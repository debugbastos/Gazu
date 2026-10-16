import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { Link } from '../../lib/router';
import { useBodyLock } from '../../lib/hooks';
import { useStore } from '../../lib/store';
import { formatPrice } from '../../../shared/format';
import type { BreadcrumbDTO } from '../../../shared/types';
import { Icon, type IconName } from './Icon';

// ---------- Botões ----------
type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'link' | 'danger'; size?: 'sm' | 'md' | 'lg'; loading?: boolean; icon?: IconName; block?: boolean };

export function Button({ variant = 'primary', size = 'md', loading, icon, block, className, children, disabled, ...rest }: BtnProps) {
  return (
    <button
      className={`btn btn--${variant} btn--${size}${block ? ' btn--block' : ''}${loading ? ' is-loading' : ''} ${className ?? ''}`}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <span className="spinner" aria-hidden="true" /> : null}
      <span className="btn__label">{children}</span>
      {icon && !loading ? <Icon name={icon} size={18} /> : null}
    </button>
  );
}

export function ButtonLink({ to, variant = 'primary', size = 'md', className, children, icon }: { to: string; variant?: BtnProps['variant']; size?: BtnProps['size']; className?: string; children: ReactNode; icon?: IconName }) {
  return (
    <Link to={to} className={`btn btn--${variant} btn--${size} ${className ?? ''}`}>
      <span className="btn__label">{children}</span>
      {icon ? <Icon name={icon} size={18} /> : null}
    </Link>
  );
}

// ---------- Campos de formulário ----------
interface FieldBase { label: string; error?: string | null; hint?: ReactNode; optional?: boolean }

export function Field({ label, error, hint, optional, id, className, ...rest }: FieldBase & InputHTMLAttributes<HTMLInputElement>) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <div className={`field${error ? ' has-error' : ''} ${className ?? ''}`}>
      <label htmlFor={fid}>
        {label}
        {optional ? <span className="field__opt"> (opcional)</span> : null}
      </label>
      <input id={fid} aria-invalid={error ? true : undefined} aria-describedby={error ? `${fid}-err` : hint ? `${fid}-hint` : undefined} {...rest} />
      {hint && !error ? <p className="field__hint" id={`${fid}-hint`}>{hint}</p> : null}
      {error ? <p className="field__error" id={`${fid}-err`} role="alert">{error}</p> : null}
    </div>
  );
}

export function SelectField({ label, error, hint, id, children, className, ...rest }: FieldBase & SelectHTMLAttributes<HTMLSelectElement>) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <div className={`field${error ? ' has-error' : ''} ${className ?? ''}`}>
      <label htmlFor={fid}>{label}</label>
      <div className="select">
        <select id={fid} aria-invalid={error ? true : undefined} {...rest}>{children}</select>
        <Icon name="chevronDown" size={16} />
      </div>
      {hint && !error ? <p className="field__hint">{hint}</p> : null}
      {error ? <p className="field__error" role="alert">{error}</p> : null}
    </div>
  );
}

export function TextareaField({ label, error, id, className, ...rest }: FieldBase & TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <div className={`field${error ? ' has-error' : ''} ${className ?? ''}`}>
      <label htmlFor={fid}>{label}</label>
      <textarea id={fid} aria-invalid={error ? true : undefined} {...rest} />
      {error ? <p className="field__error" role="alert">{error}</p> : null}
    </div>
  );
}

export function Checkbox({ label, checked, onChange, id, disabled }: { label: ReactNode; checked: boolean; onChange: (v: boolean) => void; id?: string; disabled?: boolean }) {
  const auto = useId();
  return (
    <label className="checkbox" htmlFor={id ?? auto}>
      <input id={id ?? auto} type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="checkbox__box" aria-hidden="true"><Icon name="check" size={14} /></span>
      <span>{label}</span>
    </label>
  );
}

// ---------- Preço ----------
export function Price({ cents, promoCents, className, size = 'md' }: { cents: number; promoCents?: number | null; className?: string; size?: 'sm' | 'md' | 'lg' }) {
  const promo = promoCents && promoCents < cents ? promoCents : null;
  return (
    <span className={`price price--${size} ${className ?? ''}`}>
      {promo ? (
        <>
          <span className="price__now">{formatPrice(promo)}</span>
          <s className="price__was" aria-label={`Preço anterior ${formatPrice(cents)}`}>{formatPrice(cents)}</s>
        </>
      ) : (
        <span className="price__now">{formatPrice(cents)}</span>
      )}
    </span>
  );
}

export function DemoTag({ children = 'Demonstração' }: { children?: ReactNode }) {
  return <span className="demo-tag" title="Preço, estoque e dados ilustrativos — não representam oferta real">{children}</span>;
}

// ---------- Navegação ----------
export function Breadcrumbs({ items }: { items: BreadcrumbDTO[] }) {
  return (
    <nav className="breadcrumbs" aria-label="Você está em">
      <ol>
        {items.map((b, i) => (
          <li key={b.href + i}>
            {i < items.length - 1 ? <Link to={b.href}>{b.name}</Link> : <span aria-current="page">{b.name}</span>}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function Pagination({ page, pages, onPage }: { page: number; pages: number; onPage: (p: number) => void }) {
  if (pages <= 1) return null;
  const nums: (number | '…')[] = [];
  for (let i = 1; i <= pages; i++) {
    if (i === 1 || i === pages || Math.abs(i - page) <= 1) nums.push(i);
    else if (nums[nums.length - 1] !== '…') nums.push('…');
  }
  return (
    <nav className="pagination" aria-label="Paginação">
      <button className="pagination__arrow" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Página anterior"><Icon name="arrowLeft" size={18} /></button>
      {nums.map((n, i) => n === '…' ? <span key={`e${i}`} className="pagination__gap">…</span> : (
        <button key={n} className={`pagination__num${n === page ? ' is-active' : ''}`} aria-current={n === page ? 'page' : undefined} onClick={() => onPage(n)}>{String(n).padStart(2, '0')}</button>
      ))}
      <button className="pagination__arrow" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Próxima página"><Icon name="arrowRight" size={18} /></button>
    </nav>
  );
}

// ---------- Estados ----------
export function Loading({ label = 'Carregando…', inline }: { label?: string; inline?: boolean }) {
  return (
    <div className={`state state--loading${inline ? ' state--inline' : ''}`} role="status" aria-live="polite">
      <span className="spinner spinner--dark" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function EmptyState({ title, text, action }: { title: string; text?: ReactNode; action?: ReactNode }) {
  return (
    <div className="state state--empty">
      <p className="state__title">{title}</p>
      {text ? <p className="state__text">{text}</p> : null}
      {action}
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="state state--error" role="alert">
      <Icon name="alert" size={22} />
      <p className="state__title">Algo não saiu como esperado</p>
      <p className="state__text">{message}</p>
      {onRetry ? <Button variant="secondary" size="sm" onClick={onRetry}>Tentar novamente</Button> : null}
    </div>
  );
}

export function Notice({ tone = 'info', children, title }: { tone?: 'info' | 'warning' | 'success' | 'error'; children: ReactNode; title?: string }) {
  return (
    <div className={`notice notice--${tone}`} role={tone === 'error' ? 'alert' : 'note'}>
      <Icon name={tone === 'success' ? 'check' : tone === 'info' ? 'info' : 'alert'} size={18} />
      <div>
        {title ? <strong>{title}</strong> : null}
        <div>{children}</div>
      </div>
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <span className={`skeleton ${className ?? ''}`} aria-hidden="true" />;
}

// ---------- Acordeão ----------
export function Accordion({ title, children, defaultOpen }: { title: string; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(Boolean(defaultOpen));
  const id = useId();
  return (
    <div className={`accordion${open ? ' is-open' : ''}`}>
      <h3>
        <button aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
          <span>{title}</span>
          <Icon name={open ? 'minus' : 'plus'} size={18} />
        </button>
      </h3>
      <div id={id} className="accordion__panel" hidden={!open}>{children}</div>
    </div>
  );
}

// ---------- Modal / gaveta acessível ----------
export function Dialog({ open, onClose, title, children, variant = 'modal', labelledBy, className }: { open: boolean; onClose: () => void; title?: string; children: ReactNode; variant?: 'modal' | 'drawer-right' | 'drawer-left' | 'fullscreen'; labelledBy?: string; className?: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const lastFocus = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(false);
  useBodyLock(open);

  useEffect(() => {
    if (open) {
      setMounted(true);
      lastFocus.current = document.activeElement as HTMLElement;
      const raf = requestAnimationFrame(() => setVisible(true));
      return () => cancelAnimationFrame(raf);
    }
    setVisible(false);
    const t = window.setTimeout(() => setMounted(false), 320);
    lastFocus.current?.focus?.();
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open || !visible) return;
    const el = ref.current;
    const focusables = () => Array.from(el?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea, [tabindex]:not([tabindex="-1"])') ?? []);
    const first = el?.querySelector<HTMLElement>('[data-autofocus]') ?? focusables()[0];
    first?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
      if (e.key === 'Tab') {
        const f = focusables();
        if (!f.length) return;
        const a = f[0]!, b = f[f.length - 1]!;
        if (e.shiftKey && document.activeElement === a) { e.preventDefault(); b.focus(); }
        else if (!e.shiftKey && document.activeElement === b) { e.preventDefault(); a.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, visible, onClose]);

  if (!mounted) return null;
  return (
    <div className={`dialog dialog--${variant}${visible ? ' is-visible' : ''} ${className ?? ''}`}>
      <div className="dialog__backdrop" onClick={onClose} aria-hidden="true" />
      <div className="dialog__panel" role="dialog" aria-modal="true" aria-labelledby={labelledBy ?? (title ? titleId : undefined)} ref={ref}>
        {title ? (
          <div className="dialog__head">
            <h2 id={titleId}>{title}</h2>
            <button className="icon-btn" onClick={onClose} aria-label="Fechar"><Icon name="close" /></button>
          </div>
        ) : null}
        {children}
      </div>
    </div>
  );
}

// ---------- Avisos (toasts) ----------
export function Toasts() {
  const { toasts, dismiss } = useStore();
  return (
    <div className="toasts" aria-live="polite" aria-atomic="false">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast--${t.tone}`} role={t.tone === 'error' ? 'alert' : 'status'}>
          <Icon name={t.tone === 'error' ? 'alert' : t.tone === 'success' ? 'check' : 'info'} size={18} />
          <span className="toast__msg">{t.message}</span>
          {t.action ? <Link className="toast__action" to={t.action.href} onClick={() => dismiss(t.id)}>{t.action.label}</Link> : null}
          <button className="toast__close" onClick={() => dismiss(t.id)} aria-label="Fechar aviso"><Icon name="close" size={16} /></button>
        </div>
      ))}
    </div>
  );
}

export function SectionTitle({ eyebrow, title, action }: { eyebrow?: string; title: string; action?: ReactNode }) {
  return (
    <div className="section-title">
      <div>
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h2>{title}</h2>
      </div>
      {action}
    </div>
  );
}
