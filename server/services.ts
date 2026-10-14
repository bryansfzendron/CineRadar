// Monta as integrações a partir da configuração e guarda o que o app inteiro compartilha.

import type { Config } from './config.ts';
import type { DB } from './db/index.ts';
import { Arr } from './integrations/arr.ts';
import { Jellyfin } from './integrations/jellyfin.ts';
import { Metadata } from './integrations/metadata.ts';
import { Plex } from './integrations/plex.ts';
import { Prowlarr } from './integrations/prowlarr.ts';
import { QBittorrent } from './integrations/qbittorrent.ts';
import { Tmdb } from './integrations/tmdb.ts';
import { SettingsStore } from './settings.ts';
import { Store, setLinkBuilders } from './store.ts';

export interface Services {
  config: Config;
  db: DB;
  store: Store;
  settings: SettingsStore;
  tmdb: Tmdb;
  meta: Metadata;
  radarr: Arr;
  sonarr: Arr;
  prowlarr: Prowlarr;
  plex: Plex;
  jellyfin: Jellyfin;
  qbit: QBittorrent;
  log: { info: (msg: string) => void; warn: (msg: string) => void; error: (msg: string) => void };
}

export function createServices(config: Config, db: DB, log: Services['log']): Services {
  const plex = new Plex(config.plex.url, config.plex.token, config.plex.webUrl);
  const jellyfin = new Jellyfin(config.jellyfin.url, config.jellyfin.key, config.jellyfin.webUrl);
  setLinkBuilders(
    (key) => plex.linkFor(key),
    (id) => jellyfin.linkFor(id),
  );
  const tmdb = new Tmdb(config.tmdb.key, config.tmdb.language, config.tmdb.region);
  const radarr = new Arr('radarr', config.radarr.url, config.radarr.key, config.radarr.rootFolder, config.radarr.qualityProfile);
  const sonarr = new Arr('sonarr', config.sonarr.url, config.sonarr.key, config.sonarr.rootFolder, config.sonarr.qualityProfile);
  return {
    config,
    db,
    store: new Store(db),
    settings: new SettingsStore(db),
    tmdb,
    meta: new Metadata(tmdb, radarr, sonarr),
    radarr,
    sonarr,
    prowlarr: new Prowlarr(config.prowlarr.url, config.prowlarr.key),
    plex,
    jellyfin,
    qbit: new QBittorrent(config.qbittorrent.url, config.qbittorrent.user, config.qbittorrent.password, config.qbittorrent.category),
    log,
  };
}
