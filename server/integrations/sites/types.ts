// Contrato dos leitores de sites brasileiros: cada um sabe buscar no seu site e devolver os magnets.

import type { Kind, SiteId } from '../../../shared/types.ts';

/** O que o motor sabe do item procurado. */
export interface SiteQuery {
  kind: Kind;
  /** Título pt-BR, original e alternativos. */
  titles: string[];
  year: number | null;
  /** Temporadas desejadas (vazio = qualquer uma). */
  seasons: number[];
  imdbId: string | null;
}

export interface SiteRelease {
  title: string;
  size: number;
  seeders: number | null;
  leechers: number | null;
  magnetUrl: string;
  infoHash: string | null;
  infoUrl: string;
  /** O site confirmou o título pelo IMDb: não precisa conferir o nome. */
  matched: boolean;
}

export interface SiteScraper {
  id: SiteId;
  name: string;
  defaultUrl: string;
  search(baseUrl: string, query: SiteQuery): Promise<SiteRelease[]>;
  /** Confere se o site responde e ainda tem o formato esperado. */
  ping(baseUrl: string): Promise<void>;
}
