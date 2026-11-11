import { describe, expect, it } from 'vitest';
import { playMediaQuery } from '../integrations/plex.ts';
import { pickForApproval } from './approve.ts';
import { choosePlayer } from './play.ts';
import { keepWantedSeasons, wantedSeasons } from './search.ts';

type R = Parameters<typeof pickForApproval>[1][number];
let next = 1;
const rel = (over: Partial<R>): R => ({ id: next++, status: 'new', language: 'dual', season: null, notes: [], ...over });

describe('pickForApproval', () => {
  it('filme: a melhor em português, ignorando legendado e já enviada', () => {
    const list = [rel({ language: 'legendado' }), rel({ status: 'sent' }), rel({ language: 'dublado', id: 99 }), rel({ language: 'dual' })];
    expect(pickForApproval({ kind: 'movie', onlySeasons: null }, list).map((r) => r.id)).toEqual([99]);
    expect(pickForApproval({ kind: 'movie', onlySeasons: null }, [rel({ language: 'multi' })])).toEqual([]);
  });

  it('série: pacote completo quando nada foi enviado', () => {
    const complete = rel({ season: null });
    const list = [rel({ season: 1 }), complete, rel({ season: 2 })];
    expect(pickForApproval({ kind: 'series', onlySeasons: null }, list)).toEqual([complete]);
  });

  it('série: uma por temporada não enviada, sem episódio avulso, em ordem', () => {
    const t2 = rel({ season: 2 });
    const t1a = rel({ season: 1 });
    const list = [t2, rel({ season: 3, status: 'sent' }), rel({ season: 3 }), t1a, rel({ season: 1 }), rel({ season: 4, notes: ['episódio avulso'] }), rel({ season: null })];
    expect(pickForApproval({ kind: 'series', onlySeasons: null }, list)).toEqual([t1a, t2]);
  });

  it('série com temporadas pedidas: só elas, e nunca o pacote completo', () => {
    const t3 = rel({ season: 3 });
    const list = [rel({ season: null }), rel({ season: 1 }), t3];
    expect(pickForApproval({ kind: 'series', onlySeasons: [3] }, list)).toEqual([t3]);
  });
});

describe('temporadas pedidas na busca', () => {
  it('wantedSeasons', () => {
    expect(wantedSeasons({ seasons: [1, 2, 3], onlySeasons: null })).toEqual([1, 2, 3]);
    expect(wantedSeasons({ seasons: [1, 2, 3], onlySeasons: [2] })).toEqual([2]);
    expect(wantedSeasons({ seasons: [], onlySeasons: null })).toEqual([1]);
  });
  it('keepWantedSeasons', () => {
    const list = [{ season: 1 }, { season: 2 }, { season: null }];
    expect(keepWantedSeasons(list, null)).toEqual(list);
    expect(keepWantedSeasons(list, [2])).toEqual([{ season: 2 }]);
  });
});

describe('TV', () => {
  const players = [{ name: 'Quarto' }, { name: 'TV da Sala' }];
  it('choosePlayer pelo nome, senão o primeiro', () => {
    expect(choosePlayer(players, (p) => p.name, 'sala')?.name).toBe('TV da Sala');
    expect(choosePlayer(players, (p) => p.name, 'cozinha')?.name).toBe('Quarto');
    expect(choosePlayer(players, (p) => p.name)?.name).toBe('Quarto');
    expect(choosePlayer([], (p: { name: string }) => p.name)).toBeNull();
  });
  it('playMediaQuery aponta o player para o servidor', () => {
    expect(playMediaQuery('http://192.168.15.150:32400', 'abc', 'tok', { key: '77', offset: 1200 }, 5, 3)).toEqual({
      key: '/library/metadata/77',
      offset: 1200,
      machineIdentifier: 'abc',
      address: '192.168.15.150',
      port: '32400',
      protocol: 'http',
      token: 'tok',
      containerKey: '/playQueues/5?own=1&window=200',
      commandID: 3,
      type: 'video',
    });
  });
});
