// Aprovar sem abrir o app ("Alexa, pede pro meu cinema aprovar Agente Carter"): escolhe as mesmas versões
// que o envio automático escolheria, mas sem exigir a nota mínima — quem aprova é você.

import type { ReleaseLanguage } from '../../shared/types.ts';
import { errorMessage } from '../integrations/http.ts';
import type { Services } from '../services.ts';
import type { StoredItem, StoredRelease } from '../store.ts';
import { dispatchRelease } from './dispatch.ts';

const PORTUGUESE: ReadonlySet<ReleaseLanguage> = new Set(['dual', 'dublado', 'ptbr']);

type Pickable = Pick<StoredRelease, 'id' | 'status' | 'language' | 'season' | 'notes'>;

/**
 * As versões a enviar, já na ordem de nota (a lista vem do banco ordenada). Filme: a melhor em português.
 * Série: o pacote completo se nada foi enviado e não há temporadas pedidas; senão a melhor de cada
 * temporada ainda não enviada. Episódio avulso nunca entra. Função pura.
 */
export function pickForApproval<T extends Pickable>(item: Pick<StoredItem, 'kind' | 'onlySeasons'>, releases: T[]): T[] {
  const pt = releases.filter((r) => r.status === 'new' && PORTUGUESE.has(r.language) && !r.notes.includes('episódio avulso'));
  if (item.kind === 'movie') return pt.slice(0, 1);

  const sent = new Set(releases.filter((r) => r.status === 'sent').map((r) => r.season));
  const only = item.onlySeasons;
  const complete = pt.find((r) => r.season == null);
  if (complete && !only && sent.size === 0) return [complete];
  const picks: T[] = [];
  for (const r of pt) {
    if (r.season == null || sent.has(r.season) || (only && !only.includes(r.season))) continue;
    if (picks.some((p) => p.season === r.season)) continue;
    picks.push(r);
  }
  return picks.sort((a, b) => (a.season ?? 0) - (b.season ?? 0));
}

/** Envia as versões escolhidas (as que ainda estão sem envio). Devolve quantas foram e as falhas. */
export async function approveReleases(svc: Services, item: StoredItem, releaseIds: number[]): Promise<{ sent: number; errors: string[] }> {
  let sent = 0;
  const errors: string[] = [];
  for (const id of releaseIds) {
    const release = svc.store.getRelease(id);
    if (!release || release.itemId !== item.id || release.status !== 'new') continue;
    try {
      await dispatchRelease(svc, item, release, 'manual');
      sent++;
    } catch (err) {
      svc.store.setReleaseStatus(release.id, 'failed', errorMessage(err));
      svc.store.event(item.id, 'error', `Falha ao enviar "${release.title}": ${errorMessage(err)}`);
      errors.push(errorMessage(err));
    }
  }
  return { sent, errors };
}
