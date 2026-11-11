// A conversa da skill "meu cinema": pedir (filme, série ou uma temporada), aprovar, tirar da lista, saber
// sobre um título, sugestões, tocar na TV e as consultas (status, o que está baixando, o que chegou).
// Funções puras: as consultas entram por `SkillDeps`, e o teste troca o TMDB e o banco por listas fixas.
//
// Tudo que muda algo pede confirmação, e o "sim" depende da pergunta que ficou no ar: ela viaja nos
// atributos da sessão da Alexa (`SessionState.action`), então o servidor não guarda nada entre falas.

import type { ItemStatus, Kind, ReleaseLanguage } from '../../shared/types.ts';
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
  id: number;
  kind: Kind;
  title: string;
  originalTitle: string;
  year: number | null;
  status: ItemStatus;
  statusDetail: string | null;
  progress: number | null;
}

export interface TitleInfo {
  genres: string[];
  runtime: number | null;
  rating: number | null;
  seasons: number[];
  overview: string;
}

export interface ReleaseSummary {
  id: number;
  language: ReleaseLanguage;
  resolution: number | null;
  size: number;
  season: number | null;
}

export type SuggestionList = 'trending' | 'now_playing' | 'popular' | 'upcoming' | 'on_the_air';

export type RequestReply =
  | { outcome: 'created' | 'exists' | 'season-added' | 'has-all-seasons' }
  | { outcome: 'no-such-season'; seasons: number[] };

export type PlayReply = { ok: true; via: string; device: string } | { ok: false; reason: 'not-in-library' | 'no-player' };

export interface SkillDeps {
  search(query: string, kind?: Kind): Promise<Candidate[]>;
  suggestions(which: SuggestionList, kind: Kind): Promise<Candidate[]>;
  details(kind: Kind, tmdbId: number): Promise<TitleInfo>;
  request(kind: Kind, tmdbId: number, season?: number): Promise<RequestReply>;
  items(): ItemSummary[];
  /** Títulos que ficaram disponíveis nos últimos dias, do mais novo para o mais antigo. */
  arrived(): string[];
  /** As versões que seriam enviadas ao aprovar (vazio = nada em português para aprovar). */
  approvalPlan(itemId: number): ReleaseSummary[];
  approve(itemId: number, releaseIds: number[]): Promise<{ sent: number; errors: string[] }>;
  remove(itemId: number): void;
  play(kind: Kind, tmdbId: number, device?: string): Promise<PlayReply>;
}

type Brief = Pick<Candidate, 'kind' | 'title' | 'year'>;

interface SessionState {
  action?: 'request' | 'approve' | 'remove' | 'play' | 'choose';
  candidates?: Candidate[];
  index?: number;
  /** Só um candidato: "não" encerra em vez de oferecer o próximo. */
  single?: boolean;
  season?: number;
  itemId?: number;
  item?: Brief & { status?: ItemStatus };
  releaseIds?: number[];
  device?: string;
}

export interface AlexaResponse {
  version: '1.0';
  sessionAttributes?: SessionState;
  response: Record<string, unknown>;
}

const MAX_CANDIDATES = 5;
const ORDINALS = ['primeiro', 'segundo', 'terceiro', 'quarto', 'quinto'];

export const HELP =
  'Você pode pedir um filme, uma série ou uma temporada, aprovar uma versão, tirar da lista, perguntar sobre um título, ' +
  'pedir sugestões, colocar um filme na TV, ou saber o que está baixando e o que chegou.';

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

export function describe(c: Brief): string {
  return `${c.kind === 'movie' ? 'o filme' : 'a série'} ${c.title}${c.year ? `, de ${c.year}` : ''}`;
}

/** "a temporada 3 da série O Urso, de 2022". */
export function describeSeason(c: Brief, season: number): string {
  return `a temporada ${season} da série ${c.title}${c.year ? `, de ${c.year}` : ''}`;
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
      return 'tem versão em português esperando a sua aprovação';
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

const LANGUAGE_WORD: Partial<Record<ReleaseLanguage, string>> = { dual: 'dual áudio', dublado: 'dublado', ptbr: 'em português' };

export function sizeWord(bytes: number): string {
  if (bytes <= 0) return '';
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(1).replace('.', ',').replace(/,0$/, '')} gigas`;
  return `${Math.round(bytes / 1024 ** 2)} megas`;
}

/** "dual áudio, 1080p, 4,2 gigas". */
export function releaseWord(r: Pick<ReleaseSummary, 'language' | 'resolution' | 'size'>): string {
  return [LANGUAGE_WORD[r.language] ?? 'em português', r.resolution ? `${r.resolution}p` : '', sizeWord(r.size)].filter(Boolean).join(', ');
}

export function runtimeWord(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (!h) return `${m} minutos`;
  const hours = h === 1 ? '1 hora' : `${h} horas`;
  return m ? `${hours} e ${m} minutos` : hours;
}

/** As primeiras frases da sinopse, até uns 300 caracteres. */
export function shortOverview(text: string, max = 300): string {
  const sentences = text.trim().split(/(?<=[.!?])\s+/).filter(Boolean);
  let out = '';
  for (const s of sentences) {
    if (out && out.length + s.length > max) break;
    out = out ? `${out} ${s}` : s;
  }
  return out.length > max + 150 ? `${out.slice(0, max).replace(/\s+\S*$/, '')}…` : out;
}

/** "O filme Duna, de 2021: ficção científica e aventura, 2 horas e 35 minutos, nota 7,8 no TMDB. Sinopse…" */
export function aboutText(c: Brief, info: TitleInfo): string {
  const facts: string[] = [];
  if (info.genres.length) facts.push(listPt(info.genres.slice(0, 3).map((g) => g.toLowerCase())));
  if (c.kind === 'series' && info.seasons.length) facts.push(info.seasons.length === 1 ? '1 temporada' : `${info.seasons.length} temporadas`);
  if (c.kind === 'movie' && info.runtime) facts.push(runtimeWord(info.runtime));
  if (info.rating) facts.push(`nota ${info.rating.toFixed(1).replace('.', ',')} no TMDB`);
  const head = `${capital(describe(c))}${facts.length ? `: ${facts.join(', ')}` : ''}.`;
  const overview = shortOverview(info.overview);
  return overview ? `${head} ${overview}` : head;
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

const NUMBER_WORDS: Record<string, number> = {
  um: 1, uma: 1, primeiro: 1, primeira: 1,
  dois: 2, duas: 2, segundo: 2, segunda: 2,
  tres: 3, terceiro: 3, terceira: 3,
  quatro: 4, quarto: 4, quarta: 4,
  cinco: 5, quinto: 5, quinta: 5,
  seis: 6, sexto: 6, sexta: 6,
  sete: 7, setimo: 7, setima: 7,
  oito: 8, oitavo: 8, oitava: 8,
  nove: 9, nono: 9, nona: 9,
  dez: 10, decimo: 10, decima: 10,
  onze: 11, doze: 12, treze: 13, catorze: 14, quatorze: 14, quinze: 15,
};

/** "3", "3ª", "terceira", "três", "décima primeira" → número. */
export function wordToNumber(text: string): number | null {
  const digits = /^(\d{1,2})\s*[ªºao°]?$/i.exec(text.trim());
  if (digits) return Number(digits[1]);
  const t = normalize(text);
  const parts = t.split(' ');
  if (parts.length === 2 && NUMBER_WORDS[parts[0]!] === 10 && NUMBER_WORDS[parts[1]!] && NUMBER_WORDS[parts[1]!]! < 10) {
    return 10 + NUMBER_WORDS[parts[1]!]!;
  }
  return parts.length === 1 ? (NUMBER_WORDS[t] ?? null) : null;
}

const OF = String.raw`(?:de|do|da|dos|das)`;

/** "a terceira temporada de the bear", "temporada 3 de the bear" → 3, "the bear". */
export function parseSeason(text: string, bare = false): { season: number; rest: string } | null {
  const v = text.trim();
  const patterns = [
    new RegExp(String.raw`^(?:a\s+)?(\S+(?:\s+\S+)?)\s+temporada\s+${OF}\s+(.+)$`, 'i'),
    new RegExp(String.raw`^(?:a\s+)?temporada\s+(\S+(?:\s+\S+)?)\s+${OF}\s+(.+)$`, 'i'),
    // Dentro de "pede a temporada {…}", o valor vem sem a palavra: "3 de the bear".
    ...(bare ? [new RegExp(String.raw`^(\S+(?:\s+\S+)?)\s+${OF}\s+(.+)$`, 'i')] : []),
  ];
  for (const p of patterns) {
    const m = p.exec(v);
    if (!m) continue;
    const n = wordToNumber(m[1]!);
    if (n && n > 0 && n < 100) return { season: n, rest: m[2]!.trim() };
  }
  return null;
}

/** "o filme duna" → filme, "duna". A Alexa às vezes deixa o "o filme" dentro do valor do slot. */
export function parseTitle(value: string, kind?: Kind, seasonOnly = false): { query: string; kind?: Kind; season?: number } {
  let query = value.trim();
  let season: number | undefined;
  const s = parseSeason(query, seasonOnly);
  if (s) {
    season = s.season;
    query = s.rest;
    kind = 'series';
  }
  const m = /^(?:o\s+|um\s+)?(filme|s[eé]rie)\s+(?:d[oa]\s+)?(.+)$/i.exec(query) ?? /^(?:a\s+|uma\s+)(s[eé]rie)\s+(.+)$/i.exec(query);
  if (m) {
    kind ??= m[1]!.toLowerCase() === 'filme' ? 'movie' : 'series';
    query = m[2]!;
  }
  return { query: query.trim(), ...(kind ? { kind } : {}), ...(season ? { season } : {}) };
}

/** "duna na tv da sala" → "duna", "sala". */
export function parseDevice(value: string): { query: string; device?: string } {
  const m = /^(.+?)\s+(?:na|pra|para a|no)\s+(?:tv|tev[eê]|televis[aã]o)(?:\s+(?:da|do|de)\s+(.+))?$/i.exec(value.trim());
  if (!m) return { query: value.trim() };
  return { query: m[1]!.trim(), ...(m[2] ? { device: m[2].trim() } : {}) };
}

/** O pedido da lista que corresponde ao nome falado: igual, ou um contendo o outro. */
export function findItem<T extends Pick<ItemSummary, 'title' | 'originalTitle'>>(items: T[], spoken: string): T | null {
  const q = normalize(spoken);
  if (!q) return null;
  const names = (i: T) => [normalize(i.title), normalize(i.originalTitle)];
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

/** O id do valor de um slot com tipo próprio (o sinônimo dito vira o valor canônico). */
function slotId(env: AlexaRequestEnvelope, name: string): string {
  const s = env.request?.intent?.slots?.[name] as
    | { resolutions?: { resolutionsPerAuthority?: { status?: { code?: string }; values?: { value?: { id?: string } }[] }[] } }
    | undefined;
  const hit = s?.resolutions?.resolutionsPerAuthority?.find((a) => a.status?.code === 'ER_SUCCESS_MATCH');
  return hit?.values?.[0]?.value?.id ?? '';
}

// ---------- pedir ----------

function offer(candidates: Candidate[], index: number, prefix: string, extra: Pick<SessionState, 'season' | 'single'> = {}): AlexaResponse {
  const c = candidates[index]!;
  const state: SessionState = { action: 'request', candidates, index, ...extra };
  if (extra.season != null) {
    const owned = c.inLibrary ? `, que já está ${whereOwned(c.inLibrary)}` : '';
    return speak(`${prefix} ${describe(c)}${owned}.`, { ask: `Quer que eu peça a temporada ${extra.season}?`, state });
  }
  if (c.inLibrary) return speak(`${prefix} ${describe(c)}, que já está ${whereOwned(c.inLibrary)}.`, { ask: 'É esse?', state });
  if (c.inList) return speak(`${prefix} ${describe(c)}, que já está na sua lista.`, { ask: 'É esse?', state });
  return speak(`${prefix} ${describe(c)}.`, { ask: 'Quer que eu peça?', state });
}

async function ask(env: AlexaRequestEnvelope, deps: SkillDeps, kind?: Kind, seasonOnly = false): Promise<AlexaResponse> {
  const spoken = slot(env, 'titulo');
  if (!spoken) return speak('Qual filme ou série? Diga, por exemplo: pede o filme Duna.', { ask: 'O que você quer pedir?' });
  const t = parseTitle(spoken, kind, seasonOnly);
  if (seasonOnly && t.season == null) return speak('Qual temporada? Diga, por exemplo: pede a temporada 2 de The Bear.');
  const found = (await deps.search(t.query, t.kind)).filter((c) => c.title).slice(0, MAX_CANDIDATES);
  if (!found.length) {
    const what = t.kind === 'series' ? 'nenhuma série chamada' : t.kind === 'movie' ? 'nenhum filme chamado' : 'nenhum filme ou série com o nome';
    return speak(`Não achei ${what} ${t.query}.`);
  }
  return offer(found, 0, 'Achei', t.season != null ? { season: t.season } : {});
}

async function confirmRequest(state: SessionState, deps: SkillDeps): Promise<AlexaResponse> {
  const c = state.candidates?.[state.index ?? 0];
  if (!c) return speak(`Não tenho nada para confirmar. ${HELP}`);
  const season = state.season;
  if (season == null && c.inLibrary) return speak(`Então é só assistir: ${describe(c)} já está ${whereOwned(c.inLibrary)}.`);
  if (season == null && c.inList) {
    const item = deps.items().find((i) => i.kind === c.kind && normalize(i.title) === normalize(c.title));
    return speak(`${capital(describe(c))} já estava na lista${item ? ` e ${statusPhrase(item)}` : ''}.`);
  }
  const r = await deps.request(c.kind, c.tmdbId, season);
  if (season != null) {
    switch (r.outcome) {
      case 'created':
        return speak(`Pronto, pedi ${describeSeason(c, season)}. O CineRadar vai procurar uma versão em português.`);
      case 'season-added':
        return speak(`Pronto, acrescentei a temporada ${season} ao pedido de ${describe(c)}.`);
      case 'has-all-seasons':
        return speak(`${capital(describe(c))} já está na lista com todas as temporadas, então a ${season} vem junto.`);
      case 'exists':
        return speak(`A temporada ${season} de ${c.title} já estava pedida.`);
      case 'no-such-season': {
        const n = r.seasons.length;
        return speak(`${capital(describe(c))} tem ${n === 1 ? 'só 1 temporada' : `${n} temporadas`}. Não existe a temporada ${season}.`);
      }
    }
  }
  return speak(
    r.outcome === 'created'
      ? `Pronto, pedi ${describe(c)}. O CineRadar vai procurar uma versão em português.`
      : `${capital(describe(c))} já estava na lista.`,
  );
}

function declineRequest(state: SessionState): AlexaResponse {
  const candidates = state.candidates ?? [];
  const next = (state.index ?? 0) + 1;
  if (!candidates.length || state.single) return speak('Tudo bem.');
  if (next >= candidates.length) return speak('Não achei outro com esse nome. Tente de novo dizendo o nome com o ano.');
  return offer(candidates, next, 'Então seria', state.season != null ? { season: state.season } : {});
}

// ---------- aprovar e tirar da lista ----------

function itemFromSlot(env: AlexaRequestEnvelope, deps: SkillDeps): { item: ItemSummary | null; spoken: string } {
  const spoken = parseTitle(slot(env, 'titulo')).query;
  return { item: spoken ? findItem(deps.items(), spoken) : null, spoken };
}

function approve(env: AlexaRequestEnvelope, deps: SkillDeps): AlexaResponse {
  let { item, spoken } = itemFromSlot(env, deps);
  if (!spoken) {
    const waiting = deps.items().filter((i) => i.status === 'found');
    if (!waiting.length) return speak('Nada está esperando aprovação.');
    if (waiting.length > 1) {
      const names = waiting.slice(0, 5).map((i) => i.title);
      return speak(`Tem ${waiting.length} esperando aprovação: ${listPt(names)}. Diga, por exemplo: aprova ${names[0]}.`);
    }
    item = waiting[0]!;
  }
  if (!item) return speak(`Não achei ${spoken} na sua lista.`);
  const plan = deps.approvalPlan(item.id);
  if (!plan.length) {
    if (item.status === 'sent' || item.status === 'downloading') return speak(`${capital(describe(item))} já foi para o download.`);
    if (item.status === 'available') return speak(`${capital(describe(item))} já está disponível.`);
    return speak(`${capital(describe(item))} ainda não tem versão em português para aprovar.`);
  }
  const best = plan[0]!;
  let what: string;
  if (item.kind === 'movie') what = `A melhor versão de ${describe(item)} é ${releaseWord(best)}.`;
  else if (plan.length === 1 && best.season == null) what = `Para ${describe(item)}, achei a série completa, ${releaseWord(best)}.`;
  else {
    const seasons = plan.map((p) => String(p.season));
    const which = seasons.length === 1 ? `a temporada ${seasons[0]}` : `as temporadas ${listPt(seasons)}`;
    what = `Para ${describe(item)}, achei ${which}. A melhor é ${releaseWord(best)}.`;
  }
  return speak(what, {
    ask: 'Quer enviar para download?',
    state: { action: 'approve', itemId: item.id, item: { kind: item.kind, title: item.title, year: item.year }, releaseIds: plan.map((p) => p.id) },
  });
}

async function confirmApprove(state: SessionState, deps: SkillDeps): Promise<AlexaResponse> {
  if (!state.itemId || !state.releaseIds?.length || !state.item) return speak('Não tenho nada para aprovar.');
  const r = await deps.approve(state.itemId, state.releaseIds);
  if (r.sent > 0) {
    const fail = r.errors.length ? ` ${r.errors.length === 1 ? 'Uma versão falhou' : `${r.errors.length} versões falharam`}: ${r.errors[0]}.` : '';
    return speak(`Pronto, enviei ${describe(state.item)} para download.${fail}`);
  }
  if (r.errors.length) return speak(`Não consegui enviar: ${r.errors[0]}.`);
  return speak('Essas versões já tinham sido enviadas.');
}

function remove(env: AlexaRequestEnvelope, deps: SkillDeps): AlexaResponse {
  const { item, spoken } = itemFromSlot(env, deps);
  if (!spoken) return speak('Qual? Diga, por exemplo: tira Duna da lista.');
  if (!item) return speak(`Não achei ${spoken} na sua lista.`);
  return speak(`Tirar ${describe(item)} da lista?`, {
    ask: 'Confirma?',
    state: { action: 'remove', itemId: item.id, item: { kind: item.kind, title: item.title, year: item.year, status: item.status } },
  });
}

function confirmRemove(state: SessionState, deps: SkillDeps): AlexaResponse {
  if (!state.itemId || !state.item) return speak('Não tenho nada para tirar.');
  deps.remove(state.itemId);
  const started = state.item.status === 'sent' || state.item.status === 'downloading';
  const note = started ? ` O download que já começou continua no ${state.item.kind === 'movie' ? 'Radarr' : 'Sonarr'}.` : '';
  return speak(`Pronto, tirei ${describe(state.item)} da lista.${note}`);
}

// ---------- sobre, sugestões e TV ----------

async function about(env: AlexaRequestEnvelope, deps: SkillDeps): Promise<AlexaResponse> {
  const t = parseTitle(slot(env, 'titulo'));
  if (!t.query) return speak('Sobre qual título? Diga, por exemplo: do que se trata Duna.');
  const [c] = await deps.search(t.query, t.kind);
  if (!c) return speak(`Não achei nada com o nome ${t.query}.`);
  const text = aboutText(c, await deps.details(c.kind, c.tmdbId));
  if (c.inLibrary) {
    return speak(`${text} Já está ${whereOwned(c.inLibrary)}.`, { ask: 'Quer assistir agora na TV?', state: { action: 'play', candidates: [c], index: 0 } });
  }
  if (c.inList) return speak(`${text} Já está na sua lista.`);
  return speak(text, { ask: 'Quer que eu peça?', state: { action: 'request', candidates: [c], index: 0, single: true } });
}

const LIST_LABEL: Record<SuggestionList, string> = {
  trending: 'Em alta',
  now_playing: 'No cinema',
  popular: 'Populares',
  upcoming: 'Estreias que vêm aí',
  on_the_air: 'No ar',
};

/** A lista certa para o tipo: o TMDB não tem "no cinema" de série nem "no ar" de filme. Função pura. */
export function suggestionFor(which: string, kind: string): { which: SuggestionList; kind: Kind } {
  const k: Kind = kind === 'series' || which === 'on_the_air' ? 'series' : 'movie';
  let w = (Object.keys(LIST_LABEL).includes(which) ? which : 'trending') as SuggestionList;
  if (k === 'series' && w === 'now_playing') w = 'on_the_air';
  if (k === 'series' && w === 'upcoming') w = 'trending';
  if (k === 'movie' && w === 'on_the_air') w = 'now_playing';
  return { which: w, kind: k };
}

async function suggest(env: AlexaRequestEnvelope, deps: SkillDeps): Promise<AlexaResponse> {
  const { which, kind } = suggestionFor(slotId(env, 'lista'), slotId(env, 'tipo'));
  const list = (await deps.suggestions(which, kind)).filter((c) => !c.inLibrary && !c.inList).slice(0, MAX_CANDIDATES);
  if (!list.length) return speak('Não achei sugestões novas agora. Tudo o que está em alta já está na sua lista ou na biblioteca.');
  const parts = list.map((c, i) => `${ORDINALS[i]}, ${c.title}${c.year ? `, de ${c.year}` : ''}`);
  return speak(`${LIST_LABEL[which]} ${kind === 'movie' ? 'nos filmes' : 'nas séries'}: ${parts.join('; ')}.`, {
    ask: 'Quer pedir algum? Diga o número.',
    state: { action: 'choose', candidates: list },
  });
}

function choose(env: AlexaRequestEnvelope, state: SessionState): AlexaResponse {
  const candidates = state.action === 'choose' ? (state.candidates ?? []) : [];
  if (!candidates.length) return speak('Não tenho nenhuma lista aberta. Peça sugestões primeiro, por exemplo: o que está em alta.');
  const n = Number(slot(env, 'numero')) || Number(slotId(env, 'ordinal')) || wordToNumber(slot(env, 'ordinal')) || 0;
  if (n < 1 || n > candidates.length) {
    return speak(`Diga um número de 1 a ${candidates.length}.`, { ask: 'Qual você quer?', state });
  }
  return offer(candidates, n - 1, 'Então é', { single: true });
}

async function play(env: AlexaRequestEnvelope, deps: SkillDeps): Promise<AlexaResponse> {
  const d = parseDevice(slot(env, 'titulo'));
  const t = parseTitle(d.query);
  if (!t.query) return speak('O que você quer assistir? Diga, por exemplo: coloca Duna na TV.');
  const found = await deps.search(t.query, t.kind);
  const owned = found.slice(0, MAX_CANDIDATES).find((c) => c.inLibrary);
  if (!owned) {
    const c = found[0];
    if (!c) return speak(`Não achei nada com o nome ${t.query}.`);
    return speak(`${capital(describe(c))} ainda não está na biblioteca.`, {
      ask: 'Quer que eu peça?',
      state: { action: 'request', candidates: [c], index: 0, single: true },
    });
  }
  return startPlay(owned, deps, d.device);
}

async function startPlay(c: Candidate, deps: SkillDeps, device?: string): Promise<AlexaResponse> {
  const r = await deps.play(c.kind, c.tmdbId, device);
  if (r.ok) return speak(`Colocando ${describe(c)} na ${r.device}, pelo ${r.via}.`);
  if (r.reason === 'not-in-library') return speak(`${capital(describe(c))} ainda não está na biblioteca.`);
  return speak('Não achei nenhuma TV com o Plex ou o Jellyfin aberto. Abra o app na TV e tente de novo.');
}

// ---------- consultar ----------

function status(env: AlexaRequestEnvelope, deps: SkillDeps): AlexaResponse {
  const { item, spoken } = itemFromSlot(env, deps);
  if (!spoken) return speak('De qual pedido? Diga, por exemplo: como está o pedido de Duna.');
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

// ---------- sim e não ----------

async function yes(state: SessionState, deps: SkillDeps): Promise<AlexaResponse> {
  switch (state.action ?? (state.candidates ? 'request' : undefined)) {
    case 'request':
      return confirmRequest(state, deps);
    case 'approve':
      return confirmApprove(state, deps);
    case 'remove':
      return confirmRemove(state, deps);
    case 'play': {
      const c = state.candidates?.[state.index ?? 0];
      return c ? startPlay(c, deps, state.device) : speak('Não tenho nada para colocar na TV.');
    }
    case 'choose':
      return speak('Qual deles? Diga o número.', { ask: 'Qual você quer?', state });
    default:
      return speak(`Não tenho nada para confirmar. ${HELP}`);
  }
}

function no(state: SessionState): AlexaResponse {
  switch (state.action ?? (state.candidates ? 'request' : undefined)) {
    case 'request':
      return declineRequest(state);
    case 'approve':
      return speak('Tudo bem, não enviei nada.');
    case 'remove':
      return speak('Tudo bem, continua na lista.');
    default:
      return speak('Tudo bem.');
  }
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
    case 'PedirTemporadaIntent':
      return ask(env, deps, 'series', true);
    case 'AprovarIntent':
      return approve(env, deps);
    case 'TirarIntent':
      return remove(env, deps);
    case 'SobreIntent':
      return about(env, deps);
    case 'SugestoesIntent':
      return suggest(env, deps);
    case 'EscolherIntent':
      return choose(env, state);
    case 'TocarIntent':
      return play(env, deps);
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
