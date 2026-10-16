import { useCallback, useEffect, useRef, useState, type ReactNode, type TouchEvent } from 'react';
import type { ImageDTO, ProductCardDTO } from '../../../shared/types';
import { Link } from '../../lib/router';
import { Icon } from '../ui/Icon';
import { Dialog, Price } from '../ui/ui';

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Galeria da página de produto (Referência 2): imagem principal ao centro e faixa lateral
 * que "vaza" pela borda direita com contador 01 — 0N.
 * - Produto com várias fotos: a faixa mostra as fotos do produto (clique troca a principal).
 * - Produto com uma foto: a faixa mostra produtos relacionados, identificados como "Combine com"
 *   (não são inventados ângulos que não existem).
 */
export function Gallery({ images, name, index, onIndex, related = [] }: { images: ImageDTO[]; name: string; index: number; onIndex: (i: number) => void; related?: ProductCardDTO[] }) {
  const [zoom, setZoom] = useState(false);
  const touch = useRef<number | null>(null);
  const total = images.length;
  const current = images[Math.min(index, total - 1)];
  const go = useCallback((d: number) => { if (total > 1) onIndex((index + d + total) % total); }, [index, total, onIndex]);

  useEffect(() => {
    if (!zoom) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') go(1);
      if (e.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [zoom, go]);

  const onTouchStart = (e: TouchEvent) => { touch.current = e.touches[0]?.clientX ?? null; };
  const onTouchEnd = (e: TouchEvent) => {
    if (touch.current === null) return;
    const dx = (e.changedTouches[0]?.clientX ?? touch.current) - touch.current;
    if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1);
    touch.current = null;
  };

  if (!current) return <div className="pdp-media pdp-media--empty">Imagem indisponível</div>;

  return (
    <>
      <div className="pdp-media" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
        <button className="pdp-media__main" onClick={() => setZoom(true)} aria-label={`Ampliar imagem ${index + 1} de ${total} de ${name}`}>
          <img
            key={current.url}
            src={current.url}
            srcSet={current.srcset ?? undefined}
            sizes="(min-width: 1024px) 34vw, 100vw"
            alt={current.alt || name}
            width={current.width ?? undefined}
            height={current.height ?? undefined}
            fetchPriority="high"
            decoding="async"
          />
          <span className="pdp-media__zoom" aria-hidden="true"><Icon name="zoom" size={18} /></span>
        </button>
        {total > 1 ? (
          <div className="pdp-media__nav">
            <button onClick={() => go(-1)} aria-label="Imagem anterior"><Icon name="chevronLeft" size={18} /></button>
            <button onClick={() => go(1)} aria-label="Próxima imagem"><Icon name="chevronRight" size={18} /></button>
          </div>
        ) : null}
      </div>

      {total > 1 ? (
        <Strip label="Fotos do produto" count={total} active={index} onActive={onIndex}>
          {images.map((im, i) => (
            <li key={im.url + i}>
              <button className={`pdp-strip__tile${i === index ? ' is-active' : ''}`} onClick={() => onIndex(i)} aria-label={`Ver imagem ${i + 1} de ${total}`} aria-current={i === index ? 'true' : undefined}>
                <img src={im.url} alt="" loading="lazy" style={{ objectPosition: im.position }} />
              </button>
            </li>
          ))}
        </Strip>
      ) : related.length ? (
        <Strip label="Combine com" count={Math.min(related.length, 6)} visibleLabel>
          {related.slice(0, 6).map((r) => (
            <li key={r.id}>
              <Link to={`/produto/${r.slug}`} className="pdp-strip__tile pdp-strip__tile--product">
                {r.image ? <img src={r.image.url} alt="" loading="lazy" style={{ objectPosition: r.image.position }} /> : null}
                <span className="pdp-strip__caption"><span>{r.name}</span><Price cents={r.priceCents} promoCents={r.promoPriceCents} size="sm" /></span>
              </Link>
            </li>
          ))}
        </Strip>
      ) : null}

      <Dialog open={zoom} onClose={() => setZoom(false)} variant="fullscreen" labelledBy="lightbox-title" className="lightbox">
        <h2 id="lightbox-title" className="sr-only">{name} — imagem {index + 1} de {total}</h2>
        <button className="icon-btn lightbox__close" onClick={() => setZoom(false)} aria-label="Fechar visualização ampliada" data-autofocus><Icon name="close" /></button>
        <div className="lightbox__stage" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
          <img src={current.url} alt={current.alt || name} />
        </div>
        {total > 1 ? (
          <div className="lightbox__nav">
            <button className="icon-btn" onClick={() => go(-1)} aria-label="Imagem anterior"><Icon name="arrowLeft" /></button>
            <span>{index + 1} / {total}</span>
            <button className="icon-btn" onClick={() => go(1)} aria-label="Próxima imagem"><Icon name="arrowRight" /></button>
          </div>
        ) : null}
      </Dialog>
    </>
  );
}

/** Faixa lateral com rolagem horizontal e contador "01 —— 0N" sincronizado com a posição. */
function Strip({ label, count, active, onActive, visibleLabel, children }: { label: string; count: number; active?: number; onActive?: (i: number) => void; visibleLabel?: boolean; children: ReactNode }) {
  const list = useRef<HTMLUListElement | null>(null);
  const [pos, setPos] = useState(0);
  const current = active ?? pos;

  const onScroll = () => {
    const el = list.current;
    const first = el?.firstElementChild as HTMLElement | null;
    if (!el || !first) return;
    const step = first.getBoundingClientRect().width + parseFloat(getComputedStyle(el).columnGap || '0');
    setPos(Math.max(0, Math.min(count - 1, Math.round(el.scrollLeft / Math.max(1, step)))));
  };
  const scrollTo = (i: number) => {
    const el = list.current;
    const item = el?.children[i] as HTMLElement | undefined;
    if (!el || !item) return;
    el.scrollTo({ left: item.offsetLeft - el.offsetLeft, behavior: 'smooth' });
  };
  const step = (d: number) => {
    const next = Math.max(0, Math.min(count - 1, current + d));
    if (onActive) onActive(next);
    scrollTo(next);
  };
  useEffect(() => { if (active !== undefined) scrollTo(active); }, [active]);

  return (
    <div className="pdp-strip">
      {visibleLabel ? <p className="pdp-strip__label">{label}</p> : null}
      <ul className="pdp-strip__list" ref={list} onScroll={onScroll} aria-label={label}>{children}</ul>
      <div className="pdp-strip__count">
        <span aria-hidden="true">{pad(current + 1)}</span>
        <span className="pdp-strip__bar" aria-hidden="true"><span style={{ width: `${((current + 1) / count) * 100}%` }} /></span>
        <span aria-hidden="true">{pad(count)}</span>
        {count > 1 ? (
          <span className="pdp-strip__arrows">
            <button onClick={() => step(-1)} disabled={current <= 0} aria-label="Anterior"><Icon name="chevronLeft" size={16} /></button>
            <button onClick={() => step(1)} disabled={current >= count - 1} aria-label="Próximo"><Icon name="chevronRight" size={16} /></button>
          </span>
        ) : null}
      </div>
    </div>
  );
}
