// Envia um release para download. Ordem de preferência:
// 1. release da busca do Radarr/Sonarr → grab pelo GUID (o *arr acompanha e importa sozinho);
// 2. release de fora (Prowlarr/Torznab) → push para o *arr, que confere e baixa;
// 3. se o *arr recusar o push → qBittorrent direto, e o CineRadar pede a importação manual ao terminar.

import { Arr } from '../integrations/arr.ts';
import { errorMessage } from '../integrations/http.ts';
import { magnetHash } from '../integrations/qbittorrent.ts';
import type { Services } from '../services.ts';
import type { StoredItem, StoredRelease } from '../store.ts';
import { ensureArr } from './search.ts';

export async function dispatchRelease(svc: Services, item: StoredItem, release: StoredRelease, how: 'auto' | 'manual'): Promise<string> {
  const arr = item.kind === 'movie' ? svc.radarr : svc.sonarr;
  if (!arr.configured) throw new Error(`${arr.service} não está configurado`);
  const arrId = await ensureArr(svc, item);
  const who = how === 'auto' ? 'Envio automático' : 'Aprovado';
  let via: string;

  if ((release.source === 'radarr' || release.source === 'sonarr') && release.indexerId != null) {
    try {
      await arr.grab(release.guid, release.indexerId, arrId);
    } catch (err) {
      // O resultado da busca expira no *arr (~30 min): busca de novo e tenta outra vez.
      if (!Arr.isNotFound(err)) throw err;
      await arr.searchReleases(arrId, release.season ?? undefined);
      await arr.grab(release.guid, release.indexerId, arrId);
    }
    via = arr.service;
  } else {
    const pushed = await arr.push({
      title: release.title,
      downloadUrl: release.downloadUrl,
      magnetUrl: release.magnetUrl,
      publishDate: release.publishDate,
      indexer: `CineRadar (${release.indexer || release.sourceName})`,
      size: release.size,
    });
    if (pushed.approved) {
      via = arr.service;
    } else if (svc.qbit.configured && (release.magnetUrl || release.downloadUrl)) {
      await svc.qbit.add((release.magnetUrl ?? release.downloadUrl)!);
      const hash = release.infoHash ?? magnetHash(release.magnetUrl);
      svc.store.update(item.id, { downloadHash: hash });
      via = 'qBittorrent';
      svc.store.event(item.id, 'info', `${arr.service} recusou o push (${pushed.rejections.join('; ') || 'sem motivo'}); enviado direto ao qBittorrent`);
    } else {
      throw new Error(`${arr.service} recusou o release: ${pushed.rejections.join('; ') || 'sem motivo'}`);
    }
  }

  svc.store.setReleaseStatus(release.id, 'sent');
  const season = release.season != null ? ` (T${release.season})` : '';
  svc.store.update(item.id, { status: 'sent', statusDetail: `Enviado ao ${via}${season}`, progress: 0 });
  svc.store.event(item.id, 'sent', `${who}: "${release.title}" (nota ${release.score}) → ${via}`);
  svc.log.info(`[dispatch] ${item.title}: ${release.title} → ${via}`);
  return via;
}

/** Envia sozinho o melhor release elegível (filme) ou o melhor de cada temporada ainda não enviada (série). */
export async function autoDispatch(svc: Services, item: StoredItem): Promise<number> {
  const releases = svc.store.releases(item.id);
  const eligible = releases.filter((r) => r.autoEligible && r.status === 'new');
  const picks: StoredRelease[] = [];
  if (item.kind === 'movie') {
    if (eligible[0]) picks.push(eligible[0]);
  } else {
    const sentSeasons = new Set(releases.filter((r) => r.status === 'sent').map((r) => r.season));
    // Série completa elegível cobre tudo; senão, uma por temporada.
    const complete = eligible.find((r) => r.season == null);
    if (complete && sentSeasons.size === 0) picks.push(complete);
    else {
      for (const r of eligible) {
        if (r.season == null || sentSeasons.has(r.season) || picks.some((p) => p.season === r.season)) continue;
        picks.push(r);
      }
    }
  }
  let sent = 0;
  for (const pick of picks) {
    try {
      await dispatchRelease(svc, item, pick, 'auto');
      sent++;
    } catch (err) {
      svc.store.setReleaseStatus(pick.id, 'failed', errorMessage(err));
      svc.store.event(item.id, 'error', `Falha ao enviar "${pick.title}": ${errorMessage(err)}`);
    }
  }
  return sent;
}
