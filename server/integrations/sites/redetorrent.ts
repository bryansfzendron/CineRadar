// Rede Torrent (redestorrents.com): busca em `index.php?busca=`, cartões `article.custom-card` com tipo e
// título, e na página de cada título um botão por versão, com o rótulo ("DUAL ÁUDIO 5.1 MKV 1080P") e o magnet.
// O nome interno do magnet costuma vir sujo ("HIDRATORRENTS.ORG...MKV"), então o título do release é montado
// com o nome da página, o ano e o rótulo do botão.

import type { Kind } from '../../../shared/types.ts';
import { matchesTitle, normalize } from '../../engine/ptbr.ts';
import { magnetHash } from '../qbittorrent.ts';
import { magnetTrackers, PUBLIC_TRACKERS, scrapeSwarms, type Swarm } from '../trackers.ts';
import { decodeEntities, fetchHtml, parseSize, textOf } from './html.ts';
import type { SiteQuery, SiteRelease, SiteScraper } from './types.ts';

const NAME = 'Rede Torrent';
/** Páginas de título abertas por busca: mais que isso deixa a busca lenta e chama a atenção do site. */
const MAX_PAGES = 8;

export interface Card {
  url: string;
  title: string;
  kind: Kind | null;
  season: number | null;
}

export interface TitlePage {
  name: string;
  year: number | null;
  altName: string | null;
  imdbId: string | null;
  sizes: number[];
  links: { label: string; magnet: string }[];
}

function seasonOf(text: string): number | null {
  const m = /(\d{1,2})\s*[ªa°º]?\s*temporada/i.exec(text) ?? /temporada\s*(\d{1,2})/i.exec(text) ?? /\bS(\d{1,2})\b/.exec(text);
  return m ? Number(m[1]) : null;
}

export function parseSearch(html: string, baseUrl: string): Card[] {
  const cards: Card[] = [];
  const re = /<a\s[^>]*href="([^"]+)"[^>]*>\s*<article\s[^>]*class="custom-card"([^>]*)>/g;
  for (const m of html.matchAll(re)) {
    const attrs = Object.fromEntries([...m[2]!.matchAll(/data-(\w+)="([^"]*)"/g)].map((a) => [a[1]!, decodeEntities(a[2]!)]));
    const title = attrs.title?.trim();
    if (!title) continue;
    const tipo = normalize(attrs.tipo ?? '');
    const kind: Kind | null = tipo.startsWith('filme') ? 'movie' : tipo.startsWith('serie') ? 'series' : null;
    cards.push({ url: new URL(decodeEntities(m[1]!), baseUrl).toString(), title, kind, season: seasonOf(title) });
  }
  return cards;
}

export function parseTitlePage(html: string): TitlePage {
  const pageTitle = textOf(/<title>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? '');
  // "Duna - Parte 2 Torrent (2024) Dual Áudio 5.1 Download"
  const head = /^(.*?)\s+Torrent\s*\((\d{4})\)/i.exec(pageTitle);
  const name = (head?.[1] ?? pageTitle.replace(/\s+(Torrent|Download)\b.*$/i, '')).trim();
  const year = head ? Number(head[2]) : null;
  const altName = /"alternateName"\s*:\s*"([^"]+)"/.exec(html)?.[1] ?? null;
  const imdbId = /imdb\.com\/title\/(tt\d+)/.exec(html)?.[1] ?? null;
  const sizeText = /Tamanho do Arquivo([\s\S]{0,400}?)(?:<\/li>|<\/div>\s*<\/div>)/i.exec(html)?.[1] ?? '';
  const sizes = textOf(sizeText)
    .split('|')
    .map(parseSize)
    .filter((n) => n > 0);

  const start = html.search(/LINKS PARA BAIXAR/i);
  const body = start >= 0 ? html.slice(start) : html;
  const links: TitlePage['links'] = [];
  let last = 0;
  for (const m of body.matchAll(/<a\s[^>]*href="(magnet:\?[^"]+)"/g)) {
    const before = body.slice(last, m.index);
    const labels = [...before.matchAll(/class="download-name"[^>]*>([\s\S]*?)<\/(?:span|div|p|h\d|strong)>/g)];
    const label = labels.length ? textOf(labels[labels.length - 1]![1]!) : '';
    links.push({ label, magnet: decodeEntities(m[1]!) });
    last = m.index + m[0].length;
  }
  return { name, year, altName: altName ? decodeEntities(altName) : null, imdbId, sizes, links };
}

/** Rótulo do botão sem as palavras de navegação: "DOWNLOAD TORRENT DUAL ÁUDIO 5.1 MKV 1080P" → "DUAL ÁUDIO 5.1 MKV 1080P". */
export function cleanLabel(label: string): string {
  return label
    .replace(/\b(download|torrent|baixar|via|link|magnet|clique|aqui)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Nome do arquivo no magnet sem a assinatura do site: "SITEDETORRENTS.COM..MKV.Duna 2024 WEB-DL" → "Duna 2024 WEB-DL". */
export function cleanMagnetName(magnet: string): string {
  const dn = new URLSearchParams(magnet.slice(magnet.indexOf('?') + 1)).get('dn') ?? '';
  return dn
    .replace(/^[\w-]+\.(com|org|net|xyz|tv|la|se|to|cc|io|fans|me)(\.br)?\.*/i, '')
    .replace(/^(mkv|mp4|avi)\.+/i, '')
    .replace(/[._]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Monta os releases de uma página, escolhendo o nome que bate com o item (pt-BR, original ou IMDb). */
export function pageReleases(page: TitlePage, card: Card, query: SiteQuery, pageUrl: string): SiteRelease[] {
  const imdbMatch = !!query.imdbId && page.imdbId === query.imdbId;
  if (query.imdbId && page.imdbId && !imdbMatch) return [];
  const year = page.year ? ` ${page.year}` : '';
  const names = [card.title, page.name, page.altName].filter((n): n is string => !!n);
  const fitting = names.find((n) => matchesTitle(`${n}${year}`, { titles: query.titles, year: query.year, kind: query.kind }));
  if (!fitting && !imdbMatch) return [];
  const name = fitting ?? card.title;
  const sizeFor = (i: number) => (page.sizes.length === page.links.length ? (page.sizes[i] ?? 0) : 0);

  return page.links.map((link, i) => {
    const label = cleanLabel(link.label);
    const fileName = cleanMagnetName(link.magnet);
    const extra = fileName.length >= 6 && /[a-z]{3}/i.test(fileName) ? ` [${fileName}]` : '';
    return {
      title: `${name}${year}${label ? ` ${label}` : ''}${extra}`,
      size: sizeFor(i),
      seeders: null,
      leechers: null,
      magnetUrl: link.magnet,
      infoHash: magnetHash(link.magnet),
      infoUrl: pageUrl,
      matched: imdbMatch,
    };
  });
}

/** O cartão pode ser do item? Filtro solto, só para não abrir páginas à toa. */
export function cardFits(card: Card, query: SiteQuery): boolean {
  if (card.kind && card.kind !== query.kind) return false;
  if (query.kind === 'series' && query.seasons.length && card.season != null && !query.seasons.includes(card.season)) return false;
  if (matchesTitle(card.title, { titles: query.titles, year: null, kind: query.kind })) return true;
  // "Duna - Parte 2" para "Duna: Parte Dois": a primeira palavra bate e a página confirma pelo IMDb.
  const first = (t: string) => normalize(t).split(' ')[0] ?? '';
  return !!query.imdbId && query.titles.some((t) => first(t) === first(card.title));
}

export const redeTorrent: SiteScraper = {
  id: 'rede_torrent',
  name: NAME,
  defaultUrl: 'https://redestorrents.com/',

  async search(baseUrl, query) {
    const terms = [...new Set(query.titles.slice(0, 2).map((t) => t.replace(/[:\-–—]+/g, ' ').replace(/\s+/g, ' ').trim()))];
    const seen = new Set<string>();
    const cards: Card[] = [];
    for (const term of terms) {
      const url = new URL('index.php', baseUrl);
      url.searchParams.set('busca', term);
      for (const card of parseSearch(await fetchHtml(url.toString(), NAME), baseUrl)) {
        if (seen.has(card.url) || !cardFits(card, query)) continue;
        seen.add(card.url);
        cards.push(card);
      }
    }
    const byName = (c: Card) => Number(matchesTitle(c.title, { titles: query.titles, year: null, kind: query.kind }));
    const picked = cards.sort((a, b) => byName(b) - byName(a)).slice(0, MAX_PAGES);

    const releases: SiteRelease[] = [];
    let next = 0;
    async function worker() {
      while (next < picked.length) {
        const card = picked[next++]!;
        const html = await fetchHtml(card.url, NAME).catch(() => null);
        if (html) releases.push(...pageReleases(parseTitlePage(html), card, query, card.url));
      }
    }
    await Promise.all([worker(), worker(), worker()]);

    // O site não mostra seeders: pergunta aos trackers do magnet e a alguns públicos.
    const hashes = releases.map((r) => r.infoHash).filter((h): h is string => !!h);
    const trackers = [...new Set([...releases.flatMap((r) => magnetTrackers(r.magnetUrl)), ...PUBLIC_TRACKERS])];
    const swarms = await scrapeSwarms(hashes, trackers).catch(() => new Map<string, Swarm>());
    for (const r of releases) {
      const s = r.infoHash ? swarms.get(r.infoHash) : undefined;
      if (s) {
        r.seeders = s.seeders;
        r.leechers = s.leechers;
      }
    }
    return releases;
  },

  async ping(baseUrl) {
    const url = new URL('index.php', baseUrl);
    url.searchParams.set('busca', 'matrix');
    const html = await fetchHtml(url.toString(), NAME);
    if (!/class="custom-card"/.test(html)) throw new Error(`${NAME}: o site respondeu, mas mudou de formato`);
  },
};
