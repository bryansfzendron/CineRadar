// Jellyfin: mapa tmdbId -> item (para "Disponível" e "Abrir no Jellyfin") e atualização da biblioteca.

import { requestBuffer, requestJson } from './http.ts';

export interface JellyfinEntry {
  id: string;
  name: string;
  year: number | null;
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
    const data = await this.req<{
      Items: { Id: string; Name: string; Type: string; ProductionYear?: number; ProviderIds?: Record<string, string> }[];
    }>('/Items', {
      query: { Recursive: true, IncludeItemTypes: 'Movie,Series', Fields: 'ProviderIds' },
    });
    const map = new Map<string, JellyfinEntry>();
    for (const item of data.Items) {
      const tmdb = item.ProviderIds?.Tmdb;
      if (!tmdb) continue;
      map.set(`${item.Type === 'Movie' ? 'movie' : 'series'}:${tmdb}`, { id: item.Id, name: item.Name, year: item.ProductionYear ?? null });
    }
    return map;
  }

  poster(id: string): Promise<{ data: Buffer; contentType: string }> {
    return requestBuffer(`${this.url}/Items/${encodeURIComponent(id)}/Images/Primary`, {
      service: 'Jellyfin',
      headers: { 'X-Emby-Token': this.key },
      query: { maxWidth: 342, quality: 80 },
      timeoutMs: 30_000,
    });
  }

  linkFor(id: string): string {
    const base = this.webUrl || this.url;
    return `${base}/web/#/details?id=${id}${this.serverId ? `&serverId=${this.serverId}` : ''}`;
  }

  async refresh(): Promise<void> {
    await this.req('/Library/Refresh', { method: 'POST' });
  }

  // ---------- tocar numa TV (Alexa: "coloca Duna na TV") ----------

  /** Apps do Jellyfin abertos agora que aceitam controle remoto, do mais recente para o mais antigo. */
  async sessions(): Promise<JellyfinSession[]> {
    const list = await this.req<
      { Id: string; DeviceName?: string; Client?: string; UserId?: string; SupportsRemoteControl?: boolean; LastActivityDate?: string }[]
    >('/Sessions');
    return list
      .filter((s) => s.SupportsRemoteControl)
      .map((s) => ({ id: s.Id, deviceName: s.DeviceName ?? s.Client ?? 'Jellyfin', userId: s.UserId ?? null, lastActivity: s.LastActivityDate ?? '' }))
      .sort((a, b) => b.lastActivity.localeCompare(a.lastActivity));
  }

  /** O episódio para continuar a série, do ponto de vista do usuário daquela sessão. */
  async nextEpisode(seriesId: string, userId: string | null): Promise<string | null> {
    const user: Record<string, string> = userId ? { UserId: userId } : {};
    const next = await this.req<{ Items: { Id: string }[] }>('/Shows/NextUp', { query: { SeriesId: seriesId, Limit: '1', ...user } }).catch(() => null);
    if (next?.Items[0]) return next.Items[0].Id;
    const all = await this.req<{ Items: { Id: string }[] }>(`/Shows/${encodeURIComponent(seriesId)}/Episodes`, { query: { Limit: '1', ...user } });
    return all.Items[0]?.Id ?? null;
  }

  async play(sessionId: string, itemId: string): Promise<void> {
    await this.req(`/Sessions/${encodeURIComponent(sessionId)}/Playing`, { method: 'POST', query: { PlayCommand: 'PlayNow', ItemIds: itemId } });
  }
}

export interface JellyfinSession {
  id: string;
  deviceName: string;
  userId: string | null;
  lastActivity: string;
}
