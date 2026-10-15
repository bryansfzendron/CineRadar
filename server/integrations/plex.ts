// Plex: mapa tmdbId -> item da biblioteca (para "Disponível" e "Abrir no Plex") e atualização de bibliotecas.

import type { Kind } from '../../shared/types.ts';
import { requestBuffer, requestJson } from './http.ts';

interface Section {
  key: string;
  type: 'movie' | 'show' | string;
  title: string;
}

export interface PlexEntry {
  ratingKey: string;
  title: string;
  year: number | null;
}

export class Plex {
  private machineId: string | null = null;

  constructor(
    private readonly url: string,
    private readonly token: string,
    private readonly webUrl: string,
  ) {}

  get configured(): boolean {
    return Boolean(this.url && this.token);
  }

  private req<T>(path: string, query: Record<string, string | number> = {}): Promise<T> {
    return requestJson<T>(`${this.url}${path}`, {
      service: 'Plex',
      headers: { 'X-Plex-Token': this.token, Accept: 'application/json' },
      query,
      timeoutMs: 30_000,
    });
  }

  async version(): Promise<string> {
    const data = await this.req<{ MediaContainer: { version: string; machineIdentifier: string } }>('/');
    this.machineId = data.MediaContainer.machineIdentifier;
    return data.MediaContainer.version;
  }

  private async sections(): Promise<Section[]> {
    const data = await this.req<{ MediaContainer: { Directory?: Section[] } }>('/library/sections');
    return data.MediaContainer.Directory ?? [];
  }

  /** Mapa "movie:123" / "series:456" -> item da biblioteca. */
  async library(): Promise<Map<string, PlexEntry>> {
    if (!this.machineId) await this.version();
    const map = new Map<string, PlexEntry>();
    for (const section of await this.sections()) {
      if (section.type !== 'movie' && section.type !== 'show') continue;
      const kind: Kind = section.type === 'movie' ? 'movie' : 'series';
      const data = await this.req<{
        MediaContainer: { Metadata?: { ratingKey: string; title: string; year?: number; Guid?: { id: string }[] }[] };
      }>(`/library/sections/${section.key}/all`, { includeGuids: 1 });
      for (const m of data.MediaContainer.Metadata ?? []) {
        const tmdb = m.Guid?.find((g) => g.id.startsWith('tmdb://'))?.id.slice(7);
        if (tmdb) map.set(`${kind}:${tmdb}`, { ratingKey: m.ratingKey, title: m.title, year: m.year ?? null });
      }
    }
    return map;
  }

  /** Cartaz do item, já reduzido pelo próprio Plex. */
  poster(ratingKey: string): Promise<{ data: Buffer; contentType: string }> {
    return requestBuffer(`${this.url}/photo/:/transcode`, {
      service: 'Plex',
      headers: { 'X-Plex-Token': this.token },
      query: { width: 342, height: 513, minSize: 1, url: `/library/metadata/${ratingKey}/thumb` },
      timeoutMs: 30_000,
    });
  }

  linkFor(ratingKey: string): string | null {
    if (!this.machineId) return null;
    return `${this.webUrl}#!/server/${this.machineId}/details?key=${encodeURIComponent(`/library/metadata/${ratingKey}`)}`;
  }

  async refreshAll(): Promise<void> {
    for (const section of await this.sections()) {
      await this.req(`/library/sections/${section.key}/refresh`);
    }
  }
}
