// Tocar um título da biblioteca numa TV: Plex primeiro (é o que se usa na sala), Jellyfin de reserva.
// Só funciona com o app aberto na TV — é ele que recebe o comando.

import type { Kind } from '../../shared/types.ts';
import { errorMessage } from '../integrations/http.ts';
import type { Services } from '../services.ts';
import type { OwnedLibrary } from './library.ts';

export type PlayResult = { ok: true; via: 'Plex' | 'Jellyfin'; device: string } | { ok: false; reason: 'not-in-library' | 'no-player'; detail?: string };

function simple(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** O player pedido pelo nome ("TV da sala"), senão o primeiro. Função pura. */
export function choosePlayer<T>(list: T[], name: (t: T) => string, hint?: string): T | null {
  if (!list.length) return null;
  const h = hint ? simple(hint) : '';
  if (h) {
    const hit = list.find((t) => simple(name(t)).includes(h) || h.includes(simple(name(t))));
    if (hit) return hit;
  }
  return list[0]!;
}

export async function playOnTv(svc: Services, owned: OwnedLibrary, kind: Kind, tmdbId: number, hint?: string): Promise<PlayResult> {
  const t = (await owned.all()).get(`${kind}:${tmdbId}`);
  if (!t) return { ok: false, reason: 'not-in-library' };
  const errors: string[] = [];

  if (t.plexKey && svc.plex.configured) {
    try {
      const player = choosePlayer(await svc.plex.players(), (p) => p.name, hint);
      if (player) {
        const target = kind === 'series' ? await svc.plex.nextEpisode(t.plexKey) : { key: t.plexKey, offset: 0 };
        if (target) {
          await svc.plex.play(player, target);
          return { ok: true, via: 'Plex', device: player.name };
        }
      }
    } catch (err) {
      errors.push(errorMessage(err));
    }
  }

  if (t.jellyfinId && svc.jellyfin.configured) {
    try {
      const session = choosePlayer(await svc.jellyfin.sessions(), (s) => s.deviceName, hint);
      if (session) {
        const id = kind === 'series' ? await svc.jellyfin.nextEpisode(t.jellyfinId, session.userId) : t.jellyfinId;
        if (id) {
          await svc.jellyfin.play(session.id, id);
          return { ok: true, via: 'Jellyfin', device: session.deviceName };
        }
      }
    } catch (err) {
      errors.push(errorMessage(err));
    }
  }

  if (errors.length) svc.log.warn(`[play] ${t.title}: ${errors.join('; ')}`);
  return { ok: false, reason: 'no-player', ...(errors.length ? { detail: errors[0] } : {}) };
}
