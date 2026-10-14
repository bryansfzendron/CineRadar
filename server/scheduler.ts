// Agendador: busca os desejos pendentes, acompanha downloads e confere as bibliotecas.

import { autoDispatch } from './engine/dispatch.ts';
import { searchItem } from './engine/search.ts';
import { syncAvailability, syncDownloads } from './engine/sync.ts';
import { errorMessage } from './integrations/http.ts';
import type { Services } from './services.ts';
import type { StoredItem } from './store.ts';

const label = (lang: string) => ({ dual: 'dual áudio', dublado: 'dublado', ptbr: 'PT-BR' })[lang] ?? lang;

export class Scheduler {
  private timers: NodeJS.Timeout[] = [];
  private searching = new Set<number>();
  lastTickAt: Date | null = null;
  running = false;

  constructor(private readonly svc: Services) {}

  get searchingCount(): number {
    return this.searching.size;
  }

  isSearching(itemId: number): boolean {
    return this.searching.has(itemId);
  }

  start(): void {
    this.running = true;
    this.every(60_000, () => this.tickSearch(), 5_000);
    this.every(45_000, () => syncDownloads(this.svc), 15_000);
    this.every(5 * 60_000, () => syncAvailability(this.svc), 10_000);
  }

  /** Tarefa extra no mesmo relógio (ex.: limpar sessões vencidas). */
  add(ms: number, fn: () => Promise<unknown>): void {
    this.every(ms, fn);
  }

  stop(): void {
    this.running = false;
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }

  private every(ms: number, fn: () => Promise<unknown>, firstDelay = ms): void {
    const run = () =>
      fn().catch((err) => this.svc.log.error(`[scheduler] ${errorMessage(err)}`));
    const first = setTimeout(() => {
      void run();
      this.timers.push(setInterval(() => void run(), ms));
    }, firstDelay);
    this.timers.push(first);
  }

  private async tickSearch(): Promise<void> {
    this.lastTickAt = new Date();
    // Um por vez: cada busca abre várias consultas aos indexadores.
    if (this.searching.size > 0) return;
    const [next] = this.svc.store.dueForSearch(1);
    if (next) await this.search(next);
  }

  /** Fila única: as buscas rodam uma de cada vez (cada uma já abre várias consultas aos indexadores). */
  private queue: Promise<void> = Promise.resolve();

  /** Busca agora (também usado pelo botão "Buscar agora" e ao adicionar um item). */
  search(item: StoredItem): Promise<void> {
    if (this.searching.has(item.id)) return Promise.resolve();
    this.searching.add(item.id);
    this.svc.store.update(item.id, { status: 'searching', statusDetail: 'Na fila de busca…' });
    const run = this.queue.then(() => this.runSearch(item));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async runSearch(item: StoredItem): Promise<void> {
    const { store, settings } = this.svc;
    const previous = item.status;
    store.update(item.id, { status: 'searching', statusDetail: 'Procurando nas fontes…' });
    try {
      const result = await searchItem(this.svc, item);
      // Se todas as fontes falharam, mantém o que já havia em vez de apagar.
      const failedAll = result.releases.length === 0 && result.errors.length > 0;
      if (!failedAll) store.replaceReleases(item.id, result.releases);
      const nextAt = new Date(Date.now() + settings.get().searchIntervalHours * 3600_000).toISOString();
      store.update(item.id, { lastSearchAt: new Date().toISOString(), nextSearchAt: nextAt });

      const pt = result.releases.filter((r) => r.language === 'dual' || r.language === 'dublado' || r.language === 'ptbr');
      const sources = result.sources.join(', ') || 'nenhuma fonte configurada';
      store.event(
        item.id,
        'search',
        `Busca em ${sources}: ${result.releases.length} versão(ões), ${pt.length} em português${failedAll ? ' (fontes com erro)' : ''}`,
      );
      for (const e of result.errors.slice(0, 3)) store.event(item.id, 'error', e);

      if (pt.length > 0) {
        const best = pt[0]!;
        store.update(item.id, {
          status: 'found',
          statusDetail: `${pt.length} em português · melhor nota ${best.score} (${label(best.language)})`,
        });
        if (previous !== 'found') store.event(item.id, 'found', `Encontrado em português: "${best.title}" (nota ${best.score})`);
        const sent = await autoDispatch(this.svc, store.getItem(item.id)!);
        if (sent === 0) {
          const top = store.releases(item.id).find((r) => r.status === 'new');
          const why = settings.get().autoRule.enabled ? (top?.notes[0] ?? 'abaixo do limite') : 'envio automático desligado';
          store.update(item.id, { statusDetail: `Aguardando aprovação · ${why}` });
        }
      } else {
        const when = new Date(nextAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Sao_Paulo' });
        store.update(item.id, {
          status: result.sources.length === 0 || (result.errors.length > 0 && result.releases.length === 0) ? 'error' : 'wanted',
          statusDetail:
            result.sources.length === 0
              ? 'Nenhuma fonte de busca configurada'
              : result.errors.length > 0 && result.releases.length === 0
                ? result.errors[0]!
                : `Nada em português ainda · nova busca ${when}`,
        });
      }
    } catch (err) {
      store.update(item.id, { status: 'error', statusDetail: errorMessage(err), nextSearchAt: new Date(Date.now() + 3600_000).toISOString() });
      store.event(item.id, 'error', `Busca falhou: ${errorMessage(err)}`);
    } finally {
      this.searching.delete(item.id);
    }
  }
}
