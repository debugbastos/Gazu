// Roteador por hash (#/caminho) — mesma interface de src/client/lib/router.tsx.
// Necessário porque a versão HTML é aberta como arquivo (file://), onde a History API não pode mudar o caminho.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from 'react';

interface Loc { pathname: string; search: string; hash: string }
interface RouterValue { location: Loc; navigate: (to: string, opts?: { replace?: boolean; scroll?: boolean }) => void }
const RouterCtx = createContext<RouterValue | null>(null);

let last: Loc = { pathname: '/', search: '', hash: '' };
function current(): Loc {
  const h = window.location.hash;
  if (!h.startsWith('#/')) return last; // âncoras comuns (#conteudo) não mudam a rota
  const url = new URL(h.slice(1), 'http://gazu.local');
  last = { pathname: url.pathname, search: url.search, hash: '' };
  return last;
}
export const hrefFor = (to: string): string => (/^(https?:|mailto:|tel:|#)/.test(to) ? to : `#${to}`);

export function RouterProvider({ children }: { children: ReactNode }) {
  const [location, setLocation] = useState<Loc>(current);
  useEffect(() => {
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
    const on = () => { const prev = last.pathname; const next = current(); setLocation({ ...next }); if (next.pathname !== prev) window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior }); };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const navigate = useCallback((to: string, opts: { replace?: boolean; scroll?: boolean } = {}) => {
    if (/^https?:/.test(to)) { window.location.href = to; return; }
    const target = `#${to}`;
    if (opts.replace) history.replaceState(null, '', target); else history.pushState(null, '', target);
    setLocation({ ...current() });
    if (opts.scroll !== false) window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, []);
  const value = useMemo(() => ({ location, navigate }), [location, navigate]);
  return <RouterCtx.Provider value={value}>{children}</RouterCtx.Provider>;
}

export function useRouter(): RouterValue {
  const v = useContext(RouterCtx);
  if (!v) throw new Error('useRouter fora do RouterProvider');
  return v;
}

export function useSearchParams(): [URLSearchParams, (next: URLSearchParams, opts?: { replace?: boolean; scroll?: boolean }) => void] {
  const { location, navigate } = useRouter();
  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const set = useCallback((next: URLSearchParams, opts: { replace?: boolean; scroll?: boolean } = {}) => {
    const qs = next.toString();
    navigate(location.pathname + (qs ? `?${qs}` : ''), { replace: opts.replace ?? true, scroll: opts.scroll ?? false });
  }, [location.pathname, navigate]);
  return [params, set];
}

type LinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & { to: string; replace?: boolean };
export function Link({ to, replace, onClick, children, ...rest }: LinkProps) {
  const { navigate } = useRouter();
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || rest.target === '_blank') return;
    if (/^(https?:|mailto:|tel:)/.test(to) || to.startsWith('/api/')) return;
    e.preventDefault();
    navigate(to, { replace });
  };
  return <a href={hrefFor(to)} onClick={handle} {...rest}>{children}</a>;
}

export function matchPath(pattern: string, pathname: string): Record<string, string> | null {
  const keys: string[] = [];
  const re = new RegExp('^' + pattern.replace(/:([a-zA-Z]+)/g, (_, k: string) => { keys.push(k); return '([^/]+)'; }) + '/?$');
  const m = re.exec(pathname);
  if (!m) return null;
  const out: Record<string, string> = {};
  keys.forEach((k, i) => (out[k] = decodeURIComponent(m[i + 1] ?? '')));
  return out;
}
