// Buscar: procura no TMDB (em português) e põe na lista com "Quero ver".

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Plus, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { DiscoverResult, Kind } from '../../../shared/types.ts';
import { api, ApiError } from '../api.ts';
import { OpenLinks, Poster } from '../components/PosterCard.tsx';
import { STATUS_LABEL } from '../labels.ts';

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

const LISTS: { which: string; kind: Kind; title: string }[] = [
  { which: 'now_playing', kind: 'movie', title: 'Nos cinemas do Brasil' },
  { which: 'trending', kind: 'movie', title: 'Filmes em alta na semana' },
  { which: 'trending', kind: 'series', title: 'Séries em alta na semana' },
  { which: 'upcoming', kind: 'movie', title: 'Estreias chegando' },
];

export function Discover() {
  const [params, setParams] = useSearchParams();
  const [text, setText] = useState(params.get('q') ?? '');
  const [kind, setKind] = useState<Kind | 'all'>('all');
  const q = useDebounced(text.trim(), 350);

  useEffect(() => {
    if (q) params.set('q', q);
    else params.delete('q');
    setParams(params, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const results = useQuery({
    queryKey: ['discover', q, kind],
    queryFn: () => api.discoverSearch(q, kind === 'all' ? undefined : kind),
    enabled: q.length > 1,
  });

  return (
    <div className="discover">
      <form className="searchbar" role="search" onSubmit={(e) => e.preventDefault()}>
        <Search size={20} aria-hidden />
        <label htmlFor="q" className="sr-only">
          Nome do filme ou série
        </label>
        <input
          id="q"
          type="search"
          autoFocus
          placeholder="Nome do filme ou da série"
          value={text}
          onChange={(e) => setText(e.target.value)}
          autoComplete="off"
        />
        <div className="seg" role="group" aria-label="Tipo">
          {(['all', 'movie', 'series'] as const).map((k) => (
            <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>
              {k === 'all' ? 'Tudo' : k === 'movie' ? 'Filmes' : 'Séries'}
            </button>
          ))}
        </div>
      </form>

      {q.length > 1 ? (
        <section aria-live="polite">
          {results.isPending && <div className="grid-skeleton" aria-busy="true" />}
          {results.error && <ErrorNote err={results.error} />}
          {results.data && results.data.length === 0 && <p className="muted">Nada encontrado para “{q}”. Tente o título original.</p>}
          {results.data && results.data.length > 0 && <ResultGrid results={results.data} />}
        </section>
      ) : (
        LISTS.map((l) => <ListShelf key={`${l.which}-${l.kind}`} {...l} />)
      )}
    </div>
  );
}

function ListShelf({ which, kind, title }: { which: string; kind: Kind; title: string }) {
  const list = useQuery({ queryKey: ['discover-list', which, kind], queryFn: () => api.discoverList(which, kind), staleTime: 30 * 60_000 });
  if (list.error) return <ErrorNote err={list.error} />;
  if (!list.data?.length) return null;
  return (
    <section className="shelf">
      <header className="shelf-head">
        <h2 className="shelf-title">{title}</h2>
      </header>
      <ResultGrid results={list.data.slice(0, 18)} />
    </section>
  );
}

function ResultGrid({ results }: { results: DiscoverResult[] }) {
  return (
    <div className="grid">
      {results.map((r) => (
        <ResultCard key={`${r.kind}-${r.tmdbId}`} r={r} />
      ))}
    </div>
  );
}

function ResultCard({ r }: { r: DiscoverResult }) {
  const qc = useQueryClient();
  const [, setParams] = useSearchParams();
  const add = useMutation({
    mutationFn: () => api.addItem(r.kind, r.tmdbId),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['items'] });
      void qc.invalidateQueries({ queryKey: ['discover'] });
      void qc.invalidateQueries({ queryKey: ['discover-list'] });
    },
  });
  const inList = r.inList ?? (add.data ? { id: add.data.id, status: add.data.status } : null);

  return (
    <Poster
      data={{ kind: r.kind, title: r.title, year: r.year, posterPath: r.posterPath }}
      onOpen={inList ? () => setParams({ item: String(inList.id) }) : undefined}
      action={
        inList ? (
          <span className="want want-done">
            <Check size={14} aria-hidden /> {STATUS_LABEL[inList.status]}
          </span>
        ) : r.inLibrary ? (
          <span className="want want-done own">
            <Check size={14} aria-hidden /> Na biblioteca
            <OpenLinks plexUrl={r.inLibrary.plexUrl} jellyfinUrl={r.inLibrary.jellyfinUrl} />
          </span>
        ) : (
          <button type="button" className="want" onClick={() => add.mutate()} disabled={add.isPending}>
            <Plus size={14} aria-hidden /> {add.isPending ? 'Adicionando…' : 'Quero ver'}
          </button>
        )
      }
    />
  );
}

function ErrorNote({ err }: { err: unknown }) {
  const msg = err instanceof ApiError ? err.message : 'Falha ao buscar.';
  return (
    <p className="note-error">
      {msg}
      {/TMDB/i.test(msg) && ' Confira a chave do TMDB no arquivo .env do servidor.'}
    </p>
  );
}
