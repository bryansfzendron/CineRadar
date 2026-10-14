// Detalhe de um item: sinopse, elenco, releases encontrados (com nota) e ações.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ExternalLink, RefreshCw, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { Release } from '../../../shared/types.ts';
import { api, backdropUrl, posterUrl } from '../api.ts';
import { formatSize, LANGUAGE_LABEL, STATUS_LABEL, timeAgo } from '../labels.ts';

export function DetailSheet({ id, onClose }: { id: number; onClose: () => void }) {
  const qc = useQueryClient();
  const dialog = useRef<HTMLDialogElement>(null);
  const detail = useQuery({ queryKey: ['item', id], queryFn: () => api.item(id), refetchInterval: 5_000 });
  const [showAll, setShowAll] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const d = dialog.current;
    if (d && !d.open) d.showModal();
    const onCancel = (e: Event) => {
      e.preventDefault();
      onClose();
    };
    d?.addEventListener('cancel', onCancel);
    return () => d?.removeEventListener('cancel', onCancel);
  }, [onClose]);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: ['item', id] });
    void qc.invalidateQueries({ queryKey: ['items'] });
  };

  const search = useMutation({ mutationFn: () => api.searchNow(id), onSuccess: () => (setMessage('Busca iniciada.'), refresh()) });
  const remove = useMutation({
    mutationFn: () => api.removeItem(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['items'] });
      onClose();
    },
  });
  const send = useMutation({
    mutationFn: (r: Release) => api.dispatch(id, r.id),
    onSuccess: (res) => (setMessage(`Enviado para o ${res.via}.`), refresh()),
    onError: (err) => setMessage(err instanceof Error ? err.message : 'Não foi possível enviar.'),
  });

  const item = detail.data;
  const releases = item?.releases ?? [];
  const visible = showAll ? releases : releases.filter((r) => r.language !== 'none').slice(0, 12);
  const hidden = releases.length - visible.length;

  return (
    <dialog ref={dialog} className="sheet" aria-labelledby="sheet-title" onClick={(e) => e.target === dialog.current && onClose()}>
      <div className="sheet-body">
        <button type="button" className="sheet-close" onClick={onClose} aria-label="Fechar">
          <X size={20} />
        </button>
        {!item ? (
          <div className="sheet-loading" aria-busy="true">
            {detail.error ? 'Não consegui carregar este título.' : 'Carregando…'}
          </div>
        ) : (
          <>
            <div className="sheet-hero" style={item.backdropPath ? { backgroundImage: `url(${backdropUrl(item.backdropPath)})` } : undefined}>
              <div className="sheet-hero-inner">
                {item.posterPath && <img className="sheet-poster" src={posterUrl(item.posterPath, 'w342')!} alt="" />}
                <div className="sheet-head">
                  <h2 id="sheet-title" className="sheet-title">{item.title}</h2>
                  <p className="sheet-meta">
                    {[item.year, item.originalTitle !== item.title ? item.originalTitle : null, item.genres.slice(0, 3).join(', '), item.runtime ? `${item.runtime} min` : null, item.rating ? `TMDB ${item.rating}` : null]
                      .filter(Boolean)
                      .map((m, i) => (
                        <span key={i}>{m}</span>
                      ))}
                  </p>
                  <p className={`sheet-status status-${item.status}`}>
                    <strong>{STATUS_LABEL[item.status]}</strong>
                    {item.statusDetail && <span>{item.statusDetail}</span>}
                  </p>
                  {item.status === 'downloading' && item.progress != null && (
                    <div className="meter" role="progressbar" aria-valuenow={Math.round(item.progress * 100)} aria-valuemin={0} aria-valuemax={100}>
                      <span style={{ width: `${item.progress * 100}%` }} />
                    </div>
                  )}
                  <div className="sheet-actions">
                    {item.plexUrl && (
                      <a className="btn btn-plex" href={item.plexUrl} target="_blank" rel="noreferrer">
                        Abrir no Plex <ExternalLink size={14} aria-hidden />
                      </a>
                    )}
                    {item.jellyfinUrl && (
                      <a className="btn btn-jelly" href={item.jellyfinUrl} target="_blank" rel="noreferrer">
                        Abrir no Jellyfin <ExternalLink size={14} aria-hidden />
                      </a>
                    )}
                    <button type="button" className="btn" onClick={() => search.mutate()} disabled={search.isPending || item.status === 'searching'}>
                      <RefreshCw size={14} aria-hidden className={item.status === 'searching' ? 'spin' : undefined} />
                      {item.status === 'searching' ? 'Buscando…' : 'Buscar agora'}
                    </button>
                    <button
                      type="button"
                      className="btn btn-quiet"
                      onClick={() => confirm(`Tirar "${item.title}" da lista? O que já foi baixado continua no Plex/Jellyfin.`) && remove.mutate()}
                    >
                      <Trash2 size={14} aria-hidden /> Tirar da lista
                    </button>
                  </div>
                  {message && (
                    <p className="sheet-message" role="status">
                      {message}
                    </p>
                  )}
                </div>
              </div>
            </div>

            <div className="sheet-content">
              {item.overview && <p className="overview">{item.overview}</p>}
              {item.cast.length > 0 && (
                <p className="cast">
                  <span className="muted">Elenco:</span> {item.cast.slice(0, 6).map((c) => c.name).join(', ')}
                </p>
              )}

              <section className="releases" aria-labelledby="rel-title">
                <h3 id="rel-title" className="section-title">
                  Versões encontradas
                  <span className="muted small">{item.lastSearchAt ? ` · última busca ${timeAgo(item.lastSearchAt)}` : ''}</span>
                </h3>
                {releases.length === 0 ? (
                  <p className="muted">Nenhuma ainda. A próxima busca automática acontece sozinha; use “Buscar agora” para não esperar.</p>
                ) : (
                  <ul className="release-list">
                    {visible.map((r) => (
                      <ReleaseRow key={r.id} r={r} busy={send.isPending && send.variables?.id === r.id} onSend={() => send.mutate(r)} />
                    ))}
                  </ul>
                )}
                {hidden > 0 && (
                  <button type="button" className="link" onClick={() => setShowAll(true)}>
                    Mostrar mais {hidden} (inclui versões sem português)
                  </button>
                )}
              </section>

              {item.events.length > 0 && (
                <section aria-labelledby="ev-title">
                  <h3 id="ev-title" className="section-title">
                    Histórico
                  </h3>
                  <ol className="timeline">
                    {item.events.slice(0, 12).map((e) => (
                      <li key={e.id} className={`ev ev-${e.kind}`}>
                        <time dateTime={e.at}>{new Date(e.at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}</time>
                        <span>{e.message}</span>
                      </li>
                    ))}
                  </ol>
                </section>
              )}
            </div>
          </>
        )}
      </div>
    </dialog>
  );
}

function ReleaseRow({ r, busy, onSend }: { r: Release; busy: boolean; onSend: () => void }) {
  return (
    <li className={`release ${r.status !== 'new' ? `release-${r.status}` : ''}`}>
      <div className="release-score" aria-label={`Nota ${r.score}`}>
        <span className="score-num">{r.score}</span>
        <span className="score-bar">
          <span style={{ width: `${r.score}%` }} />
        </span>
      </div>
      <div className="release-main">
        <p className="release-title" title={r.title}>
          {r.title}
        </p>
        <p className="release-meta">
          <span className={`lang lang-${r.language}`}>{LANGUAGE_LABEL[r.language]}</span>
          {r.resolution && <span>{r.resolution}p</span>}
          {r.season != null && <span>Temporada {r.season}</span>}
          <span>{formatSize(r.size)}</span>
          {r.seeders != null && <span>{r.seeders} seeders</span>}
          <span className="muted">{r.indexer || r.sourceName}</span>
        </p>
        {r.notes.length > 0 && r.status === 'new' && <p className="release-notes">{r.notes.join(' · ')}</p>}
        {r.status === 'failed' && <p className="release-notes error">{r.notes[r.notes.length - 1]}</p>}
      </div>
      <div className="release-action">
        {r.status === 'sent' ? (
          <span className="sent-mark">Enviado</span>
        ) : (
          <button type="button" className="btn btn-primary" onClick={onSend} disabled={busy}>
            {busy ? 'Enviando…' : 'Baixar esta'}
          </button>
        )}
      </div>
    </li>
  );
}
