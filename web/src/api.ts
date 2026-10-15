// Cliente da API. Erros viram ApiError com a mensagem do servidor; 401 manda para o login.

import type { DiscoverResult, Health, Item, ItemDetail, Kind, LibraryEntry, Me, Settings } from '../../shared/types.ts';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(path, {
    credentials: 'same-origin',
    ...init,
    headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new ApiError((data && data.error) || `Erro ${res.status}`, res.status);
  return data as T;
}

const json = (body: unknown) => JSON.stringify(body);

export interface IndexerInfo {
  id: number;
  name: string;
  enabled: boolean;
  failing: boolean;
  language: string | null;
}

export interface ActivityEvent {
  id: number;
  at: string;
  kind: string;
  message: string;
  itemId: number | null;
  title: string | null;
}

export const api = {
  me: () => call<Me>('/api/auth/me'),
  login: (username: string, password: string) => call<Me>('/api/auth/login', { method: 'POST', body: json({ username, password }) }),
  logout: () => call('/api/auth/logout', { method: 'POST' }),
  changePassword: (current: string, next: string) => call('/api/auth/password', { method: 'POST', body: json({ current, next }) }),

  health: (force = false) => call<Health>(`/api/health${force ? '?force=1' : ''}`),
  items: (kind?: Kind) => call<Item[]>(`/api/items${kind ? `?kind=${kind}` : ''}`),
  item: (id: number) => call<ItemDetail>(`/api/items/${id}`),
  addItem: (kind: Kind, tmdbId: number) => call<Item>('/api/items', { method: 'POST', body: json({ kind, tmdbId }) }),
  removeItem: (id: number) => call(`/api/items/${id}`, { method: 'DELETE' }),
  searchNow: (id: number) => call<{ started: boolean }>(`/api/items/${id}/search`, { method: 'POST' }),
  dispatch: (id: number, releaseId: number) => call<{ ok: boolean; via: string }>(`/api/items/${id}/releases/${releaseId}/dispatch`, { method: 'POST' }),
  events: () => call<ActivityEvent[]>('/api/events'),

  discoverSearch: (q: string, kind?: Kind) =>
    call<DiscoverResult[]>(`/api/discover/search?q=${encodeURIComponent(q)}${kind ? `&kind=${kind}` : ''}`),
  discoverList: (which: string, kind: Kind) => call<DiscoverResult[]>(`/api/discover/list/${which}?kind=${kind}`),

  library: (kind: Kind) => call<LibraryEntry[]>(`/api/library?kind=${kind}`),

  settings: () => call<{ settings: Settings; webhooks: { radarr: string; sonarr: string } | null }>('/api/settings'),
  saveSettings: (s: Settings) => call<{ settings: Settings }>('/api/settings', { method: 'PUT', body: json(s) }),
  indexers: () => call<IndexerInfo[]>('/api/indexers'),
};

/** Caminho do TMDB ("/abc.jpg") ou URL completa (cartazes que vêm do TheTVDB pelo Sonarr). */
export function posterUrl(path: string | null, size: 'w185' | 'w342' | 'w500' = 'w342'): string | null {
  if (!path) return null;
  return path.startsWith('http') || path.startsWith('/api/') ? path : `https://image.tmdb.org/t/p/${size}${path}`;
}

export function backdropUrl(path: string | null): string | null {
  if (!path) return null;
  return path.startsWith('http') ? path : `https://image.tmdb.org/t/p/w1280${path}`;
}
