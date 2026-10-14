import { Film, Tv } from 'lucide-react';
import type { ItemStatus, Kind, ReleaseLanguage } from '../../../shared/types.ts';
import { posterUrl } from '../api.ts';
import { LANGUAGE_LABEL, STATUS_LABEL } from '../labels.ts';

export interface PosterData {
  kind: Kind;
  title: string;
  year: number | null;
  posterPath: string | null;
  status?: ItemStatus | null;
  statusDetail?: string | null;
  progress?: number | null;
  language?: ReleaseLanguage | null;
}

export function Poster({ data, onOpen, action }: { data: PosterData; onOpen?: () => void; action?: React.ReactNode }) {
  const src = posterUrl(data.posterPath);
  const status = data.status ?? null;
  const showLang = data.language && (data.language === 'dual' || data.language === 'dublado' || data.language === 'ptbr');
  const label = `${data.title}${data.year ? ` (${data.year})` : ''}${status ? ` — ${STATUS_LABEL[status]}` : ''}`;

  const art = (
    <span className="poster-art">
      {src ? (
        <img src={src} alt="" loading="lazy" decoding="async" />
      ) : (
        <span className="poster-blank">
          {data.kind === 'movie' ? <Film aria-hidden size={28} /> : <Tv aria-hidden size={28} />}
          <span>{data.title}</span>
        </span>
      )}
      {showLang && <span className={`tag tag-${data.language}`}>{LANGUAGE_LABEL[data.language!]}</span>}
      {status && (
        <span className={`strip strip-${status}`} title={data.statusDetail ?? undefined}>
          {status === 'downloading' && data.progress != null && (
            <span className="strip-fill" style={{ width: `${Math.round(data.progress * 100)}%` }} />
          )}
          <span className="strip-text">
            {status === 'downloading' && data.progress != null ? `Baixando ${Math.round(data.progress * 100)}%` : STATUS_LABEL[status]}
          </span>
        </span>
      )}
    </span>
  );

  return (
    <article className="poster">
      {onOpen ? (
        <button type="button" className="poster-hit" onClick={onOpen} aria-label={label}>
          {art}
        </button>
      ) : (
        art
      )}
      <div className="poster-caption">
        <h3 className="poster-title">{data.title}</h3>
        <span className="poster-year">{data.year ?? 'sem data'}</span>
      </div>
      {action}
    </article>
  );
}
