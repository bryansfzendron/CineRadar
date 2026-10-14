// Login com usuário e senha. Senha com scrypt; sessão em cookie HttpOnly guardada como hash no banco.

import crypto from 'node:crypto';
import { promisify } from 'node:util';
import type { DB } from './db/index.ts';

const scrypt = promisify(crypto.scrypt) as (pw: string, salt: Buffer, len: number, opts: crypto.ScryptOptions) => Promise<Buffer>;
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export const SESSION_COOKIE = 'cr_session';

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, 64, SCRYPT);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, saltB64, keyB64] = stored.split('$');
  if (algo !== 'scrypt' || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, 'base64');
  const key = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length, SCRYPT);
  return crypto.timingSafeEqual(key, expected);
}

function sha256(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

export class Auth {
  constructor(
    private readonly db: DB,
    private readonly sessionDays: number,
  ) {}

  /** Cria o admin do .env se ainda não existe nenhum usuário. */
  async ensureAdmin(username: string, password: string): Promise<'created' | 'exists' | 'missing-password'> {
    const count = (this.db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;
    if (count > 0) return 'exists';
    if (!password) return 'missing-password';
    this.db.prepare('INSERT INTO users (username, pass_hash) VALUES (?, ?)').run(username, await hashPassword(password));
    return 'created';
  }

  async login(username: string, password: string): Promise<{ token: string; expiresAt: Date } | null> {
    const user = this.db.prepare('SELECT id, pass_hash FROM users WHERE username = ?').get(username) as
      | { id: number; pass_hash: string }
      | undefined;
    // Sem usuário, ainda calcula um hash para não revelar pelo tempo de resposta.
    const ok = user ? await verifyPassword(password, user.pass_hash) : (await hashPassword(password), false);
    if (!user || !ok) return null;
    const token = crypto.randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + this.sessionDays * 86400_000);
    this.db
      .prepare('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)')
      .run(sha256(token), user.id, expiresAt.toISOString());
    return { token, expiresAt };
  }

  userFor(token: string | undefined): { id: number; username: string } | null {
    if (!token) return null;
    const row = this.db
      .prepare(
        'SELECT u.id, u.username, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?',
      )
      .get(sha256(token)) as { id: number; username: string; expires_at: string } | undefined;
    if (!row) return null;
    if (new Date(row.expires_at) < new Date()) {
      this.logout(token);
      return null;
    }
    return { id: row.id, username: row.username };
  }

  logout(token: string): void {
    this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
  }

  async changePassword(userId: number, current: string, next: string): Promise<boolean> {
    const row = this.db.prepare('SELECT pass_hash FROM users WHERE id = ?').get(userId) as { pass_hash: string } | undefined;
    if (!row || !(await verifyPassword(current, row.pass_hash))) return false;
    this.db.prepare('UPDATE users SET pass_hash = ? WHERE id = ?').run(await hashPassword(next), userId);
    this.db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
    return true;
  }

  purgeExpired(): void {
    this.db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(new Date().toISOString());
  }
}
