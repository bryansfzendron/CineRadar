import { describe, expect, it } from 'vitest';
import { detectLanguage, parseRelease } from '../../engine/ptbr.ts';
import { magnetHash } from '../qbittorrent.ts';
import { cardFits, cleanLabel, cleanMagnetName, pageReleases, parseSearch, parseTitlePage } from './redetorrent.ts';

// Trechos no formato real do site (redestorrents.com, outubro de 2026), reduzidos.
const SEARCH_HTML = `
<div class="col">
  <a href="https://redestorrents.com/duna-parte-2-torrent-dublado-dual-audio-legendado-download/" class="text-decoration-none cover-link" title="Duna - Parte 2 Torrent">
    <article class="custom-card" data-title="Duna - Parte 2" data-tipo="Filmes" data-genero="Ação" data-desc="Paul Atreides &amp; Chani.">
      <div class="cover-wrapper"><span class="cover-badge badge-audio">Dual Áudio</span></div>
    </article>
  </a>
</div>
<div class="col">
  <a href="/o-urso-5a-temporada-torrent-dublado-dual-audio-legendado-download/" class="text-decoration-none cover-link" title="O Urso">
    <article class="custom-card" data-title="O Urso - 5ª Temporada" data-tipo="Séries" data-genero="Drama" data-desc="">
    </article>
  </a>
</div>
<div class="col">
  <a href="/a-familia-urso/" class="text-decoration-none cover-link" title="A Família Urso">
    <article class="custom-card" data-title="A Família Urso / The Beary Family" data-tipo="Desenhos"></article>
  </a>
</div>`;

const MAGNET_DUAL =
  'magnet:?xt=urn:btih:4DBTGVDMM5JRT5IIGGFJEZZ5E37GCRPR&amp;dn=SITEDETORRENTS.COM..MKV.Duna%20-%20Parte%202%202024%20WEB-DL%201080p%20x264%20DUAL%205.1&amp;tr=udp%3A%2F%2Ftracker.openbittorrent.com%3A80%2Fannounce';
const MAGNET_LEG =
  'magnet:?xt=urn:btih:E5YP4JYIIVTUSZXBQS7GB3I34D7ESTZ2&amp;dn=SITEDETORRENTS.COM..MP4.-LEGENDADO-..Dune%20Part%20Two%20(2024)%20%5B1080p%5D%20%5BWEBRip%5D';

const PAGE_HTML = `
<html><head><title>Duna - Parte 2 Torrent (2024) Dual Áudio 5.1 Download</title>
<script type="application/ld+json">{"@type":"Movie","alternateName": "Dune: Part Two", "sameAs": "https://www.imdb.com/title/tt15239678/"}</script>
</head><body>
<h2>LINKS PARA BAIXAR</h2>
<div class="download-item"><span class="download-name">DOWNLOAD TORRENT DUAL ÁUDIO 5.1 MKV 1080P</span>
<a href="${MAGNET_DUAL}" rel="nofollow" class="download-btn download-btn-green">Download</a></div>
<div class="download-item"><span class="download-name">DOWNLOAD TORRENT LEGENDADO 5.1 MP4 1080P</span>
<a href="${MAGNET_LEG}" rel="nofollow" class="download-btn download-btn-red">Download</a></div>
<ul><li><i class="fa-solid fa-database"></i><span>Tamanho do Arquivo</span><strong>3.50 GB | 1.49 GB</strong></li></ul>
</body></html>`;

const dunaQuery = { kind: 'movie' as const, titles: ['Duna: Parte Dois', 'Dune: Part Two'], year: 2024, seasons: [], imdbId: 'tt15239678' };

describe('Rede Torrent: busca', () => {
  it('lê os cartões com título, tipo, temporada e endereço absoluto', () => {
    const cards = parseSearch(SEARCH_HTML, 'https://redestorrents.com/');
    expect(cards).toEqual([
      { url: 'https://redestorrents.com/duna-parte-2-torrent-dublado-dual-audio-legendado-download/', title: 'Duna - Parte 2', kind: 'movie', season: null },
      { url: 'https://redestorrents.com/o-urso-5a-temporada-torrent-dublado-dual-audio-legendado-download/', title: 'O Urso - 5ª Temporada', kind: 'series', season: 5 },
      { url: 'https://redestorrents.com/a-familia-urso/', title: 'A Família Urso / The Beary Family', kind: null, season: null },
    ]);
  });

  it('filtra cartões antes de abrir as páginas', () => {
    const [duna, urso, familia] = parseSearch(SEARCH_HTML, 'https://redestorrents.com/');
    // "Duna - Parte 2" não bate com "Duna: Parte Dois" pelo nome, mas a página confirma pelo IMDb.
    expect(cardFits(duna!, dunaQuery)).toBe(true);
    expect(cardFits(duna!, { ...dunaQuery, imdbId: null })).toBe(false);
    const bear = { kind: 'series' as const, titles: ['O Urso', 'The Bear'], year: 2022, seasons: [], imdbId: null };
    expect(cardFits(urso!, bear)).toBe(true);
    expect(cardFits(urso!, { ...bear, seasons: [1, 2] })).toBe(false);
    expect(cardFits(familia!, bear)).toBe(false);
    expect(cardFits(urso!, { ...dunaQuery, titles: ['O Urso'] })).toBe(false);
  });
});

describe('Rede Torrent: página do título', () => {
  const page = parseTitlePage(PAGE_HTML);

  it('lê nome, ano, título original, IMDb, tamanhos e um rótulo por magnet', () => {
    expect(page.name).toBe('Duna - Parte 2');
    expect(page.year).toBe(2024);
    expect(page.altName).toBe('Dune: Part Two');
    expect(page.imdbId).toBe('tt15239678');
    expect(page.sizes).toHaveLength(2);
    expect(page.links.map((l) => l.label)).toEqual(['DOWNLOAD TORRENT DUAL ÁUDIO 5.1 MKV 1080P', 'DOWNLOAD TORRENT LEGENDADO 5.1 MP4 1080P']);
    expect(page.links[0]!.magnet).toContain('&dn=');
  });

  it('monta releases que o parser entende', () => {
    const [card] = parseSearch(SEARCH_HTML, 'https://redestorrents.com/');
    const releases = pageReleases(page, card!, dunaQuery, card!.url);
    expect(releases).toHaveLength(2);
    const [dual, leg] = releases;
    expect(dual!.title).toBe('Dune: Part Two 2024 DUAL ÁUDIO 5.1 MKV 1080P [Duna - Parte 2 2024 WEB-DL 1080p x264 DUAL 5 1]');
    expect(dual!.matched).toBe(true);
    expect(dual!.size).toBeGreaterThan(3e9);
    expect(dual!.infoHash).toMatch(/^[0-9a-f]{40}$/);
    expect(parseRelease(dual!.title, [], { brSource: true })).toMatchObject({ language: 'dual', resolution: 1080, quality: 'webdl' });
    expect(parseRelease(leg!.title, [], { brSource: true }).language).toBe('legendado');
  });

  it('descarta a página de outro filme pelo IMDb', () => {
    const [card] = parseSearch(SEARCH_HTML, 'https://redestorrents.com/');
    expect(pageReleases(page, card!, { ...dunaQuery, imdbId: 'tt1160419' }, card!.url)).toEqual([]);
  });

  it('limpa rótulo e nome do magnet', () => {
    expect(cleanLabel('5ª TEMPORADA COMPLETA DOWNLOAD TORRENT DUBLADA DUAL ÁUDIO MKV')).toBe('5ª TEMPORADA COMPLETA DUBLADA DUAL ÁUDIO MKV');
    expect(cleanMagnetName('magnet:?xt=urn:btih:x&dn=HIDRATORRENTS.ORG...MKV.-DUBLADO-DUAL-AUDIO-..')).toBe('-DUBLADO-DUAL-AUDIO-');
  });
});

describe('suporte', () => {
  it('converte o hash base32 do magnet para hexadecimal, como o qBittorrent mostra', () => {
    expect(magnetHash('magnet:?xt=urn:btih:4DBTGVDMM5JRT5IIGGFJEZZ5E37GCRPR&dn=x')).toBe('e0c333546c675319f508318a92673d26fe6145f1');
    expect(magnetHash('magnet:?xt=urn:btih:E0C333546C675319F508318A92673D26FE6145F1')).toBe('e0c333546c675319f508318a92673d26fe6145f1');
    expect(magnetHash('magnet:?xt=urn:btih:curto')).toBeNull();
  });

  it('"dual" de site brasileiro é português', () => {
    expect(detectLanguage('Filme Qualquer 2024 DUAL ÁUDIO 5.1 MKV 1080P')).toBe('multi');
    expect(detectLanguage('Filme Qualquer 2024 DUAL ÁUDIO 5.1 MKV 1080P', [], { brSource: true })).toBe('dual');
  });

  it('a resolução escrita vence o "4K" solto no nome', () => {
    expect(parseRelease('Duna - 4K UHD 2021 DUAL ÁUDIO 5.1 MKV 1080P').resolution).toBe(1080);
    expect(parseRelease('Duna 2021 4K HDR').resolution).toBe(2160);
  });
});
