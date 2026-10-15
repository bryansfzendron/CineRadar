// Motor de busca: pergunta a todas as fontes (Radarr/Sonarr, Prowlarr, Torznab, sites BR), lê cada release,
// descarta o que não é do título, dá nota e decide o que pode ir sozinho.

import type { AutoRule, Kind, ReleaseSourceKind } from '../../shared/types.ts';
import { rejectionText, type ArrRelease } from '../integrations/arr.ts';
import { errorMessage } from '../integrations/http.ts';
import { magnetHash } from '../integrations/qbittorrent.ts';
import { SITES } from '../integrations/sites/index.ts';
import { torznabSearch } from '../integrations/torznab.ts';
import type { Services } from '../services.ts';
import type { NewRelease, StoredItem } from '../store.ts';
import { matchesTitle, normalize, parseRelease } from './ptbr.ts';
import { autoDecision, scoreRelease } from './score.ts';

/** Release cru de qualquer fonte, antes de ler e pontuar. */
interface RawRelease {
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
  /** O *arr já casou o release com o filme/série (busca por ID), então não precisa conferir o título. */
  matched: boolean;
  arrLanguages?: string[];
  arrSeason?: number | null;
  customFormatScore?: number | null;
  arrRejections?: string[];
  /** Veio de um site brasileiro (o "dual" de lá inclui português). */
  brSource?: boolean;
}

export interface SearchResult {
  releases: NewRelease[];
  errors: string[];
  sources: string[];
}

/** Rejeições do *arr que não importam para o CineRadar (quem decide o download é ele). */
const IGNORED_REJECTIONS = /(not monitored|não monitorad|nao monitorad|unmonitored|already meets cutoff|existing file)/i;

/** As rejeições mais comuns do Radarr/Sonarr, em português. */
const REJECTION_PT: [RegExp, string][] = [
  [/custom formats?.*below.*minimum/i, 'abaixo da pontuação mínima de formatos do Radarr/Sonarr'],
  [/unknown (movie|series)/i, 'o Radarr/Sonarr não reconheceu o título (dá para baixar mesmo assim)'],
  [/wrong (movie|series)/i, 'o Radarr/Sonarr acha que é outro título'],
  [/not wanted in profile|quality.*not wanted/i, 'qualidade fora do perfil do Radarr/Sonarr'],
  [/blocklist/i, 'está na lista de bloqueio do Radarr/Sonarr'],
  [/size.*(too large|maximum)|larger than/i, 'maior que o limite do Radarr/Sonarr'],
  [/size.*(too small|minimum)|smaller than/i, 'menor que o mínimo do Radarr/Sonarr'],
  [/no seeders|seeders/i, 'poucos seeders para o Radarr/Sonarr'],
  [/release is already in queue|already in queue/i, 'já está na fila de download'],
];

/** Recusas que não impedem o envio: o grab pelo GUID funciona e o idioma quem julga é o CineRadar. */
const SOFT_REJECTIONS = /(não reconheceu o título|pontuação mínima de formatos)/;

function translateRejection(text: string): string {
  return REJECTION_PT.find(([re]) => re.test(text))?.[1] ?? text;
}

export function searchQueries(item: Pick<StoredItem, 'kind' | 'title' | 'originalTitle' | 'year' | 'altTitles'>): string[] {
  const titles = [...new Set([item.title, item.originalTitle, ...item.altTitles])].filter(Boolean).slice(0, 3);
  const queries: string[] = [];
  for (const t of titles) {
    if (item.kind === 'movie') queries.push(item.year ? `${t} ${item.year}` : t);
    else queries.push(t);
  }
  const main = item.title;
  queries.push(`${main} dublado`, `${main} dual`);
  if (item.kind === 'series') queries.push(`${main} temporada`);
  const seen = new Set<string>();
  return queries.filter((q) => {
    const k = normalize(q);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function fromArr(r: ArrRelease, source: 'radarr' | 'sonarr'): RawRelease {
  return {
    source,
    sourceName: source === 'radarr' ? 'Radarr' : 'Sonarr',
    indexer: r.indexer,
    indexerId: r.indexerId,
    guid: r.guid,
    title: r.title,
    size: r.size,
    seeders: r.seeders ?? null,
    leechers: r.leechers ?? null,
    publishDate: r.publishDate ?? null,
    infoUrl: r.infoUrl ?? null,
    downloadUrl: r.downloadUrl ?? null,
    magnetUrl: r.magnetUrl ?? null,
    infoHash: r.infoHash ?? null,
    matched: true,
    arrLanguages: (r.languages ?? []).map((l) => l.name),
    arrSeason: r.seasonNumber ?? null,
    customFormatScore: r.customFormatScore ?? null,
    arrRejections: [...new Set(rejectionText(r.rejections).filter((x) => !IGNORED_REJECTIONS.test(x)).map(translateRejection))],
  };
}

/** Roda tarefas com no máximo `limit` ao mesmo tempo (o servidor tem 2 núcleos). */
async function pool<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const out: T[] = [];
  let next = 0;
  async function worker() {
    while (next < tasks.length) {
      const i = next++;
      out[i] = await tasks[i]!();
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return out;
}

export async function searchItem(svc: Services, item: StoredItem): Promise<SearchResult> {
  const settings = svc.settings.get();
  const errors: string[] = [];
  const sources: string[] = [];
  const raw: RawRelease[] = [];
  const arr = item.kind === 'movie' ? svc.radarr : svc.sonarr;

  // 1) Busca interativa do Radarr/Sonarr (indexadores sincronizados pelo Prowlarr, casados por ID).
  if (arr.configured) {
    try {
      const arrId = await ensureArr(svc, item);
      if (item.kind === 'movie') {
        raw.push(...(await arr.searchReleases(arrId)).map((r) => fromArr(r, 'radarr')));
      } else {
        const seasons = item.seasons.length ? item.seasons : [1];
        for (const season of seasons) {
          const list = await arr.searchReleases(arrId, season).catch((err) => {
            errors.push(`${arr.service} T${season}: ${errorMessage(err)}`);
            return [] as ArrRelease[];
          });
          raw.push(...list.map((r) => fromArr(r, 'sonarr')));
        }
      }
      sources.push(arr.service);
    } catch (err) {
      errors.push(errorMessage(err));
    }
  }

  // 2) Prowlarr e Torznab, por texto (título pt-BR, original, "dublado", "dual").
  const queries = searchQueries(item);
  const tasks: (() => Promise<void>)[] = [];
  if (svc.prowlarr.configured) {
    sources.push('Prowlarr');
    for (const q of queries) {
      tasks.push(async () => {
        try {
          const list = await svc.prowlarr.search(q, item.kind);
          for (const r of list) {
            if (r.protocol !== 'torrent') continue;
            raw.push({
              source: 'prowlarr',
              sourceName: 'Prowlarr',
              indexer: r.indexer,
              indexerId: r.indexerId,
              guid: r.guid,
              title: r.title,
              size: r.size,
              seeders: r.seeders ?? null,
              leechers: r.leechers ?? null,
              publishDate: r.publishDate ?? null,
              infoUrl: r.infoUrl ?? null,
              downloadUrl: r.downloadUrl ?? null,
              magnetUrl: r.magnetUrl ?? (r.guid.startsWith('magnet:') ? r.guid : null),
              infoHash: r.infoHash ?? null,
              matched: false,
            });
          }
        } catch (err) {
          errors.push(`Prowlarr "${q}": ${errorMessage(err)}`);
        }
      });
    }
  }
  for (const source of settings.torznab.filter((t) => t.enabled)) {
    sources.push(source.name);
    for (const q of queries) {
      tasks.push(async () => {
        try {
          for (const r of await torznabSearch(source, q, item.kind)) {
            raw.push({ ...r, source: 'torznab', sourceName: source.name, indexerId: null, matched: false });
          }
        } catch (err) {
          errors.push(`${source.name} "${q}": ${errorMessage(err)}`);
        }
      });
    }
  }
  // 3) Sites brasileiros lidos direto (sem Prowlarr).
  for (const site of settings.sites.filter((s) => s.enabled)) {
    const scraper = SITES[site.id];
    sources.push(scraper.name);
    tasks.push(async () => {
      try {
        const list = await scraper.search(site.url, {
          kind: item.kind,
          titles: [...new Set([item.title, item.originalTitle, ...item.altTitles])].filter(Boolean),
          year: item.year,
          seasons: item.seasons,
          imdbId: item.imdbId,
        });
        for (const r of list) {
          raw.push({
            source: 'site',
            sourceName: scraper.name,
            indexer: scraper.name,
            indexerId: null,
            guid: r.infoHash ? `${scraper.id}:${r.infoHash}` : r.magnetUrl,
            title: r.title,
            size: r.size,
            seeders: r.seeders,
            leechers: r.leechers,
            publishDate: null,
            infoUrl: r.infoUrl,
            downloadUrl: null,
            magnetUrl: r.magnetUrl,
            infoHash: r.infoHash,
            matched: r.matched,
            brSource: true,
          });
        }
      } catch (err) {
        errors.push(errorMessage(err));
      }
    });
  }
  await pool(tasks, 2);

  return { releases: rank(item, raw, settings.autoRule), errors: [...new Set(errors)], sources };
}

/** Garante o filme/série no Radarr/Sonarr e guarda o id. */
export async function ensureArr(svc: Services, item: StoredItem): Promise<number> {
  if (item.arrId) return item.arrId;
  const arrItem =
    item.kind === 'movie' ? await svc.radarr.ensureMovie(item.tmdbId) : await svc.sonarr.ensureSeries(item.tmdbId, item.tvdbId);
  svc.store.update(item.id, { arrId: arrItem.id });
  item.arrId = arrItem.id;
  return arrItem.id;
}

/** Lê, filtra, pontua e remove duplicados. Exportado para teste. */
export function rank(
  item: Pick<StoredItem, 'kind' | 'title' | 'originalTitle' | 'year' | 'altTitles'>,
  raw: RawRelease[],
  rule: AutoRule,
): NewRelease[] {
  const titles = [...new Set([item.title, item.originalTitle, ...item.altTitles])];
  const hasLocalTitle = normalize(item.title) !== normalize(item.originalTitle);
  const best = new Map<string, NewRelease & { fromArr: boolean }>();

  for (const r of raw) {
    if (!r.title) continue;
    if (!r.matched && !matchesTitle(r.title, { titles, year: item.year, kind: item.kind })) continue;
    // Release com o título brasileiro ("Duna 2021 DUAL") é indício forte de que o "dual" inclui português.
    const localizedTitle = hasLocalTitle && matchesTitle(r.title, { titles: [item.title], year: item.year, kind: item.kind });
    const parsed = parseRelease(r.title, r.arrLanguages, { localizedTitle, brSource: r.brSource });
    if (item.kind === 'series' && r.arrSeason != null && parsed.season == null) parsed.season = r.arrSeason;
    if (item.kind === 'series' && parsed.season == null && !parsed.fullSeason) continue;

    const kind: Kind = item.kind;
    const arrRejected = (r.arrRejections ?? []).some((x) => !SOFT_REJECTIONS.test(x));
    const score = scoreRelease({ parsed, size: r.size, seeders: r.seeders, kind, customFormatScore: r.customFormatScore, arrRejected }, rule);
    const decision = autoDecision({ parsed, size: r.size, seeders: r.seeders, kind, score }, rule);
    const notes = [...(r.arrRejections ?? []), ...decision.reasons];
    let eligible = decision.eligible && !arrRejected;
    if (kind === 'series' && parsed.episode != null) {
      notes.push('episódio avulso');
      eligible = false;
    }
    if (!r.downloadUrl && !r.magnetUrl && r.source !== 'radarr' && r.source !== 'sonarr') continue;

    const infoHash = (r.infoHash ?? magnetHash(r.magnetUrl))?.toLowerCase() ?? null;
    // O *arr nem sempre devolve o hash; título normalizado + tamanho junta o mesmo torrent de fontes diferentes.
    // Sem tamanho (sites que não informam), o hash separa as versões.
    const key = r.size > 0 ? `${normalize(r.title)}|${Math.round(r.size / 5e7)}` : `hash:${infoHash ?? normalize(r.title)}`;
    const candidate = {
      source: r.source,
      sourceName: r.sourceName,
      indexer: r.indexer,
      indexerId: r.indexerId,
      guid: r.guid.length > 500 ? `hash:${infoHash ?? normalize(r.title)}` : r.guid,
      title: r.title,
      size: r.size,
      seeders: r.seeders,
      leechers: r.leechers,
      publishDate: r.publishDate,
      infoUrl: r.infoUrl,
      downloadUrl: r.downloadUrl,
      magnetUrl: r.magnetUrl,
      infoHash,
      season: parsed.season,
      language: parsed.language,
      resolution: parsed.resolution,
      quality: parsed.quality,
      codec: parsed.codec,
      score,
      notes,
      autoEligible: eligible,
      fromArr: r.source === 'radarr' || r.source === 'sonarr',
    };
    const prev = best.get(key);
    // O mesmo torrent vindo do *arr é preferido: dá para baixar pelo GUID, o caminho mais confiável.
    if (!prev || (candidate.fromArr && !prev.fromArr) || (candidate.fromArr === prev.fromArr && candidate.score > prev.score)) {
      best.set(key, candidate);
    }
  }

  return [...best.values()]
    .map(({ fromArr: _f, ...r }) => r)
    .sort((a, b) => b.score - a.score || (b.seeders ?? 0) - (a.seeders ?? 0));
}
