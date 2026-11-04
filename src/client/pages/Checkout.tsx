import { useEffect, useState } from 'react';
import { api, ApiError, errorMessage } from '../lib/api';
import { useApi, useDocumentTitle } from '../lib/hooks';
import { Link, useRouter } from '../lib/router';
import { useStore } from '../lib/store';
import { useCartQuote } from '../lib/useCartQuote';
import { formatCep } from '../../shared/format';
import type { AddressDTO, OrderDTO } from '../../shared/types';
import { AddressForm, emptyAddress, validateAddress, type AddressValues } from '../components/checkout/AddressForm';
import { Breadcrumbs, Button, ButtonLink, Checkbox, EmptyState, ErrorState, Field, Loading, Notice } from '../components/ui/ui';
import { getAttribution, track } from '../lib/analytics';
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
  // Compra sem cadastro (visitante): nome, e-mail, telefone e aceite dos termos.
  const [guestMode, setGuestMode] = useState(false);
  const [guest, setGuest] = useState({ name: '', email: '', phone: '' });
  const [acceptTerms, setAcceptTerms] = useState(false);

  useEffect(() => { setCartOpen(false); }, [setCartOpen]);
  useEffect(() => {
    if (userLoaded && !user && !config.guestCheckout) navigate('/entrar?returnTo=/checkout', { replace: true });
  }, [userLoaded, user, navigate, config.guestCheckout]);
  useEffect(() => { if (cart.length) track({ event: 'begin_checkout', props: { items: cart.length } }); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);
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
  const { quote, error: quoteError, retry } = useCartQuote(cart, { couponCode: prefs.couponCode, cep, shippingOptionId: prefs.shippingOptionId, enabled: userLoaded });

  if (!userLoaded) return <div className="container page-pad"><Loading /></div>;
  if (cart.length === 0) return <div className="container page-pad"><EmptyState title="Sua sacola está vazia" action={<ButtonLink to="/categoria/novidades">Ver novidades</ButtonLink>} /></div>;
  if (!user && !guestMode) {
    return (
      <div className="checkout container">
        <Breadcrumbs items={[{ name: 'Sacola', href: '/carrinho' }, { name: 'Checkout', href: '/checkout' }]} />
        <h1 className="page-title">Finalizar compra</h1>
        <div className="checkout-identify">
          <section className="panel">
            <h2>Já tenho conta</h2>
            <p className="muted">Entre para usar seus endereços salvos e acompanhar todos os pedidos.</p>
            <ButtonLink to="/entrar?returnTo=/checkout">Entrar</ButtonLink>
            <p className="muted small">Não tem conta? <Link to="/cadastro?returnTo=/checkout" className="link-underline">Criar conta</Link></p>
          </section>
          {config.guestCheckout ? (
            <section className="panel">
              <h2>Comprar sem cadastro</h2>
              <p className="muted">Informe seu nome e e-mail. Você recebe por e-mail o link para acompanhar o pedido.</p>
              <Button variant="secondary" onClick={() => setGuestMode(true)}>Continuar como visitante</Button>
            </section>
          ) : null}
        </div>
      </div>
    );
  }
  if (cart.length === 0) return <div className="container page-pad"><EmptyState title="Sua sacola está vazia" action={<ButtonLink to="/categoria/novidades">Ver novidades</ButtonLink>} /></div>;
  if (quoteError && !quote) return <div className="container page-pad"><ErrorState message={quoteError} onRetry={retry} /></div>;
  if (!quote || addrs.loading) return <div className="container page-pad"><Loading label="Preparando checkout…" /></div>;

  const paymentAvailable = config.payments.pix || config.payments.creditCard || config.payments.boleto || config.payments.demo;

  const submit = async () => {
    setSubmitError(null);
    if (quote.hasIssues) { setSubmitError('Há itens indisponíveis. Ajuste a sacola antes de continuar.'); return; }
    let addressPayload: Record<string, unknown> = {};
    if (!user) {
      const ge: Record<string, string> = {};
      if (guest.name.trim().length < 3) ge.guestName = 'Informe seu nome completo.';
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(guest.email.trim())) ge.guestEmail = 'Informe um e-mail válido.';
      if (!acceptTerms) ge.terms = 'É necessário aceitar os termos e a política de privacidade.';
      const ae = validateAddress(newAddr);
      setErrors({ ...ae, ...ge });
      if (Object.keys(ge).length || Object.keys(ae).length) { setSubmitError(ge.terms ?? 'Revise seus dados e o endereço de entrega.'); return; }
    }
    if (addressId === 'new' || addressId === null || !user) {
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
      const base = { items: cart, couponCode: prefs.couponCode || null, shippingOptionId: quote.shipping.id, expectedTotalCents: quote.totalCents, attribution: getAttribution(), ...addressPayload };
      const order = user
        ? await api.post<OrderDTO>('/api/checkout/orders', base)
        : await api.post<OrderDTO>('/api/checkout/guest-orders', { ...base, address: { ...newAddr, complement: newAddr.complement || null }, guest: { name: guest.name.trim(), email: guest.email.trim(), phone: guest.phone || null, acceptTerms: true } });
      writePrefs({ couponCode: '', cep: '', shippingOptionId: '' });
      // O servidor já esvaziou o carrinho persistido; aqui limpamos a cópia local e seguimos para o pagamento.
      clearCart();
      navigate(user ? `/checkout/pedido/${order.number}` : `/pedido/${order.number}`, { replace: true });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'total_changed') retry();
      if (e instanceof ApiError && e.code === 'validation_error') setErrors(e.fieldErrors);
      if (e instanceof ApiError && e.code === 'account_exists') setErrors({ guestEmail: e.message });
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
            {user ? <p>Comprando como <strong>{user.name || user.email}</strong> ({user.email}).</p> : (
              <div className="form-stack">
                <p className="muted small">Comprando sem cadastro. <button className="link-btn" onClick={() => setGuestMode(false)}>Prefiro entrar na conta</button></p>
                <div className="form-grid">
                  <Field label="Nome completo" value={guest.name} onChange={(e) => setGuest({ ...guest, name: e.target.value })} error={errors.guestName} autoComplete="name" required />
                  <Field label="E-mail" type="email" value={guest.email} onChange={(e) => setGuest({ ...guest, email: e.target.value })} error={errors.guestEmail} autoComplete="email" required hint="Enviamos a confirmação e o link do pedido para este e-mail." />
                  <Field label="Telefone" value={guest.phone} onChange={(e) => setGuest({ ...guest, phone: e.target.value })} optional autoComplete="tel" inputMode="tel" />
                </div>
                <Checkbox checked={acceptTerms} onChange={setAcceptTerms} label={<>Li e aceito os <Link to="/termos-de-uso" className="link-underline">Termos de uso</Link> e a <Link to="/politica-de-privacidade" className="link-underline">Política de privacidade</Link>.</>} />
                {errors.terms ? <p className="field__error" role="alert">{errors.terms}</p> : null}
              </div>
            )}
          </section>

          <section className="step" aria-labelledby="st2">
            <h2 id="st2"><span className="step__n">02</span> Endereço de entrega</h2>
            {addrs.error ? <ErrorState message={addrs.error} onRetry={addrs.reload} /> : null}
            {user && addrs.data?.addresses.length ? (
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
            {addressId === 'new' || addressId === null || !user ? (
              <>
                <AddressForm value={newAddr} onChange={setNewAddr} errors={errors} />
                {user ? <Checkbox checked={saveAddr} onChange={setSaveAddr} label="Salvar este endereço na minha conta" /> : null}
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
