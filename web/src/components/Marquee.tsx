// O quadro de programação: painel iluminado com letras encaixadas em trilhos, como nos cinemas de rua.

import type { Item } from '../../../shared/types.ts';

function Letters({ text, className }: { text: string; className?: string }) {
  return (
    <span className={`letters ${className ?? ''}`} aria-hidden="true">
      {[...text].map((ch, i) =>
        ch === ' ' ? (
          <span key={i} className="gap" />
        ) : (
          <span key={i} className="tile" style={{ ['--i' as string]: i }}>
            {ch}
          </span>
        ),
      )}
    </span>
  );
}

export function Marquee({ items }: { items: Item[] }) {
  const count = (fn: (i: Item) => boolean) => items.filter(fn).length;
  const showing = count((i) => i.status === 'available');
  const downloading = count((i) => i.status === 'downloading' || i.status === 'sent');
  const found = count((i) => i.status === 'found');
  const wanted = count((i) => i.status === 'wanted' || i.status === 'searching' || i.status === 'error');

  const line = [
    `${showing} em cartaz`,
    downloading ? `${downloading} baixando` : null,
    found ? `${found} ${found === 1 ? 'achado' : 'achados'}` : null,
    `${wanted} procurando`,
  ]
    .filter(Boolean)
    .join('  ');

  return (
    <div className="marquee" role="banner">
      <div className="marquee-board">
        <h1 className="marquee-title">
          <span className="sr-only">CineRadar</span>
          <Letters text="CINERADAR" className="big" />
        </h1>
        <p className="marquee-line">
          <span className="sr-only">{line}</span>
          <Letters text={line.toUpperCase()} />
        </p>
      </div>
    </div>
  );
}
