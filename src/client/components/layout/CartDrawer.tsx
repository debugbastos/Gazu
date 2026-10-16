import { useStore } from '../../lib/store';
import { useCartQuote } from '../../lib/useCartQuote';
import { formatPrice } from '../../../shared/format';
import { CartLine } from '../cart/CartLine';
import { ButtonLink, Dialog, EmptyState, ErrorState, Loading } from '../ui/ui';

export function CartDrawer() {
  const { cart, cartOpen, setCartOpen, cartCount } = useStore();
  const { quote, loading, error, retry } = useCartQuote(cart, { enabled: cartOpen });
  const close = () => setCartOpen(false);
  return (
    <Dialog open={cartOpen} onClose={close} variant="drawer-right" title={`Sacola (${cartCount})`} className="cart-drawer">
      <div className="cart-drawer__body">
        {cart.length === 0 ? (
          <EmptyState title="Sua sacola está vazia" text="Explore as novidades e encontre peças para você." action={<ButtonLink to="/categoria/novidades" variant="secondary" size="sm">Ver novidades</ButtonLink>} />
        ) : error && !quote ? (
          <ErrorState message={error} onRetry={retry} />
        ) : !quote ? (
          <Loading />
        ) : (
          <ul className="cart-lines" aria-busy={loading}>
            {quote.lines.map((l) => <CartLine key={l.variantId} line={l} compact />)}
          </ul>
        )}
      </div>
      {cart.length > 0 && quote ? (
        <div className="cart-drawer__foot">
          <div className="summary-row summary-row--total">
            <span>Subtotal</span>
            <strong>{formatPrice(quote.subtotalCents)}</strong>
          </div>
          <p className="muted small">Frete e cupom calculados na sacola e no checkout.</p>
          {quote.hasIssues ? <p className="cart-drawer__warn" role="alert">Há itens indisponíveis na sacola. Ajuste-os para finalizar.</p> : null}
          <div className="cart-drawer__ctas">
            <ButtonLink to="/carrinho" variant="secondary" className="btn--block">Ver sacola</ButtonLink>
            <ButtonLink to="/checkout" className={`btn--block${quote.hasIssues ? ' is-disabled' : ''}`}>Finalizar compra</ButtonLink>
          </div>
        </div>
      ) : null}
    </Dialog>
  );
}
