import { Link } from '../../lib/router';
import { useStore } from '../../lib/store';
import { formatPrice } from '../../../shared/format';
import type { CartLineDTO } from '../../../shared/types';
import { Icon } from '../ui/Icon';
import { DemoTag } from '../ui/ui';

export function QuantityStepper({ value, max, onChange, label, disabled }: { value: number; max: number; onChange: (v: number) => void; label: string; disabled?: boolean }) {
  const cap = Math.max(1, Math.min(20, max));
  return (
    <div className="qty" role="group" aria-label={label}>
      <button type="button" onClick={() => onChange(value - 1)} disabled={disabled || value <= 1} aria-label="Diminuir quantidade"><Icon name="minus" size={16} /></button>
      <output aria-live="polite">{value}</output>
      <button type="button" onClick={() => onChange(value + 1)} disabled={disabled || value >= cap} aria-label="Aumentar quantidade"><Icon name="plus" size={16} /></button>
    </div>
  );
}

const ISSUE_TEXT = {
  out_of_stock: 'Esgotado — remova para continuar.',
  insufficient_stock: 'Quantidade acima do estoque disponível.',
  unavailable: 'Produto indisponível — remova para continuar.',
} as const;

export function CartLine({ line, compact, editableVariant }: { line: CartLineDTO; compact?: boolean; editableVariant?: boolean }) {
  const { setCartQuantity, removeFromCart, replaceCartVariant, setCartOpen } = useStore();
  const sizes = line.variants.filter((v) => v.colorName === line.colorName);
  return (
    <li className={`cart-line${line.issue ? ' has-issue' : ''}${compact ? ' cart-line--compact' : ''}`}>
      <Link to={`/produto/${line.productSlug}`} className="cart-line__img" onClick={() => setCartOpen(false)} tabIndex={-1}>
        {line.image ? <img src={line.image.url} alt={line.image.alt} loading="lazy" style={{ objectPosition: line.image.position }} /> : null}
      </Link>
      <div className="cart-line__body">
        <div className="cart-line__head">
          <Link to={`/produto/${line.productSlug}`} className="cart-line__name" onClick={() => setCartOpen(false)}>{line.name}</Link>
          <span className="cart-line__price">{formatPrice(line.lineTotalCents)}</span>
        </div>
        <p className="cart-line__meta">
          {line.colorName}
          {editableVariant && sizes.length > 1 ? (
            <label className="cart-line__size">
              <span className="sr-only">Tamanho</span>
              <select value={line.variantId} onChange={(e) => replaceCartVariant(line.variantId, Number(e.target.value))}>
                {sizes.map((v) => <option key={v.id} value={v.id} disabled={v.stock <= 0 && v.id !== line.variantId}>Tam. {v.size}{v.stock <= 0 ? ' (esgotado)' : ''}</option>)}
              </select>
            </label>
          ) : <> · Tam. {line.size}</>}
        </p>
        <p className="cart-line__unit">{formatPrice(line.unitPriceCents)} un.{line.isDemo ? <> <DemoTag /></> : null}</p>
        {line.issue ? (
          <p className="cart-line__issue" role="alert"><Icon name="alert" size={14} /> {ISSUE_TEXT[line.issue]}{line.issue === 'insufficient_stock' ? ` Disponível: ${line.stock}.` : ''}</p>
        ) : null}
        <div className="cart-line__actions">
          {line.issue === 'out_of_stock' || line.issue === 'unavailable' ? <span /> : (
            <QuantityStepper value={line.quantity} max={line.stock} onChange={(v) => setCartQuantity(line.variantId, v)} label={`Quantidade de ${line.name}`} />
          )}
          {line.issue === 'insufficient_stock' ? <button className="link-btn" onClick={() => setCartQuantity(line.variantId, line.stock)}>Ajustar para {line.stock}</button> : null}
          <button className="link-btn" onClick={() => removeFromCart(line.variantId)}><Icon name="trash" size={16} /> Remover</button>
        </div>
      </div>
    </li>
  );
}
