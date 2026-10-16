// Controlador da timeline do hero (Web Animations API).
// Uma única linha do tempo: um timer por vez, animações anteriores canceladas antes de novas,
// fila para cliques rápidos e pausa automática quando a aba fica oculta.

export interface HeroTiming {
  enterMs: number;
  holdMs: number;
  exitMs: number;
  /** Fração da saída após a qual o próximo modelo começa a entrar (evita palco vazio). */
  overlap: number;
}

export const DEFAULT_TIMING: HeroTiming = { enterMs: 1100, holdMs: 3000, exitMs: 800, overlap: 0.45 };

type Phase = 'enter' | 'hold' | 'exit' | 'idle';

export interface HeroControllerOptions {
  timing?: HeroTiming;
  reducedMotion: boolean;
  onChange: (index: number) => void;
  onPhase?: (phase: Phase, index: number) => void;
}

const EASE_OUT = 'cubic-bezier(0.16, 1, 0.3, 1)';
const EASE_IN = 'cubic-bezier(0.55, 0, 0.75, 0.2)';

export class HeroController {
  private index = 0;
  private timer: number | null = null;
  private running: Animation[] = [];
  private busy = false;
  private queued: { index: number; dir: 1 | -1 } | null = null;
  private userPaused = false;
  private hiddenPaused = false;
  private destroyed = false;
  private readonly timing: HeroTiming;

  constructor(private readonly layers: HTMLElement[], private readonly opts: HeroControllerOptions) {
    this.timing = opts.timing ?? DEFAULT_TIMING;
    for (const l of layers) l.style.opacity = '0';
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  get current(): number { return this.index; }
  get isPaused(): boolean { return this.userPaused || this.opts.reducedMotion; }

  async start(): Promise<void> {
    const first = this.layers[0];
    if (!first) return;
    await this.ready(0);
    if (this.destroyed) return;
    this.busy = true;
    this.opts.onPhase?.('enter', 0);
    await this.enter(first);
    this.busy = false;
    this.afterEnter();
  }

  next(): void { this.goTo((this.index + 1) % this.layers.length, 1); }
  prev(): void { this.goTo((this.index - 1 + this.layers.length) % this.layers.length, -1); }

  goTo(target: number, dir: 1 | -1 = 1): void {
    if (this.destroyed || target === this.index && !this.busy) return;
    if (this.busy) { this.queued = { index: target, dir }; return; }
    void this.transition(target, dir);
  }

  pause(): void {
    this.userPaused = true;
    this.clearTimer();
    this.opts.onPhase?.('idle', this.index);
  }

  resume(): void {
    this.userPaused = false;
    if (!this.busy) this.scheduleNext();
  }

  destroy(): void {
    this.destroyed = true;
    this.clearTimer();
    for (const a of this.running) a.cancel();
    this.running = [];
    document.removeEventListener('visibilitychange', this.onVisibility);
  }

  private onVisibility = (): void => {
    if (document.hidden) {
      this.hiddenPaused = true;
      this.clearTimer();
    } else if (this.hiddenPaused) {
      this.hiddenPaused = false;
      if (!this.busy) this.scheduleNext();
    }
  };

  private clearTimer(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
  }

  private scheduleNext(): void {
    this.clearTimer();
    if (this.userPaused || this.hiddenPaused || this.opts.reducedMotion || this.destroyed || this.layers.length < 2) {
      this.opts.onPhase?.('idle', this.index);
      return;
    }
    this.opts.onPhase?.('hold', this.index);
    this.timer = window.setTimeout(() => this.next(), this.timing.holdMs);
  }

  private afterEnter(): void {
    if (this.queued && this.queued.index !== this.index) {
      const q = this.queued;
      this.queued = null;
      void this.transition(q.index, q.dir);
      return;
    }
    this.queued = null;
    this.scheduleNext();
  }

  /** Garante que a próxima imagem esteja decodificada antes de animar (sem "piscar"). */
  private async ready(i: number): Promise<void> {
    const img = this.layers[i]?.querySelector('img');
    if (!img) return;
    if (img.loading === 'lazy') img.loading = 'eager';
    try {
      if (!img.complete) await new Promise<void>((res) => { img.addEventListener('load', () => res(), { once: true }); img.addEventListener('error', () => res(), { once: true }); });
      await img.decode?.();
    } catch { /* imagem com erro: segue sem travar a sequência */ }
  }

  private track(a: Animation): Promise<void> {
    this.running.push(a);
    return a.finished.then(() => { this.running = this.running.filter((x) => x !== a); }, () => { this.running = this.running.filter((x) => x !== a); });
  }

  private enter(el: HTMLElement): Promise<void> {
    el.style.visibility = 'visible';
    const reduced = this.opts.reducedMotion;
    const a = el.animate(
      reduced
        ? [{ opacity: 0 }, { opacity: 1 }]
        : [{ opacity: 0, transform: 'translate3d(0, 9%, 0)' }, { opacity: 1, offset: 0.55 }, { opacity: 1, transform: 'translate3d(0, 0, 0)' }],
      { duration: reduced ? 220 : this.timing.enterMs, easing: EASE_OUT, fill: 'forwards' },
    );
    return this.track(a).then(() => { el.style.opacity = '1'; el.style.transform = 'none'; a.cancel(); });
  }

  private exit(el: HTMLElement, dir: 1 | -1): Promise<void> {
    const reduced = this.opts.reducedMotion;
    const a = el.animate(
      reduced
        ? [{ opacity: 1 }, { opacity: 0 }]
        : [{ opacity: 1, transform: 'translate3d(0, 0, 0)' }, { opacity: 0, transform: `translate3d(${dir === 1 ? '-14%' : '14%'}, 0, 0)` }],
      { duration: reduced ? 200 : this.timing.exitMs, easing: EASE_IN, fill: 'forwards' },
    );
    return this.track(a).then(() => { el.style.opacity = '0'; el.style.transform = 'none'; el.style.visibility = 'hidden'; a.cancel(); });
  }

  private async transition(target: number, dir: 1 | -1): Promise<void> {
    const from = this.layers[this.index];
    const to = this.layers[target];
    if (!from || !to) return;
    this.busy = true;
    this.clearTimer();
    await this.ready(target);
    if (this.destroyed) return;
    this.opts.onPhase?.('exit', this.index);
    const exitDone = this.exit(from, dir);
    const startNext = this.opts.reducedMotion ? exitDone : new Promise<void>((r) => window.setTimeout(r, this.timing.exitMs * this.timing.overlap));
    await startNext;
    if (this.destroyed) return;
    this.index = target;
    this.opts.onChange(target);
    this.opts.onPhase?.('enter', target);
    await Promise.all([exitDone, this.enter(to)]);
    if (this.destroyed) return;
    this.busy = false;
    // pré-carrega o seguinte
    void this.ready((target + 1) % this.layers.length);
    this.afterEnter();
  }
}
