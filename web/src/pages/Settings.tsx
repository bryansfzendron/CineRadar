// Ajustes: conexões, regra de envio automático, intervalo de busca, fontes extras e senha.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { IntegrationName, Settings, TorznabSource } from '../../../shared/types.ts';
import { api } from '../api.ts';

const NAMES: Record<IntegrationName, { label: string; role: string }> = {
  tmdb: { label: 'TMDB', role: 'títulos, sinopses e cartazes em português' },
  radarr: { label: 'Radarr', role: 'baixa e organiza os filmes' },
  sonarr: { label: 'Sonarr', role: 'baixa e organiza as séries' },
  prowlarr: { label: 'Prowlarr', role: 'procura nos indexadores' },
  plex: { label: 'Plex', role: 'mostra o que já está em cartaz' },
  jellyfin: { label: 'Jellyfin', role: 'mostra o que já está em cartaz' },
  qbittorrent: { label: 'qBittorrent', role: 'plano B quando o Radarr/Sonarr recusam uma versão' },
};

export function SettingsPage() {
  const qc = useQueryClient();
  const health = useQuery({ queryKey: ['health'], queryFn: () => api.health() });
  const settings = useQuery({ queryKey: ['settings'], queryFn: api.settings });
  const indexers = useQuery({ queryKey: ['indexers'], queryFn: api.indexers, retry: false });
  const [draft, setDraft] = useState<Settings | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (settings.data && !draft) setDraft(settings.data.settings);
  }, [settings.data, draft]);

  const save = useMutation({
    mutationFn: (s: Settings) => api.saveSettings(s),
    onSuccess: (res) => {
      setDraft(res.settings);
      setSaved(true);
      void qc.invalidateQueries({ queryKey: ['settings'] });
      setTimeout(() => setSaved(false), 2500);
    },
  });

  const recheck = useMutation({
    mutationFn: () => api.health(true),
    onSuccess: (data) => qc.setQueryData(['health'], data),
  });

  const rule = draft?.autoRule;
  const setRule = (patch: Partial<Settings['autoRule']>) => draft && setDraft({ ...draft, autoRule: { ...draft.autoRule, ...patch } });

  return (
    <div className="settings">
      <section className="panel">
        <header className="panel-head">
          <h2 className="section-title">Conexões</h2>
          <button type="button" className="btn btn-quiet" onClick={() => recheck.mutate()} disabled={recheck.isPending}>
            <RefreshCw size={14} aria-hidden className={recheck.isPending ? 'spin' : undefined} /> Testar de novo
          </button>
        </header>
        <ul className="conn-list">
          {(health.data?.integrations ?? []).map((i) => (
            <li key={i.name} className={`conn ${i.ok ? 'conn-ok' : i.configured ? 'conn-bad' : 'conn-off'}`}>
              <span className="conn-dot" aria-hidden />
              <span className="conn-name">{NAMES[i.name].label}</span>
              <span className="conn-role">{NAMES[i.name].role}</span>
              <span className="conn-state">{i.ok ? (i.version ? `ok · ${i.version}` : 'ok') : i.message}</span>
            </li>
          ))}
        </ul>
        <p className="muted small">Endereços e chaves ficam no arquivo .env do servidor, fora do navegador.</p>
      </section>

      {draft && rule && (
        <form
          className="panel"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate(draft);
          }}
        >
          <h2 className="section-title">Baixar sozinho</h2>
          <label className="check">
            <input type="checkbox" checked={rule.enabled} onChange={(e) => setRule({ enabled: e.target.checked })} />
            Mandar baixar automaticamente quando a versão passar dos limites abaixo
          </label>
          <div className="fields">
            <Field label="Nota mínima (0–100)" hint="Dual áudio 1080p com bons seeders costuma passar de 80.">
              <input type="number" min={0} max={100} value={rule.minScore} onChange={(e) => setRule({ minScore: Number(e.target.value) })} />
            </Field>
            <Field label="Seeders mínimos">
              <input type="number" min={0} value={rule.minSeeders} onChange={(e) => setRule({ minSeeders: Number(e.target.value) })} />
            </Field>
            <Field label="Tamanho máximo de filme (GB)">
              <input type="number" min={0.5} step={0.5} value={rule.maxSizeGbMovie} onChange={(e) => setRule({ maxSizeGbMovie: Number(e.target.value) })} />
            </Field>
            <Field label="Tamanho máximo por temporada (GB)">
              <input type="number" min={0.5} step={0.5} value={rule.maxSizeGbSeason} onChange={(e) => setRule({ maxSizeGbSeason: Number(e.target.value) })} />
            </Field>
            <Field label="Procurar de novo a cada (horas)">
              <input
                type="number"
                min={1}
                max={168}
                value={draft.searchIntervalHours}
                onChange={(e) => setDraft({ ...draft, searchIntervalHours: Number(e.target.value) })}
              />
            </Field>
          </div>
          <label className="check">
            <input type="checkbox" checked={rule.requireDub} onChange={(e) => setRule({ requireDub: e.target.checked })} />
            Só baixar sozinho versões com áudio em português (dublado ou dual)
          </label>
          <label className="check">
            <input type="checkbox" checked={rule.allow2160} onChange={(e) => setRule({ allow2160: e.target.checked })} />
            Aceitar 4K (arquivos grandes; o servidor não tem GPU para converter)
          </label>

          <h3 className="section-title sub">Fontes extras (Torznab)</h3>
          <p className="muted small">Além do Prowlarr, o CineRadar pode consultar outros serviços compatíveis com Torznab, como o Jackett.</p>
          <TorznabEditor list={draft.torznab} onChange={(torznab) => setDraft({ ...draft, torznab })} />

          <div className="form-foot">
            <button type="submit" className="btn btn-primary" disabled={save.isPending}>
              {save.isPending ? 'Salvando…' : 'Salvar ajustes'}
            </button>
            {saved && <span role="status">Ajustes salvos.</span>}
            {save.error && <span className="error">{save.error.message}</span>}
          </div>
        </form>
      )}

      <section className="panel">
        <h2 className="section-title">Indexadores do Prowlarr</h2>
        {indexers.error ? (
          <p className="muted">{indexers.error.message}</p>
        ) : (
          <>
            <p className="muted small">
              É aqui que o CineRadar procura. Para achar mais versões dubladas, cadastre indexadores brasileiros no Prowlarr; eles aparecem
              aqui sozinhos.
            </p>
            <ul className="idx-list">
              {(indexers.data ?? []).map((i) => (
                <li key={i.id} className={!i.enabled ? 'idx-off' : i.failing ? 'idx-bad' : 'idx-ok'}>
                  {i.name}
                  <span>{!i.enabled ? 'desligado' : i.failing ? 'falhando' : 'ok'}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {settings.data?.webhooks && (
        <section className="panel">
          <h2 className="section-title">Avisos do Radarr e do Sonarr</h2>
          <p className="muted small">
            Em cada um, Configurações › Conectar › Webhook, com estes endereços. Assim o CineRadar fica sabendo na hora quando um download
            começa ou termina.
          </p>
          <dl className="hooks">
            <dt>Radarr</dt>
            <dd>
              <code>{settings.data.webhooks.radarr}</code>
            </dd>
            <dt>Sonarr</dt>
            <dd>
              <code>{settings.data.webhooks.sonarr}</code>
            </dd>
          </dl>
        </section>
      )}

      <PasswordPanel />
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

function TorznabEditor({ list, onChange }: { list: TorznabSource[]; onChange: (l: TorznabSource[]) => void }) {
  const update = (id: string, patch: Partial<TorznabSource>) => onChange(list.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  return (
    <div className="torznab">
      {list.map((t) => (
        <div key={t.id} className="torznab-row">
          <input aria-label="Nome" placeholder="Nome" value={t.name} onChange={(e) => update(t.id, { name: e.target.value })} />
          <input aria-label="Endereço Torznab" placeholder="http://192.168.15.150:9117/api/v2.0/indexers/all/results/torznab" value={t.url} onChange={(e) => update(t.id, { url: e.target.value })} />
          <input aria-label="Chave" placeholder="Chave da API" value={t.apiKey} onChange={(e) => update(t.id, { apiKey: e.target.value })} />
          <label className="check inline">
            <input type="checkbox" checked={t.enabled} onChange={(e) => update(t.id, { enabled: e.target.checked })} /> Ligada
          </label>
          <button type="button" className="btn btn-quiet" onClick={() => onChange(list.filter((x) => x.id !== t.id))}>
            Remover
          </button>
        </div>
      ))}
      <button
        type="button"
        className="btn"
        onClick={() => onChange([...list, { id: crypto.randomUUID().slice(0, 8), name: 'Nova fonte', url: '', apiKey: '', enabled: true }])}
      >
        Adicionar fonte
      </button>
    </div>
  );
}

function PasswordPanel() {
  const qc = useQueryClient();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const change = useMutation({
    mutationFn: () => api.changePassword(current, next),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ['me'] }),
  });
  return (
    <form
      className="panel"
      onSubmit={(e) => {
        e.preventDefault();
        change.mutate();
      }}
    >
      <h2 className="section-title">Senha</h2>
      <div className="fields">
        <Field label="Senha atual">
          <input type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
        </Field>
        <Field label="Nova senha" hint="Pelo menos 8 caracteres. Você vai entrar de novo depois.">
          <input type="password" autoComplete="new-password" minLength={8} value={next} onChange={(e) => setNext(e.target.value)} />
        </Field>
      </div>
      <div className="form-foot">
        <button type="submit" className="btn" disabled={change.isPending || next.length < 8 || !current}>
          Trocar senha
        </button>
        {change.error && <span className="error">{change.error.message}</span>}
      </div>
    </form>
  );
}
