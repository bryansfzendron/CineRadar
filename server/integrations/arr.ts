// Radarr e Sonarr: a API v3 dos dois é quase igual. Aqui ficam busca interativa, envio de release
// (grab por GUID ou push por URL/magnet), cadastro de filme/série, fila e importação manual.

import { HttpError, requestJson } from './http.ts';

export type ArrKind = 'radarr' | 'sonarr';

export interface ArrRelease {
  guid: string;
  indexerId: number;
  indexer: string;
  title: string;
  size: number;
  seeders?: number | null;
  leechers?: number | null;
  protocol: string;
  publishDate?: string;
  infoUrl?: string | null;
  downloadUrl?: string | null;
  magnetUrl?: string | null;
  infoHash?: string | null;
  languages?: { id: number; name: string }[];
  customFormatScore?: number;
  rejected?: boolean;
  rejections?: (string | { reason?: string })[];
  approved?: boolean;
  seasonNumber?: number;
  fullSeason?: boolean;
}

export interface ArrQueueRecord {
  id: number;
  movieId?: number;
  seriesId?: number;
  title: string;
  size: number;
  sizeleft: number;
  status: string;
  trackedDownloadState?: string;
  trackedDownloadStatus?: string;
  errorMessage?: string;
  downloadId?: string;
  timeleft?: string;
}

export interface ArrMovie {
  id: number;
  title: string;
  tmdbId: number;
  imdbId?: string;
  hasFile?: boolean;
  monitored: boolean;
}

export interface ArrSeries {
  id: number;
  title: string;
  tvdbId: number;
  tmdbId?: number;
  monitored: boolean;
  statistics?: { episodeFileCount: number; episodeCount: number; totalEpisodeCount: number; percentOfEpisodes: number };
}

/** Resultado de /movie/lookup e /series/lookup. */
export interface ArrLookup {
  title: string;
  originalTitle?: string;
  year?: number;
  overview?: string;
  tmdbId?: number;
  tvdbId?: number;
  imdbId?: string;
  runtime?: number;
  genres?: string[];
  images?: { coverType: string; remoteUrl?: string; url?: string }[];
  ratings?: { value?: number; tmdb?: { value?: number } };
  alternateTitles?: { title: string }[];
  seasons?: { seasonNumber: number }[];
}

export function rejectionText(r: ArrRelease['rejections']): string[] {
  return (r ?? []).map((x) => (typeof x === 'string' ? x : (x.reason ?? ''))).filter(Boolean);
}

export class Arr {
  readonly service: string;

  constructor(
    readonly kind: ArrKind,
    private readonly url: string,
    private readonly key: string,
    private readonly rootFolder: string,
    private readonly qualityProfile: string,
  ) {
    this.service = kind === 'radarr' ? 'Radarr' : 'Sonarr';
  }

  get configured(): boolean {
    return Boolean(this.url && this.key);
  }

  private req<T>(path: string, opts: { method?: string; query?: Record<string, string | number | boolean | undefined>; json?: unknown; timeoutMs?: number } = {}): Promise<T> {
    return requestJson<T>(`${this.url}/api/v3${path}`, {
      service: this.service,
      headers: { 'X-Api-Key': this.key },
      ...opts,
    });
  }

  async version(): Promise<string> {
    const s = await this.req<{ version: string }>('/system/status');
    return s.version;
  }

  private async qualityProfileId(): Promise<number> {
    const profiles = await this.req<{ id: number; name: string }[]>('/qualityprofile');
    const wanted = this.qualityProfile.toLowerCase();
    const match = profiles.find((p) => p.name.toLowerCase() === wanted || String(p.id) === wanted) ?? profiles[0];
    if (!match) throw new Error(`${this.service}: nenhum perfil de qualidade`);
    return match.id;
  }

  // ---------- filmes (Radarr) ----------

  async movies(): Promise<ArrMovie[]> {
    return this.req<ArrMovie[]>('/movie');
  }

  async movieByTmdb(tmdbId: number): Promise<ArrMovie | null> {
    const list = await this.req<ArrMovie[]>('/movie', { query: { tmdbId } });
    return list[0] ?? null;
  }

  /**
   * Cadastra o filme sem monitorar e sem busca automática: quem escolhe o release é o CineRadar.
   * Monitorado, o RSS do Radarr baixaria sozinho qualquer versão (inclusive sem português).
   */
  async ensureMovie(tmdbId: number): Promise<ArrMovie> {
    const existing = await this.movieByTmdb(tmdbId);
    if (existing) return existing;
    const lookup = await this.req<Record<string, unknown>>('/movie/lookup/tmdb', { query: { tmdbId } });
    return this.req<ArrMovie>('/movie', {
      method: 'POST',
      json: {
        ...lookup,
        qualityProfileId: await this.qualityProfileId(),
        rootFolderPath: this.rootFolder,
        monitored: false,
        minimumAvailability: 'released',
        tags: [],
        addOptions: { searchForMovie: false },
      },
    });
  }

  // ---------- séries (Sonarr) ----------

  async seriesList(): Promise<ArrSeries[]> {
    return this.req<ArrSeries[]>('/series');
  }

  async ensureSeries(tmdbId: number, tvdbId: number | null): Promise<ArrSeries> {
    const all = await this.seriesList();
    const existing = all.find((s) => (tvdbId && s.tvdbId === tvdbId) || (s.tmdbId && s.tmdbId === tmdbId));
    if (existing) return existing;
    const term = tvdbId ? `tvdb:${tvdbId}` : `tmdb:${tmdbId}`;
    const [lookup] = await this.req<Record<string, unknown>[]>('/series/lookup', { query: { term } });
    if (!lookup) throw new Error(`Sonarr não achou a série (${term})`);
    return this.req<ArrSeries>('/series', {
      method: 'POST',
      json: {
        ...lookup,
        qualityProfileId: await this.qualityProfileId(),
        rootFolderPath: this.rootFolder,
        // Sem monitorar, pelo mesmo motivo do Radarr: o RSS do Sonarr não baixa nada por conta própria.
        monitored: false,
        seasonFolder: true,
        seriesType: 'standard',
        tags: [],
        addOptions: { monitor: 'none', searchForMissingEpisodes: false, searchForCutoffUnmetEpisodes: false },
      },
    });
  }

  // ---------- metadados (plano B sem TMDB) ----------

  async lookup(term: string): Promise<ArrLookup[]> {
    return this.req<ArrLookup[]>(this.kind === 'radarr' ? '/movie/lookup' : '/series/lookup', { query: { term }, timeoutMs: 30_000 });
  }

  async lookupOne(tmdbId: number): Promise<ArrLookup | null> {
    if (this.kind === 'radarr') return this.req<ArrLookup>('/movie/lookup/tmdb', { query: { tmdbId } }).catch(() => null);
    const [first] = await this.lookup(`tmdb:${tmdbId}`);
    return first ?? null;
  }

  // ---------- releases ----------

  /** Busca interativa: o *arr consulta os indexadores dele (sincronizados pelo Prowlarr) e já casa com o título. */
  async searchReleases(arrId: number, season?: number): Promise<ArrRelease[]> {
    const query = this.kind === 'radarr' ? { movieId: arrId } : { seriesId: arrId, seasonNumber: season };
    return this.req<ArrRelease[]>('/release', { query, timeoutMs: 120_000 });
  }

  /** Baixa um release da busca interativa (o *arr guarda o resultado da busca por ~30 min). */
  async grab(guid: string, indexerId: number, arrId: number): Promise<void> {
    const json: Record<string, unknown> = { guid, indexerId };
    if (this.kind === 'radarr') json.movieId = arrId;
    else json.seriesId = arrId;
    await this.req('/release', { method: 'POST', json, timeoutMs: 60_000 });
  }

  /** Empurra um release de fora (Prowlarr/Torznab). Devolve se o *arr aceitou e baixou. */
  async push(release: {
    title: string;
    downloadUrl: string | null;
    magnetUrl: string | null;
    publishDate: string | null;
    indexer: string;
    size: number;
  }): Promise<{ approved: boolean; rejections: string[] }> {
    const res = await this.req<ArrRelease | ArrRelease[]>('/release/push', {
      method: 'POST',
      timeoutMs: 60_000,
      json: {
        title: release.title,
        downloadUrl: release.downloadUrl ?? release.magnetUrl,
        magnetUrl: release.magnetUrl,
        protocol: 'torrent',
        publishDate: release.publishDate ?? new Date().toISOString(),
        indexer: release.indexer,
        size: release.size,
      },
    });
    const first = Array.isArray(res) ? res[0] : res;
    return { approved: Boolean(first?.approved), rejections: rejectionText(first?.rejections) };
  }

  async queue(): Promise<ArrQueueRecord[]> {
    const data = await this.req<{ records: ArrQueueRecord[] }>('/queue', {
      query: { pageSize: 500, includeUnknownMovieItems: false, includeUnknownSeriesItems: false },
    });
    return data.records;
  }

  /** Importa uma pasta baixada fora do *arr (pelo qBittorrent direto), indicando o filme/série. */
  async manualImport(folder: string, arrId: number): Promise<number> {
    const query = this.kind === 'radarr' ? { folder, movieId: arrId, filterExistingFiles: false } : { folder, seriesId: arrId, filterExistingFiles: false };
    const items = await this.req<
      {
        path: string;
        quality: unknown;
        languages: unknown;
        releaseGroup?: string;
        episodes?: { id: number }[];
        rejections?: unknown[];
      }[]
    >('/manualimport', { query, timeoutMs: 120_000 });
    const files = items
      .filter((i) => this.kind === 'radarr' || (i.episodes?.length ?? 0) > 0)
      .map((i) => ({
        path: i.path,
        quality: i.quality,
        languages: i.languages,
        releaseGroup: i.releaseGroup,
        ...(this.kind === 'radarr' ? { movieId: arrId } : { seriesId: arrId, episodeIds: i.episodes!.map((e) => e.id) }),
      }));
    if (files.length === 0) return 0;
    await this.req('/command', { method: 'POST', json: { name: 'ManualImport', files, importMode: 'auto' } });
    return files.length;
  }

  /** Ignora erro 404 (item apagado no *arr). */
  static isNotFound(err: unknown): boolean {
    return err instanceof HttpError && err.status === 404;
  }
}
