// Filmes ou Séries: prateleiras por status, do que está acontecendo agora para o que já está em cartaz.

import { useSearchParams, Link } from 'react-router-dom';
import type { Item, ItemStatus, Kind } from '../../../shared/types.ts';
import { Poster } from '../components/PosterCard.tsx';

const SHELVES: { title: string; statuses: ItemStatus[]; hint: string }[] = [
  { title: 'Baixando', statuses: ['downloading', 'sent'], hint: 'Já foi para o Radarr/Sonarr; aparece em cartaz quando chegar ao Plex e ao Jellyfin.' },
  { title: 'Achados em português', statuses: ['found'], hint: 'Tem versão dublada ou dual, mas abaixo do seu limite automático. Abra para escolher.' },
  { title: 'Procurando', statuses: ['wanted', 'searching', 'error'], hint: 'Nada em português ainda. O CineRadar procura de novo sozinho.' },
  { title: 'Em cartaz', statuses: ['available'], hint: 'Pronto para assistir no Plex ou no Jellyfin.' },
];

export function Library({ kind, items, loading }: { kind: Kind; items: Item[] | undefined; loading: boolean }) {
  const [params, setParams] = useSearchParams();
  const mine = (items ?? []).filter((i) => i.kind === kind);
  const noun = kind === 'movie' ? 'filme' : 'série';

  const open = (id: number) => {
    params.set('item', String(id));
    setParams(params);
  };

  if (loading) return <div className="grid-skeleton" aria-busy="true" />;

  if (mine.length === 0) {
    return (
      <section className="empty">
        <h2 className="empty-title">Nenhum{kind === 'series' ? 'a' : ''} {noun} na lista ainda</h2>
        <p>
          Procure pelo nome em <Link to="/buscar">Buscar</Link> e marque <strong>Quero ver</strong>. O CineRadar procura versões
          dubladas e dual áudio e manda baixar quando achar uma boa.
        </p>
      </section>
    );
  }

  return (
    <div className="shelves">
      {SHELVES.map((shelf) => {
        const list = mine.filter((i) => shelf.statuses.includes(i.status));
        if (list.length === 0) return null;
        return (
          <section key={shelf.title} className="shelf" aria-labelledby={`shelf-${shelf.title}`}>
            <header className="shelf-head">
              <h2 id={`shelf-${shelf.title}`} className="shelf-title">
                {shelf.title} <span className="shelf-count">{list.length}</span>
              </h2>
              <p className="shelf-hint">{shelf.hint}</p>
            </header>
            <div className="grid">
              {list.map((item) => (
                <Poster
                  key={item.id}
                  onOpen={() => open(item.id)}
                  data={{
                    kind: item.kind,
                    title: item.title,
                    year: item.year,
                    posterPath: item.posterPath,
                    status: item.status,
                    statusDetail: item.statusDetail,
                    progress: item.progress,
                    language: item.status === 'available' ? null : item.bestLanguage,
                  }}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
