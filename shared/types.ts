// Tipos compartilhados entre o servidor e a interface.

export type Kind = 'movie' | 'series';

/** Ciclo de um item da lista de desejos. */
export type ItemStatus =
  | 'wanted' // na lista, ainda sem release em português
  | 'searching' // busca em andamento
  | 'found' // achou release em português, esperando aprovação
  | 'sent' // release enviado ao Radarr/Sonarr (ou qBittorrent)
  | 'downloading' // na fila de download
  | 'available' // no Plex ou no Jellyfin
  | 'error';

/**
 * Idioma detectado no release, do melhor para o pior. `multi` = "dual"/"multi" sem pista de que um dos
 * áudios é português (pode ser turco, hindi…): aparece na lista, mas nunca vai sozinho.
 */
export type ReleaseLanguage = 'dual' | 'dublado' | 'ptbr' | 'multi' | 'legendado' | 'none';

export type ReleaseSourceKind = 'prowlarr' | 'radarr' | 'sonarr' | 'torznab' | 'site';

export interface ParsedRelease {
  language: ReleaseLanguage;
  resolution: 2160 | 1080 | 720 | 480 | null;
  quality: 'remux' | 'bluray' | 'webdl' | 'webrip' | 'hdtv' | 'dvd' | 'cam' | null;
  codec: 'x265' | 'x264' | 'av1' | null;
  season: number | null;
  episode: number | null;
  fullSeason: boolean;
  year: number | null;
}

export interface Release {
  id: number;
  itemId: number;
  source: ReleaseSourceKind;
  sourceName: string;
  indexer: string;
  title: string;
  size: number;
  seeders: number | null;
  leechers: number | null;
  publishDate: string | null;
  infoUrl: string | null;
  season: number | null;
  language: ReleaseLanguage;
  resolution: number | null;
  quality: string | null;
  codec: string | null;
  score: number;
  /** Motivos de recusa do Radarr/Sonarr ou do CineRadar (ex.: abaixo do limite). */
  notes: string[];
  autoEligible: boolean;
  status: 'new' | 'sent' | 'failed';
  foundAt: string;
}

export interface CastMember {
  name: string;
  character: string | null;
  profilePath: string | null;
}

export interface Item {
  id: number;
  kind: Kind;
  tmdbId: number;
  imdbId: string | null;
  tvdbId: number | null;
  title: string;
  originalTitle: string;
  year: number | null;
  overview: string;
  posterPath: string | null;
  backdropPath: string | null;
  genres: string[];
  runtime: number | null;
  rating: number | null;
  seasons: number[];
  cast: CastMember[];
  status: ItemStatus;
  statusDetail: string | null;
  progress: number | null;
  bestScore: number | null;
  bestLanguage: ReleaseLanguage | null;
  releaseCount: number;
  arrId: number | null;
  plexUrl: string | null;
  jellyfinUrl: string | null;
  lastSearchAt: string | null;
  nextSearchAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ItemDetail extends Item {
  releases: Release[];
  events: ItemEvent[];
}

export interface ItemEvent {
  id: number;
  at: string;
  kind: 'info' | 'search' | 'found' | 'sent' | 'download' | 'available' | 'error';
  message: string;
}

/** Resultado da busca no TMDB (página Buscar). */
export interface DiscoverResult {
  kind: Kind;
  tmdbId: number;
  title: string;
  originalTitle: string;
  year: number | null;
  overview: string;
  posterPath: string | null;
  backdropPath: string | null;
  rating: number | null;
  /** Já está na lista? Qual o id e o status. */
  inList: { id: number; status: ItemStatus } | null;
}

export interface AutoRule {
  enabled: boolean;
  minScore: number;
  minSeeders: number;
  maxSizeGbMovie: number;
  maxSizeGbSeason: number;
  allow2160: boolean;
  requireDub: boolean;
}

export interface TorznabSource {
  id: string;
  name: string;
  url: string;
  apiKey: string;
  enabled: boolean;
}

/** Site brasileiro lido direto pelo CineRadar (sem Prowlarr). */
export type SiteId = 'rede_torrent';

export interface SiteSource {
  id: SiteId;
  enabled: boolean;
  /** Endereço atual do site: eles mudam de domínio com frequência. */
  url: string;
}

export interface Settings {
  autoRule: AutoRule;
  searchIntervalHours: number;
  torznab: TorznabSource[];
  sites: SiteSource[];
}

export type IntegrationName = 'tmdb' | 'radarr' | 'sonarr' | 'prowlarr' | 'plex' | 'jellyfin' | 'qbittorrent' | SiteId;

export interface IntegrationStatus {
  name: IntegrationName;
  configured: boolean;
  ok: boolean;
  version: string | null;
  message: string | null;
}

export interface Health {
  ok: boolean;
  version: string;
  integrations: IntegrationStatus[];
  scheduler: { running: boolean; lastTickAt: string | null; searching: number };
}

export interface Me {
  username: string;
}
