// Logomarca GAZU vetorizada a partir da proposta original fornecida (assets-source/branding/gazu-logo-original.png).
// Os traçados foram extraídos por contorno (scripts/assets/trace_logo.py) para preservar o desenho das letras.
import logoSvg from '../../../../public/assets/branding/logo/gazu-wordmark.svg';
import fullSvg from '../../../../public/assets/branding/logo/gazu-logo.svg';

const inline = (svg: string, label: string) => svg.replace('<svg ', `<svg focusable="false" aria-hidden="true" data-label="${label}" `);

export function Logo({ variant = 'wordmark', className }: { variant?: 'wordmark' | 'full'; className?: string }) {
  return (
    <span className={`logo ${className ?? ''}`} role="img" aria-label="GAZU" dangerouslySetInnerHTML={{ __html: inline(variant === 'full' ? fullSvg : logoSvg, 'GAZU') }} />
  );
}
