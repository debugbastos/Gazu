import { useEffect, useRef, useState } from 'react';
import { Link } from '../../lib/router';
import { usePrefersReducedMotion } from '../../lib/hooks';
import { useStore } from '../../lib/store';
import { Icon } from '../ui/Icon';
import { HeroController, DEFAULT_TIMING } from './heroController';
import { asset } from '../../lib/asset';

// Os quatro modelos fornecidos pelo cliente (recortes sem distorção; ver docs/INVENTARIO-IMAGENS.md).
export const HERO_MODELS = [
  {
    key: 'male', label: 'Masculino', href: '/categoria/masculino', src: '/assets/hero/male/male-954.webp', w: 458, h: 954,
    alt: 'Modelo masculino adulto de suéter azul-acinzentado, cachecol de tricô e bolsa de couro',
    height: 90, fade: true,
  },
  {
    key: 'female', label: 'Feminino', href: '/categoria/feminino', src: '/assets/hero/female/female-1348.webp', w: 716, h: 1348,
    alt: 'Modelo feminina adulta de casaco marrom, camiseta branca, jeans destroyed e óculos escuros',
    height: 94, fade: true,
  },
  {
    key: 'boys', label: 'Menino', href: '/categoria/infantil-menino', src: '/assets/hero/boys/boy-874.webp', w: 390, h: 874,
    alt: 'Menino de camiseta verde estampada e bermuda off-white',
    height: 85, fade: true,
  },
  {
    key: 'girls', label: 'Menina', href: '/categoria/infantil-menina', src: '/assets/hero/girls/girl-1164.webp', w: 422, h: 1164,
    alt: 'Menina sorridente de vestido listrado em tons de rosa e tênis prateado',
    height: 84, fade: false,
  },
] as const;

export function Hero() {
  const { config } = useStore();
  const reduced = usePrefersReducedMotion();
  const layers = useRef<(HTMLDivElement | null)[]>([]);
  const ctrl = useRef<HeroController | null>(null);
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<'enter' | 'hold' | 'exit' | 'idle'>('enter');
  const [paused, setPaused] = useState(false);
  const [announce, setAnnounce] = useState('');
  const [cycle, setCycle] = useState(0);

  useEffect(() => {
    const els = layers.current.filter((x): x is HTMLDivElement => Boolean(x));
    const c = new HeroController(els, {
      reducedMotion: reduced,
      timing: DEFAULT_TIMING,
      onChange: (i) => setIndex(i),
      onPhase: (p) => { setPhase(p); if (p === 'hold') setCycle((n) => n + 1); },
    });
    ctrl.current = c;
    void c.start();
    if (reduced) setPaused(true);
    return () => { c.destroy(); ctrl.current = null; };
  }, [reduced]);

  const manual = (fn: (c: HeroController) => void, label?: string) => {
    if (!ctrl.current) return;
    fn(ctrl.current);
    if (label) setAnnounce(label);
  };
  const togglePause = () => {
    const c = ctrl.current;
    if (!c) return;
    if (paused) { c.resume(); setPaused(false); } else { c.pause(); setPaused(true); }
  };

  const tagline = config.settings.heroTagline;
  const collection = config.settings.heroCollectionLabel;
  const active = HERO_MODELS[index]!;
  const total = HERO_MODELS.length;

  return (
    <section className="hero" aria-roledescription="carrossel" aria-label="Coleção GAZU — modelos em destaque">
      <div className="hero__stage">
        <p className="hero__tagline">
          {tagline.map((l, i) => <span key={i}>{l}</span>)}
          <span className="rule" aria-hidden="true" />
        </p>

        <h1 className="hero__word">
          <span aria-hidden="true">GAZU</span>
          <span className="sr-only">GAZU — moda masculina, feminina e infantil, tênis e acessórios</span>
        </h1>

        <div className="hero__models">
          {HERO_MODELS.map((m, i) => (
            <figure
              key={m.key}
              className={`hero-model hero-model--${m.key}${m.fade ? ' hero-model--fade' : ''}`}
              style={{ ['--h' as string]: `${m.height}%`, ['--ratio' as string]: `${m.w} / ${m.h}` }}
              aria-hidden={i === index ? undefined : true}
              role="group"
              aria-roledescription="slide"
              aria-label={`${i + 1} de ${total}: ${m.label}`}
            >
              <div className="hero-model__layer" ref={(el) => { layers.current[i] = el; }} style={{ visibility: 'hidden' }}>
                <img
                  src={asset(m.src)}
                  width={m.w}
                  height={m.h}
                  alt={m.alt}
                  decoding="async"
                  loading={i === 0 ? 'eager' : 'lazy'}
                  fetchPriority={i === 0 ? 'high' : 'low'}
                  draggable={false}
                />
              </div>
            </figure>
          ))}
        </div>

        <div className="hero__ctas">
          <Link to={active.href} className="btn btn--primary btn--lg hero__shop">Comprar agora</Link>
          <Link to="/categoria/novidades" className="link-underline">Ver novidades</Link>
        </div>

        <p className="hero__collection">
          {collection.map((l, i) => <span key={i}>{l}</span>)}
          <span className="rule" aria-hidden="true" />
        </p>

        <div className="hero__controls">
          <button className="hero__arrow" onClick={() => manual((c) => c.prev(), `Mostrando ${HERO_MODELS[(index - 1 + total) % total]!.label}`)} aria-label="Modelo anterior"><Icon name="chevronLeft" size={18} /></button>
          <ol className="hero__dots">
            {HERO_MODELS.map((m, i) => (
              <li key={m.key}>
                <button
                  className={`hero__dot${i === index ? ' is-active' : ''}`}
                  onClick={() => manual((c) => c.goTo(i, i > index ? 1 : -1), `Mostrando ${m.label}`)}
                  aria-label={`${m.label} (${i + 1} de ${total})`}
                  aria-current={i === index ? 'true' : undefined}
                >
                  <span className="hero__dot-fill" key={i === index ? `${cycle}-${phase}` : 'idle'} data-phase={i === index ? phase : 'idle'} style={{ animationDuration: `${DEFAULT_TIMING.holdMs}ms` }} />
                </button>
              </li>
            ))}
          </ol>
          <span className="hero__count" aria-hidden="true">{String(index + 1).padStart(2, '0')} / {String(total).padStart(2, '0')}</span>
          <button className="hero__arrow" onClick={() => manual((c) => c.next(), `Mostrando ${HERO_MODELS[(index + 1) % total]!.label}`)} aria-label="Próximo modelo"><Icon name="chevronRight" size={18} /></button>
          <button className="hero__arrow" onClick={togglePause} aria-pressed={paused} aria-label={paused ? 'Retomar animação' : 'Pausar animação'}>
            <Icon name={paused ? 'play' : 'pause'} size={16} />
          </button>
        </div>
        <p className="sr-only" aria-live="polite">{announce}</p>
      </div>
    </section>
  );
}
