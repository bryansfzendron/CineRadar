// Fonte Torznab genérica (Jackett, outro Prowlarr, etc.): `<url>/api?t=search&q=...&apikey=...`.

import { XMLParser } from 'fast-xml-parser';
import type { TorznabSource } from '../../shared/types.ts';
import { requestText } from './http.ts';

export interface TorznabResult {
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
  indexer: string;
}

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' });

type Attr = { name: string; value: string };

export async function torznabSearch(source: TorznabSource, query: string, kind: 'movie' | 'series'): Promise<TorznabResult[]> {
  const base = source.url.replace(/\/+$/, '');
  const endpoint = base.endsWith('/api') ? base : `${base}/api`;
  const { text } = await requestText(endpoint, {
    service: source.name,
    headers: { Accept: 'application/rss+xml, application/xml' },
    query: { t: 'search', q: query, cat: kind === 'movie' ? '2000' : '5000', apikey: source.apiKey || undefined },
    timeoutMs: 60_000,
  });
  return parseTorznab(text, source.name);
}

export function parseTorznab(xml: string, sourceName: string): TorznabResult[] {
  const doc = parser.parse(xml);
  const raw = doc?.rss?.channel?.item;
  const items: Record<string, unknown>[] = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return items.map((it) => {
    const attrsRaw = it['torznab:attr'] ?? it['newznab:attr'];
    const attrs: Attr[] = Array.isArray(attrsRaw) ? (attrsRaw as Attr[]) : attrsRaw ? [attrsRaw as Attr] : [];
    const attr = (name: string) => attrs.find((a) => a.name === name)?.value ?? null;
    const enclosure = it.enclosure as { url?: string; length?: string } | undefined;
    const link = typeof it.link === 'string' ? it.link : null;
    const guidRaw = it.guid as string | { '#text'?: string } | undefined;
    const guid = typeof guidRaw === 'string' ? guidRaw : (guidRaw?.['#text'] ?? link ?? String(it.title));
    const magnet = attr('magneturl') ?? (link?.startsWith('magnet:') ? link : null);
    const num = (v: string | null) => (v !== null && v !== '' && Number.isFinite(Number(v)) ? Number(v) : null);
    const jackettIndexer = (it.jackettindexer as { '#text'?: string } | string | undefined) ?? null;
    return {
      guid,
      title: String(it.title ?? ''),
      size: num(attr('size')) ?? num(enclosure?.length ?? null) ?? Number(it.size ?? 0),
      seeders: num(attr('seeders')),
      leechers: num(attr('peers')) !== null ? Math.max(0, (num(attr('peers')) ?? 0) - (num(attr('seeders')) ?? 0)) : null,
      publishDate: it.pubDate ? new Date(String(it.pubDate)).toISOString() : null,
      infoUrl: typeof it.comments === 'string' ? it.comments : null,
      downloadUrl: enclosure?.url && !enclosure.url.startsWith('magnet:') ? enclosure.url : link && !link.startsWith('magnet:') ? link : null,
      magnetUrl: magnet,
      infoHash: attr('infohash'),
      indexer: typeof jackettIndexer === 'string' ? jackettIndexer : (jackettIndexer?.['#text'] ?? sourceName),
    };
  });
}
