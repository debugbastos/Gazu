import { useState } from 'react';
import { Link } from '../../lib/router';
import { useStore } from '../../lib/store';
import { track } from '../../lib/analytics';
import type { ImageDTO, ProductCardDTO } from '../../../shared/types';
import { Icon } from '../ui/Icon';
import { DemoTag, Price } from '../ui/ui';

/**
 * Cartão de produto: segunda foto ao passar o mouse (quando existe), selos reais
 * (Esgotado, Oferta com promoção vigente, Novo dentro do período configurado, Últimas unidades)
 * e troca da foto ao escolher a cor (somente quando há foto daquela cor).
 */
export function ProductCard({ product, priority, index }: { product: ProductCardDTO; priority?: boolean; index?: number }) {
  const { isFavorite, toggleFavorite } = useStore();
  const fav = isFavorite(product.id);
  const [color, setColor] = useState<string | null>(null);
  const colorImg = color ? product.colorImages?.[color] : undefined;
  const img: ImageDTO | null = colorImg ?? product.image;
  const hover = !colorImg ? product.hoverImage ?? null : null;
  const href = `/produto/${product.slug}${color ? `?cor=${encodeURIComponent(color)}` : ''}`;
  const badge = !product.available ? { label: 'Esgotado', cls: '' } : product.promoPriceCents ? { label: 'Oferta', cls: ' product-card__badge--sale' } : product.isNew ? { label: 'Novo', cls: ' product-card__badge--new' } : product.lowStock ? { label: 'Últimas unidades', cls: ' product-card__badge--low' } : null;
  return (
    <article className={`product-card${product.available ? '' : ' is-soldout'}${hover ? ' has-hover' : ''}`} style={index !== undefined ? { ['--i' as string]: index } : undefined}>
      <div className="product-card__media">
        <Link to={href} className="product-card__img" aria-label={product.name} onClick={() => track({ event: 'select_item', productId: product.id })}>
          {img ? (
            <img
              src={img.url}
              srcSet={img.srcset ?? undefined}
              sizes="(min-width: 1280px) 22vw, (min-width: 768px) 30vw, 46vw"
              alt={img.alt || product.name}
              width={img.width ?? undefined}
              height={img.height ?? undefined}
              loading={priority ? 'eager' : 'lazy'}
              decoding="async"
              style={{ objectPosition: img.position }}
            />
          ) : <span className="product-card__noimg">Sem imagem</span>}
          {hover ? <img className="product-card__hover" src={hover.url} srcSet={hover.srcset ?? undefined} sizes="(min-width: 1280px) 22vw, (min-width: 768px) 30vw, 46vw" alt="" loading="lazy" decoding="async" style={{ objectPosition: hover.position }} aria-hidden="true" /> : null}
        </Link>
        <button
          className={`fav-btn${fav ? ' is-active' : ''}`}
          onClick={() => { if (!fav) track({ event: 'favorite_add', productId: product.id }); void toggleFavorite(product.id, product.name); }}
          aria-pressed={fav}
          aria-label={fav ? `Remover ${product.name} dos favoritos` : `Adicionar ${product.name} aos favoritos`}
        >
          <Icon name="heart" size={18} filled={fav} />
        </button>
        {badge ? <span className={`product-card__badge${badge.cls}`}>{badge.label}</span> : null}
      </div>
      <div className="product-card__info">
        <h3 className="product-card__name"><Link to={href}>{product.name}</Link></h3>
        <div className="product-card__row">
          <Price cents={product.priceCents} promoCents={product.promoPriceCents} size="sm" />
          {product.isDemo ? <DemoTag>Demo</DemoTag> : null}
        </div>
        {product.colors.length > 1 ? (
          <ul className="swatches" aria-label={`Cores disponíveis de ${product.name}`}>
            {product.colors.slice(0, 5).map((c) => (
              <li key={c.name}>
                <button
                  type="button"
                  className={`swatch swatch--btn${color === c.name ? ' is-selected' : ''}`}
                  style={{ background: c.hex ?? '#ccc' }}
                  title={c.name}
                  aria-label={`Ver na cor ${c.name}`}
                  aria-pressed={color === c.name}
                  onClick={() => setColor(color === c.name ? null : c.name)}
                  onMouseEnter={() => { if (product.colorImages?.[c.name]) setColor(c.name); }}
                />
              </li>
            ))}
            {product.colors.length > 5 ? <li className="swatch-more">+{product.colors.length - 5}</li> : null}
          </ul>
        ) : product.colors.length === 1 ? (
          <ul className="swatches" aria-label={`Cor: ${product.colors[0]!.name}`}><li className="swatch" style={{ background: product.colors[0]!.hex ?? '#ccc' }} title={product.colors[0]!.name} /></ul>
        ) : null}
      </div>
    </article>
  );
}

export function ProductGrid({ products, priorityCount = 0, className }: { products: ProductCardDTO[]; priorityCount?: number; className?: string }) {
  return (
    <div className={`product-grid ${className ?? ''}`}>
      {products.map((p, i) => <ProductCard key={p.id} product={p} priority={i < priorityCount} index={i} />)}
    </div>
  );
}

export function ProductGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div className="product-grid" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="product-card product-card--skeleton">
          <span className="skeleton product-card__img" />
          <span className="skeleton skeleton--text" />
          <span className="skeleton skeleton--text skeleton--short" />
        </div>
      ))}
    </div>
  );
}
