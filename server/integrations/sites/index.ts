// Sites brasileiros lidos direto pelo CineRadar. Para incluir outro: um arquivo com um `SiteScraper` e uma
// linha aqui.

import type { SiteId, SiteSource } from '../../../shared/types.ts';
import { redeTorrent } from './redetorrent.ts';
import type { SiteScraper } from './types.ts';

export const SITES: Record<SiteId, SiteScraper> = {
  rede_torrent: redeTorrent,
};

export const DEFAULT_SITES: SiteSource[] = Object.values(SITES).map((s) => ({ id: s.id, enabled: true, url: s.defaultUrl }));

export type { SiteQuery, SiteRelease, SiteScraper } from './types.ts';
