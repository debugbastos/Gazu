import { useEffect, useRef, useState } from 'react';
import type { CartItemInput, CartQuoteDTO, ShippingOptionDTO } from '../../shared/types';
import { api, errorMessage } from './api';

export type Quote = CartQuoteDTO & { shippingOptions: ShippingOptionDTO[]; shippingMessage: string | null; shippingConfigured: boolean };

/** Recalcula o carrinho no servidor sempre que os itens/cupom/frete mudam (com debounce e cancelamento). */
export function useCartQuote(items: CartItemInput[], opts: { couponCode?: string | null; cep?: string | null; shippingOptionId?: string | null; enabled?: boolean } = {}) {
  const [quote, setQuote] = useState<Quote | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const seq = useRef(0);
  const key = JSON.stringify([items, opts.couponCode ?? null, opts.cep ?? null, opts.shippingOptionId ?? null]);
  useEffect(() => {
    if (opts.enabled === false) return;
    const my = ++seq.current;
    setLoading(true);
    const t = window.setTimeout(() => {
      api.post<Quote>('/api/cart/quote', { items, couponCode: opts.couponCode || null, cep: opts.cep || null, shippingOptionId: opts.shippingOptionId || null })
        .then((q) => { if (my === seq.current) { setQuote(q); setError(null); } })
        .catch((e: unknown) => { if (my === seq.current) setError(errorMessage(e)); })
        .finally(() => { if (my === seq.current) setLoading(false); });
    }, 180);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, nonce, opts.enabled]);
  return { quote, loading, error, retry: () => setNonce((n) => n + 1) };
}
