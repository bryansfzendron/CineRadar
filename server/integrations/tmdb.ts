// TMDB: busca, detalhes e listas em pt-BR. Aceita a chave v3 (api_key) ou o token de leitura v4 (Bearer).

import type { CastMember, DiscoverResult, Kind } from '../../shared/types.ts';
import { requestJson } from './http.ts';

const BASE = 'https://api.themoviedb.org/3';

interface TmdbListItem {
  id: number;
  media_type?: 'movie' | 'tv' | 'person';
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  release_date?: string;
  first_air_date?: string;
  overview?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  vote_average?: number;
}

export interface TmdbDetails {
  kind: Kind;
  tmdbId: number;
  imdbId: string | null;
  tvdbId: number | null;
  title: string;
  originalTitle: string;
  altTitles: string[];
  year: number | null;
  overview: string;
  posterPath: string | null;
  backdropPath: string | null;
  genres: string[];
  runtime: number | null;
  rating: number | null;
  seasons: number[];
  cast: CastMember[];
}

function yearOf(date?: string): number | null {
  const y = date ? Number(date.slice(0, 4)) : NaN;
  return Number.isFinite(y) && y > 1800 ? y : null;
}

export class Tmdb {
  constructor(
    private readonly key: string,
    private readonly language: string,
    private readonly region: string,
  ) {}

  get configured(): boolean {
    return Boolean(this.key);
  }

  private get<T>(path: string, query: Record<string, string | number | undefined> = {}): Promise<T> {
    const bearer = this.key.startsWith('eyJ');
    return requestJson<T>(`${BASE}${path}`, {
      service: 'TMDB',
      headers: bearer ? { Authorization: `Bearer ${this.key}` } : {},
      query: { language: this.language, ...(bearer ? {} : { api_key: this.key }), ...query },
    });
  }

  async ping(): Promise<void> {
    await this.get('/configuration');
  }

  private toResult(r: TmdbListItem, kind: Kind): Omit<DiscoverResult, 'inList'> {
    return {
      kind,
      tmdbId: r.id,
      title: (kind === 'movie' ? r.title : r.name) ?? '',
      originalTitle: (kind === 'movie' ? r.original_title : r.original_name) ?? '',
      year: yearOf(kind === 'movie' ? r.release_date : r.first_air_date),
      overview: r.overview ?? '',
      posterPath: r.poster_path ?? null,
      backdropPath: r.backdrop_path ?? null,
      rating: r.vote_average ? Math.round(r.vote_average * 10) / 10 : null,
    };
  }

  async search(query: string, kind?: Kind): Promise<Omit<DiscoverResult, 'inList'>[]> {
    if (kind) {
      const data = await this.get<{ results: TmdbListItem[] }>(kind === 'movie' ? '/search/movie' : '/search/tv', {
        query,
        include_adult: 'false',
        region: this.region,
      });
      return data.results.map((r) => this.toResult(r, kind));
    }
    const data = await this.get<{ results: TmdbListItem[] }>('/search/multi', { query, include_adult: 'false' });
    return data.results
      .filter((r) => r.media_type === 'movie' || r.media_type === 'tv')
      .map((r) => this.toResult(r, r.media_type === 'movie' ? 'movie' : 'series'));
  }

  async list(kind: Kind, which: 'trending' | 'now_playing' | 'popular' | 'upcoming' | 'on_the_air'): Promise<Omit<DiscoverResult, 'inList'>[]> {
    const t = kind === 'movie' ? 'movie' : 'tv';
    const path = which === 'trending' ? `/trending/${t}/week` : `/${t}/${which}`;
    const data = await this.get<{ results: TmdbListItem[] }>(path, { region: this.region });
    return data.results.map((r) => this.toResult(r, kind));
  }

  async details(kind: Kind, tmdbId: number): Promise<TmdbDetails> {
    if (kind === 'movie') {
      const m = await this.get<{
        id: number;
        imdb_id: string | null;
        title: string;
        original_title: string;
        release_date: string;
        overview: string;
        poster_path: string | null;
        backdrop_path: string | null;
        genres: { name: string }[];
        runtime: number | null;
        vote_average: number;
        credits?: { cast: { name: string; character: string; profile_path: string | null }[] };
        alternative_titles?: { titles: { iso_3166_1: string; title: string }[] };
        translations?: { translations: { iso_3166_1: string; iso_639_1: string; data: { title?: string } }[] };
      }>(`/movie/${tmdbId}`, { append_to_response: 'credits,alternative_titles,translations' });
      return {
        kind,
        tmdbId: m.id,
        imdbId: m.imdb_id || null,
        tvdbId: null,
        title: m.title,
        originalTitle: m.original_title,
        altTitles: altTitles(m.title, m.original_title, m.alternative_titles?.titles, m.translations?.translations),
        year: yearOf(m.release_date),
        overview: m.overview,
        posterPath: m.poster_path,
        backdropPath: m.backdrop_path,
        genres: m.genres.map((g) => g.name),
        runtime: m.runtime,
        rating: m.vote_average ? Math.round(m.vote_average * 10) / 10 : null,
        seasons: [],
        cast: castOf(m.credits?.cast),
      };
    }
    const s = await this.get<{
      id: number;
      name: string;
      original_name: string;
      first_air_date: string;
      overview: string;
      poster_path: string | null;
      backdrop_path: string | null;
      genres: { name: string }[];
      episode_run_time: number[];
      vote_average: number;
      seasons: { season_number: number; episode_count: number }[];
      external_ids?: { imdb_id: string | null; tvdb_id: number | null };
      credits?: { cast: { name: string; character: string; profile_path: string | null }[] };
      alternative_titles?: { results: { iso_3166_1: string; title: string }[] };
      translations?: { translations: { iso_3166_1: string; iso_639_1: string; data: { name?: string } }[] };
    }>(`/tv/${tmdbId}`, { append_to_response: 'external_ids,credits,alternative_titles,translations' });
    return {
      kind,
      tmdbId: s.id,
      imdbId: s.external_ids?.imdb_id || null,
      tvdbId: s.external_ids?.tvdb_id || null,
      title: s.name,
      originalTitle: s.original_name,
      altTitles: altTitles(
        s.name,
        s.original_name,
        s.alternative_titles?.results,
        s.translations?.translations.map((t) => ({ ...t, data: { title: t.data.name } })),
      ),
      year: yearOf(s.first_air_date),
      overview: s.overview,
      posterPath: s.poster_path,
      backdropPath: s.backdrop_path,
      genres: s.genres.map((g) => g.name),
      runtime: s.episode_run_time[0] ?? null,
      rating: s.vote_average ? Math.round(s.vote_average * 10) / 10 : null,
      seasons: s.seasons.filter((x) => x.season_number > 0 && x.episode_count > 0).map((x) => x.season_number),
      cast: castOf(s.credits?.cast),
    };
  }
}

function castOf(cast?: { name: string; character: string; profile_path: string | null }[]): CastMember[] {
  return (cast ?? []).slice(0, 8).map((c) => ({ name: c.name, character: c.character || null, profilePath: c.profile_path }));
}

/** Títulos usados na busca: pt-BR, original, inglês e os alternativos do Brasil/EUA. */
function altTitles(
  title: string,
  original: string,
  alternatives?: { iso_3166_1: string; title: string }[],
  translations?: { iso_3166_1: string; iso_639_1: string; data: { title?: string } }[],
): string[] {
  const set = new Set<string>([title, original]);
  for (const t of translations ?? []) {
    if ((t.iso_639_1 === 'en' && t.iso_3166_1 === 'US') || (t.iso_639_1 === 'pt' && t.iso_3166_1 === 'BR')) {
      if (t.data.title) set.add(t.data.title);
    }
  }
  for (const a of alternatives ?? []) if (a.iso_3166_1 === 'BR' || a.iso_3166_1 === 'US') set.add(a.title);
  return [...set].filter(Boolean).slice(0, 6);
}
