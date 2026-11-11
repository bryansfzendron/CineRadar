import { describe, expect, it } from 'vitest';
import type { Kind } from '../../shared/types.ts';
import { type Candidate, findItem, handle, type ItemSummary, normalize, parseTitle, type SkillDeps, statusPhrase } from './skill.ts';
import type { AlexaRequestEnvelope } from './verify.ts';

const duna2: Candidate = { kind: 'movie', tmdbId: 693134, title: 'Duna: Parte Dois', year: 2024, inList: null, inLibrary: null };
const duna1: Candidate = {
  kind: 'movie',
  tmdbId: 438631,
  title: 'Duna',
  year: 2021,
  inList: null,
  inLibrary: { plexUrl: 'https://plex/x', jellyfinUrl: null },
};
const profecia: Candidate = { kind: 'series', tmdbId: 90228, title: 'Duna: A Profecia', year: 2024, inList: { id: 7, status: 'downloading' }, inLibrary: null };

const items: ItemSummary[] = [
  { kind: 'series', title: 'Duna: A Profecia', originalTitle: 'Dune: Prophecy', year: 2024, status: 'downloading', statusDetail: null, progress: 0.45 },
  { kind: 'movie', title: 'Ainda Estou Aqui', originalTitle: 'Ainda Estou Aqui', year: 2024, status: 'wanted', statusDetail: null, progress: null },
  { kind: 'movie', title: 'Oppenheimer', originalTitle: 'Oppenheimer', year: 2023, status: 'available', statusDetail: null, progress: 1 },
  { kind: 'movie', title: 'Conclave', originalTitle: 'Conclave', year: 2024, status: 'found', statusDetail: null, progress: null },
];

function deps(over: Partial<SkillDeps> = {}) {
  const calls: string[] = [];
  const d: SkillDeps = {
    search: async (q: string, kind?: Kind) => {
      calls.push(`search ${q} ${kind ?? '-'}`);
      return q.toLowerCase().includes('duna') ? [duna2, duna1, profecia] : [];
    },
    request: async (kind, tmdbId) => {
      calls.push(`request ${kind} ${tmdbId}`);
      return { created: true };
    },
    items: () => items,
    arrived: () => ['Oppenheimer', 'Oppenheimer', 'Wicked'],
    ...over,
  };
  return { d, calls };
}

const intent = (name: string, slots: Record<string, string> = {}, attributes?: object): AlexaRequestEnvelope => ({
  session: attributes ? { attributes: attributes as Record<string, unknown> } : {},
  request: {
    type: 'IntentRequest',
    intent: { name, slots: Object.fromEntries(Object.entries(slots).map(([k, v]) => [k, { name: k, value: v }])) },
  },
});
const text = (r: { response: Record<string, unknown> }) => (r.response.outputSpeech as { text: string } | undefined)?.text;

describe('parseTitle', () => {
  it.each([
    ['duna', undefined, { query: 'duna' }],
    ['o filme duna', undefined, { query: 'duna', kind: 'movie' }],
    ['filme do batman', undefined, { query: 'batman', kind: 'movie' }],
    ['a série the bear', undefined, { query: 'the bear', kind: 'series' }],
    ['serie the office', undefined, { query: 'the office', kind: 'series' }],
    ['o filme duna', 'series', { query: 'duna', kind: 'series' }],
  ] as const)('%s', (value, kind, expected) => {
    expect(parseTitle(value, kind)).toEqual(expected);
  });
});

describe('findItem', () => {
  it('acha pelo nome, sem acento nem pontuação', () => {
    expect(findItem(items, 'ainda estou aqui')?.title).toBe('Ainda Estou Aqui');
    expect(findItem(items, 'duna a profecia')?.title).toBe('Duna: A Profecia');
  });
  it('acha pelo começo e pelo título original', () => {
    expect(findItem(items, 'duna')?.title).toBe('Duna: A Profecia');
    expect(findItem(items, 'dune prophecy')?.title).toBe('Duna: A Profecia');
  });
  it('não inventa', () => {
    expect(findItem(items, 'matrix')).toBeNull();
    expect(findItem(items, '')).toBeNull();
  });
  it('normalize', () => {
    expect(normalize('  Duna: Parte Dois! ')).toBe('duna parte dois');
    expect(normalize('Ação')).toBe('acao');
  });
});

describe('pedir com confirmação', () => {
  it('oferece o primeiro resultado e guarda os candidatos na sessão', async () => {
    const { d, calls } = deps();
    const r = await handle(intent('PedirFilmeIntent', { titulo: 'duna' }), d);
    expect(text(r)).toBe('Achei o filme Duna: Parte Dois, de 2024. Quer que eu peça?');
    expect(r.response.shouldEndSession).toBe(false);
    expect(r.sessionAttributes).toEqual({ candidates: [duna2, duna1, profecia], index: 0 });
    expect(calls).toEqual(['search duna movie']);
  });

  it('"sim" pede o título', async () => {
    const { d, calls } = deps();
    const r = await handle(intent('AMAZON.YesIntent', {}, { candidates: [duna2, duna1], index: 0 }), d);
    expect(text(r)).toBe('Pronto, pedi o filme Duna: Parte Dois, de 2024. O CineRadar vai procurar uma versão em português.');
    expect(r.response.shouldEndSession).toBe(true);
    expect(calls).toEqual(['request movie 693134']);
  });

  it('"não" passa para o próximo, que já está no Plex', async () => {
    const { d } = deps();
    const r = await handle(intent('AMAZON.NoIntent', {}, { candidates: [duna2, duna1, profecia], index: 0 }), d);
    expect(text(r)).toBe('Então seria o filme Duna, de 2021, que já está no Plex. É esse?');
    expect(r.sessionAttributes?.index).toBe(1);
  });

  it('"sim" num título da biblioteca não pede nada', async () => {
    const { d, calls } = deps();
    const r = await handle(intent('AMAZON.YesIntent', {}, { candidates: [duna2, duna1], index: 1 }), d);
    expect(text(r)).toBe('Então é só assistir: o filme Duna, de 2021 já está no Plex.');
    expect(calls).toEqual([]);
  });

  it('"sim" num título que já está na lista conta como ele está', async () => {
    const { d, calls } = deps();
    const r = await handle(intent('AMAZON.YesIntent', {}, { candidates: [profecia], index: 0 }), d);
    expect(text(r)).toBe('A série Duna: A Profecia, de 2024 já estava na lista e está baixando, 45%.');
    expect(calls).toEqual([]);
  });

  it('acabaram os candidatos', async () => {
    const { d } = deps();
    const r = await handle(intent('AMAZON.NoIntent', {}, { candidates: [duna2], index: 0 }), d);
    expect(text(r)).toBe('Não achei outro com esse nome. Tente de novo dizendo o nome com o ano.');
  });

  it('pedido genérico deixa o tipo pelo "o filme" do valor', async () => {
    const { d, calls } = deps();
    await handle(intent('PedirIntent', { titulo: 'o filme duna' }), d);
    expect(calls).toEqual(['search duna movie']);
  });

  it('nada encontrado', async () => {
    const { d } = deps();
    expect(text(await handle(intent('PedirSerieIntent', { titulo: 'xyz' }), d))).toBe('Não achei nenhuma série chamada xyz.');
    expect(text(await handle(intent('PedirIntent', { titulo: 'xyz' }), d))).toBe('Não achei nenhum filme ou série com o nome xyz.');
  });

  it('sem título, pergunta', async () => {
    const { d } = deps();
    const r = await handle(intent('PedirIntent'), d);
    expect(r.response.shouldEndSession).toBe(false);
  });

  it('"sim" sem nada pendente', async () => {
    const { d, calls } = deps();
    const r = await handle(intent('AMAZON.YesIntent'), d);
    expect(text(r)?.startsWith('Não tenho nada para confirmar.')).toBe(true);
    expect(calls).toEqual([]);
  });
});

describe('consultas', () => {
  it('status de um pedido', async () => {
    const { d } = deps();
    expect(text(await handle(intent('StatusPedidoIntent', { titulo: 'ainda estou aqui' }), d))).toBe(
      'O filme Ainda Estou Aqui, de 2024 está na lista, esperando aparecer uma versão em português.',
    );
    expect(text(await handle(intent('StatusPedidoIntent', { titulo: 'matrix' }), d))).toBe('Não achei matrix na sua lista.');
  });

  it('o que está em andamento, do mais perto de chegar', async () => {
    const { d } = deps();
    expect(text(await handle(intent('PendentesIntent'), d))).toBe(
      'Tem 3 pedidos em andamento: Duna: A Profecia, baixando, 45%, Conclave, esperando aprovação e Ainda Estou Aqui, esperando versão em português.',
    );
  });

  it('nada em andamento', async () => {
    const { d } = deps({ items: () => [items[2]!] });
    expect(text(await handle(intent('PendentesIntent'), d))).toBe('Nenhum pedido em andamento. Tudo o que você pediu já chegou.');
  });

  it('o que chegou, sem repetir', async () => {
    const { d } = deps();
    expect(text(await handle(intent('ChegouIntent'), d))).toBe('Nos últimos 7 dias chegaram: Oppenheimer e Wicked.');
    const vazio = deps({ arrived: () => [] });
    expect(text(await handle(intent('ChegouIntent'), vazio.d))).toBe('Nada novo chegou nos últimos 7 dias.');
  });

  it('frases de status', () => {
    expect(statusPhrase({ status: 'downloading', statusDetail: null, progress: null })).toBe('está baixando');
    expect(statusPhrase({ status: 'error', statusDetail: 'sem seeders', progress: null })).toBe('deu erro: sem seeders');
  });
});

describe('sessão', () => {
  it('abrir a skill pergunta o que assistir', async () => {
    const { d } = deps();
    const r = await handle({ request: { type: 'LaunchRequest' } }, d);
    expect(r.response.shouldEndSession).toBe(false);
  });
  it('fim de sessão responde vazio', async () => {
    const { d } = deps();
    expect(await handle({ request: { type: 'SessionEndedRequest' } }, d)).toEqual({ version: '1.0', response: {} });
  });
  it('parar e ajuda', async () => {
    const { d } = deps();
    expect(text(await handle(intent('AMAZON.StopIntent'), d))).toBe('Até mais!');
    expect((await handle(intent('AMAZON.HelpIntent'), d)).response.shouldEndSession).toBe(false);
  });
});
