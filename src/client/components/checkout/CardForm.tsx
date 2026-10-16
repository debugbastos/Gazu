import { useEffect, useRef, useState } from 'react';
import { Button, Notice } from '../ui/ui';

// Formulário de cartão com os campos seguros (iframes) do SDK oficial do Mercado Pago.
// Os dados do cartão são tokenizados pelo provedor: número, validade e CVV NUNCA passam pelo servidor da GAZU.

declare global {
  interface Window {
    MercadoPago?: new (publicKey: string, opts: { locale: string }) => {
      cardForm: (opts: unknown) => { getCardFormData: () => Record<string, string>; unmount: () => void };
    };
  }
}

let sdkPromise: Promise<void> | null = null;
function loadSdk(): Promise<void> {
  if (window.MercadoPago) return Promise.resolve();
  sdkPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://sdk.mercadopago.com/js/v2';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => { sdkPromise = null; reject(new Error('Não foi possível carregar o formulário seguro de cartão.')); };
    document.head.appendChild(s);
  });
  return sdkPromise;
}

export interface CardSubmit { token: string; installments: number; paymentMethodId: string; issuerId: string | null; identificationType: string | null; identificationNumber: string | null }

export function CardForm({ publicKey, amountCents, email, maxInstallments, onSubmit }: { publicKey: string; amountCents: number; email: string; maxInstallments: number; onSubmit: (d: CardSubmit) => Promise<void> }) {
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'submitting'>('loading');
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<ReturnType<NonNullable<InstanceType<NonNullable<Window['MercadoPago']>>['cardForm']>> | null>(null);
  const submitRef = useRef(onSubmit);
  submitRef.current = onSubmit;

  useEffect(() => {
    let cancelled = false;
    loadSdk().then(() => {
      if (cancelled || !window.MercadoPago) return;
      const mp = new window.MercadoPago(publicKey, { locale: 'pt-BR' });
      formRef.current = mp.cardForm({
        amount: (amountCents / 100).toFixed(2),
        iframe: true,
        form: {
          id: 'mp-card-form',
          cardNumber: { id: 'mp-cardNumber', placeholder: 'Número do cartão' },
          expirationDate: { id: 'mp-expirationDate', placeholder: 'MM/AA' },
          securityCode: { id: 'mp-securityCode', placeholder: 'CVV' },
          cardholderName: { id: 'mp-cardholderName', placeholder: 'Nome como no cartão' },
          issuer: { id: 'mp-issuer', placeholder: 'Banco emissor' },
          installments: { id: 'mp-installments', placeholder: 'Parcelas' },
          identificationType: { id: 'mp-identificationType', placeholder: 'Documento' },
          identificationNumber: { id: 'mp-identificationNumber', placeholder: 'Número do documento' },
          cardholderEmail: { id: 'mp-cardholderEmail', placeholder: 'E-mail' },
        },
        callbacks: {
          onFormMounted: (err: unknown) => { if (!cancelled) { if (err) { setStatus('error'); setError('Falha ao montar o formulário de cartão.'); } else setStatus('ready'); } },
          onSubmit: async (event: Event) => {
            event.preventDefault();
            const d = formRef.current?.getCardFormData() ?? {};
            if (!d.token) { setError('Verifique os dados do cartão.'); return; }
            const installments = Math.min(Number(d.installments || 1), maxInstallments);
            setStatus('submitting');
            setError(null);
            try {
              await submitRef.current({ token: d.token, installments, paymentMethodId: d.paymentMethodId ?? '', issuerId: d.issuerId || null, identificationType: d.identificationType || null, identificationNumber: d.identificationNumber || null });
            } catch (e) {
              setError(e instanceof Error ? e.message : 'Pagamento não concluído.');
            } finally {
              if (!cancelled) setStatus('ready');
            }
          },
          onFetching: () => undefined,
        },
      });
    }).catch((e: Error) => { if (!cancelled) { setStatus('error'); setError(e.message); } });
    return () => { cancelled = true; try { formRef.current?.unmount(); } catch { /* já desmontado */ } };
  }, [publicKey, amountCents, maxInstallments]);

  return (
    <form id="mp-card-form" className="card-form">
      {status === 'loading' ? <p className="muted">Carregando formulário seguro…</p> : null}
      <div className="card-form__grid">
        <div className="field span-2"><label htmlFor="mp-cardNumber">Número do cartão</label><div id="mp-cardNumber" className="mp-field" /></div>
        <div className="field"><label htmlFor="mp-expirationDate">Validade</label><div id="mp-expirationDate" className="mp-field" /></div>
        <div className="field"><label htmlFor="mp-securityCode">CVV</label><div id="mp-securityCode" className="mp-field" /></div>
        <div className="field span-2"><label htmlFor="mp-cardholderName">Nome do titular</label><input id="mp-cardholderName" /></div>
        <div className="field"><label htmlFor="mp-identificationType">Documento</label><select id="mp-identificationType" /></div>
        <div className="field"><label htmlFor="mp-identificationNumber">Número do documento</label><input id="mp-identificationNumber" inputMode="numeric" /></div>
        <div className="field"><label htmlFor="mp-issuer">Banco emissor</label><select id="mp-issuer" /></div>
        <div className="field"><label htmlFor="mp-installments">Parcelas</label><select id="mp-installments" /></div>
        <input id="mp-cardholderEmail" type="hidden" defaultValue={email} />
      </div>
      {error ? <Notice tone="error">{error}</Notice> : null}
      <Button type="submit" block loading={status === 'submitting'} disabled={status === 'loading' || status === 'error'}>Pagar com cartão</Button>
      <p className="muted small">Dados do cartão processados com segurança pelo Mercado Pago. A GAZU não armazena número nem código de segurança.</p>
    </form>
  );
}
