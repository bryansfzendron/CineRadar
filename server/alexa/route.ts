// POST /alexa: a Amazon chama aqui (pelo túnel da Cloudflare) a cada fala da skill "meu cinema".
//
// Fica fora de /api de propósito: não tem login nem cookie, e o gancho de segurança do app só olha /api.
// A proteção é a assinatura da Amazon, conferida sobre o corpo CRU — por isso esta rota tem o seu
// próprio leitor de JSON, que guarda o texto antes de interpretar.

import type { FastifyInstance } from 'fastify';
import type { Kind } from '../../shared/types.ts';
import { errorMessage } from '../integrations/http.ts';
import type { Services } from '../services.ts';
import { handle, type SkillDeps, speak } from './skill.ts';
import { type AlexaRequestEnvelope, CertCache, rejectReason } from './verify.ts';

const ARRIVED_DAYS = 7;

/** O que vem de fora de `svc` (busca com "na lista/na biblioteca", pedir, tocar) — montado pelo app. */
export type AlexaRouteDeps = { svc: Services } & Pick<SkillDeps, 'search' | 'suggestions' | 'request' | 'approvalPlan' | 'approve' | 'play'>;

export async function registerAlexa(app: FastifyInstance, deps: AlexaRouteDeps): Promise<void> {
  const { svc } = deps;
  const certs = new CertCache();

  const skillDeps: SkillDeps = {
    search: deps.search,
    suggestions: deps.suggestions,
    request: deps.request,
    approvalPlan: deps.approvalPlan,
    approve: deps.approve,
    play: deps.play,
    details: async (kind: Kind, tmdbId: number) => {
      const d = await svc.meta.details(kind, tmdbId);
      return { genres: d.genres, runtime: d.runtime, rating: d.rating, seasons: d.seasons, overview: d.overview };
    },
    items: () => svc.store.listItems(),
    remove: (id) => {
      const item = svc.store.getItem(id);
      svc.store.deleteItem(id);
      if (item) svc.log.info(`[alexa] tirado da lista: ${item.title}`);
    },
    arrived: () => {
      const since = Date.now() - ARRIVED_DAYS * 86_400_000;
      return svc.store
        .recentEvents(200)
        .filter((e) => e.kind === 'available' && e.title && Date.parse(e.at) >= since)
        .map((e) => e.title!);
    },
  };

  await app.register(async (scope) => {
    scope.removeContentTypeParser('application/json');
    scope.addContentTypeParser('application/json', { parseAs: 'string', bodyLimit: 128 * 1024 }, (_req, body, done) => done(null, body));

    scope.post('/alexa', async (req, reply) => {
      const raw = typeof req.body === 'string' ? req.body : '';
      let env: AlexaRequestEnvelope;
      try {
        env = JSON.parse(raw) as AlexaRequestEnvelope;
      } catch {
        return reply.code(400).send({ error: 'corpo inválido' });
      }
      const header = (name: string) => {
        const v = req.headers[name];
        return Array.isArray(v) ? (v[0] ?? '') : (v ?? '');
      };
      const reason = await rejectReason(
        raw,
        env,
        { certUrl: header('signaturecertchainurl'), signature: header('signature-256') },
        svc.config.alexa,
        certs,
      );
      if (reason) {
        svc.log.warn(`[alexa] pedido recusado: ${reason}`);
        return reply.code(400).send({ error: 'não autorizado' });
      }
      try {
        return await handle(env, skillDeps);
      } catch (err) {
        svc.log.error(`[alexa] ${errorMessage(err)}`);
        return speak('Tive um problema para falar com o CineRadar. Tente de novo daqui a pouco.');
      }
    });
  });
}
