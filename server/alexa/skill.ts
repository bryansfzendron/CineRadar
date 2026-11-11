// A conversa da skill "cine radar": pedir um filme ou série por voz, saber como está um pedido, o que
// está baixando e o que chegou. Funções puras: as consultas entram por `SkillDeps`, e o teste troca o
// TMDB e o banco por listas fixas.
//
// Pedir tem confirmação: "Duna" tem vários resultados, e a Alexa oferece um por vez ("Achei o filme
// Duna: Parte Dois, de 2024. Quer que eu peça?"). "Não" passa para o próximo. A lista de candidatos
// viaja nos atributos da sessão da Alexa, então o servidor não guarda nada entre uma fala e outra.

import type { ItemStatus, Kind } from '../../shared/types.ts';
import type { AlexaRequestEnvelope } from './verify.ts';

export interface Candidate {
  kind: Kind;
  tmdbId: number;
  title: string;
  year: number | null;
  inList: { id: number; status: ItemStatus } | null;
  inLibrary: { plexUrl: string | null; jellyfinUrl: string | null } | null;
}

export interface ItemSummary {
  kind: Kind;
  title: string;
  originalTitle: string;
  year: number | null;
  status: ItemStatus;
  statusDetail: string | null;
  progress: number | null;
}

export interface SkillDeps {
  search(query: string, kind?: Kind): Promise<Candidate[]>;
  request(kind: Kind, tmdbId: number): Promise<{ created: boolean }>;
  items(): ItemSummary[];
  /** Títulos que ficaram disponíveis nos últimos dias, do mais novo para o mais antigo. */
  arrived(): string[];
}

interface SessionState {
  candidates?: Candidate[];
  index?: number;
}

export interface AlexaResponse {
  version: '1.0';
  sessionAttributes?: SessionState;
  response: Record<string, unknown>;
}

const MAX_CANDIDATES = 5;

export const HELP =
  'Você pode dizer: pede o filme Duna, pede a série The Bear, como está o pedido de Duna, o que está baixando, ou o que chegou.';

// ---------- fala ----------

export function speak(text: string, opts: { ask?: string; state?: SessionState } = {}): AlexaResponse {
  const response: Record<string, unknown> = {
    outputSpeech: { type: 'PlainText', text: opts.ask ? `${text} ${opts.ask}` : text },
    card: { type: 'Simple', title: 'CineRadar', content: text },
    shouldEndSession: !opts.ask,
  };
  if (opts.ask) response.reprompt = { outputSpeech: { type: 'PlainText', text: opts.ask } };
  return { version: '1.0', ...(opts.state ? { sessionAttributes: opts.state } : {}), response };
}

export function listPt(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} e ${items[items.length - 1]}`;
}

export function describe(c: { kind: Kind; title: string; year: number | null }): string {
  return `${c.kind === 'movie' ? 'o filme' : 'a série'} ${c.title}${c.year ? `, de ${c.year}` : ''}`;
}

function capital(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function whereOwned(lib: NonNullable<Candidate['inLibrary']>): string {
  if (lib.plexUrl && lib.jellyfinUrl) return 'no Plex e no Jellyfin';
  if (lib.plexUrl) return 'no Plex';
  if (lib.jellyfinUrl) return 'no Jellyfin';
  return 'na biblioteca';
}

function percent(progress: number | null): string {
  return progress !== null && progress > 0 && progress < 1 ? `, ${Math.round(progress * 100)}%` : '';
}

/** Como um pedido está, numa frase que continua depois do nome. */
export function statusPhrase(i: Pick<ItemSummary, 'status' | 'statusDetail' | 'progress'>): string {
  switch (i.status) {
    case 'wanted':
      return 'está na lista, esperando aparecer uma versão em português';
    case 'searching':
      return 'está com a busca em andamento';
    case 'found':
      return 'tem versão em português esperando a sua aprovação no app';
    case 'sent':
      return 'já foi para o download';
    case 'downloading':
      return `está baixando${percent(i.progress)}`;
    case 'available':
      return 'já está disponível para assistir';
    case 'error':
      return i.statusDetail ? `deu erro: ${i.statusDetail}` : 'deu erro';
  }
}

/** O mesmo, curto, para a lista do que está em andamento. */
export function statusShort(i: Pick<ItemSummary, 'status' | 'progress'>): string {
  switch (i.status) {
    case 'wanted':
      return 'esperando versão em português';
    case 'searching':
      return 'em busca';
    case 'found':
      return 'esperando aprovação';
    case 'sent':
      return 'indo para o download';
    case 'downloading':
      return `baixando${percent(i.progress)}`;
    case 'available':
      return 'disponível';
    case 'error':
      return 'com erro';
  }
}

// ---------- entender o que foi dito ----------

export function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** "o filme duna" → filme, "duna". A Alexa às vezes deixa o "o filme" dentro do valor do slot. */
export function parseTitle(value: string, kind?: Kind): { query: string; kind?: Kind } {
  let query = value.trim();
  const m = /^(?:o\s+|um\s+)?(filme|s[eé]rie)\s+(?:d[oa]\s+)?(.+)$/i.exec(query) ?? /^(?:a\s+|uma\s+)(s[eé]rie)\s+(.+)$/i.exec(query);
  if (m) {
    kind ??= m[1]!.toLowerCase() === 'filme' ? 'movie' : 'series';
    query = m[2]!;
  }
  return { query: query.trim(), ...(kind ? { kind } : {}) };
}

/** O pedido da lista que corresponde ao nome falado: igual, ou um contendo o outro. */
export function findItem(items: ItemSummary[], spoken: string): ItemSummary | null {
  const q = normalize(spoken);
  if (!q) return null;
  const names = (i: ItemSummary) => [normalize(i.title), normalize(i.originalTitle)];
  return (
    items.find((i) => names(i).includes(q)) ??
    items.find((i) => names(i).some((n) => n.startsWith(q) || q.startsWith(n))) ??
    items.find((i) => names(i).some((n) => n.includes(q))) ??
    null
  );
}

function slot(env: AlexaRequestEnvelope, name: string): string {
  return env.request?.intent?.slots?.[name]?.value?.trim() ?? '';
}

// ---------- pedir ----------

function offer(candidates: Candidate[], index: number, prefix: string): AlexaResponse {
  const c = candidates[index]!;
  const state: SessionState = { candidates, index };
  if (c.inLibrary) return speak(`${prefix} ${describe(c)}, que já está ${whereOwned(c.inLibrary)}.`, { ask: 'É esse?', state });
  if (c.inList) return speak(`${prefix} ${describe(c)}, que já está na sua lista.`, { ask: 'É esse?', state });
  return speak(`${prefix} ${describe(c)}.`, { ask: 'Quer que eu peça?', state });
}

async function ask(env: AlexaRequestEnvelope, deps: SkillDeps, kind?: Kind): Promise<AlexaResponse> {
  const spoken = slot(env, 'titulo');
  if (!spoken) return speak('Qual filme ou série? Diga, por exemplo: pede o filme Duna.', { ask: 'O que você quer pedir?' });
  const t = parseTitle(spoken, kind);
  const found = (await deps.search(t.query, t.kind)).filter((c) => c.title).slice(0, MAX_CANDIDATES);
  if (!found.length) {
    const what = t.kind === 'series' ? 'nenhuma série chamada' : t.kind === 'movie' ? 'nenhum filme chamado' : 'nenhum filme ou série com o nome';
    return speak(`Não achei ${what} ${t.query}.`);
  }
  return offer(found, 0, 'Achei');
}

async function yes(state: SessionState, deps: SkillDeps): Promise<AlexaResponse> {
  const c = state.candidates?.[state.index ?? 0];
  if (!c) return speak(`Não tenho nada para confirmar. ${HELP}`);
  if (c.inLibrary) return speak(`Então é só assistir: ${describe(c)} já está ${whereOwned(c.inLibrary)}.`);
  if (c.inList) {
    const item = deps.items().find((i) => i.kind === c.kind && normalize(i.title) === normalize(c.title));
    return speak(`${capital(describe(c))} já estava na lista${item ? ` e ${statusPhrase(item)}` : ''}.`);
  }
  const { created } = await deps.request(c.kind, c.tmdbId);
  return speak(
    created
      ? `Pronto, pedi ${describe(c)}. O CineRadar vai procurar uma versão em português.`
      : `${capital(describe(c))} já estava na lista.`,
  );
}

function no(state: SessionState): AlexaResponse {
  const candidates = state.candidates ?? [];
  const next = (state.index ?? 0) + 1;
  if (!candidates.length) return speak('Tudo bem.');
  if (next >= candidates.length) return speak('Não achei outro com esse nome. Tente de novo dizendo o nome com o ano.');
  return offer(candidates, next, 'Então seria');
}

// ---------- consultar ----------

function status(env: AlexaRequestEnvelope, deps: SkillDeps): AlexaResponse {
  const spoken = parseTitle(slot(env, 'titulo')).query;
  if (!spoken) return speak('De qual pedido? Diga, por exemplo: como está o pedido de Duna.');
  const item = findItem(deps.items(), spoken);
  if (!item) return speak(`Não achei ${spoken} na sua lista.`);
  return speak(`${capital(describe(item))} ${statusPhrase(item)}.`);
}

function pending(deps: SkillDeps): AlexaResponse {
  const open = deps.items().filter((i) => i.status !== 'available');
  if (!open.length) return speak('Nenhum pedido em andamento. Tudo o que você pediu já chegou.');
  // Primeiro o que está mais perto de chegar.
  const order: ItemStatus[] = ['downloading', 'sent', 'found', 'searching', 'wanted', 'error'];
  open.sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status));
  const parts = open.slice(0, 5).map((i) => `${i.title}, ${statusShort(i)}`);
  const rest = open.length - parts.length;
  const head = open.length === 1 ? 'Tem 1 pedido em andamento: ' : `Tem ${open.length} pedidos em andamento: `;
  return speak(`${head}${listPt(parts)}${rest > 0 ? `, e mais ${rest}` : ''}.`);
}

function arrived(deps: SkillDeps): AlexaResponse {
  const titles = [...new Set(deps.arrived())];
  if (!titles.length) return speak('Nada novo chegou nos últimos 7 dias.');
  const rest = titles.length - 5;
  return speak(`Nos últimos 7 dias chegaram: ${listPt(titles.slice(0, 5))}${rest > 0 ? `, e mais ${rest}` : ''}.`);
}

// ---------- despacho ----------

export async function handle(env: AlexaRequestEnvelope, deps: SkillDeps): Promise<AlexaResponse> {
  const type = env.request?.type ?? '';
  const state = (env.session?.attributes ?? {}) as SessionState;
  if (type === 'LaunchRequest') {
    return speak('Oi! Para pedir, diga: pede o filme, e o nome.', { ask: 'O que você quer assistir?' });
  }
  if (type === 'SessionEndedRequest') return { version: '1.0', response: {} };
  if (type !== 'IntentRequest') return speak('Não entendi o pedido.');

  switch (env.request?.intent?.name) {
    case 'PedirIntent':
      return ask(env, deps);
    case 'PedirFilmeIntent':
      return ask(env, deps, 'movie');
    case 'PedirSerieIntent':
      return ask(env, deps, 'series');
    case 'AMAZON.YesIntent':
      return yes(state, deps);
    case 'AMAZON.NoIntent':
      return no(state);
    case 'StatusPedidoIntent':
      return status(env, deps);
    case 'PendentesIntent':
      return pending(deps);
    case 'ChegouIntent':
      return arrived(deps);
    case 'AMAZON.HelpIntent':
      return speak(HELP, { ask: 'O que você quer fazer?' });
    case 'AMAZON.StopIntent':
    case 'AMAZON.CancelIntent':
    case 'AMAZON.NavigateHomeIntent':
      return speak('Até mais!');
    default:
      return speak(`Isso eu ainda não sei fazer. ${HELP}`, { ask: 'O que você quer fazer?' });
  }
}
