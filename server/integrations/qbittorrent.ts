// qBittorrent (opcional): usado só quando o Radarr/Sonarr recusam o push de um release de fora.
// O CineRadar adiciona o torrent numa categoria própria e, ao terminar, pede a importação manual ao *arr.

import { HttpError, requestText } from './http.ts';

export interface QbTorrent {
  hash: string;
  name: string;
  progress: number;
  state: string;
  content_path: string;
  save_path: string;
  category: string;
}

export class QBittorrent {
  private cookie: string | null = null;

  constructor(
    private readonly url: string,
    private readonly user: string,
    private readonly password: string,
    readonly category: string,
  ) {}

  get configured(): boolean {
    return Boolean(this.url);
  }

  private async login(): Promise<void> {
    const { text, headers } = await requestText(`${this.url}/api/v2/auth/login`, {
      service: 'qBittorrent',
      method: 'POST',
      headers: { Referer: this.url, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ username: this.user, password: this.password }).toString(),
    });
    if (text.trim() !== 'Ok.') throw new HttpError('qBittorrent: usuário ou senha recusados', 403);
    this.cookie = headers.get('set-cookie')?.split(';')[0] ?? null;
  }

  private async call(path: string, form?: Record<string, string>, retry = true): Promise<string> {
    if (!this.cookie && this.user) await this.login();
    try {
      const { text } = await requestText(`${this.url}/api/v2${path}`, {
        service: 'qBittorrent',
        method: form ? 'POST' : 'GET',
        headers: {
          Referer: this.url,
          ...(this.cookie ? { Cookie: this.cookie } : {}),
          ...(form ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
        },
        body: form ? new URLSearchParams(form).toString() : undefined,
      });
      return text;
    } catch (err) {
      if (retry && err instanceof HttpError && err.status === 403 && this.user) {
        this.cookie = null;
        return this.call(path, form, false);
      }
      throw err;
    }
  }

  async version(): Promise<string> {
    return (await this.call('/app/version')).trim();
  }

  async add(urlOrMagnet: string): Promise<void> {
    await this.call('/torrents/createCategory', { category: this.category, savePath: '' }).catch(() => undefined);
    const res = await this.call('/torrents/add', { urls: urlOrMagnet, category: this.category });
    if (res.trim() !== 'Ok.') throw new Error(`qBittorrent recusou o torrent: ${res.trim()}`);
  }

  async torrents(): Promise<QbTorrent[]> {
    return JSON.parse(await this.call(`/torrents/info?category=${encodeURIComponent(this.category)}`)) as QbTorrent[];
  }
}

/** Hash (btih) de um magnet, em minúsculas. */
export function magnetHash(magnet: string | null | undefined): string | null {
  const m = /xt=urn:btih:([a-z0-9]{32,40})/i.exec(magnet ?? '');
  return m?.[1]?.toLowerCase() ?? null;
}
