import { useState, type FormEvent, type ReactNode } from 'react';
import { useDocumentTitle } from '../lib/hooks';
import { Link } from '../lib/router';
import { useStore } from '../lib/store';
import { useCartQuote, type Quote } from '../lib/useCartQuote';
import { formatCep, formatPrice, onlyDigits } from '../../shared/format';
import { CartLine } from '../components/cart/CartLine';
import { Breadcrumbs, Button, ButtonLink, EmptyState, ErrorState, Loading, Notice } from '../components/ui/ui';

const SS_KEY = 'gazu.checkout.prefs';
export interface CheckoutPrefs { couponCode: string; cep: string; shippingOptionId: string }
export const readPrefs = (): CheckoutPrefs => {
  try { return { couponCode: '', cep: '', shippingOptionId: '', ...JSON.parse(sessionStorage.getItem(SS_KEY) ?? '{}') }; } catch { return { couponCode: '', cep: '', shippingOptionId: '' }; }
};
export const writePrefs = (p: CheckoutPrefs) => { try { sessionStorage.setItem(SS_KEY, JSON.stringify(p)); } catch { /* ignorado */ } };

export function OrderSummary({ quote, children, title = 'Resumo' }: { quote: Quote; children?: ReactNode; title?: string }) {
  return (
    <div className="summary">
      <h2 className="summary__title">{title}</h2>
      <div className="summary-row"><span>Subtotal ({quote.itemCount} {quote.itemCount === 1 ? 'item' : 'itens'})</span><span>{formatPrice(quote.subtotalCents)}</span></div>
      {quote.discountCents > 0 ? <div className="summary-row summary-row--discount"><span>Desconto {quote.coupon ? `(${quote.coupon.code})` : ''}</span><span>− {formatPrice(quote.discountCents)}</span></div> : null}
      <div className="summary-row"><span>Entrega{quote.shipping?.isDemo ? ' (simulação)' : ''}</span><span>{quote.shipping ? (quote.shippingCents === 0 ? 'Grátis' : formatPrice(quote.shippingCents)) : 'Calcular'}</span></div>
      <div className="summary-row summary-row--total"><span>Total {quote.shipping ? '' : 'estimado'}</span><strong>{formatPrice(quote.totalCents)}</strong></div>
      {children}
    </div>
  );
}

export function CouponForm({ code, onApply, result }: { code: string; onApply: (c: string) => void; result: Quote['coupon'] }) {
  const [v, setV] = useState(code);
  const submit = (e: FormEvent) => { e.preventDefault(); onApply(v.trim().toUpperCase()); };
  return (
    <form className="inline-form" onSubmit={submit}>
      <label htmlFor="coupon">Cupom de desconto</label>
      <div className="inline-form__row">
        <input id="coupon" value={v} onChange={(e) => setV(e.target.value.toUpperCase())} placeholder="Código" maxLength={40} autoComplete="off" />
        {code ? <Button type="button" variant="secondary" size="sm" onClick={() => { setV(''); onApply(''); }}>Remover</Button> : <Button variant="secondary" size="sm">Aplicar</Button>}
      </div>
      {result ? <p className={result.valid ? 'field__ok' : 'field__error'} role={result.valid ? 'status' : 'alert'}>{result.message}{result.valid ? ` −${formatPrice(result.discountCents)}` : ''}</p> : null}
    </form>
  );
}

export function ShippingPicker({ cep, onCep, quote, selected, onSelect, cepEditable = true }: { cep: string; onCep: (c: string) => void; quote: Quote | null; selected: string; onSelect: (id: string) => void; cepEditable?: boolean }) {
  const [v, setV] = useState(cep);
  const [err, setErr] = useState<string | null>(null);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (onlyDigits(v).length !== 8) { setErr('Informe um CEP com 8 dígitos.'); return; }
    setErr(null);
    onCep(onlyDigits(v));
  };
  return (
    <div className="ship-picker">
      {cepEditable ? (
        <form className="inline-form" onSubmit={submit}>
          <label htmlFor="cart-cep">Entrega</label>
          <div className="inline-form__row">
            <input id="cart-cep" inputMode="numeric" autoComplete="postal-code" placeholder="CEP" value={formatCep(v)} onChange={(e) => setV(e.target.value)} maxLength={9} />
            <Button variant="secondary" size="sm">Calcular</Button>
          </div>
          {err ? <p className="field__error" role="alert">{err}</p> : null}
        </form>
      ) : null}
      {cep && quote ? (
        <>
          {quote.shippingMessage ? <p className={quote.shippingOptions.length ? 'muted small' : 'field__error'}>{quote.shippingMessage}</p> : null}
          {quote.shippingOptions.length ? (
            <fieldset className="ship-options">
              <legend className="sr-only">Opções de entrega</legend>
              {quote.shippingOptions.map((o) => (
                <label key={o.id} className={`ship-option${selected === o.id ? ' is-selected' : ''}`}>
                  <input type="radio" name="ship" value={o.id} checked={selected === o.id} onChange={() => onSelect(o.id)} />
                  <span className="ship-option__text"><strong>{o.label}</strong><small>{o.minDays === o.maxDays ? `${o.maxDays} dias úteis` : `${o.minDays} a ${o.maxDays} dias úteis`}{o.note ? ` · ${o.note}` : ''}</small></span>
                  <span className="ship-option__price">{o.priceCents === 0 ? 'Grátis' : formatPrice(o.priceCents)}</span>
                </label>
              ))}
            </fieldset>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

export function CartPage() {
  useDocumentTitle('Sacola');
  const { cart, clearCart } = useStore();
  const [prefs, setPrefs] = useState<CheckoutPrefs>(readPrefs);
  const update = (p: Partial<CheckoutPrefs>) => { const n = { ...prefs, ...p }; setPrefs(n); writePrefs(n); };
  const { quote, loading, error, retry } = useCartQuote(cart, { couponCode: prefs.couponCode, cep: prefs.cep, shippingOptionId: prefs.shippingOptionId });

  return (
    <div className="cart-page container">
      <Breadcrumbs items={[{ name: 'Início', href: '/' }, { name: 'Sacola', href: '/carrinho' }]} />
      <h1 className="page-title">Sacola</h1>
      {cart.length === 0 ? (
        <EmptyState title="Sua sacola está vazia" text="Quando você adicionar produtos, eles aparecerão aqui." action={<ButtonLink to="/categoria/novidades">Ver novidades</ButtonLink>} />
      ) : error && !quote ? (
        <ErrorState message={error} onRetry={retry} />
      ) : !quote ? (
        <Loading />
      ) : (
        <div className="two-col">
          <section aria-label="Itens da sacola">
            {quote.lines.length < cart.length ? <Notice tone="warning">Alguns itens não existem mais e foram removidos do cálculo.</Notice> : null}
            <ul className="cart-lines cart-lines--page" aria-busy={loading}>
              {quote.lines.map((l) => <CartLine key={l.variantId} line={l} editableVariant />)}
            </ul>
            <div className="cart-page__after">
              <Link to="/categoria/novidades" className="link-underline">Continuar comprando</Link>
              <button className="link-btn" onClick={clearCart}>Esvaziar sacola</button>
            </div>
          </section>
          <aside className="two-col__side">
            <OrderSummary quote={quote}>
              <CouponForm code={prefs.couponCode} onApply={(c) => update({ couponCode: c })} result={quote.coupon} />
              <ShippingPicker cep={prefs.cep} onCep={(c) => update({ cep: c, shippingOptionId: '' })} quote={quote} selected={prefs.shippingOptionId} onSelect={(id) => update({ shippingOptionId: id })} />
              {quote.hasIssues ? <Notice tone="error">Ajuste os itens indisponíveis para continuar.</Notice> : null}
              {quote.lines.some((l) => l.isDemo) ? <p className="muted small">Itens de demonstração: preços e estoques ilustrativos.</p> : null}
              <ButtonLink to="/checkout" className={`btn--block${quote.hasIssues ? ' is-disabled' : ''}`}>Finalizar compra</ButtonLink>
              {error ? <p className="field__error" role="alert">{error} <button className="link-btn" onClick={retry}>Recalcular</button></p> : null}
            </OrderSummary>
          </aside>
        </div>
      )}
    </div>
  );
}
