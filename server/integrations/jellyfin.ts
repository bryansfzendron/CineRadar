// Jellyfin: mapa tmdbId -> item (para "Disponível" e "Abrir no Jellyfin") e atualização da biblioteca.

import { requestJson } from './http.ts';

export interface JellyfinEntry {
  id: string;
  name: string;
}

export class Jellyfin {
  private serverId: string | null = null;

  constructor(
    private readonly url: string,
    private readonly key: string,
    private readonly webUrl: string,
  ) {}

  get configured(): boolean {
    return Boolean(this.url && this.key);
  }

  private req<T>(path: string, opts: { method?: string; query?: Record<string, string | boolean> } = {}): Promise<T> {
    return requestJson<T>(`${this.url}${path}`, {
      service: 'Jellyfin',
      headers: { Authorization: `MediaBrowser Token="${this.key}"`, 'X-Emby-Token': this.key },
      timeoutMs: 30_000,
      ...opts,
    });
  }

  async version(): Promise<string> {
    const info = await this.req<{ Version: string; Id: string }>('/System/Info');
    this.serverId = info.Id;
    return info.Version;
  }

  async library(): Promise<Map<string, JellyfinEntry>> {
    if (!this.serverId) await this.version();
    const data = await this.req<{ Items: { Id: string; Name: string; Type: string; ProviderIds?: Record<string, string> }[] }>('/Items', {
      query: { Recursive: true, IncludeItemTypes: 'Movie,Series', Fields: 'ProviderIds' },
    });
    const map = new Map<string, JellyfinEntry>();
    for (const item of data.Items) {
      const tmdb = item.ProviderIds?.Tmdb;
      if (!tmdb) continue;
      map.set(`${item.Type === 'Movie' ? 'movie' : 'series'}:${tmdb}`, { id: item.Id, name: item.Name });
    }
    return map;
  }

  linkFor(id: string): string {
    const base = this.webUrl || this.url;
    return `${base}/web/#/details?id=${id}${this.serverId ? `&serverId=${this.serverId}` : ''}`;
  }

  async refresh(): Promise<void> {
    await this.req('/Library/Refresh', { method: 'POST' });
  }
}
