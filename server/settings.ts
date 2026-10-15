// Ajustes editáveis pela interface (regra automática, intervalo, fontes Torznab, sites), guardados no banco.

import { z } from 'zod';
import type { Settings } from '../shared/types.ts';
import type { DB } from './db/index.ts';
import { DEFAULT_AUTO_RULE } from './engine/score.ts';
import { DEFAULT_SITES } from './integrations/sites/index.ts';

export const settingsSchema = z.object({
  autoRule: z.object({
    enabled: z.boolean(),
    minScore: z.number().int().min(0).max(100),
    minSeeders: z.number().int().min(0).max(10000),
    maxSizeGbMovie: z.number().min(0.5).max(200),
    maxSizeGbSeason: z.number().min(0.5).max(500),
    allow2160: z.boolean(),
    requireDub: z.boolean(),
  }),
  searchIntervalHours: z.number().min(1).max(168),
  torznab: z
    .array(
      z.object({
        id: z.string().min(1).max(40),
        name: z.string().min(1).max(60),
        url: z.string().url(),
        apiKey: z.string().max(200),
        enabled: z.boolean(),
      }),
    )
    .max(20),
  sites: z.array(
    z.object({
      id: z.enum(['rede_torrent']),
      enabled: z.boolean(),
      url: z.string().url().refine((u) => /^https?:\/\//.test(u), 'use http ou https'),
    }),
  ),
});

export const DEFAULT_SETTINGS: Settings = {
  autoRule: DEFAULT_AUTO_RULE,
  searchIntervalHours: 6,
  torznab: [],
  sites: DEFAULT_SITES,
};

export class SettingsStore {
  private cache: Settings | null = null;

  constructor(private readonly db: DB) {}

  get(): Settings {
    if (this.cache) return this.cache;
    const row = this.db.prepare("SELECT value FROM settings WHERE key = 'app'").get() as { value: string } | undefined;
    let parsed: Settings = DEFAULT_SETTINGS;
    if (row) {
      const merged = { ...DEFAULT_SETTINGS, ...JSON.parse(row.value) };
      merged.autoRule = { ...DEFAULT_SETTINGS.autoRule, ...merged.autoRule };
      // Sites novos entram com o padrão; os já salvos mantêm o endereço e o liga/desliga.
      merged.sites = DEFAULT_SITES.map((d) => ({ ...d, ...(merged.sites ?? []).find((x: { id: string }) => x.id === d.id) }));
      const result = settingsSchema.safeParse(merged);
      if (result.success) parsed = result.data;
    }
    this.cache = parsed;
    return parsed;
  }

  set(next: Settings): Settings {
    const valid = settingsSchema.parse(next);
    this.db
      .prepare("INSERT INTO settings (key, value) VALUES ('app', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(JSON.stringify(valid));
    this.cache = valid;
    return valid;
  }

  /** Versão para a interface: chaves das fontes Torznab mascaradas. */
  public(): Settings {
    const s = this.get();
    return { ...s, torznab: s.torznab.map((t) => ({ ...t, apiKey: t.apiKey ? '••••••' : '' })) };
  }

  /** Salva o que veio da interface, mantendo as chaves Torznab que voltaram mascaradas. */
  update(next: Settings): Settings {
    const current = this.get();
    const torznab = next.torznab.map((t) => {
      if (t.apiKey === '••••••') return { ...t, apiKey: current.torznab.find((c) => c.id === t.id)?.apiKey ?? '' };
      return t;
    });
    this.set({ ...next, torznab });
    return this.public();
  }
}
