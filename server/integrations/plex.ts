// Plex: mapa tmdbId -> item da biblioteca (para "Disponível" e "Abrir no Plex") e atualização de bibliotecas.

import type { Kind } from '../../shared/types.ts';
import { requestBuffer, requestJson, requestText } from './http.ts';

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

  // ---------- tocar numa TV (Alexa: "coloca Duna na TV") ----------

  /**
   * Players que aceitam comando: os que se anunciam na rede local (o app do Plex na TV com "Anunciar como
   * player" ligado) e, de reserva, os da conta no plex.tv que estão online.
   */
  async players(): Promise<PlexPlayer[]> {
    const out: PlexPlayer[] = [];
    const local = await this.req<{
      MediaContainer: { Server?: { name: string; machineIdentifier: string; address?: string; host?: string; port?: number | string; protocolCapabilities?: string }[] };
    }>('/clients').catch(() => null);
    for (const c of local?.MediaContainer.Server ?? []) {
      if (c.protocolCapabilities && !c.protocolCapabilities.split(',').includes('playback')) continue;
      const addr = c.address ?? c.host;
      out.push({ name: c.name, machineIdentifier: c.machineIdentifier, baseUrl: addr && c.port ? `http://${addr}:${c.port}` : null });
    }
    const account = await requestJson<
      { name: string; clientIdentifier: string; provides?: string; presence?: boolean; connections?: { uri: string; local?: boolean }[] }[]
    >('https://plex.tv/api/v2/resources', {
      service: 'Plex',
      headers: { 'X-Plex-Token': this.token, 'X-Plex-Client-Identifier': PLEX_CLIENT_ID, Accept: 'application/json' },
      query: { includeHttps: 1, includeRelay: 0 },
      timeoutMs: 15_000,
    }).catch(() => null);
    for (const r of account ?? []) {
      if (!r.provides?.split(',').includes('player') || r.presence === false) continue;
      if (out.some((p) => p.machineIdentifier === r.clientIdentifier)) continue;
      const conn = r.connections?.find((c) => c.local) ?? r.connections?.[0];
      out.push({ name: r.name, machineIdentifier: r.clientIdentifier, baseUrl: conn?.uri ?? null });
    }
    return out;
  }

  /** O episódio para continuar a série: o primeiro não assistido (retomando de onde parou), senão o primeiro. */
  async nextEpisode(showKey: string): Promise<{ key: string; offset: number } | null> {
    const data = await this.req<{ MediaContainer: { Metadata?: { ratingKey: string; viewCount?: number; viewOffset?: number }[] } }>(
      `/library/metadata/${showKey}/allLeaves`,
    );
    const eps = data.MediaContainer.Metadata ?? [];
    const ep = eps.find((e) => !e.viewCount) ?? eps[0];
    return ep ? { key: ep.ratingKey, offset: ep.viewOffset ?? 0 } : null;
  }

  /** Manda o player tocar: cria a fila no servidor e envia o playMedia ao player (direto, senão pelo servidor). */
  async play(player: PlexPlayer, target: { key: string; offset: number }): Promise<void> {
    if (!this.machineId) await this.version();
    const pq = await requestJson<{ MediaContainer: { playQueueID: number } }>(`${this.url}/playQueues`, {
      service: 'Plex',
      method: 'POST',
      headers: { 'X-Plex-Token': this.token, 'X-Plex-Client-Identifier': PLEX_CLIENT_ID, Accept: 'application/json' },
      query: {
        type: 'video',
        uri: `server://${this.machineId}/com.plexapp.plugins.library/library/metadata/${target.key}`,
        shuffle: 0,
        repeat: 0,
        continuous: 1,
        own: 1,
      },
      timeoutMs: 15_000,
    });
    const query = playMediaQuery(this.url, this.machineId!, this.token, target, pq.MediaContainer.playQueueID, ++this.commandId);
    const headers = {
      'X-Plex-Token': this.token,
      'X-Plex-Client-Identifier': PLEX_CLIENT_ID,
      'X-Plex-Target-Client-Identifier': player.machineIdentifier,
      'X-Plex-Device-Name': 'CineRadar',
      'X-Plex-Product': 'CineRadar',
    };
    let last: unknown = null;
    for (const base of [player.baseUrl, this.url].filter((b): b is string => Boolean(b))) {
      try {
        await requestText(`${base}/player/playback/playMedia`, { service: 'Plex', headers, query, timeoutMs: 10_000 });
        return;
      } catch (err) {
        last = err;
      }
    }
    throw last ?? new Error('Plex: o player não tem endereço');
  }

  private commandId = 0;
}

export const PLEX_CLIENT_ID = 'cineradar';

export interface PlexPlayer {
  name: string;
  machineIdentifier: string;
  /** Onde o player recebe comandos; null = só pelo servidor. */
  baseUrl: string | null;
}

/** Parâmetros do playMedia do Plex: o player busca o vídeo no servidor por este endereço. Função pura. */
export function playMediaQuery(
  serverUrl: string,
  machineId: string,
  token: string,
  target: { key: string; offset: number },
  playQueueId: number,
  commandId: number,
): Record<string, string | number> {
  const u = new URL(serverUrl);
  return {
    key: `/library/metadata/${target.key}`,
    offset: target.offset,
    machineIdentifier: machineId,
    address: u.hostname,
    port: u.port || (u.protocol === 'https:' ? 443 : 32400),
    protocol: u.protocol.replace(':', ''),
    token,
    containerKey: `/playQueues/${playQueueId}?own=1&window=200`,
    commandID: commandId,
    type: 'video',
  };
}
