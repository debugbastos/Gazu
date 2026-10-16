// Resolve o endereço de uma imagem/arquivo de /public.
// No site normal devolve o próprio caminho; na versão HTML autônoma (index.html) a página registra
// um resolvedor que troca o caminho pela imagem embutida no arquivo.
type Resolver = (url: string) => string | undefined;
declare global { interface Window { __GAZU_ASSET__?: Resolver } }

export const asset = (url: string): string => (typeof window !== 'undefined' && window.__GAZU_ASSET__?.(url)) || url;
