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

/** Põe o título na lista (ou devolve o que já estava) e dispara a busca em segundo plano. */
export async function requestTitle(
  svc: Services,
  scheduler: Scheduler,
  kind: Kind,
  tmdbId: number,
): Promise<{ item: StoredItem; created: boolean }> {
  const existing = svc.store.findByTmdb(kind, tmdbId);
  if (existing) return { item: existing, created: false };
  if (!svc.meta.configured) throw new NoMetadataError();
  const details = await svc.meta.details(kind, tmdbId);
  const item = svc.store.addItem(details);
  // Já pode estar no Plex/Jellyfin; confere e, se não estiver, busca.
  void (async () => {
    await syncAvailability(svc).catch(() => undefined);
    const fresh = svc.store.getItem(item.id);
    if (fresh && fresh.status !== 'available') await scheduler.search(fresh);
  })();
  return { item, created: true };
}
