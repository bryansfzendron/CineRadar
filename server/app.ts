// Servidor HTTP: API, login, webhooks do Radarr/Sonarr e a interface compilada (dist/web).

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { DiscoverResult, Health, IntegrationName, IntegrationStatus, Kind } from '../shared/types.ts';
import { Auth, SESSION_COOKIE } from './auth.ts';
import { dispatchRelease } from './engine/dispatch.ts';
import { refreshLibraries, syncAvailability } from './engine/sync.ts';
import { errorMessage } from './integrations/http.ts';
import { SITES } from './integrations/sites/index.ts';
import type { Scheduler } from './scheduler.ts';
import type { Services } from './services.ts';
import { settingsSchema } from './settings.ts';
import { publicItem } from './store.ts';

declare module 'fastify' {
  interface FastifyRequest {
    user: { id: number; username: string } | null;
  }
}

const VERSION = process.env.npm_package_version ?? '0.1.0';
const PUBLIC_API = new Set(['/api/health/live', '/api/auth/login', '/api/auth/me']);

function webDir(): string | null {
  const here = path.dirname(fileURLToPath(import.meta.url));
  for (const candidate of [path.resolve(here, '../web'), path.resolve(here, '../dist/web'), path.resolve('dist/web')]) {
    if (fs.existsSync(path.join(candidate, 'index.html'))) return candidate;
  }
  return null;
}

export async function buildApp(svc: Services, scheduler: Scheduler, auth: Auth) {
  const app = Fastify({ trustProxy: true, logger: false, bodyLimit: 256 * 1024 });
  await app.register(cookie);
  await app.register(rateLimit, { global: false });
  app.decorateRequest('user', null);

  // ---------- segurança ----------
  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/api/')) return;
    const pathOnly = req.url.split('?')[0]!;
    // Pedidos que mudam algo precisam vir da própria origem (contra CSRF), exceto webhooks (têm token próprio).
    if (req.method !== 'GET' && req.method !== 'HEAD' && !pathOnly.startsWith('/api/webhooks/')) {
      const origin = req.headers.origin;
      if (origin) {
        const host = req.headers['x-forwarded-host'] ?? req.headers.host;
        if (new URL(origin).host !== host) return reply.code(403).send({ error: 'origem não permitida' });
      }
    }
    req.user = auth.userFor(req.cookies[SESSION_COOKIE]);
    if (PUBLIC_API.has(pathOnly) || pathOnly.startsWith('/api/webhooks/')) return;
    if (!req.user) return reply.code(401).send({ error: 'faça login' });
  });

  app.addHook('onSend', async (_req, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'same-origin');
    return payload;
  });

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof z.ZodError) return reply.code(400).send({ error: 'dados inválidos', issues: err.issues });
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) svc.log.error(`[http] ${errorMessage(err)}`);
    return reply.code(status).send({ error: errorMessage(err) });
  });

  // ---------- login ----------
  app.get('/api/health/live', async () => ({ ok: true }));

  app.post('/api/auth/login', { config: { rateLimit: { max: 8, timeWindow: '5 minutes' } } }, async (req, reply) => {
    const body = z.object({ username: z.string().min(1).max(80), password: z.string().min(1).max(200) }).parse(req.body);
    const session = await auth.login(body.username, body.password);
    if (!session) return reply.code(401).send({ error: 'usuário ou senha incorretos' });
    reply.setCookie(SESSION_COOKIE, session.token, {
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
      secure: req.protocol === 'https',
      expires: session.expiresAt,
    });
    return { username: body.username };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    const token = req.cookies[SESSION_COOKIE];
    if (token) auth.logout(token);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', async (req, reply) => {
    if (!req.user) return reply.code(401).send({ error: 'faça login' });
    return { username: req.user.username };
  });

  app.post('/api/auth/password', async (req, reply) => {
    const body = z.object({ current: z.string().min(1), next: z.string().min(8).max(200) }).parse(req.body);
    const ok = await auth.changePassword(req.user!.id, body.current, body.next);
    if (!ok) return reply.code(400).send({ error: 'senha atual incorreta' });
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  // ---------- saúde das integrações ----------
  let healthCache: { at: number; data: IntegrationStatus[] } | null = null;
  async function integrations(force = false): Promise<IntegrationStatus[]> {
    if (!force && healthCache && Date.now() - healthCache.at < 60_000) return healthCache.data;
    const checks: [IntegrationName, boolean, () => Promise<string | null>][] = [
      ['tmdb', svc.tmdb.configured, async () => (await svc.tmdb.ping(), null)],
      ['radarr', svc.radarr.configured, () => svc.radarr.version()],
      ['sonarr', svc.sonarr.configured, () => svc.sonarr.version()],
      ['prowlarr', svc.prowlarr.configured, () => svc.prowlarr.version()],
      ['plex', svc.plex.configured, () => svc.plex.version()],
      ['jellyfin', svc.jellyfin.configured, () => svc.jellyfin.version()],
      ['qbittorrent', svc.qbit.configured, () => svc.qbit.version()],
      ...svc.settings.get().sites.map((site): [IntegrationName, boolean, () => Promise<string | null>] => [
        site.id,
        site.enabled,
        async () => (await SITES[site.id].ping(site.url), new URL(site.url).host),
      ]),
    ];
    const data = await Promise.all(
      checks.map(async ([name, configured, fn]): Promise<IntegrationStatus> => {
        if (!configured) return { name, configured, ok: false, version: null, message: 'não configurado' };
        try {
          return { name, configured, ok: true, version: await fn(), message: null };
        } catch (err) {
          return { name, configured, ok: false, version: null, message: errorMessage(err) };
        }
      }),
    );
    healthCache = { at: Date.now(), data };
    return data;
  }

  app.get('/api/health', async (req): Promise<Health> => {
    const force = (req.query as { force?: string }).force === '1';
    return {
      ok: true,
      version: VERSION,
      integrations: await integrations(force),
      scheduler: { running: scheduler.running, lastTickAt: scheduler.lastTickAt?.toISOString() ?? null, searching: scheduler.searchingCount },
    };
  });

  // ---------- lista de desejos ----------
  const kindSchema = z.enum(['movie', 'series']);

  app.get('/api/items', async (req) => {
    const { kind } = z.object({ kind: kindSchema.optional() }).parse(req.query);
    return svc.store.listItems(kind).map(publicItem);
  });

  app.post('/api/items', async (req, reply) => {
    const body = z.object({ kind: kindSchema, tmdbId: z.number().int().positive() }).parse(req.body);
    const existing = svc.store.findByTmdb(body.kind, body.tmdbId);
    if (existing) return reply.code(200).send(publicItem(existing));
    if (!svc.meta.configured) return reply.code(400).send({ error: 'configure o TMDB ou o Radarr/Sonarr' });
    const details = await svc.meta.details(body.kind, body.tmdbId);
    const item = svc.store.addItem(details);
    // Já pode estar no Plex/Jellyfin; confere e, se não estiver, busca.
    void (async () => {
      await syncAvailability(svc).catch(() => undefined);
      const fresh = svc.store.getItem(item.id);
      if (fresh && fresh.status !== 'available') await scheduler.search(fresh);
    })();
    return reply.code(201).send(publicItem(item));
  });

  const idParam = z.object({ id: z.coerce.number().int().positive() });

  app.get('/api/items/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const detail = svc.store.detail(id);
    if (!detail) return reply.code(404).send({ error: 'não encontrado' });
    return detail;
  });

  app.delete('/api/items/:id', async (req) => {
    const { id } = idParam.parse(req.params);
    svc.store.deleteItem(id);
    return { ok: true };
  });

  app.post('/api/items/:id/search', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const item = svc.store.getItem(id);
    if (!item) return reply.code(404).send({ error: 'não encontrado' });
    if (scheduler.isSearching(id)) return { started: false };
    void scheduler.search(item);
    return reply.code(202).send({ started: true });
  });

  app.post('/api/items/:id/releases/:rid/dispatch', async (req, reply) => {
    const { id, rid } = z.object({ id: z.coerce.number().int(), rid: z.coerce.number().int() }).parse(req.params);
    const item = svc.store.getItem(id);
    const release = svc.store.getRelease(rid);
    if (!item || !release || release.itemId !== id) return reply.code(404).send({ error: 'não encontrado' });
    try {
      const via = await dispatchRelease(svc, item, release, 'manual');
      return { ok: true, via };
    } catch (err) {
      svc.store.setReleaseStatus(release.id, 'failed', errorMessage(err));
      svc.store.event(id, 'error', `Falha ao enviar "${release.title}": ${errorMessage(err)}`);
      return reply.code(502).send({ error: errorMessage(err) });
    }
  });

  app.get('/api/events', async () => svc.store.recentEvents(40));

  // ---------- descobrir (TMDB) ----------
  function withInList(results: Omit<DiscoverResult, 'inList'>[]): DiscoverResult[] {
    const map = svc.store.inListMap();
    return results.map((r) => ({ ...r, inList: map.get(`${r.kind}:${r.tmdbId}`) ?? null }));
  }

  app.get('/api/discover/search', async (req, reply) => {
    const { q, kind } = z.object({ q: z.string().trim().min(1).max(120), kind: kindSchema.optional() }).parse(req.query);
    if (!svc.meta.configured) return reply.code(400).send({ error: 'configure o TMDB ou o Radarr/Sonarr' });
    return withInList(await svc.meta.search(q, kind as Kind | undefined));
  });

  app.get('/api/discover/list/:which', async (req, reply) => {
    const { which } = z.object({ which: z.enum(['trending', 'now_playing', 'popular', 'upcoming', 'on_the_air']) }).parse(req.params);
    const { kind } = z.object({ kind: kindSchema.default('movie') }).parse(req.query);
    // Sem TMDB não há listas; a página Buscar mostra só a caixa de busca.
    if (!svc.meta.hasLists) return [];
    if (kind === 'series' && (which === 'now_playing' || which === 'upcoming')) return [];
    if (kind === 'movie' && which === 'on_the_air') return [];
    return withInList(await svc.tmdb.list(kind, which));
  });

  // ---------- ajustes ----------
  app.get('/api/settings', async () => ({
    settings: svc.settings.public(),
    webhooks: svc.config.webhookToken
      ? {
          radarr: `${svc.config.publicUrl}/api/webhooks/radarr?token=${svc.config.webhookToken}`,
          sonarr: `${svc.config.publicUrl}/api/webhooks/sonarr?token=${svc.config.webhookToken}`,
        }
      : null,
  }));

  app.put('/api/settings', async (req) => {
    const next = settingsSchema.parse(req.body);
    return { settings: svc.settings.update(next) };
  });

  app.get('/api/indexers', async (_req, reply) => {
    if (!svc.prowlarr.configured) return reply.code(400).send({ error: 'Prowlarr não configurado' });
    const [indexers, failing] = await Promise.all([svc.prowlarr.indexers(), svc.prowlarr.failing().catch(() => [] as number[])]);
    return indexers
      .filter((i) => i.protocol === 'torrent')
      .map((i) => ({ id: i.id, name: i.name, enabled: i.enable, failing: failing.includes(i.id), language: i.language ?? null }))
      .sort((a, b) => Number(b.enabled) - Number(a.enabled) || a.name.localeCompare(b.name));
  });

  // ---------- webhooks do Radarr/Sonarr ----------
  app.post('/api/webhooks/:app', async (req: FastifyRequest, reply: FastifyReply) => {
    const { app: source } = z.object({ app: z.enum(['radarr', 'sonarr']) }).parse(req.params);
    const token = (req.query as { token?: string }).token ?? '';
    const expected = svc.config.webhookToken;
    if (!expected || token.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected))) {
      return reply.code(401).send({ error: 'token inválido' });
    }
    const body = (req.body ?? {}) as {
      eventType?: string;
      movie?: { tmdbId?: number };
      series?: { tvdbId?: number; tmdbId?: number };
      release?: { releaseTitle?: string };
    };
    const event = body.eventType ?? '';
    if (event === 'Test') return { ok: true };
    const items = svc.store.listItems(source === 'radarr' ? 'movie' : 'series');
    const item = items.find((i) =>
      source === 'radarr' ? i.tmdbId === body.movie?.tmdbId : (body.series?.tmdbId && i.tmdbId === body.series.tmdbId) || (body.series?.tvdbId && i.tvdbId === body.series.tvdbId),
    );
    if (event === 'Download') {
      void refreshLibraries(svc).then(() => setTimeout(() => void syncAvailability(svc), 60_000));
    }
    if (!item) return { ok: true, matched: false };
    if (event === 'Grab') {
      if (item.status !== 'available') svc.store.update(item.id, { status: 'downloading', statusDetail: 'Baixando', progress: item.progress ?? 0 });
      svc.store.event(item.id, 'download', `Download iniciado: ${body.release?.releaseTitle ?? ''}`.trim());
    } else if (event === 'Download') {
      svc.store.update(item.id, { statusDetail: 'Importado; atualizando Plex e Jellyfin', progress: 1 });
      svc.store.event(item.id, 'download', 'Importado na biblioteca; pedindo atualização do Plex e do Jellyfin');
    }
    return { ok: true, matched: true };
  });

  // ---------- interface ----------
  const dir = webDir();
  if (dir) {
    await app.register(fastifyStatic, { root: dir, prefix: '/', wildcard: false, maxAge: '1h', immutable: false });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) return reply.code(404).send({ error: 'rota não encontrada' });
      return reply.type('text/html').header('Cache-Control', 'no-cache').sendFile('index.html');
    });
  }

  return app;
}
