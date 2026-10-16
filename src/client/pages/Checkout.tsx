import { useEffect, useState } from 'react';
import { api, ApiError, errorMessage } from '../lib/api';
import { useApi, useDocumentTitle } from '../lib/hooks';
import { Link, useRouter } from '../lib/router';
import { useStore } from '../lib/store';
import { useCartQuote } from '../lib/useCartQuote';
import { formatCep } from '../../shared/format';
import type { AddressDTO, OrderDTO } from '../../shared/types';
import { AddressForm, emptyAddress, validateAddress, type AddressValues } from '../components/checkout/AddressForm';
import { Breadcrumbs, Button, ButtonLink, Checkbox, EmptyState, ErrorState, Loading, Notice } from '../components/ui/ui';
import { CouponForm, OrderSummary, readPrefs, ShippingPicker, writePrefs, type CheckoutPrefs } from './Cart';

export function CheckoutPage() {
  useDocumentTitle('Finalizar compra');
  const { user, userLoaded, cart, config, setCartOpen, clearCart } = useStore();
  const { navigate } = useRouter();
  const [prefs, setPrefs] = useState<CheckoutPrefs>(readPrefs);
  const addrs = useApi<{ addresses: AddressDTO[] }>(user ? '/api/account/addresses' : null, [user?.id]);
  const [addressId, setAddressId] = useState<number | 'new' | null>(null);
  const [newAddr, setNewAddr] = useState<AddressValues>(emptyAddress(user?.name ?? ''));
  const [saveAddr, setSaveAddr] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => { setCartOpen(false); }, [setCartOpen]);
  useEffect(() => {
    if (userLoaded && !user) navigate('/entrar?returnTo=/checkout', { replace: true });
  }, [userLoaded, user, navigate]);
  useEffect(() => {
    const list = addrs.data?.addresses;
    if (!list || addressId !== null) return;
    const def = list.find((a) => a.isDefault) ?? list[0];
    setAddressId(def ? def.id : 'new');
  }, [addrs.data, addressId]);

  const selectedAddress = typeof addressId === 'number' ? addrs.data?.addresses.find((a) => a.id === addressId) : null;
  const cep = selectedAddress?.cep ?? (newAddr.cep.length === 8 ? newAddr.cep : '');
  const update = (p: Partial<CheckoutPrefs>) => { const n = { ...prefs, ...p }; setPrefs(n); writePrefs(n); };
  useEffect(() => { if (cep && cep !== prefs.cep) update({ cep, shippingOptionId: '' }); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [cep]);
  const { quote, error: quoteError, retry } = useCartQuote(cart, { couponCode: prefs.couponCode, cep, shippingOptionId: prefs.shippingOptionId, enabled: Boolean(user) });

  if (!userLoaded || !user) return <div className="container page-pad"><Loading /></div>;
  if (cart.length === 0) return <div className="container page-pad"><EmptyState title="Sua sacola está vazia" action={<ButtonLink to="/categoria/novidades">Ver novidades</ButtonLink>} /></div>;
  if (quoteError && !quote) return <div className="container page-pad"><ErrorState message={quoteError} onRetry={retry} /></div>;
  if (!quote || addrs.loading) return <div className="container page-pad"><Loading label="Preparando checkout…" /></div>;

  const paymentAvailable = config.payments.pix || config.payments.creditCard || config.payments.demo;

  const submit = async () => {
    setSubmitError(null);
    if (quote.hasIssues) { setSubmitError('Há itens indisponíveis. Ajuste a sacola antes de continuar.'); return; }
    let addressPayload: Record<string, unknown> = {};
    if (addressId === 'new' || addressId === null) {
      const e = validateAddress(newAddr);
      setErrors(e);
      if (Object.keys(e).length) { setSubmitError('Revise o endereço de entrega.'); document.querySelector('.address-form')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
      addressPayload = { address: { ...newAddr, complement: newAddr.complement || null }, saveAddress: saveAddr };
    } else {
      addressPayload = { addressId };
    }
    if (!quote.shipping) { setSubmitError('Escolha uma opção de entrega.'); return; }
    setSubmitting(true);
    try {
      const order = await api.post<OrderDTO>('/api/checkout/orders', {
        items: cart, couponCode: prefs.couponCode || null, shippingOptionId: quote.shipping.id, expectedTotalCents: quote.totalCents, ...addressPayload,
      });
      writePrefs({ couponCode: '', cep: '', shippingOptionId: '' });
      // O servidor já esvaziou o carrinho persistido; aqui limpamos a cópia local e seguimos para o pagamento.
      clearCart();
      navigate(`/checkout/pedido/${order.number}`, { replace: true });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'total_changed') retry();
      if (e instanceof ApiError && e.code === 'validation_error') setErrors(e.fieldErrors);
      setSubmitError(errorMessage(e));
      setSubmitting(false);
    }
  };

  return (
    <div className="checkout container">
      <Breadcrumbs items={[{ name: 'Sacola', href: '/carrinho' }, { name: 'Checkout', href: '/checkout' }]} />
      <h1 className="page-title">Finalizar compra</h1>
      {config.demoMode ? <Notice tone="info" title="Ambiente de demonstração">Produtos, preços, estoques{config.shipping.provider === 'demo' ? ', frete' : ''}{config.payments.demo ? ' e pagamento' : ''} podem ser simulados. Nenhuma cobrança real é feita no modo simulado.</Notice> : null}
      <div className="two-col">
        <div className="checkout__steps">
          <section className="step" aria-labelledby="st1">
            <h2 id="st1"><span className="step__n">01</span> Identificação</h2>
            <p>Comprando como <strong>{user.name || user.email}</strong> ({user.email}).</p>
          </section>

          <section className="step" aria-labelledby="st2">
            <h2 id="st2"><span className="step__n">02</span> Endereço de entrega</h2>
            {addrs.error ? <ErrorState message={addrs.error} onRetry={addrs.reload} /> : null}
            {addrs.data?.addresses.length ? (
              <fieldset className="addr-options">
                <legend className="sr-only">Endereços salvos</legend>
                {addrs.data.addresses.map((a) => (
                  <label key={a.id} className={`addr-option${addressId === a.id ? ' is-selected' : ''}`}>
                    <input type="radio" name="addr" checked={addressId === a.id} onChange={() => setAddressId(a.id)} />
                    <span><strong>{a.label}</strong> · {a.recipient}<br />{a.street}, {a.number}{a.complement ? ` — ${a.complement}` : ''} · {a.district} · {a.city}/{a.state} · {formatCep(a.cep)}</span>
                  </label>
                ))}
                <label className={`addr-option${addressId === 'new' ? ' is-selected' : ''}`}>
                  <input type="radio" name="addr" checked={addressId === 'new'} onChange={() => setAddressId('new')} />
                  <span><strong>Usar um novo endereço</strong></span>
                </label>
              </fieldset>
            ) : null}
            {addressId === 'new' || addressId === null ? (
              <>
                <AddressForm value={newAddr} onChange={setNewAddr} errors={errors} />
                <Checkbox checked={saveAddr} onChange={setSaveAddr} label="Salvar este endereço na minha conta" />
              </>
            ) : null}
          </section>

          <section className="step" aria-labelledby="st3">
            <h2 id="st3"><span className="step__n">03</span> Entrega</h2>
            {!cep ? <p className="muted">Informe o endereço para ver as opções de entrega.</p> : (
              <ShippingPicker cep={cep} onCep={() => undefined} cepEditable={false} quote={quote} selected={prefs.shippingOptionId} onSelect={(id) => update({ shippingOptionId: id })} />
            )}
          </section>

          <section className="step" aria-labelledby="st4">
            <h2 id="st4"><span className="step__n">04</span> Cupom</h2>
            <CouponForm code={prefs.couponCode} onApply={(c) => update({ couponCode: c })} result={quote.coupon} />
          </section>

          <section className="step" aria-labelledby="st5">
            <h2 id="st5"><span className="step__n">05</span> Revisão</h2>
            <ul className="review-list">
              {quote.lines.map((l) => (
                <li key={l.variantId} className={l.issue ? 'has-issue' : ''}>
                  {l.image ? <img src={l.image.url} alt="" style={{ objectPosition: l.image.position }} /> : <span />}
                  <span><strong>{l.name}</strong><small>{l.colorName} · Tam. {l.size} · {l.quantity} un.</small>{l.issue ? <em className="field__error">Indisponível na quantidade escolhida</em> : null}</span>
                  <span>{(l.lineTotalCents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span>
                </li>
              ))}
            </ul>
            <p className="muted small">Ao confirmar, o pedido é criado e o estoque fica reservado por tempo limitado enquanto você conclui o pagamento na próxima etapa.</p>
          </section>
        </div>

        <aside className="two-col__side">
          <OrderSummary quote={quote} title="Seu pedido">
            {!paymentAvailable ? <Notice tone="warning">Os meios de pagamento ainda não foram configurados pela loja. O pedido não pode ser concluído.</Notice> : null}
            {quote.hasIssues ? <Notice tone="error">Há itens indisponíveis. <Link to="/carrinho" className="link-underline">Ajustar sacola</Link></Notice> : null}
            {submitError ? <Notice tone="error">{submitError}</Notice> : null}
            <Button block size="lg" loading={submitting} disabled={!paymentAvailable || quote.hasIssues || !quote.shipping} onClick={() => void submit()}>
              Confirmar pedido e pagar
            </Button>
            {!quote.shipping && cep ? <p className="muted small">Selecione uma opção de entrega para continuar.</p> : null}
            <p className="muted small">Ao confirmar você concorda com os <Link to="/termos-de-uso" className="link-underline">Termos de uso</Link>.</p>
          </OrderSummary>
        </aside>
      </div>
    </div>
  );
}
