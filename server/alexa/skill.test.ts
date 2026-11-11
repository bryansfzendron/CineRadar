import { describe, expect, it } from 'vitest';
import type { Kind } from '../../shared/types.ts';
import {
  aboutText,
  type Candidate,
  findItem,
  handle,
  type ItemSummary,
  normalize,
  parseDevice,
  parseSeason,
  parseTitle,
  type PlayReply,
  releaseWord,
  type RequestReply,
  runtimeWord,
  shortOverview,
  type SkillDeps,
  sizeWord,
  statusPhrase,
  suggestionFor,
  wordToNumber,
} from './skill.ts';
import type { AlexaRequestEnvelope } from './verify.ts';

const GB = 1024 ** 3;
const duna2: Candidate = { kind: 'movie', tmdbId: 693134, title: 'Duna: Parte Dois', year: 2024, inList: null, inLibrary: null };
const duna1: Candidate = {
  kind: 'movie',
  tmdbId: 438631,
  title: 'Duna',
  year: 2021,
  inList: null,
  inLibrary: { plexUrl: 'https://plex/x', jellyfinUrl: null },
};
const profecia: Candidate = { kind: 'series', tmdbId: 90228, title: 'Duna: A Profecia', year: 2024, inList: { id: 1, status: 'downloading' }, inLibrary: null };
const urso: Candidate = { kind: 'series', tmdbId: 136315, title: 'O Urso', year: 2022, inList: null, inLibrary: null };

const items: ItemSummary[] = [
  { id: 1, kind: 'series', title: 'Duna: A Profecia', originalTitle: 'Dune: Prophecy', year: 2024, status: 'downloading', statusDetail: null, progress: 0.45 },
  { id: 2, kind: 'movie', title: 'Ainda Estou Aqui', originalTitle: 'Ainda Estou Aqui', year: 2024, status: 'wanted', statusDetail: null, progress: null },
  { id: 3, kind: 'movie', title: 'Oppenheimer', originalTitle: 'Oppenheimer', year: 2023, status: 'available', statusDetail: null, progress: 1 },
  { id: 4, kind: 'movie', title: 'Conclave', originalTitle: 'Conclave', year: 2024, status: 'found', statusDetail: null, progress: null },
  { id: 5, kind: 'series', title: 'Agente Carter', originalTitle: 'Agent Carter', year: 2015, status: 'found', statusDetail: null, progress: null },
];

function deps(over: Partial<SkillDeps> = {}) {
  const calls: string[] = [];
  const d: SkillDeps = {
    search: async (q: string, kind?: Kind) => {
      calls.push(`search ${q} ${kind ?? '-'}`);
      if (q.toLowerCase().includes('duna')) return [duna2, duna1, profecia];
      if (q.toLowerCase().includes('urso') || q.toLowerCase().includes('bear')) return [urso];
      return [];
    },
    suggestions: async (which, kind) => {
      calls.push(`suggestions ${which} ${kind}`);
      return [duna1, duna2, urso, profecia];
    },
    details: async () => ({
      genres: ['Ficção científica', 'Aventura'],
      runtime: 155,
      rating: 7.8,
      seasons: [],
      overview: 'Paul Atreides une forças com os Fremen. Ele busca vingança. Uma terceira frase bem longa que não precisa entrar.',
    }),
    request: async (kind, tmdbId, season): Promise<RequestReply> => {
      calls.push(`request ${kind} ${tmdbId}${season != null ? ` T${season}` : ''}`);
      return { outcome: 'created' };
    },
    items: () => items,
    arrived: () => ['Oppenheimer', 'Oppenheimer', 'Wicked'],
    approvalPlan: (id) => {
      calls.push(`plan ${id}`);
      if (id === 4) return [{ id: 40, language: 'dual', resolution: 1080, size: 4.2 * GB, season: null }];
      if (id === 5)
        return [
          { id: 51, language: 'dublado', resolution: 720, size: 8 * GB, season: 1 },
          { id: 52, language: 'dual', resolution: 1080, size: 9 * GB, season: 2 },
        ];
      return [];
    },
    approve: async (id, ids) => {
      calls.push(`approve ${id} ${ids.join(',')}`);
      return { sent: ids.length, errors: [] };
    },
    remove: (id) => void calls.push(`remove ${id}`),
    play: async (kind, tmdbId, device): Promise<PlayReply> => {
      calls.push(`play ${kind} ${tmdbId}${device ? ` @${device}` : ''}`);
      return { ok: true, via: 'Plex', device: 'TV da Sala' };
    },
    ...over,
  };
  return { d, calls };
}

const intent = (name: string, slots: Record<string, string | { id: string; value: string }> = {}, attributes?: object): AlexaRequestEnvelope => ({
  session: attributes ? { attributes: attributes as Record<string, unknown> } : {},
  request: {
    type: 'IntentRequest',
    intent: {
      name,
      slots: Object.fromEntries(
        Object.entries(slots).map(([k, v]) => [
          k,
          typeof v === 'string'
            ? { name: k, value: v }
            : { name: k, value: v.value, resolutions: { resolutionsPerAuthority: [{ status: { code: 'ER_SUCCESS_MATCH' }, values: [{ value: { id: v.id } }] }] } },
        ]),
      ),
    },
  },
});
const text = (r: { response: Record<string, unknown> }) => (r.response.outputSpeech as { text: string } | undefined)?.text;

describe('entender o que foi dito', () => {
  it.each([
    ['duna', undefined, { query: 'duna' }],
    ['o filme duna', undefined, { query: 'duna', kind: 'movie' }],
    ['filme do batman', undefined, { query: 'batman', kind: 'movie' }],
    ['a série the bear', undefined, { query: 'the bear', kind: 'series' }],
    ['serie the office', undefined, { query: 'the office', kind: 'series' }],
    ['o filme duna', 'series', { query: 'duna', kind: 'series' }],
    ['a terceira temporada de the bear', undefined, { query: 'the bear', kind: 'series', season: 3 }],
    ['temporada 2 da série the office', undefined, { query: 'the office', kind: 'series', season: 2 }],
    ['segunda temporada do o urso', undefined, { query: 'o urso', kind: 'series', season: 2 }],
  ] as const)('parseTitle %s', (value, kind, expected) => {
    expect(parseTitle(value, kind)).toEqual(expected);
  });

  it('temporada "nua" só dentro de "pede a temporada"', () => {
    expect(parseTitle('3 de the bear', undefined, true)).toEqual({ query: 'the bear', kind: 'series', season: 3 });
    expect(parseTitle('três de the bear', undefined, true)).toEqual({ query: 'the bear', kind: 'series', season: 3 });
    // Sem o modo temporada, "de" no nome não vira temporada.
    expect(parseTitle('cidade de deus')).toEqual({ query: 'cidade de deus' });
    expect(parseSeason('cidade de deus', true)).toBeNull();
  });

  it.each([
    ['3', 3],
    ['3ª', 3],
    ['10º', 10],
    ['terceira', 3],
    ['terceiro', 3],
    ['três', 3],
    ['duas', 2],
    ['décima primeira', 11],
    ['quinze', 15],
    ['banana', null],
  ] as const)('wordToNumber %s', (w, n) => {
    expect(wordToNumber(w)).toBe(n);
  });

  it('parseDevice', () => {
    expect(parseDevice('duna na tv da sala')).toEqual({ query: 'duna', device: 'sala' });
    expect(parseDevice('o filme duna na tv')).toEqual({ query: 'o filme duna' });
    expect(parseDevice('duna')).toEqual({ query: 'duna' });
  });

  it('findItem', () => {
    expect(findItem(items, 'ainda estou aqui')?.id).toBe(2);
    expect(findItem(items, 'duna a profecia')?.id).toBe(1);
    expect(findItem(items, 'dune prophecy')?.id).toBe(1);
    expect(findItem(items, 'matrix')).toBeNull();
    expect(findItem(items, '')).toBeNull();
    expect(normalize('  Duna: Parte Dois! ')).toBe('duna parte dois');
  });

  it('suggestionFor ajusta a lista ao tipo', () => {
    expect(suggestionFor('', '')).toEqual({ which: 'trending', kind: 'movie' });
    expect(suggestionFor('now_playing', 'series')).toEqual({ which: 'on_the_air', kind: 'series' });
    expect(suggestionFor('upcoming', 'series')).toEqual({ which: 'trending', kind: 'series' });
    expect(suggestionFor('on_the_air', '')).toEqual({ which: 'on_the_air', kind: 'series' });
    expect(suggestionFor('popular', 'movie')).toEqual({ which: 'popular', kind: 'movie' });
  });
});

describe('falas', () => {
  it('tamanho, versão e duração', () => {
    expect(sizeWord(4.2 * GB)).toBe('4,2 gigas');
    expect(sizeWord(8 * GB)).toBe('8 gigas');
    expect(sizeWord(700 * 1024 ** 2)).toBe('700 megas');
    expect(releaseWord({ language: 'dual', resolution: 1080, size: 4.2 * GB })).toBe('dual áudio, 1080p, 4,2 gigas');
    expect(releaseWord({ language: 'ptbr', resolution: null, size: 0 })).toBe('em português');
    expect(runtimeWord(155)).toBe('2 horas e 35 minutos');
    expect(runtimeWord(60)).toBe('1 hora');
    expect(runtimeWord(45)).toBe('45 minutos');
  });
  it('sinopse curta', () => {
    expect(shortOverview('Uma. Duas. Três.', 10)).toBe('Uma. Duas.');
    expect(shortOverview('Uma. Duas. Três.', 3)).toBe('Uma.');
    expect(shortOverview('')).toBe('');
  });
  it('sobre um filme e uma série', () => {
    expect(aboutText(duna1, { genres: ['Ficção científica', 'Aventura'], runtime: 155, rating: 7.8, seasons: [], overview: 'Paul vai a Arrakis.' })).toBe(
      'O filme Duna, de 2021: ficção científica e aventura, 2 horas e 35 minutos, nota 7,8 no TMDB. Paul vai a Arrakis.',
    );
    expect(aboutText(urso, { genres: ['Drama'], runtime: 30, rating: null, seasons: [1, 2, 3, 4], overview: '' })).toBe('A série O Urso, de 2022: drama, 4 temporadas.');
  });
  it('status', () => {
    expect(statusPhrase({ status: 'downloading', statusDetail: null, progress: null })).toBe('está baixando');
    expect(statusPhrase({ status: 'error', statusDetail: 'sem seeders', progress: null })).toBe('deu erro: sem seeders');
  });
});

describe('pedir', () => {
  it('oferece o primeiro resultado e guarda os candidatos', async () => {
    const { d, calls } = deps();
    const r = await handle(intent('PedirFilmeIntent', { titulo: 'duna' }), d);
    expect(text(r)).toBe('Achei o filme Duna: Parte Dois, de 2024. Quer que eu peça?');
    expect(r.response.shouldEndSession).toBe(false);
    expect(r.sessionAttributes).toEqual({ action: 'request', candidates: [duna2, duna1, profecia], index: 0 });
    expect(calls).toEqual(['search duna movie']);
  });

  it('"sim" pede; "não" passa para o próximo; acaba', async () => {
    const { d, calls } = deps();
    expect(text(await handle(intent('AMAZON.YesIntent', {}, { action: 'request', candidates: [duna2], index: 0 }), d))).toBe(
      'Pronto, pedi o filme Duna: Parte Dois, de 2024. O CineRadar vai procurar uma versão em português.',
    );
    expect(calls).toEqual(['request movie 693134']);
    const r = await handle(intent('AMAZON.NoIntent', {}, { action: 'request', candidates: [duna2, duna1], index: 0 }), d);
    expect(text(r)).toBe('Então seria o filme Duna, de 2021, que já está no Plex. É esse?');
    expect(text(await handle(intent('AMAZON.NoIntent', {}, { action: 'request', candidates: [duna2], index: 0 }), d))).toBe(
      'Não achei outro com esse nome. Tente de novo dizendo o nome com o ano.',
    );
  });

  it('candidatos da versão anterior (sem "action") ainda funcionam', async () => {
    const { d, calls } = deps();
    await handle(intent('AMAZON.YesIntent', {}, { candidates: [duna2], index: 0 }), d);
    expect(calls).toEqual(['request movie 693134']);
  });

  it('já no Plex ou já na lista não pede de novo', async () => {
    const { d, calls } = deps();
    expect(text(await handle(intent('AMAZON.YesIntent', {}, { action: 'request', candidates: [duna1], index: 0 }), d))).toBe(
      'Então é só assistir: o filme Duna, de 2021 já está no Plex.',
    );
    expect(text(await handle(intent('AMAZON.YesIntent', {}, { action: 'request', candidates: [profecia], index: 0 }), d))).toBe(
      'A série Duna: A Profecia, de 2024 já estava na lista e está baixando, 45%.',
    );
    expect(calls).toEqual([]);
  });

  it('nada encontrado e sem título', async () => {
    const { d } = deps();
    expect(text(await handle(intent('PedirSerieIntent', { titulo: 'xyz' }), d))).toBe('Não achei nenhuma série chamada xyz.');
    expect(text(await handle(intent('PedirIntent', { titulo: 'xyz' }), d))).toBe('Não achei nenhum filme ou série com o nome xyz.');
    expect((await handle(intent('PedirIntent'), d)).response.shouldEndSession).toBe(false);
  });
});

describe('pedir temporada', () => {
  it('"pede a terceira temporada de the bear" pelo pedido genérico', async () => {
    const { d, calls } = deps();
    const r = await handle(intent('PedirIntent', { titulo: 'a terceira temporada de the bear' }), d);
    expect(text(r)).toBe('Achei a série O Urso, de 2022. Quer que eu peça a temporada 3?');
    expect(r.sessionAttributes).toMatchObject({ action: 'request', season: 3 });
    expect(calls).toEqual(['search the bear series']);
  });

  it('"pede a temporada 2 de the bear"', async () => {
    const { d, calls } = deps();
    const r = await handle(intent('PedirTemporadaIntent', { titulo: '2 de the bear' }), d);
    expect(text(r)).toBe('Achei a série O Urso, de 2022. Quer que eu peça a temporada 2?');
    await handle(intent('AMAZON.YesIntent', {}, r.sessionAttributes), d);
    expect(calls).toEqual(['search the bear series', 'request series 136315 T2']);
  });

  it('sem número pergunta qual', async () => {
    const { d } = deps();
    expect(text(await handle(intent('PedirTemporadaIntent', { titulo: 'the bear' }), d))).toBe(
      'Qual temporada? Diga, por exemplo: pede a temporada 2 de The Bear.',
    );
  });

  it.each([
    [{ outcome: 'created' }, 'Pronto, pedi a temporada 3 da série O Urso, de 2022. O CineRadar vai procurar uma versão em português.'],
    [{ outcome: 'season-added' }, 'Pronto, acrescentei a temporada 3 ao pedido de a série O Urso, de 2022.'],
    [{ outcome: 'has-all-seasons' }, 'A série O Urso, de 2022 já está na lista com todas as temporadas, então a 3 vem junto.'],
    [{ outcome: 'exists' }, 'A temporada 3 de O Urso já estava pedida.'],
    [{ outcome: 'no-such-season', seasons: [1, 2] }, 'A série O Urso, de 2022 tem 2 temporadas. Não existe a temporada 3.'],
  ] as [RequestReply, string][])('resposta %j', async (reply, expected) => {
    const { d } = deps({ request: async () => reply });
    expect(text(await handle(intent('AMAZON.YesIntent', {}, { action: 'request', candidates: [urso], index: 0, season: 3 }), d))).toBe(expected);
  });
});

describe('aprovar', () => {
  it('filme: diz a melhor versão e envia no "sim"', async () => {
    const { d, calls } = deps();
    const r = await handle(intent('AprovarIntent', { titulo: 'conclave' }), d);
    expect(text(r)).toBe('A melhor versão de o filme Conclave, de 2024 é dual áudio, 1080p, 4,2 gigas. Quer enviar para download?');
    expect(r.sessionAttributes).toMatchObject({ action: 'approve', itemId: 4, releaseIds: [40] });
    expect(text(await handle(intent('AMAZON.YesIntent', {}, r.sessionAttributes), d))).toBe('Pronto, enviei o filme Conclave, de 2024 para download.');
    expect(calls).toEqual(['plan 4', 'approve 4 40']);
  });

  it('série: diz as temporadas', async () => {
    const { d } = deps();
    expect(text(await handle(intent('AprovarIntent', { titulo: 'agente carter' }), d))).toBe(
      'Para a série Agente Carter, de 2015, achei as temporadas 1 e 2. A melhor é dublado, 720p, 8 gigas. Quer enviar para download?',
    );
  });

  it('sem nome: com mais de um esperando, lista', async () => {
    const { d } = deps();
    expect(text(await handle(intent('AprovarIntent'), d))).toBe(
      'Tem 2 esperando aprovação: Conclave e Agente Carter. Diga, por exemplo: aprova Conclave.',
    );
  });

  it('sem nome: com um só, aprova ele', async () => {
    const { d } = deps({ items: () => [items[3]!] });
    expect(text(await handle(intent('AprovarIntent'), d))?.startsWith('A melhor versão de o filme Conclave')).toBe(true);
  });

  it('nada para aprovar', async () => {
    const { d } = deps();
    expect(text(await handle(intent('AprovarIntent', { titulo: 'ainda estou aqui' }), d))).toBe(
      'O filme Ainda Estou Aqui, de 2024 ainda não tem versão em português para aprovar.',
    );
    expect(text(await handle(intent('AprovarIntent', { titulo: 'duna a profecia' }), d))).toBe('A série Duna: A Profecia, de 2024 já foi para o download.');
  });

  it('"não" não envia; falha é contada', async () => {
    const { d, calls } = deps({ approve: async () => ({ sent: 0, errors: ['Radarr recusou o release'] }) });
    const state = { action: 'approve', itemId: 4, item: { kind: 'movie', title: 'Conclave', year: 2024 }, releaseIds: [40] };
    expect(text(await handle(intent('AMAZON.NoIntent', {}, state), d))).toBe('Tudo bem, não enviei nada.');
    expect(calls).toEqual([]);
    expect(text(await handle(intent('AMAZON.YesIntent', {}, state), d))).toBe('Não consegui enviar: Radarr recusou o release.');
  });
});

describe('tirar da lista', () => {
  it('confirma antes de tirar', async () => {
    const { d, calls } = deps();
    const r = await handle(intent('TirarIntent', { titulo: 'ainda estou aqui' }), d);
    expect(text(r)).toBe('Tirar o filme Ainda Estou Aqui, de 2024 da lista? Confirma?');
    expect(calls).toEqual([]);
    expect(text(await handle(intent('AMAZON.YesIntent', {}, r.sessionAttributes), d))).toBe('Pronto, tirei o filme Ainda Estou Aqui, de 2024 da lista.');
    expect(calls).toEqual(['remove 2']);
  });

  it('avisa que o download já começado continua', async () => {
    const { d } = deps();
    const r = await handle(intent('TirarIntent', { titulo: 'duna a profecia' }), d);
    expect(text(await handle(intent('AMAZON.YesIntent', {}, r.sessionAttributes), d))).toBe(
      'Pronto, tirei a série Duna: A Profecia, de 2024 da lista. O download que já começou continua no Sonarr.',
    );
  });

  it('"não" mantém', async () => {
    const { d, calls } = deps();
    const r = await handle(intent('TirarIntent', { titulo: 'conclave' }), d);
    expect(text(await handle(intent('AMAZON.NoIntent', {}, r.sessionAttributes), d))).toBe('Tudo bem, continua na lista.');
    expect(calls).toEqual([]);
  });
});

describe('sobre, sugestões e TV', () => {
  it('sobre um título na biblioteca oferece a TV', async () => {
    const { d, calls } = deps({ search: async () => [duna1] });
    const r = await handle(intent('SobreIntent', { titulo: 'duna' }), d);
    expect(text(r)).toBe(
      'O filme Duna, de 2021: ficção científica e aventura, 2 horas e 35 minutos, nota 7,8 no TMDB. Paul Atreides une forças com os Fremen. Ele busca vingança. ' +
        'Uma terceira frase bem longa que não precisa entrar. Já está no Plex. Quer assistir agora na TV?',
    );
    await handle(intent('AMAZON.YesIntent', {}, r.sessionAttributes), d);
    expect(calls).toEqual(['play movie 438631']);
  });

  it('sobre um título novo oferece pedir, e "não" encerra', async () => {
    const { d } = deps();
    const r = await handle(intent('SobreIntent', { titulo: 'duna' }), d);
    expect(r.sessionAttributes).toMatchObject({ action: 'request', single: true });
    expect(text(await handle(intent('AMAZON.NoIntent', {}, r.sessionAttributes), d))).toBe('Tudo bem.');
  });

  it('sugestões sem o que já tem, e escolha pelo número', async () => {
    const { d, calls } = deps();
    const r = await handle(intent('SugestoesIntent', { lista: { id: 'trending', value: 'em alta' } }), d);
    expect(text(r)).toBe('Em alta nos filmes: primeiro, Duna: Parte Dois, de 2024; segundo, O Urso, de 2022. Quer pedir algum? Diga o número.');
    const escolha = await handle(intent('EscolherIntent', { numero: '2' }, r.sessionAttributes), d);
    expect(text(escolha)).toBe('Então é a série O Urso, de 2022. Quer que eu peça?');
    await handle(intent('AMAZON.YesIntent', {}, escolha.sessionAttributes), d);
    expect(calls).toEqual(['suggestions trending movie', 'request series 136315']);
  });

  it('escolha por ordinal e fora da lista', async () => {
    const { d } = deps();
    const r = await handle(intent('SugestoesIntent', { tipo: { id: 'series', value: 'séries' } }), d);
    expect(text(await handle(intent('EscolherIntent', { ordinal: { id: '1', value: 'primeiro' } }, r.sessionAttributes), d))).toBe(
      'Então é o filme Duna: Parte Dois, de 2024. Quer que eu peça?',
    );
    expect(text(await handle(intent('EscolherIntent', { numero: '9' }, r.sessionAttributes), d))).toBe('Diga um número de 1 a 2. Qual você quer?');
    expect(text(await handle(intent('EscolherIntent', { numero: '1' }), d))?.startsWith('Não tenho nenhuma lista aberta')).toBe(true);
  });

  it('tocar na TV o que já está na biblioteca', async () => {
    const { d, calls } = deps();
    expect(text(await handle(intent('TocarIntent', { titulo: 'duna na tv da sala' }), d))).toBe('Colocando o filme Duna, de 2021 na TV da Sala, pelo Plex.');
    expect(calls).toEqual(['search duna -', 'play movie 438631 @sala']);
  });

  it('tocar o que não está na biblioteca oferece pedir', async () => {
    const { d } = deps({ search: async () => [duna2] });
    const r = await handle(intent('TocarIntent', { titulo: 'duna parte dois' }), d);
    expect(text(r)).toBe('O filme Duna: Parte Dois, de 2024 ainda não está na biblioteca. Quer que eu peça?');
  });

  it('sem TV aberta', async () => {
    const { d } = deps({ play: async () => ({ ok: false, reason: 'no-player' }) });
    expect(text(await handle(intent('TocarIntent', { titulo: 'duna' }), d))).toBe(
      'Não achei nenhuma TV com o Plex ou o Jellyfin aberto. Abra o app na TV e tente de novo.',
    );
  });
});

describe('consultas e sessão', () => {
  it('status, em andamento e chegou', async () => {
    const { d } = deps();
    expect(text(await handle(intent('StatusPedidoIntent', { titulo: 'ainda estou aqui' }), d))).toBe(
      'O filme Ainda Estou Aqui, de 2024 está na lista, esperando aparecer uma versão em português.',
    );
    expect(text(await handle(intent('PendentesIntent'), d))).toBe(
      'Tem 4 pedidos em andamento: Duna: A Profecia, baixando, 45%, Conclave, esperando aprovação, Agente Carter, esperando aprovação e Ainda Estou Aqui, esperando versão em português.',
    );
    expect(text(await handle(intent('ChegouIntent'), d))).toBe('Nos últimos 7 dias chegaram: Oppenheimer e Wicked.');
  });

  it('abrir, fim, parar e ajuda', async () => {
    const { d } = deps();
    expect((await handle({ request: { type: 'LaunchRequest' } }, d)).response.shouldEndSession).toBe(false);
    expect(await handle({ request: { type: 'SessionEndedRequest' } }, d)).toEqual({ version: '1.0', response: {} });
    expect(text(await handle(intent('AMAZON.StopIntent'), d))).toBe('Até mais!');
    expect((await handle(intent('AMAZON.HelpIntent'), d)).response.shouldEndSession).toBe(false);
    expect(text(await handle(intent('AMAZON.YesIntent'), d))?.startsWith('Não tenho nada para confirmar.')).toBe(true);
  });
});
