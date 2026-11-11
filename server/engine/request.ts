// Pedir um título: o que acontece quando alguém aperta "Quero" no app ou pede pela Alexa. Um caminho só,
// para os dois nunca divergirem.

import type { Kind } from '../../shared/types.ts';
import type { Scheduler } from '../scheduler.ts';
import type { Services } from '../services.ts';
import type { StoredItem } from '../store.ts';
import { syncAvailability } from './sync.ts';

export class NoMetadataError extends Error {
  constructor() {
    super('configure o TMDB ou o Radarr/Sonarr');
  }
}

/** A temporada pedida não existe (o TMDB diz quais existem). */
export class SeasonNotFoundError extends Error {
  constructor(readonly available: number[]) {
    super(`temporada inexistente; a série tem ${available.length}`);
  }
}

/**
 * - created: entrou na lista agora;
 * - exists: já estava (filme, série inteira, ou a temporada pedida já estava pedida);
 * - season-added: a série estava com outras temporadas pedidas e ganhou esta;
 * - has-all-seasons: a temporada pedida já vem junto, porque a série inteira está na lista.
 */
export type RequestOutcome = 'created' | 'exists' | 'season-added' | 'has-all-seasons';

/** Põe o título na lista (ou devolve o que já estava) e dispara a busca em segundo plano. */
export async function requestTitle(
  svc: Services,
  scheduler: Scheduler,
  kind: Kind,
  tmdbId: number,
  season?: number,
): Promise<{ item: StoredItem; created: boolean; outcome: RequestOutcome }> {
  const wantSeason = kind === 'series' && season != null ? season : null;
  const existing = svc.store.findByTmdb(kind, tmdbId);
  if (existing) {
    if (wantSeason == null) return { item: existing, created: false, outcome: 'exists' };
    if (existing.seasons.length && !existing.seasons.includes(wantSeason)) throw new SeasonNotFoundError(existing.seasons);
    if (!existing.onlySeasons) return { item: existing, created: false, outcome: 'has-all-seasons' };
    if (existing.onlySeasons.includes(wantSeason)) return { item: existing, created: false, outcome: 'exists' };
    svc.store.setOnlySeasons(existing.id, [...existing.onlySeasons, wantSeason]);
    svc.store.event(existing.id, 'info', `Temporada ${wantSeason} pedida`);
    const fresh = svc.store.getItem(existing.id)!;
    void scheduler.search(fresh);
    return { item: fresh, created: false, outcome: 'season-added' };
  }

  if (!svc.meta.configured) throw new NoMetadataError();
  const details = await svc.meta.details(kind, tmdbId);
  if (wantSeason != null && details.seasons.length && !details.seasons.includes(wantSeason)) throw new SeasonNotFoundError(details.seasons);
  let item = svc.store.addItem(details);
  if (wantSeason != null) {
    svc.store.setOnlySeasons(item.id, [wantSeason]);
    svc.store.event(item.id, 'info', `Só a temporada ${wantSeason}`);
    item = svc.store.getItem(item.id)!;
  }
  // Já pode estar no Plex/Jellyfin; confere e, se não estiver, busca. Temporada pedida busca sempre: a
  // série pode estar no Plex sem ela.
  void (async () => {
    await syncAvailability(svc).catch(() => undefined);
    const fresh = svc.store.getItem(item.id);
    if (fresh && (fresh.status !== 'available' || wantSeason != null)) await scheduler.search(fresh);
  })();
  return { item, created: true, outcome: 'created' };
}
