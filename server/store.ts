// Acesso ao banco: itens da lista, releases encontrados e eventos (linha do tempo de cada item).

import type { Item, ItemDetail, ItemEvent, ItemStatus, Kind, Release, ReleaseLanguage, ReleaseSourceKind } from '../shared/types.ts';
import type { DB } from './db/index.ts';
import type { TmdbDetails } from './integrations/tmdb.ts';

interface ItemRow {
  id: number;
  kind: Kind;
  tmdb_id: number;
  imdb_id: string | null;
  tvdb_id: number | null;
  title: string;
  original_title: string;
  alt_titles: string;
  year: number | null;
  overview: string;
  poster_path: string | null;
  backdrop_path: string | null;
  genres: string;
  runtime: number | null;
  rating: number | null;
  seasons: string;
  cast_json: string;
  status: ItemStatus;
  status_detail: string | null;
  progress: number | null;
  arr_id: number | null;
  download_hash: string | null;
  plex_key: string | null;
  jellyfin_id: string | null;
  last_search_at: string | null;
  next_search_at: string | null;
  created_at: string;
  updated_at: string;
  best_score?: number | null;
  best_language?: ReleaseLanguage | null;
  release_count?: number;
}

interface ReleaseRow {
  id: number;
  item_id: number;
  source: ReleaseSourceKind;
  source_name: string;
  indexer: string;
  indexer_id: number | null;
  guid: string;
  title: string;
  size: number;
  seeders: number | null;
  leechers: number | null;
  publish_date: string | null;
  info_url: string | null;
  download_url: string | null;
  magnet_url: string | null;
  info_hash: string | null;
  season: number | null;
  language: ReleaseLanguage;
  resolution: number | null;
  quality: string | null;
  codec: string | null;
  score: number;
  notes: string;
  auto_eligible: number;
  status: Release['status'];
  found_at: string;
}

/** Release com os campos internos (URLs de download), que nunca vão para a interface. */
export interface StoredRelease extends Release {
  indexerId: number | null;
  guid: string;
  downloadUrl: string | null;
  magnetUrl: string | null;
  infoHash: string | null;
}

export interface NewRelease {
  source: ReleaseSourceKind;
  sourceName: string;
  indexer: string;
  indexerId: number | null;
  guid: string;
  title: string;
  size: number;
  seeders: number | null;
  leechers: number | null;
  publishDate: string | null;
  infoUrl: string | null;
  downloadUrl: string | null;
  magnetUrl: string | null;
  infoHash: string | null;
  season: number | null;
  language: ReleaseLanguage;
  resolution: number | null;
  quality: string | null;
  codec: string | null;
  score: number;
  notes: string[];
  autoEligible: boolean;
}

/** Interno do servidor: item com os campos que a interface não vê. */
export interface StoredItem extends Item {
  altTitles: string[];
  downloadHash: string | null;
  plexKey: string | null;
  jellyfinId: string | null;
}

const ITEM_SELECT = `
  SELECT i.*,
    (SELECT MAX(score) FROM releases r WHERE r.item_id = i.id AND r.language IN ('dual','dublado','ptbr')) AS best_score,
    (SELECT language FROM releases r WHERE r.item_id = i.id ORDER BY score DESC LIMIT 1) AS best_language,
    (SELECT COUNT(*) FROM releases r WHERE r.item_id = i.id) AS release_count
  FROM items i`;

const LINKS: { plex: (key: string) => string | null; jellyfin: (id: string) => string | null } = {
  plex: () => null,
  jellyfin: () => null,
};

/** Os links "Abrir no Plex/Jellyfin" dependem do servidor; o app registra os geradores na inicialização. */
export function setLinkBuilders(plex: (key: string) => string | null, jellyfin: (id: string) => string | null): void {
  LINKS.plex = plex;
  LINKS.jellyfin = jellyfin;
}

function toItem(r: ItemRow): StoredItem {
  return {
    id: r.id,
    kind: r.kind,
    tmdbId: r.tmdb_id,
    imdbId: r.imdb_id,
    tvdbId: r.tvdb_id,
    title: r.title,
    originalTitle: r.original_title,
    altTitles: JSON.parse(r.alt_titles),
    year: r.year,
    overview: r.overview,
    posterPath: r.poster_path,
    backdropPath: r.backdrop_path,
    genres: JSON.parse(r.genres),
    runtime: r.runtime,
    rating: r.rating,
    seasons: JSON.parse(r.seasons),
    cast: JSON.parse(r.cast_json),
    status: r.status,
    statusDetail: r.status_detail,
    progress: r.progress,
    bestScore: r.best_score ?? null,
    bestLanguage: r.best_language ?? null,
    releaseCount: r.release_count ?? 0,
    arrId: r.arr_id,
    downloadHash: r.download_hash,
    plexKey: r.plex_key,
    jellyfinId: r.jellyfin_id,
    plexUrl: r.plex_key ? LINKS.plex(r.plex_key) : null,
    jellyfinUrl: r.jellyfin_id ? LINKS.jellyfin(r.jellyfin_id) : null,
    lastSearchAt: r.last_search_at,
    nextSearchAt: r.next_search_at,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function publicItem(i: StoredItem): Item {
  const { altTitles: _a, downloadHash: _d, plexKey: _p, jellyfinId: _j, ...rest } = i;
  return rest;
}

function toRelease(r: ReleaseRow): StoredRelease {
  return {
    id: r.id,
    itemId: r.item_id,
    source: r.source,
    sourceName: r.source_name,
    indexer: r.indexer,
    indexerId: r.indexer_id,
    guid: r.guid,
    title: r.title,
    size: r.size,
    seeders: r.seeders,
    leechers: r.leechers,
    publishDate: r.publish_date,
    infoUrl: r.info_url,
    downloadUrl: r.download_url,
    magnetUrl: r.magnet_url,
    infoHash: r.info_hash,
    season: r.season,
    language: r.language,
    resolution: r.resolution,
    quality: r.quality,
    codec: r.codec,
    score: r.score,
    notes: JSON.parse(r.notes),
    autoEligible: r.auto_eligible === 1,
    status: r.status,
    foundAt: r.found_at,
  };
}

export function publicRelease(r: StoredRelease): Release {
  const { indexerId: _i, guid: _g, downloadUrl: _d, magnetUrl: _m, infoHash: _h, ...rest } = r;
  // Só mostra infoUrl se for uma página (não um link de download com chave).
  return { ...rest, infoUrl: r.infoUrl && !/apikey=/i.test(r.infoUrl) ? r.infoUrl : null };
}

const now = () => new Date().toISOString();

export class Store {
  constructor(private readonly db: DB) {}

  listItems(kind?: Kind): StoredItem[] {
    const rows = (
      kind
        ? this.db.prepare(`${ITEM_SELECT} WHERE i.kind = ? ORDER BY i.updated_at DESC`).all(kind)
        : this.db.prepare(`${ITEM_SELECT} ORDER BY i.updated_at DESC`).all()
    ) as unknown as ItemRow[];
    return rows.map(toItem);
  }

  getItem(id: number): StoredItem | null {
    const row = this.db.prepare(`${ITEM_SELECT} WHERE i.id = ?`).get(id) as unknown as ItemRow | undefined;
    return row ? toItem(row) : null;
  }

  findByTmdb(kind: Kind, tmdbId: number): StoredItem | null {
    const row = this.db.prepare(`${ITEM_SELECT} WHERE i.kind = ? AND i.tmdb_id = ?`).get(kind, tmdbId) as unknown as ItemRow | undefined;
    return row ? toItem(row) : null;
  }

  /** Mapa "kind:tmdbId" -> {id, status} para marcar "Na lista" nos resultados de busca. */
  inListMap(): Map<string, { id: number; status: ItemStatus }> {
    const rows = this.db.prepare('SELECT id, kind, tmdb_id, status FROM items').all() as unknown as {
      id: number;
      kind: Kind;
      tmdb_id: number;
      status: ItemStatus;
    }[];
    return new Map(rows.map((r) => [`${r.kind}:${r.tmdb_id}`, { id: r.id, status: r.status }]));
  }

  addItem(d: TmdbDetails): StoredItem {
    const res = this.db
      .prepare(
        `INSERT INTO items (kind, tmdb_id, imdb_id, tvdb_id, title, original_title, alt_titles, year, overview,
           poster_path, backdrop_path, genres, runtime, rating, seasons, cast_json, next_search_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        d.kind,
        d.tmdbId,
        d.imdbId,
        d.tvdbId,
        d.title,
        d.originalTitle,
        JSON.stringify(d.altTitles),
        d.year,
        d.overview,
        d.posterPath,
        d.backdropPath,
        JSON.stringify(d.genres),
        d.runtime,
        d.rating,
        JSON.stringify(d.seasons),
        JSON.stringify(d.cast),
        now(),
      );
    const id = Number(res.lastInsertRowid);
    this.event(id, 'info', 'Adicionado à lista de desejos');
    return this.getItem(id)!;
  }

  deleteItem(id: number): void {
    this.db.prepare('DELETE FROM items WHERE id = ?').run(id);
  }

  update(
    id: number,
    patch: Partial<{
      status: ItemStatus;
      statusDetail: string | null;
      progress: number | null;
      arrId: number | null;
      downloadHash: string | null;
      plexKey: string | null;
      jellyfinId: string | null;
      lastSearchAt: string | null;
      nextSearchAt: string | null;
    }>,
  ): void {
    const cols: Record<string, string> = {
      status: 'status',
      statusDetail: 'status_detail',
      progress: 'progress',
      arrId: 'arr_id',
      downloadHash: 'download_hash',
      plexKey: 'plex_key',
      jellyfinId: 'jellyfin_id',
      lastSearchAt: 'last_search_at',
      nextSearchAt: 'next_search_at',
    };
    const entries = Object.entries(patch).filter(([k]) => k in cols);
    if (entries.length === 0) return;
    const sets = entries.map(([k]) => `${cols[k]} = ?`).join(', ');
    // Só muda updated_at quando algo visível muda (status), para a ordem da lista não pular à toa.
    const touch = 'status' in patch ? `, updated_at = '${now()}'` : '';
    this.db.prepare(`UPDATE items SET ${sets}${touch} WHERE id = ?`).run(...(entries.map(([, v]) => v) as (string | number | null)[]), id);
  }

  /** Itens prontos para uma nova busca. */
  dueForSearch(limit: number): StoredItem[] {
    const rows = this.db
      .prepare(`${ITEM_SELECT} WHERE i.status IN ('wanted','found','error') AND (i.next_search_at IS NULL OR i.next_search_at <= ?) ORDER BY i.next_search_at LIMIT ?`)
      .all(now(), limit) as unknown as ItemRow[];
    return rows.map(toItem);
  }

  /**
   * Grava o resultado de uma busca. Os releases ainda não enviados da busca anterior saem (seeders mudam,
   * links expiram, as regras de idioma podem ter mudado); os enviados e os que falharam ficam no histórico.
   */
  replaceReleases(itemId: number, releases: NewRelease[]): number {
    this.db.exec('BEGIN');
    try {
      this.db.prepare("DELETE FROM releases WHERE item_id = ? AND status = 'new'").run(itemId);
      const n = this.saveReleases(itemId, releases);
      this.db.exec('COMMIT');
      return n;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  saveReleases(itemId: number, releases: NewRelease[]): number {
    const stmt = this.db.prepare(
      `INSERT INTO releases (item_id, source, source_name, indexer, indexer_id, guid, title, size, seeders, leechers,
         publish_date, info_url, download_url, magnet_url, info_hash, season, language, resolution, quality, codec,
         score, notes, auto_eligible)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(item_id, source, guid) DO UPDATE SET
         seeders = excluded.seeders, leechers = excluded.leechers, score = excluded.score, notes = excluded.notes,
         language = excluded.language, resolution = excluded.resolution, quality = excluded.quality,
         codec = excluded.codec, season = excluded.season,
         auto_eligible = excluded.auto_eligible, download_url = excluded.download_url, magnet_url = excluded.magnet_url,
         indexer_id = excluded.indexer_id`,
    );
    let inserted = 0;
    for (const r of releases) {
      const res = stmt.run(
        itemId,
        r.source,
        r.sourceName,
        r.indexer,
        r.indexerId,
        r.guid,
        r.title,
        r.size,
        r.seeders,
        r.leechers,
        r.publishDate,
        r.infoUrl,
        r.downloadUrl,
        r.magnetUrl,
        r.infoHash,
        r.season,
        r.language,
        r.resolution,
        r.quality,
        r.codec,
        r.score,
        JSON.stringify(r.notes),
        r.autoEligible ? 1 : 0,
      );
      if (res.changes > 0) inserted++;
    }
    return inserted;
  }

  releases(itemId: number): StoredRelease[] {
    const rows = this.db.prepare('SELECT * FROM releases WHERE item_id = ? ORDER BY score DESC, seeders DESC LIMIT 200').all(itemId) as unknown as ReleaseRow[];
    return rows.map(toRelease);
  }

  getRelease(id: number): StoredRelease | null {
    const row = this.db.prepare('SELECT * FROM releases WHERE id = ?').get(id) as unknown as ReleaseRow | undefined;
    return row ? toRelease(row) : null;
  }

  setReleaseStatus(id: number, status: Release['status'], note?: string): void {
    if (note) {
      const r = this.getRelease(id);
      const notes = [...(r?.notes ?? []), note].slice(-5);
      this.db.prepare('UPDATE releases SET status = ?, notes = ? WHERE id = ?').run(status, JSON.stringify(notes), id);
    } else {
      this.db.prepare('UPDATE releases SET status = ? WHERE id = ?').run(status, id);
    }
  }

  event(itemId: number | null, kind: ItemEvent['kind'], message: string): void {
    this.db.prepare('INSERT INTO events (item_id, kind, message) VALUES (?, ?, ?)').run(itemId, kind, message);
  }

  events(itemId: number, limit = 50): ItemEvent[] {
    return this.db.prepare('SELECT id, at, kind, message FROM events WHERE item_id = ? ORDER BY id DESC LIMIT ?').all(itemId, limit) as unknown as ItemEvent[];
  }

  recentEvents(limit = 30): (ItemEvent & { itemId: number | null; title: string | null })[] {
    return this.db
      .prepare(
        'SELECT e.id, e.at, e.kind, e.message, e.item_id AS itemId, i.title FROM events e LEFT JOIN items i ON i.id = e.item_id ORDER BY e.id DESC LIMIT ?',
      )
      .all(limit) as unknown as (ItemEvent & { itemId: number | null; title: string | null })[];
  }

  detail(id: number): ItemDetail | null {
    const item = this.getItem(id);
    if (!item) return null;
    return { ...publicItem(item), releases: this.releases(id).map(publicRelease), events: this.events(id) };
  }
}
