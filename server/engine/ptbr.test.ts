import { describe, expect, it } from 'vitest';
import { detectLanguage, matchesTitle, parseRelease } from './ptbr.ts';
import { autoDecision, DEFAULT_AUTO_RULE, scoreRelease } from './score.ts';

describe('detectLanguage', () => {
  it.each([
    ['A.Substancia.2024.1080p.WEB-DL.DUAL.5.1-COMANDO', 'dual'],
    ['Belo Desastre 2023 1080p WEB-DL DUAL 5.1 PT-BR', 'dual'],
    ['John Carter Entre Dois Mundos (2012) BluRay 1080p Dual Áudio Dublado', 'dual'],
    ['Duna (2021) Dublado BluRay 720p', 'dublado'],
    ['Cidade de Deus 2002 Nacional 1080p', 'dublado'],
    ['Oppenheimer.2023.1080p.PT-BR.Legendado', 'legendado'],
    ['Filme 2023 Legendado 720p', 'legendado'],
    ['Movie.2023.1080p.WEB-DL.PT-BR', 'ptbr'],
    ['Dune.Part.Two.2024.2160p.WEB-DL.DDP5.1.Atmos.x265', 'none'],
  ])('%s → %s', (title, lang) => {
    expect(detectLanguage(title)).toBe(lang);
  });

  it('usa os idiomas que o Radarr detectou', () => {
    expect(detectLanguage('Some.Movie.2023.1080p', ['Portuguese (Brazil)'])).toBe('ptbr');
    expect(detectLanguage('Some.Movie.2023.1080p.DUAL', ['English', 'Portuguese (Brazil)'])).toBe('dual');
  });

  it('"dual" sem pista de português não é português (casos reais da busca)', () => {
    expect(detectLanguage('Dune Part One 2021 720p BluRay x264 DuaL TURKO')).toBe('none');
    expect(detectLanguage('Dune Part One (2021) RiffTrax dual audio 720p 10bit BluRay x265')).toBe('none');
    expect(detectLanguage('Dune (2021) WebDL 1080p 60fps dual')).toBe('multi');
    expect(detectLanguage('Dune.2021.1080p.DUAL', ['English', 'Turkish'])).toBe('none');
  });

  it('"Dub" russo não é dublado em português', () => {
    expect(detectLanguage('Дюна / Dune: Part One [2021, WEB-DL 2160p] Dub + 2x MVO + AVO + Ukr + Original (Eng)')).toBe('none');
    expect(detectLanguage('Duna 2021 1080p Dub PT-BR')).toBe('dublado');
  });

  it('"dual" com indício brasileiro é dual áudio', () => {
    expect(detectLanguage('Duna 2021 1080p WEB-DL DUAL 5.1', [], { localizedTitle: true })).toBe('dual');
    expect(detectLanguage('Dune.2021.1080p.BluRay.DUAL-WOLVERDONFILMES')).toBe('dual');
    expect(detectLanguage('Dune 2021 1080p Dual Audio PT-BR')).toBe('dual');
  });
});

describe('parseRelease', () => {
  it('lê resolução, origem, codec e ano', () => {
    const p = parseRelease('Rush.No.Limite.da.Emoção.2013.1080p.BluRay.x265.DUAL', [], { localizedTitle: true });
    expect(p).toMatchObject({ resolution: 1080, quality: 'bluray', codec: 'x265', year: 2013, language: 'dual' });
  });

  it('marca CAM/TS', () => {
    expect(parseRelease('Filme.2025.HDCAM.Dublado').quality).toBe('cam');
    expect(parseRelease('Filme 2025 TS Dublado').quality).toBe('cam');
    expect(parseRelease('Filme.2025.1080p.DTS-HD.BluRay').quality).toBe('bluray');
  });

  it.each([
    ['The.Bear.S02E05.1080p.WEB-DL.DUAL', 2, 5, false],
    ['The Bear S03 Completa 1080p Dual Áudio', 3, null, true],
    ['The Bear 1ª Temporada Completa Dublado', 1, null, true],
    ['Limitless Temporada 1 Dual', 1, null, true],
    ['Doctor Who Série Completa Dublado', null, null, true],
  ])('temporada em %s', (title, season, episode, full) => {
    const p = parseRelease(title);
    expect(p.season).toBe(season);
    expect(p.episode).toBe(episode);
    expect(p.fullSeason).toBe(full);
  });
});

describe('matchesTitle', () => {
  const duna = { titles: ['Duna', 'Dune'], year: 2021, kind: 'movie' as const };
  it('aceita título em pt-BR ou original com o ano certo', () => {
    expect(matchesTitle('Duna.2021.1080p.DUAL', duna)).toBe(true);
    expect(matchesTitle('Dune 2021 Dublado 720p', duna)).toBe(true);
  });
  it('recusa ano errado ou outro filme', () => {
    expect(matchesTitle('Duna.1984.1080p.DUAL', duna)).toBe(false);
    expect(matchesTitle('Dunkirk.2017.1080p', duna)).toBe(false);
  });
  it('o título precisa estar no começo do release', () => {
    const bear = { titles: ['The Bear', 'O Urso'], year: 2022, kind: 'series' as const };
    expect(matchesTitle('The.Bear.S03.1080p.WEB-DL.DUAL', bear)).toBe(true);
    expect(matchesTitle('[Grupo] The Bear S02 1080p', bear)).toBe(true);
    expect(matchesTitle('Kleo S02E03 The Bear 1080p NF WEB DL DUAL', bear)).toBe(false);
    expect(matchesTitle('Paddington and the Bear S01', bear)).toBe(false);
  });

  it('títulos longos aceitam pequenas variações', () => {
    const rush = { titles: ['Rush: No Limite da Emoção'], year: 2013, kind: 'movie' as const };
    expect(matchesTitle('Rush.No.Limite.da.Emocao.2013.1080p-WOLVERDONFILMES', rush)).toBe(true);
  });
});

describe('scoreRelease / autoDecision', () => {
  const rule = DEFAULT_AUTO_RULE;
  const score = (title: string, size: number, seeders: number | null) => {
    const parsed = parseRelease(title);
    const s = scoreRelease({ parsed, size, seeders, kind: 'movie' }, rule);
    return { s, decision: autoDecision({ parsed, size, seeders, kind: 'movie', score: s }, rule) };
  };
  const GB = 1024 ** 3;

  it('1080p dual com seeders passa no limite', () => {
    const { s, decision } = score('Duna.2021.1080p.WEB-DL.DUAL.5.1.PT-BR', 4 * GB, 120);
    expect(s).toBeGreaterThanOrEqual(rule.minScore);
    expect(decision.eligible).toBe(true);
  });

  it('dublado vale mais que 4K sem português', () => {
    const dub = score('Duna.2021.720p.Dublado', 2 * GB, 30).s;
    const eng = score('Dune.2021.2160p.WEB-DL', 20 * GB, 300).s;
    expect(dub).toBeGreaterThan(eng);
  });

  it('CAM, legendado e sem seeders não vão sozinhos', () => {
    expect(score('Filme.2025.HDCAM.Dublado', 1.5 * GB, 500).decision.eligible).toBe(false);
    expect(score('Filme.2025.1080p.Legendado', 3 * GB, 80).decision.eligible).toBe(false);
    expect(score('Filme.2025.1080p.DUAL', 3 * GB, 0).decision.reasons).toContain('menos de 3 seeders');
  });

  it('a nota fica entre 0 e 100', () => {
    expect(score('Filme.2025.HDCAM', 50 * GB, 0).s).toBe(0);
    expect(score('Filme.2025.2160p.REMUX.DUAL.x265', 10 * GB, 5000).s).toBeLessThanOrEqual(100);
  });
});
