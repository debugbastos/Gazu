import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { CartItemInput, MeDTO, PublicConfigDTO } from '../../shared/types';
import { api, errorMessage } from './api';
import { readJson, removeKey, writeJson } from './storage';

export interface Toast {
  id: number;
  message: string;
  tone: 'info' | 'success' | 'error';
  action?: { label: string; href: string };
}

interface StoreValue {
  config: PublicConfigDTO;
  user: MeDTO | null;
  userLoaded: boolean;
  refreshUser: () => Promise<MeDTO | null>;
  logout: () => Promise<void>;
  // carrinho
  cart: CartItemInput[];
  cartCount: number;
  addToCart: (variantId: number, quantity: number) => void;
  setCartQuantity: (variantId: number, quantity: number) => void;
  replaceCartVariant: (fromVariantId: number, toVariantId: number) => void;
  removeFromCart: (variantId: number) => void;
  clearCart: () => void;
  cartOpen: boolean;
  setCartOpen: (open: boolean) => void;
  // favoritos
  favorites: number[];
  isFavorite: (productId: number) => boolean;
  toggleFavorite: (productId: number, name?: string) => Promise<void>;
  // avisos
  toasts: Toast[];
  notify: (message: string, tone?: Toast['tone'], action?: Toast['action']) => void;
  dismiss: (id: number) => void;
  searchOpen: boolean;
  setSearchOpen: (open: boolean) => void;
}

const Ctx = createContext<StoreValue | null>(null);
const CART_KEY = 'gazu.cart.v1';
const FAV_KEY = 'gazu.favorites.v1';
const MAX_QTY = 20;

function bootConfig(): PublicConfigDTO {
  const el = document.getElementById('gazu-boot');
  const parsed = el?.textContent ? (JSON.parse(el.textContent) as { config: PublicConfigDTO }) : null;
  if (!parsed) throw new Error('Configuração inicial ausente');
  return parsed.config;
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [config] = useState<PublicConfigDTO>(bootConfig);
  const [user, setUser] = useState<MeDTO | null>(null);
  const [userLoaded, setUserLoaded] = useState(false);
  const [cart, setCart] = useState<CartItemInput[]>(() => readJson<CartItemInput[]>(CART_KEY, []));
  const [favorites, setFavorites] = useState<number[]>(() => readJson<number[]>(FAV_KEY, []));
  const [cartOpen, setCartOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);
  const syncTimer = useRef<number | null>(null);
  const userRef = useRef<MeDTO | null>(null);
  userRef.current = user;

  const notify = useCallback((message: string, tone: Toast['tone'] = 'info', action?: Toast['action']) => {
    const id = ++toastId.current;
    setToasts((t) => [...t.slice(-2), { id, message, tone, action }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === 'error' ? 7000 : 4200);
  }, []);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  // Persiste o carrinho: localmente (visitante) ou no servidor (cliente autenticado, com debounce).
  const persistCart = useCallback((items: CartItemInput[]) => {
    if (userRef.current) {
      if (syncTimer.current) window.clearTimeout(syncTimer.current);
      syncTimer.current = window.setTimeout(() => {
        api.put('/api/cart', { items }).catch(() => notify('Não foi possível sincronizar seu carrinho. Suas alterações continuam salvas neste dispositivo.', 'error'));
      }, 400);
      writeJson(CART_KEY, items);
    } else {
      writeJson(CART_KEY, items);
    }
  }, [notify]);

  const updateCart = useCallback((fn: (prev: CartItemInput[]) => CartItemInput[]) => {
    setCart((prev) => {
      const next = fn(prev).filter((i) => i.quantity > 0).map((i) => ({ ...i, quantity: Math.min(MAX_QTY, i.quantity) }));
      persistCart(next);
      return next;
    });
  }, [persistCart]);

  const afterLogin = useCallback(async (me: MeDTO) => {
    // Mescla carrinho e favoritos do visitante com os da conta (sem duplicar itens).
    try {
      const local = readJson<CartItemInput[]>(CART_KEY, []);
      const merged = await api.post<{ items: CartItemInput[] }>('/api/cart/merge', { items: local });
      setCart(merged.items);
      writeJson(CART_KEY, merged.items);
      const localFavs = readJson<number[]>(FAV_KEY, []);
      const favs = await api.post<{ ids: number[] }>('/api/favorites/merge', { ids: localFavs });
      setFavorites(favs.ids);
      writeJson(FAV_KEY, favs.ids);
    } catch (e) {
      notify(errorMessage(e), 'error');
    }
    void me;
  }, [notify]);

  const refreshUser = useCallback(async () => {
    try {
      const { user: me } = await api.get<{ user: MeDTO | null }>('/api/auth/me');
      const wasLogged = Boolean(userRef.current);
      setUser(me);
      userRef.current = me;
      if (me && !wasLogged) await afterLogin(me);
      return me;
    } catch {
      return null;
    } finally {
      setUserLoaded(true);
    }
  }, [afterLogin]);

  useEffect(() => { void refreshUser(); }, [refreshUser]);

  const logout = useCallback(async () => {
    try { await api.post('/api/auth/logout'); } catch { /* sessão já encerrada */ }
    setUser(null);
    userRef.current = null;
    setCart([]);
    setFavorites([]);
    removeKey(CART_KEY);
    removeKey(FAV_KEY);
    notify('Você saiu da sua conta.', 'info');
  }, [notify]);

  const addToCart = useCallback((variantId: number, quantity: number) => {
    updateCart((prev) => {
      const found = prev.find((i) => i.variantId === variantId);
      return found ? prev.map((i) => (i.variantId === variantId ? { ...i, quantity: i.quantity + quantity } : i)) : [...prev, { variantId, quantity }];
    });
  }, [updateCart]);
  const setCartQuantity = useCallback((variantId: number, quantity: number) => updateCart((prev) => prev.map((i) => (i.variantId === variantId ? { ...i, quantity } : i))), [updateCart]);
  const removeFromCart = useCallback((variantId: number) => updateCart((prev) => prev.filter((i) => i.variantId !== variantId)), [updateCart]);
  const replaceCartVariant = useCallback((from: number, to: number) => updateCart((prev) => {
    const fromItem = prev.find((i) => i.variantId === from);
    if (!fromItem) return prev;
    const rest = prev.filter((i) => i.variantId !== from);
    const existing = rest.find((i) => i.variantId === to);
    return existing ? rest.map((i) => (i.variantId === to ? { ...i, quantity: i.quantity + fromItem.quantity } : i)) : [...rest, { variantId: to, quantity: fromItem.quantity }];
  }), [updateCart]);
  const clearCart = useCallback(() => updateCart(() => []), [updateCart]);

  const isFavorite = useCallback((id: number) => favorites.includes(id), [favorites]);
  const toggleFavorite = useCallback(async (productId: number, name?: string) => {
    const on = !favorites.includes(productId);
    const next = on ? [productId, ...favorites] : favorites.filter((f) => f !== productId);
    setFavorites(next);
    writeJson(FAV_KEY, next);
    if (userRef.current) {
      try {
        if (on) await api.put(`/api/favorites/${productId}`);
        else await api.del(`/api/favorites/${productId}`);
      } catch (e) {
        setFavorites(favorites);
        writeJson(FAV_KEY, favorites);
        notify(errorMessage(e), 'error');
        return;
      }
    }
    notify(on ? `${name ?? 'Produto'} adicionado aos favoritos.` : `${name ?? 'Produto'} removido dos favoritos.`, 'success', on ? { label: 'Ver favoritos', href: '/favoritos' } : undefined);
  }, [favorites, notify]);

  const cartCount = cart.reduce((s, i) => s + i.quantity, 0);

  const value = useMemo<StoreValue>(() => ({
    config, user, userLoaded, refreshUser, logout,
    cart, cartCount, addToCart, setCartQuantity, replaceCartVariant, removeFromCart, clearCart, cartOpen, setCartOpen,
    favorites, isFavorite, toggleFavorite, toasts, notify, dismiss, searchOpen, setSearchOpen,
  }), [config, user, userLoaded, refreshUser, logout, cart, cartCount, addToCart, setCartQuantity, replaceCartVariant, removeFromCart, clearCart, cartOpen, favorites, isFavorite, toggleFavorite, toasts, notify, dismiss, searchOpen]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): StoreValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useStore fora do StoreProvider');
  return v;
}
