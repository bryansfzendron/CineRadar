// Biblioteca: tudo o que já está no Plex ou no Jellyfin, para saber o que você tem antes de procurar.

import { useQuery } from '@tanstack/react-query';
import { Check, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { Kind } from '../../../shared/types.ts';
import { api, ApiError } from '../api.ts';
import { OpenLinks, Poster } from '../components/PosterCard.tsx';
import { STATUS_LABEL } from '../labels.ts';

const PAGE = 120;

const normalize = (s: string) => s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

export function Owned() {
  const [kind, setKind] = useState<Kind>('movie');
  const [text, setText] = useState('');
  const [shown, setShown] = useState(PAGE);

  const lib = useQuery({ queryKey: ['library', kind], queryFn: () => api.library(kind), staleTime: 60_000 });

  const filtered = useMemo(() => {
    const q = normalize(text.trim());
    const all = lib.data ?? [];
    return q ? all.filter((e) => normalize(e.title).includes(q)) : all;
  }, [lib.data, text]);

  const noun = kind === 'movie' ? 'filmes' : 'séries';

  return (
    <div className="discover">
      <form className="searchbar" role="search" onSubmit={(e) => e.preventDefault()}>
        <Search size={20} aria-hidden />
        <label htmlFor="own-q" className="sr-only">
          Procurar na biblioteca
        </label>
        <input
          id="own-q"
          type="search"
          placeholder={`Procurar entre os seus ${noun}`}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setShown(PAGE);
          }}
          autoComplete="off"
        />
        <div className="seg" role="group" aria-label="Tipo">
          {(['movie', 'series'] as const).map((k) => (
            <button
              key={k}
              type="button"
              aria-pressed={kind === k}
              onClick={() => {
                setKind(k);
                setShown(PAGE);
              }}
            >
              {k === 'movie' ? 'Filmes' : 'Séries'}
            </button>
          ))}
        </div>
      </form>

      {lib.isPending && <div className="grid-skeleton" aria-busy="true" />}
      {lib.error && (
        <p className="note-error">{lib.error instanceof ApiError ? lib.error.message : 'Falha ao ler a biblioteca.'}</p>
      )}
      {lib.data && (
        <section className="shelf" aria-live="polite">
          <header className="shelf-head">
            <h2 className="shelf-title">
              Na biblioteca <span className="shelf-count">{filtered.length}</span>
            </h2>
            <p className="shelf-hint">Títulos do Plex e do Jellyfin com ID do TMDB. O CineRadar não busca de novo o que já está aqui.</p>
          </header>
          {filtered.length === 0 ? (
            <p className="muted">{text ? `Nenhum resultado para “${text}”.` : `Nenhum dos seus ${noun} foi encontrado.`}</p>
          ) : (
            <div className="grid">
              {filtered.slice(0, shown).map((e) => (
                <Poster
                  key={`${e.kind}-${e.tmdbId}`}
                  data={{ kind: e.kind, title: e.title, year: e.year, posterPath: e.posterPath }}
                  action={
                    <span className="want want-done own">
                      <Check size={14} aria-hidden /> {e.inList ? STATUS_LABEL[e.inList.status] : 'Na biblioteca'}
                      <OpenLinks plexUrl={e.plexUrl} jellyfinUrl={e.jellyfinUrl} />
                    </span>
                  }
                />
              ))}
            </div>
          )}
          {filtered.length > shown && (
            <p className="more">
              <button type="button" className="want" onClick={() => setShown((n) => n + PAGE)}>
                Mostrar mais ({filtered.length - shown})
              </button>
            </p>
          )}
        </section>
      )}
    </div>
  );
}
