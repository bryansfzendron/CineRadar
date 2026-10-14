// Lê o título de um release e diz o idioma (dublado, dual áudio, legendado), a resolução, a origem, o codec
// e a temporada/episódio. Os títulos brasileiros misturam tudo: "Duna.2021.1080p.WEB-DL.DUAL.5.1",
// "Duna (2021) Dublado BluRay 720p", "The Bear 1ª Temporada Completa Dual Áudio", "Filme.2023.Legendado".

import type { ParsedRelease, ReleaseLanguage } from '../../shared/types.ts';

/** Minúsculas, sem acentos, com separadores (. _ - [ ] ( )) trocados por espaço. */
export function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[._\-[\](){}+|,:;!?'"]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const DUAL = /\b(dual(\s?audio)?|multi(\s?audio)?|dual\s?5\s?1|duo)\b/;
// "Dub" solto não serve: releases russos usam "Dub" para a dublagem russa.
const DUB = /\b(dublado|dublada|dub(bed)?\s?(pt|ptbr|pt\s?br|portugues|brazilian|br)|nacional|audio\s?portugues|ptbr\s?audio)\b/;
const PTBR = /\b(pt\s?br|ptbr|portugues|portuguese|brazilian|brasil|brazil|br\s?dub|por)\b/;
const LEG = /\b(legendado|legendada|leg|legenda|subbed\s?pt|sub\s?pt\s?br)\b/;
/** Outro idioma explícito: "DuaL TURKO", "Hindi", "ITA ENG", "Latino", "RiffTrax" (comentário em inglês). */
const OTHER = /\b(turko|turkce|turkish|hindi|tamil|telugu|ita|italian|french|truefrench|vff|vfq|latino|castellano|spanish|esp|rus|russian|ukr|german|deutsch|korean|kor|japanese|jpn|chinese|polish|czech|hungarian|arabic|thai|vietnamese|rifftrax)\b/;
/** Grupos e assinaturas comuns em releases brasileiros. */
const BR_GROUPS = /\b(wolverdon\w*|comando\w*|lapumia|bludv|piratefilmes|thepiratefilmes|andretpf|tpf|amzn\s?br|globoplay|gloobplay|nacional)\b/;

export interface LanguageContext {
  /** O release usa o título em português (diferente do original), ex.: "Duna 2021" para "Dune". */
  localizedTitle?: boolean;
}

export function detectLanguage(title: string, arrLanguages: string[] = [], ctx: LanguageContext = {}): ReleaseLanguage {
  const t = normalize(title);
  const langs = arrLanguages.map((l) => normalize(l));
  const arrPortuguese = langs.some((l) => l.includes('portuguese') || l.includes('brazil'));
  const arrOther = langs.length > 0 && !arrPortuguese && !langs.every((l) => l === 'english' || l === 'unknown');

  if (DUB.test(t)) return DUAL.test(t) ? 'dual' : 'dublado';
  const brEvidence = PTBR.test(t) || BR_GROUPS.test(t) || ctx.localizedTitle === true || arrPortuguese;
  if (DUAL.test(t)) {
    if (brEvidence && !LEG.test(t)) return 'dual';
    if (OTHER.test(t) || arrOther) return 'none';
    return 'multi';
  }
  // "Legendado" vence o "pt-br" solto: "Filme 2023 PT-BR Legendado" é legenda, não áudio.
  if (LEG.test(t)) return 'legendado';
  if (PTBR.test(t) || arrPortuguese) return 'ptbr';
  return 'none';
}

export function detectResolution(t: string): ParsedRelease['resolution'] {
  if (/\b(2160p|4k|uhd)\b/.test(t)) return 2160;
  if (/\b(1080p|1080i|fhd|full\s?hd)\b/.test(t)) return 1080;
  if (/\b(720p|hd)\b/.test(t)) return 720;
  if (/\b(480p|576p|sd|dvdrip|xvid)\b/.test(t)) return 480;
  return null;
}

export function detectQuality(t: string): ParsedRelease['quality'] {
  if (/\b(cam|camrip|hdcam|ts|telesync|hdts|tc|telecine|pdvd)\b/.test(t)) return 'cam';
  if (/\bremux\b/.test(t)) return 'remux';
  if (/\b(bluray|blu\s?ray|bdrip|brrip|bdremux)\b/.test(t)) return 'bluray';
  if (/\b(web\s?dl|webdl|amzn|nf|dsnp|hmax|atvp|gplay|pmtp)\b/.test(t)) return 'webdl';
  if (/\b(webrip|web)\b/.test(t)) return 'webrip';
  if (/\b(hdtv|pdtv|hdtvrip)\b/.test(t)) return 'hdtv';
  if (/\b(dvd|dvdrip|dvdr)\b/.test(t)) return 'dvd';
  return null;
}

export function detectCodec(t: string): ParsedRelease['codec'] {
  if (/\b(x265|h\s?265|hevc)\b/.test(t)) return 'x265';
  if (/\b(av1)\b/.test(t)) return 'av1';
  if (/\b(x264|h\s?264|avc)\b/.test(t)) return 'x264';
  return null;
}

/** Temporada e episódio: S01E02, S01, 1x02, "1ª Temporada", "Temporada 2", "Season 3", "Completa". */
export function detectSeason(t: string): Pick<ParsedRelease, 'season' | 'episode' | 'fullSeason'> {
  let m = /\bs(\d{1,2})\s?e(\d{1,3})\b/.exec(t);
  if (m) return { season: Number(m[1]), episode: Number(m[2]), fullSeason: false };
  m = /\b(\d{1,2})x(\d{2,3})\b/.exec(t);
  if (m) return { season: Number(m[1]), episode: Number(m[2]), fullSeason: false };
  m = /\bs(\d{1,2})\b/.exec(t) ?? /\b(\d{1,2})\s?a?\s?temporada\b/.exec(t) ?? /\btemporada\s?(\d{1,2})\b/.exec(t) ?? /\bseason\s?(\d{1,2})\b/.exec(t);
  if (m) return { season: Number(m[1]), episode: null, fullSeason: true };
  if (/\b(serie\s?completa|complete\s?series|todas\s?as\s?temporadas)\b/.test(t)) return { season: null, episode: null, fullSeason: true };
  return { season: null, episode: null, fullSeason: false };
}

export function detectYear(t: string): number | null {
  const years = [...t.matchAll(/\b(19[2-9]\d|20[0-4]\d)\b/g)].map((m) => Number(m[1]));
  // O último ano costuma ser o do filme ("2001 Uma Odisseia no Espaco 1968").
  return years.length ? (years[years.length - 1] ?? null) : null;
}

export function parseRelease(title: string, arrLanguages: string[] = [], ctx: LanguageContext = {}): ParsedRelease {
  const t = normalize(title).replace(/\b(\d)ª/g, '$1a');
  return {
    language: detectLanguage(title, arrLanguages, ctx),
    resolution: detectResolution(t),
    quality: detectQuality(t),
    codec: detectCodec(t),
    ...detectSeason(t),
    year: detectYear(t),
  };
}

const STOPWORDS = new Set(['the', 'a', 'o', 'os', 'as', 'um', 'uma', 'de', 'da', 'do', 'das', 'dos', 'e', 'and', 'of', 'em', 'no', 'na']);

function titleTokens(text: string): string[] {
  return normalize(text)
    .split(' ')
    .filter((w) => w.length > 0 && !STOPWORDS.has(w));
}

/**
 * O release é deste título? Exige que o título (pt-BR ou original) esteja no começo do nome do release
 * (no máximo uma palavra antes, como "[Grupo]" ou o título em outro alfabeto) e, para filmes, que o ano bata
 * (±1, por causa de lançamentos em anos diferentes). "Kleo S02E03 The Bear" não é "The Bear".
 */
export function matchesTitle(
  releaseTitle: string,
  candidates: { titles: string[]; year: number | null; kind: 'movie' | 'series' },
): boolean {
  const rel = normalize(releaseTitle);
  const relTokens = titleTokens(releaseTitle);
  const parsed = parseRelease(releaseTitle);
  // Uma palavra antes do título só vale se for "[Grupo]" ou o título em outro alfabeto ("Дюна / Dune").
  const ascii = releaseTitle.normalize('NFD').replace(/[̀-ͯ]/g, '').trimStart();
  const maxStart = /^[[(【{]/.test(ascii) || /^[^\x00-\x7F]/.test(ascii) ? 1 : 0;

  const titleOk = candidates.titles.some((title) => {
    if (rel.startsWith(normalize(title))) return true;
    const want = titleTokens(title);
    if (want.length === 0) return false;
    const start = relTokens.indexOf(want[0]!);
    if (start < 0 || start > maxStart) return false;
    const window = relTokens.slice(start, start + want.length + 2);
    const hits = want.filter((w) => window.includes(w)).length;
    return hits / want.length >= (want.length <= 2 ? 1 : 0.75);
  });
  if (!titleOk) return false;

  if (candidates.kind === 'movie' && candidates.year && parsed.year) {
    return Math.abs(parsed.year - candidates.year) <= 1;
  }
  return true;
}
