// Seeders e leechers de um torrent perguntando direto aos trackers UDP (BEP 15), para fontes que não
// informam esses números, como os sites brasileiros.

import { randomBytes } from 'node:crypto';
import dgram from 'node:dgram';

export interface Swarm {
  seeders: number;
  leechers: number;
}

/** Trackers públicos estáveis, somados aos que vêm no próprio magnet. */
export const PUBLIC_TRACKERS = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.stealth.si:80/announce',
  'udp://tracker.torrent.eu.org:451/announce',
  'udp://open.demonii.com:1337/announce',
  'udp://exodus.desync.com:6969/announce',
];

const PROTOCOL_ID = 0x41727101980n;
const MAX_HASHES_PER_SCRAPE = 70;

/** Trackers UDP de um magnet (`tr=`). */
export function magnetTrackers(magnet: string): string[] {
  const query = magnet.slice(magnet.indexOf('?') + 1);
  return new URLSearchParams(query).getAll('tr').filter((t) => t.startsWith('udp://'));
}

/**
 * Pergunta a cada tracker e fica com o maior número visto de cada hash (trackers diferentes conhecem
 * partes diferentes do enxame). Tracker fora do ar é ignorado; hash sem resposta fica de fora do mapa.
 */
export async function scrapeSwarms(hashes: string[], trackers: string[], timeoutMs = 5000): Promise<Map<string, Swarm>> {
  const unique = [...new Set(hashes.map((h) => h.toLowerCase()).filter((h) => /^[0-9a-f]{40}$/.test(h)))];
  const result = new Map<string, Swarm>();
  if (unique.length === 0) return result;
  const urls = [...new Set(trackers)].slice(0, 8);
  await Promise.all(
    urls.map(async (url) => {
      for (let i = 0; i < unique.length; i += MAX_HASHES_PER_SCRAPE) {
        const batch = unique.slice(i, i + MAX_HASHES_PER_SCRAPE);
        const swarms = await scrapeTracker(url, batch, timeoutMs).catch(() => null);
        if (!swarms) return;
        swarms.forEach((s, idx) => {
          const hash = batch[idx]!;
          const prev = result.get(hash);
          result.set(hash, { seeders: Math.max(prev?.seeders ?? 0, s.seeders), leechers: Math.max(prev?.leechers ?? 0, s.leechers) });
        });
      }
    }),
  );
  return result;
}

/** Um tracker: connect (ação 0) e scrape (ação 2). */
async function scrapeTracker(url: string, hashes: string[], timeoutMs: number): Promise<Swarm[]> {
  const { hostname, port } = new URL(url);
  if (!hostname || !port) throw new Error('tracker sem host/porta');
  const socket = dgram.createSocket('udp4');
  const send = (msg: Buffer) =>
    new Promise<void>((resolve, reject) => socket.send(msg, Number(port), hostname, (err) => (err ? reject(err) : resolve())));
  const receive = (tx: Buffer) =>
    new Promise<Buffer>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('tracker não respondeu')), timeoutMs);
      const onMessage = (msg: Buffer) => {
        if (msg.length < 8 || !msg.subarray(4, 8).equals(tx)) return;
        clearTimeout(timer);
        socket.off('message', onMessage);
        if (msg.readUInt32BE(0) === 3) reject(new Error(msg.subarray(8).toString()));
        else resolve(msg);
      };
      socket.on('message', onMessage);
    });
  // A resposta é esperada antes de enviar; se o envio falhar, a espera não pode virar erro solto.
  const listen = (tx: Buffer) => {
    const answer = receive(tx);
    answer.catch(() => undefined);
    return answer;
  };

  try {
    socket.on('error', () => undefined);
    const tx1 = randomBytes(4);
    const connect = Buffer.alloc(16);
    connect.writeBigUInt64BE(PROTOCOL_ID, 0);
    connect.writeUInt32BE(0, 8);
    tx1.copy(connect, 12);
    const answer1 = listen(tx1);
    await send(connect);
    const res1 = await answer1;
    if (res1.length < 16 || res1.readUInt32BE(0) !== 0) throw new Error('resposta de connect inválida');
    const connectionId = res1.subarray(8, 16);

    const tx2 = randomBytes(4);
    const scrape = Buffer.alloc(16 + 20 * hashes.length);
    connectionId.copy(scrape, 0);
    scrape.writeUInt32BE(2, 8);
    tx2.copy(scrape, 12);
    hashes.forEach((h, i) => Buffer.from(h, 'hex').copy(scrape, 16 + 20 * i));
    const answer2 = listen(tx2);
    await send(scrape);
    const res2 = await answer2;
    if (res2.readUInt32BE(0) !== 2) throw new Error('resposta de scrape inválida');
    const out: Swarm[] = [];
    for (let i = 0; i < hashes.length && 8 + 12 * (i + 1) <= res2.length; i++) {
      const off = 8 + 12 * i;
      out.push({ seeders: res2.readUInt32BE(off), leechers: res2.readUInt32BE(off + 8) });
    }
    return out;
  } finally {
    socket.close();
  }
}
