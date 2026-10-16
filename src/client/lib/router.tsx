import { createContext, useCallback, useContext, useEffect, useMemo, useState, type AnchorHTMLAttributes, type MouseEvent, type ReactNode } from 'react';

// Roteador mínimo baseado na History API (sem dependências externas).

interface Loc {
  pathname: string;
  search: string;
  hash: string;
}

interface RouterValue {
  location: Loc;
  navigate: (to: string, opts?: { replace?: boolean; scroll?: boolean }) => void;
}

const RouterCtx = createContext<RouterValue | null>(null);

const current = (): Loc => ({ pathname: window.location.pathname, search: window.location.search, hash: window.location.hash });

export function RouterProvider({ children }: { children: ReactNode }) {
  const [location, setLocation] = useState<Loc>(current);

  useEffect(() => {
    if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
    const onPop = () => setLocation(current());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const navigate = useCallback((to: string, opts: { replace?: boolean; scroll?: boolean } = {}) => {
    const url = new URL(to, window.location.origin);
    if (url.origin !== window.location.origin) {
      window.location.href = to;
      return;
    }
    const target = url.pathname + url.search + url.hash;
    if (opts.replace) history.replaceState(null, '', target);
    else history.pushState(null, '', target);
    setLocation(current());
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
  const set = useCallback(
    (next: URLSearchParams, opts: { replace?: boolean; scroll?: boolean } = {}) => {
      const qs = next.toString();
      navigate(location.pathname + (qs ? `?${qs}` : ''), { replace: opts.replace ?? true, scroll: opts.scroll ?? false });
    },
    [location.pathname, navigate],
  );
  return [params, set];
}

type LinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & { to: string; replace?: boolean };

export function Link({ to, replace, onClick, children, ...rest }: LinkProps) {
  const { navigate } = useRouter();
  const handle = (e: MouseEvent<HTMLAnchorElement>) => {
    onClick?.(e);
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || rest.target === '_blank') return;
    if (to.startsWith('http') || to.startsWith('/api/') || to.startsWith('mailto:') || to.startsWith('tel:')) return;
    e.preventDefault();
    navigate(to, { replace });
  };
  return (
    <a href={to} onClick={handle} {...rest}>
      {children}
    </a>
  );
}

/** Casa um padrão "/produto/:slug" com o caminho atual. */
export function matchPath(pattern: string, pathname: string): Record<string, string> | null {
  const keys: string[] = [];
  const re = new RegExp('^' + pattern.replace(/:([a-zA-Z]+)/g, (_, k: string) => { keys.push(k); return '([^/]+)'; }) + '/?$');
  const m = re.exec(pathname);
  if (!m) return null;
  const out: Record<string, string> = {};
  keys.forEach((k, i) => (out[k] = decodeURIComponent(m[i + 1] ?? '')));
  return out;
}
