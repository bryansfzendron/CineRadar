// Nota de 0 a 100 para um release e a decisão de envio automático.
// O idioma pesa mais que tudo: um 720p dublado vale mais que um 2160p sem português.

import type { AutoRule, Kind, ParsedRelease, ReleaseLanguage } from '../../shared/types.ts';

export interface ScoreInput {
  parsed: ParsedRelease;
  size: number;
  seeders: number | null;
  kind: Kind;
  /** Pontuação de custom formats do Radarr/Sonarr (os perfis PT-BR/dublado do usuário). */
  customFormatScore?: number | null;
  /** O Radarr/Sonarr recusou (ex.: "Wrong movie"). */
  arrRejected?: boolean;
}

const LANGUAGE_POINTS: Record<ReleaseLanguage, number> = {
  dual: 40,
  dublado: 38,
  ptbr: 28,
  multi: 14,
  legendado: 10,
  none: 0,
};

const GB = 1024 ** 3;

export function scoreRelease(input: ScoreInput, rule: AutoRule): number {
  const { parsed, size, seeders, kind } = input;
  let score = LANGUAGE_POINTS[parsed.language];

  switch (parsed.resolution) {
    case 2160:
      score += rule.allow2160 ? 16 : -30;
      break;
    case 1080:
      score += 20;
      break;
    case 720:
      score += 12;
      break;
    case 480:
      score += 3;
      break;
    default:
      score += 6;
  }

  switch (parsed.quality) {
    case 'remux':
    case 'bluray':
    case 'webdl':
      score += 10;
      break;
    case 'webrip':
      score += 7;
      break;
    case 'hdtv':
      score += 4;
      break;
    case 'dvd':
      score += 2;
      break;
    case 'cam':
      score -= 60;
      break;
    default:
      score += 3;
  }

  if (parsed.codec === 'x265' || parsed.codec === 'av1') score += 3;

  if (seeders !== null) {
    if (seeders === 0) score -= 25;
    else score += Math.min(15, Math.round(6 * Math.log10(seeders + 1) + 2));
  } else {
    score += 4;
  }

  const sizeGb = size / GB;
  const maxGb = kind === 'movie' ? rule.maxSizeGbMovie : rule.maxSizeGbSeason;
  if (size > 0) {
    if (sizeGb > maxGb) score -= 30;
    else if (kind === 'movie' && sizeGb < 0.3) score -= 20;
    else score += 5;
  }

  if (input.customFormatScore && input.customFormatScore > 0) score += Math.min(8, Math.round(input.customFormatScore / 25));
  if (input.arrRejected) score -= 8;

  return Math.max(0, Math.min(100, score));
}

/** Pode ir sozinho para download? Devolve os motivos quando não pode. */
export function autoDecision(
  input: ScoreInput & { score: number },
  rule: AutoRule,
): { eligible: boolean; reasons: string[] } {
  // "Envio automático desligado" não entra nos motivos: vale para todos e já aparece no status do item.
  const reasons: string[] = [];
  const { parsed } = input;
  if (input.score < rule.minScore) reasons.push(`nota ${input.score} abaixo de ${rule.minScore}`);
  if (parsed.language === 'none' || parsed.language === 'legendado') reasons.push('sem áudio em português');
  else if (parsed.language === 'multi') reasons.push('dual sem idioma identificado');
  else if (parsed.language === 'ptbr' && rule.requireDub) reasons.push('áudio em português não confirmado');
  if ((input.seeders ?? 0) < rule.minSeeders) reasons.push(`menos de ${rule.minSeeders} seeders`);
  const maxGb = input.kind === 'movie' ? rule.maxSizeGbMovie : rule.maxSizeGbSeason;
  if (input.size / GB > maxGb) reasons.push(`maior que ${maxGb} GB`);
  if (parsed.quality === 'cam') reasons.push('gravado no cinema (CAM/TS)');
  if (parsed.resolution === 2160 && !rule.allow2160) reasons.push('4K desativado');
  return { eligible: rule.enabled && reasons.length === 0, reasons };
}

export const DEFAULT_AUTO_RULE: AutoRule = {
  enabled: true,
  minScore: 70,
  minSeeders: 3,
  maxSizeGbMovie: 15,
  maxSizeGbSeason: 40,
  allow2160: false,
  requireDub: true,
};
