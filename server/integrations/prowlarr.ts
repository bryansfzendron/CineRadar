// Prowlarr: busca em todos os indexadores configurados (inclusive os brasileiros que o usuário cadastrar).

import { requestJson } from './http.ts';

export interface ProwlarrResult {
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
  categories?: { id: number }[];
}

export interface ProwlarrIndexer {
  id: number;
  name: string;
  enable: boolean;
  language?: string;
  protocol: string;
}

export class Prowlarr {
  constructor(
    private readonly url: string,
    private readonly key: string,
  ) {}

  get configured(): boolean {
    return Boolean(this.url && this.key);
  }

  private req<T>(path: string, query?: Record<string, string | number | (string | number)[] | undefined>, timeoutMs = 20_000): Promise<T> {
    return requestJson<T>(`${this.url}/api/v1${path}`, {
      service: 'Prowlarr',
      headers: { 'X-Api-Key': this.key },
      query,
      timeoutMs,
    });
  }

  async version(): Promise<string> {
    return (await this.req<{ version: string }>('/system/status')).version;
  }

  async indexers(): Promise<ProwlarrIndexer[]> {
    return this.req<ProwlarrIndexer[]>('/indexer');
  }

  /** Indexadores com falha recente (o Prowlarr desliga temporariamente). */
  async failing(): Promise<number[]> {
    const status = await this.req<{ indexerId: number; disabledTill?: string }[]>('/indexerstatus');
    return status.filter((s) => s.disabledTill && new Date(s.disabledTill) > new Date()).map((s) => s.indexerId);
  }

  /** categories: 2000 = filmes, 5000 = TV (padrão Newznab). */
  async search(query: string, kind: 'movie' | 'series'): Promise<ProwlarrResult[]> {
    return this.req<ProwlarrResult[]>(
      '/search',
      { query, type: 'search', categories: kind === 'movie' ? [2000] : [5000], limit: 100 },
      90_000,
    );
  }
}
