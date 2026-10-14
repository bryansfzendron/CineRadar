// Ponto de entrada: abre o banco, monta as integrações, cria o admin, sobe o agendador e o servidor.

import path from 'node:path';
import { buildApp } from './app.ts';
import { Auth } from './auth.ts';
import { config } from './config.ts';
import { openDb } from './db/index.ts';
import { Scheduler } from './scheduler.ts';
import { createServices } from './services.ts';

const stamp = () => new Date().toISOString();
const log = {
  info: (msg: string) => console.log(`${stamp()} INFO  ${msg}`),
  warn: (msg: string) => console.warn(`${stamp()} WARN  ${msg}`),
  error: (msg: string) => console.error(`${stamp()} ERROR ${msg}`),
};

const db = openDb(path.join(config.dataDir, 'cineradar.db'));
const svc = createServices(config, db, log);
const auth = new Auth(db, config.sessionDays);

const admin = await auth.ensureAdmin(config.adminUser, config.adminPassword);
if (admin === 'created') log.info(`Usuário "${config.adminUser}" criado.`);
if (admin === 'missing-password') log.warn('Nenhum usuário ainda: defina CINERADAR_ADMIN_PASSWORD no .env e reinicie.');

const scheduler = new Scheduler(svc);
const app = await buildApp(svc, scheduler, auth);
await app.listen({ port: config.port, host: config.host });

const configured = (['tmdb', 'radarr', 'sonarr', 'prowlarr', 'plex', 'jellyfin', 'qbit'] as const).filter((k) => svc[k].configured);
log.info(`CineRadar em http://${config.host}:${config.port} · integrações: ${configured.join(', ') || 'nenhuma'}`);

scheduler.start();
scheduler.add(6 * 3600_000, async () => auth.purgeExpired());

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    log.info(`${signal}: encerrando`);
    scheduler.stop();
    await app.close();
    db.close();
    process.exit(0);
  });
}
