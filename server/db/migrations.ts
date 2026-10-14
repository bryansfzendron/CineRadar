// Cada entrada é uma migration; nunca edite uma que já foi publicada, acrescente outra.

export const MIGRATIONS: string[] = [
  `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    pass_hash TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE items (
    id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('movie','series')),
    tmdb_id INTEGER NOT NULL,
    imdb_id TEXT,
    tvdb_id INTEGER,
    title TEXT NOT NULL,
    original_title TEXT NOT NULL,
    alt_titles TEXT NOT NULL DEFAULT '[]',
    year INTEGER,
    overview TEXT NOT NULL DEFAULT '',
    poster_path TEXT,
    backdrop_path TEXT,
    genres TEXT NOT NULL DEFAULT '[]',
    runtime INTEGER,
    rating REAL,
    seasons TEXT NOT NULL DEFAULT '[]',
    cast_json TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'wanted',
    status_detail TEXT,
    progress REAL,
    arr_id INTEGER,
    download_hash TEXT,
    plex_key TEXT,
    jellyfin_id TEXT,
    last_search_at TEXT,
    next_search_at TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE (kind, tmdb_id)
  );
  CREATE INDEX items_status ON items(status);

  CREATE TABLE releases (
    id INTEGER PRIMARY KEY,
    item_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    source TEXT NOT NULL,
    source_name TEXT NOT NULL,
    indexer TEXT NOT NULL DEFAULT '',
    indexer_id INTEGER,
    guid TEXT NOT NULL,
    title TEXT NOT NULL,
    size INTEGER NOT NULL DEFAULT 0,
    seeders INTEGER,
    leechers INTEGER,
    publish_date TEXT,
    info_url TEXT,
    download_url TEXT,
    magnet_url TEXT,
    info_hash TEXT,
    season INTEGER,
    language TEXT NOT NULL,
    resolution INTEGER,
    quality TEXT,
    codec TEXT,
    score INTEGER NOT NULL,
    notes TEXT NOT NULL DEFAULT '[]',
    auto_eligible INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'new',
    found_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE (item_id, source, guid)
  );
  CREATE INDEX releases_item ON releases(item_id, score DESC);

  CREATE TABLE events (
    id INTEGER PRIMARY KEY,
    item_id INTEGER REFERENCES items(id) ON DELETE CASCADE,
    at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    kind TEXT NOT NULL,
    message TEXT NOT NULL
  );
  CREATE INDEX events_item ON events(item_id, id DESC);
  `,
];
