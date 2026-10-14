// Mantém o status dos itens em dia com o mundo lá fora: fila do Radarr/Sonarr, qBittorrent e bibliotecas
// do Plex/Jellyfin.

import type { ItemStatus } from '../../shared/types.ts';
import type { ArrQueueRecord } from '../integrations/arr.ts';
import { errorMessage } from '../integrations/http.ts';
import type { JellyfinEntry } from '../integrations/jellyfin.ts';
import type { PlexEntry } from '../integrations/plex.ts';
import type { Services } from '../services.ts';
import type { StoredItem } from '../store.ts';

const ACTIVE: ItemStatus[] = ['sent', 'downloading'];

function queueDetail(r: ArrQueueRecord): string {
  if (r.errorMessage) return r.errorMessage;
  const state = r.trackedDownloadState ?? r.status;
  const map: Record<string, string> = {
    downloading: 'Baixando',
    importPending: 'Aguardando importação',
    importing: 'Importando',
    importBlocked: 'Importação bloqueada (ver Radarr/Sonarr)',
    failedPending: 'Falhou, aguardando',
    queued: 'Na fila',
    paused: 'Pausado',
    completed: 'Concluído',
    stalled: 'Parado (sem seeders)',
  };
  const text = map[state] ?? state;
  return r.timeleft && state === 'downloading' ? `${text} · falta ${r.timeleft}` : text;
}

/** Fila do Radarr/Sonarr e torrents do qBittorrent → progresso dos itens enviados. */
export async function syncDownloads(svc: Services): Promise<void> {
  const items = svc.store.listItems().filter((i) => ACTIVE.includes(i.status));
  if (items.length === 0) return;

  const queues: Record<'movie' | 'series', ArrQueueRecord[] | null> = { movie: null, series: null };
  if (items.some((i) => i.kind === 'movie') && svc.radarr.configured) queues.movie = await svc.radarr.queue().catch(() => null);
  if (items.some((i) => i.kind === 'series') && svc.sonarr.configured) queues.series = await svc.sonarr.queue().catch(() => null);
  const torrents = items.some((i) => i.downloadHash) && svc.qbit.configured ? await svc.qbit.torrents().catch(() => []) : [];

  for (const item of items) {
    // Baixado direto pelo qBittorrent (o *arr recusou o push).
    if (item.downloadHash) {
      const t = torrents.find((x) => x.hash.toLowerCase() === item.downloadHash);
      if (t) {
        if (t.progress >= 1 && !(item.statusDetail ?? '').startsWith('Importando')) {
          const arr = item.kind === 'movie' ? svc.radarr : svc.sonarr;
          try {
            const n = await arr.manualImport(t.content_path, item.arrId!);
            svc.store.update(item.id, { status: 'downloading', progress: 1, statusDetail: `Importando ${n} arquivo(s) no ${arr.service}` });
            svc.store.event(item.id, 'download', `Download concluído; ${arr.service} importando ${n} arquivo(s)`);
          } catch (err) {
            svc.store.update(item.id, { statusDetail: `Importação falhou: ${errorMessage(err)}` });
          }
        } else if (t.progress < 1) {
          svc.store.update(item.id, { status: 'downloading', progress: t.progress, statusDetail: `Baixando no qBittorrent (${t.state})` });
        }
        continue;
      }
    }
    const queue = item.kind === 'movie' ? queues.movie : queues.series;
    if (!queue || !item.arrId) continue;
    const records = queue.filter((r) => (item.kind === 'movie' ? r.movieId : r.seriesId) === item.arrId);
    if (records.length === 0) continue;
    const size = records.reduce((s, r) => s + r.size, 0);
    const left = records.reduce((s, r) => s + r.sizeleft, 0);
    const progress = size > 0 ? Math.max(0, Math.min(1, 1 - left / size)) : 0;
    if (item.status !== 'downloading') svc.store.event(item.id, 'download', 'Download começou');
    svc.store.update(item.id, { status: 'downloading', progress, statusDetail: queueDetail(records[0]!) });
  }
}

/** Plex/Jellyfin (e arquivos no Radarr/Sonarr) → "Disponível", com os links. */
export async function syncAvailability(svc: Services): Promise<void> {
  const items = svc.store.listItems();
  if (items.length === 0) return;

  let plex: Map<string, PlexEntry> | null = null;
  let jelly: Map<string, JellyfinEntry> | null = null;
  if (svc.plex.configured) plex = await svc.plex.library().catch((err) => (svc.log.warn(`Plex: ${errorMessage(err)}`), null));
  if (svc.jellyfin.configured) jelly = await svc.jellyfin.library().catch((err) => (svc.log.warn(`Jellyfin: ${errorMessage(err)}`), null));

  // Filmes com arquivo no Radarr contam como disponíveis mesmo antes do Plex/Jellyfin terminarem de varrer.
  const radarrFiles = new Set<number>();
  if (svc.radarr.configured && items.some((i) => i.kind === 'movie')) {
    for (const m of await svc.radarr.movies().catch(() => [])) if (m.hasFile) radarrFiles.add(m.tmdbId);
  }
  const sonarrDone = new Map<number, number>();
  if (svc.sonarr.configured && items.some((i) => i.kind === 'series')) {
    for (const s of await svc.sonarr.seriesList().catch(() => [])) {
      if (s.statistics) sonarrDone.set(s.id, s.statistics.episodeFileCount);
    }
  }

  for (const item of items) {
    const key = `${item.kind}:${item.tmdbId}`;
    const p = plex?.get(key) ?? null;
    const j = jelly?.get(key) ?? null;
    const patch: Parameters<Services['store']['update']>[1] = {};
    if (plex && (p?.ratingKey ?? null) !== item.plexKey) patch.plexKey = p?.ratingKey ?? null;
    if (jelly && (j?.id ?? null) !== item.jellyfinId) patch.jellyfinId = j?.id ?? null;

    const inServer = Boolean(p || j);
    const hasFiles = item.kind === 'movie' ? radarrFiles.has(item.tmdbId) : (item.arrId ? (sonarrDone.get(item.arrId) ?? 0) > 0 : false);
    if ((inServer || hasFiles) && item.status !== 'available') {
      patch.status = 'available';
      patch.progress = null;
      const where = [p && 'Plex', j && 'Jellyfin'].filter(Boolean).join(' e ');
      patch.statusDetail = where ? `No ${where}` : `Arquivo no ${item.kind === 'movie' ? 'Radarr' : 'Sonarr'}`;
      svc.store.event(item.id, 'available', where ? `Disponível no ${where}` : 'Arquivo importado; aguardando o Plex/Jellyfin');
    } else if (item.status === 'available' && inServer) {
      const where = [p && 'Plex', j && 'Jellyfin'].filter(Boolean).join(' e ');
      if (item.statusDetail !== `No ${where}`) patch.statusDetail = `No ${where}`;
    }
    if (Object.keys(patch).length) svc.store.update(item.id, patch);
  }
}

/** Depois de um import: pede para o Plex e o Jellyfin varrerem as bibliotecas. */
export async function refreshLibraries(svc: Services): Promise<void> {
  const tasks: Promise<unknown>[] = [];
  if (svc.plex.configured) tasks.push(svc.plex.refreshAll().catch((err) => svc.log.warn(`Plex refresh: ${errorMessage(err)}`)));
  if (svc.jellyfin.configured) tasks.push(svc.jellyfin.refresh().catch((err) => svc.log.warn(`Jellyfin refresh: ${errorMessage(err)}`)));
  await Promise.all(tasks);
}

export function isActive(item: StoredItem): boolean {
  return ACTIVE.includes(item.status);
}
