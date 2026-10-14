// Configuração vinda do ambiente (.env). Os segredos ficam só aqui; a interface mostra se estão
// configurados, nunca o valor.

import path from 'node:path';

function env(name: string, fallback = ''): string {
  return (process.env[name] ?? fallback).trim();
}

function url(name: string, fallback = ''): string {
  return env(name, fallback).replace(/\/+$/, '');
}

export const config = {
  port: Number(env('PORT', '7575')),
  host: env('HOST', '0.0.0.0'),
  dataDir: path.resolve(env('CINERADAR_DATA_DIR', './data')),
  /** Endereço público do CineRadar (para links e webhooks), ex.: http://192.168.15.150:7575 */
  publicUrl: url('CINERADAR_PUBLIC_URL', 'http://localhost:7575'),
  adminUser: env('CINERADAR_ADMIN_USER', 'admin'),
  adminPassword: env('CINERADAR_ADMIN_PASSWORD'),
  webhookToken: env('CINERADAR_WEBHOOK_TOKEN'),
  /** Sessões de login duram 30 dias. */
  sessionDays: Number(env('CINERADAR_SESSION_DAYS', '30')),

  tmdb: { key: env('TMDB_API_KEY'), language: env('TMDB_LANGUAGE', 'pt-BR'), region: env('TMDB_REGION', 'BR') },
  radarr: {
    url: url('RADARR_URL'),
    key: env('RADARR_API_KEY'),
    rootFolder: env('RADARR_ROOT_FOLDER', '/Movies'),
    qualityProfile: env('RADARR_QUALITY_PROFILE', ''),
  },
  sonarr: {
    url: url('SONARR_URL'),
    key: env('SONARR_API_KEY'),
    rootFolder: env('SONARR_ROOT_FOLDER', '/Series'),
    qualityProfile: env('SONARR_QUALITY_PROFILE', ''),
  },
  prowlarr: { url: url('PROWLARR_URL'), key: env('PROWLARR_API_KEY') },
  plex: {
    url: url('PLEX_URL'),
    token: env('PLEX_TOKEN'),
    /** Endereço que o navegador usa para abrir o Plex (padrão: app.plex.tv). */
    webUrl: url('PLEX_WEB_URL', 'https://app.plex.tv/desktop'),
  },
  jellyfin: { url: url('JELLYFIN_URL'), key: env('JELLYFIN_API_KEY'), webUrl: url('JELLYFIN_WEB_URL') },
  qbittorrent: {
    url: url('QBITTORRENT_URL'),
    user: env('QBITTORRENT_USER'),
    password: env('QBITTORRENT_PASSWORD'),
    category: env('QBITTORRENT_CATEGORY', 'cineradar'),
  },
};

export type Config = typeof config;
