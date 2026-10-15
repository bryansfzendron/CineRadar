// Metadados: TMDB quando há chave; senão, o lookup do Radarr/Sonarr (que também usa o TMDB por trás e já
// devolve títulos em pt-BR). Sem TMDB não há listas de "em alta" e "nos cinemas".

import type { DiscoverResult, Kind } from '../../shared/types.ts';
import type { Arr, ArrLookup } from './arr.ts';
import type { Tmdb, TmdbDetails } from './tmdb.ts';

/** Caminho TMDB ("/abc.jpg") quando a imagem é do TMDB; senão, a URL inteira. */
export function imagePath(lookup: ArrLookup, type: 'poster' | 'fanart'): string | null {
  const img = lookup.images?.find((i) => i.coverType === type);
  const url = img?.remoteUrl ?? null;
  if (!url) return null;
  const m = /image\.tmdb\.org\/t\/p\/[^/]+(\/.+)$/.exec(url);
  return m?.[1] ?? url;
}

function fromLookup(l: ArrLookup, kind: Kind): Omit<DiscoverResult, 'inList' | 'inLibrary'> | null {
  if (!l.tmdbId) return null;
  return {
    kind,
    tmdbId: l.tmdbId,
    title: l.title,
    originalTitle: l.originalTitle ?? l.title,
    year: l.year || null,
    overview: l.overview ?? '',
    posterPath: imagePath(l, 'poster'),
    backdropPath: imagePath(l, 'fanart'),
    rating: l.ratings?.tmdb?.value ?? l.ratings?.value ?? null,
  };
}

export class Metadata {
  constructor(
    private readonly tmdb: Tmdb,
    private readonly radarr: Arr,
    private readonly sonarr: Arr,
  ) {}

  get configured(): boolean {
    return this.tmdb.configured || this.radarr.configured || this.sonarr.configured;
  }

  get hasLists(): boolean {
    return this.tmdb.configured;
  }

  async search(query: string, kind?: Kind): Promise<Omit<DiscoverResult, 'inList' | 'inLibrary'>[]> {
    if (this.tmdb.configured) return this.tmdb.search(query, kind);
    const out: Omit<DiscoverResult, 'inList' | 'inLibrary'>[] = [];
    const jobs: Promise<void>[] = [];
    if ((!kind || kind === 'movie') && this.radarr.configured) {
      jobs.push(this.radarr.lookup(query).then((list) => void out.push(...list.map((l) => fromLookup(l, 'movie')).filter((x) => x !== null))));
    }
    if ((!kind || kind === 'series') && this.sonarr.configured) {
      jobs.push(this.sonarr.lookup(query).then((list) => void out.push(...list.map((l) => fromLookup(l, 'series')).filter((x) => x !== null))));
    }
    await Promise.all(jobs);
    return out.slice(0, 40);
  }

  async details(kind: Kind, tmdbId: number): Promise<TmdbDetails> {
    if (this.tmdb.configured) return this.tmdb.details(kind, tmdbId);
    const arr = kind === 'movie' ? this.radarr : this.sonarr;
    const l = await arr.lookupOne(tmdbId);
    if (!l) throw new Error(`${arr.service} não achou este título`);
    const titles = new Set([l.title, l.originalTitle ?? l.title, ...(l.alternateTitles ?? []).map((a) => a.title)]);
    return {
      kind,
      tmdbId,
      imdbId: l.imdbId ?? null,
      tvdbId: l.tvdbId ?? null,
      title: l.title,
      originalTitle: l.originalTitle ?? l.title,
      altTitles: [...titles].filter(Boolean).slice(0, 6),
      year: l.year || null,
      overview: l.overview ?? '',
      posterPath: imagePath(l, 'poster'),
      backdropPath: imagePath(l, 'fanart'),
      genres: l.genres ?? [],
      runtime: l.runtime || null,
      rating: l.ratings?.tmdb?.value ?? l.ratings?.value ?? null,
      seasons: (l.seasons ?? []).map((s) => s.seasonNumber).filter((n) => n > 0),
      cast: [],
    };
  }
}
