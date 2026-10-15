// O que já existe no Plex e no Jellyfin, unido por TMDB id. Serve para marcar "Na biblioteca" na busca
// e para a aba Biblioteca. Guarda o resultado por alguns minutos: varrer as bibliotecas custa uma
// chamada por seção no Plex e uma lista inteira no Jellyfin.

import type { Kind } from '../../shared/types.ts';
import { errorMessage } from '../integrations/http.ts';
import type { Services } from '../services.ts';

export interface OwnedTitle {
  kind: Kind;
  tmdbId: number;
  title: string;
  year: number | null;
  plexKey: string | null;
  jellyfinId: string | null;
}

const TTL_MS = 2 * 60_000;

export class OwnedLibrary {
  private cache: { at: number; map: Map<string, OwnedTitle> } | null = null;
  private loading: Promise<Map<string, OwnedTitle>> | null = null;

  constructor(private readonly svc: Services) {}

  get configured(): boolean {
    return this.svc.plex.configured || this.svc.jellyfin.configured;
  }

  /** Esquece o cache (depois de um import, por exemplo). */
  invalidate(): void {
    this.cache = null;
  }

  async all(): Promise<Map<string, OwnedTitle>> {
    if (this.cache && Date.now() - this.cache.at < TTL_MS) return this.cache.map;
    this.loading ??= this.load().finally(() => (this.loading = null));
    return this.loading;
  }

  private async load(): Promise<Map<string, OwnedTitle>> {
    const { plex, jellyfin, log } = this.svc;
    const [p, j] = await Promise.all([
      plex.configured ? plex.library().catch((err) => (log.warn(`Plex: ${errorMessage(err)}`), null)) : null,
      jellyfin.configured ? jellyfin.library().catch((err) => (log.warn(`Jellyfin: ${errorMessage(err)}`), null)) : null,
    ]);

    const map = new Map<string, OwnedTitle>();
    for (const key of new Set([...(p?.keys() ?? []), ...(j?.keys() ?? [])])) {
      const [kind, tmdb] = key.split(':') as [Kind, string];
      const px = p?.get(key);
      const jx = j?.get(key);
      map.set(key, {
        kind,
        tmdbId: Number(tmdb),
        title: px?.title ?? jx?.name ?? '',
        year: px?.year ?? jx?.year ?? null,
        plexKey: px?.ratingKey ?? null,
        jellyfinId: jx?.id ?? null,
      });
    }
    // Se as duas bibliotecas falharam, não guarda: melhor tentar de novo na próxima.
    if (p || j) this.cache = { at: Date.now(), map };
    return map;
  }

  links(t: OwnedTitle): { plexUrl: string | null; jellyfinUrl: string | null } {
    return {
      plexUrl: t.plexKey ? this.svc.plex.linkFor(t.plexKey) : null,
      jellyfinUrl: t.jellyfinId ? this.svc.jellyfin.linkFor(t.jellyfinId) : null,
    };
  }
}
