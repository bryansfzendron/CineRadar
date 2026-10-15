// Utilidades para ler HTML de sites sem depender de um parser completo.

import { HttpError, requestText } from '../http.ts';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
const TTL_MS = 30 * 60_000;
const MAX_CACHE = 300;
const cache = new Map<string, { at: number; html: string }>();

/** Baixa uma página com cara de navegador e guarda por 30 minutos (as buscas se repetem a cada ciclo). */
export async function fetchHtml(url: string, service: string): Promise<string> {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.html;
  let text: string;
  try {
    ({ text } = await requestText(url, {
      service,
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'pt-BR,pt;q=0.9' },
      timeoutMs: 25_000,
    }));
  } catch (err) {
    if (err instanceof HttpError && (err.status === 403 || err.status === 503) && /just a moment|cloudflare/i.test(err.body ?? '')) {
      throw new HttpError(`${service}: o site passou a exigir a verificação do Cloudflare`, err.status);
    }
    if (err instanceof HttpError && err.status === 404) throw new HttpError(`${service}: página não encontrada (o site mudou de endereço?)`, 404);
    throw err;
  }
  if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value!);
  cache.set(url, { at: Date.now(), html: text });
  return text;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ldquo: '“', rdquo: '”', ndash: '–', mdash: '—' };

export function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-f]+|\w+);/gi, (whole, code: string) => {
    if (code[0] === '#') {
      const n = code[1]?.toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : whole;
    }
    return ENTITIES[code.toLowerCase()] ?? whole;
  });
}

/** Texto visível de um trecho de HTML. */
export function textOf(fragment: string): string {
  return decodeEntities(fragment.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

/** "1.49 GB" → bytes. */
export function parseSize(text: string): number {
  const m = /([\d.,]+)\s*(TB|GB|MB|KB)/i.exec(text);
  if (!m) return 0;
  const n = Number(m[1]!.replace(',', '.'));
  const mult = { TB: 1024 ** 4, GB: 1024 ** 3, MB: 1024 ** 2, KB: 1024 }[m[2]!.toUpperCase() as 'TB' | 'GB' | 'MB' | 'KB'];
  return Number.isFinite(n) ? Math.round(n * mult) : 0;
}
