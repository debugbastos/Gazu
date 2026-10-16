import { Link } from '../../lib/router';
import { useStore } from '../../lib/store';
import type { ProductCardDTO } from '../../../shared/types';
import { Icon } from '../ui/Icon';
import { DemoTag, Price } from '../ui/ui';

export function ProductCard({ product, priority, index }: { product: ProductCardDTO; priority?: boolean; index?: number }) {
  const { isFavorite, toggleFavorite } = useStore();
  const fav = isFavorite(product.id);
  const img = product.image;
  return (
    <article className={`product-card${product.available ? '' : ' is-soldout'}`} style={index !== undefined ? { ['--i' as string]: index } : undefined}>
      <div className="product-card__media">
        <Link to={`/produto/${product.slug}`} className="product-card__img" aria-label={product.name}>
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
        </Link>
        <button
          className={`fav-btn${fav ? ' is-active' : ''}`}
          onClick={() => void toggleFavorite(product.id, product.name)}
          aria-pressed={fav}
          aria-label={fav ? `Remover ${product.name} dos favoritos` : `Adicionar ${product.name} aos favoritos`}
        >
          <Icon name="heart" size={18} filled={fav} />
        </button>
        {!product.available ? <span className="product-card__badge">Esgotado</span> : product.promoPriceCents ? <span className="product-card__badge product-card__badge--sale">Oferta</span> : null}
      </div>
      <div className="product-card__info">
        <h3 className="product-card__name"><Link to={`/produto/${product.slug}`}>{product.name}</Link></h3>
        <div className="product-card__row">
          <Price cents={product.priceCents} promoCents={product.promoPriceCents} size="sm" />
          {product.isDemo ? <DemoTag>Demo</DemoTag> : null}
        </div>
        {product.colors.length > 0 ? (
          <ul className="swatches" aria-label={`Cores: ${product.colors.map((c) => c.name).join(', ')}`}>
            {product.colors.slice(0, 5).map((c) => <li key={c.name} className="swatch" style={{ background: c.hex ?? '#ccc' }} title={c.name} />)}
            {product.colors.length > 5 ? <li className="swatch-more">+{product.colors.length - 5}</li> : null}
          </ul>
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
