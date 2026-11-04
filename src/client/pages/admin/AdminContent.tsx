import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { api, errorMessage } from '../../lib/api';
import { useApi } from '../../lib/hooks';
import { Link, useRouter } from '../../lib/router';
import { useStore } from '../../lib/store';
import { formatDate, formatPrice } from '../../../shared/format';
import type { AdminReviewDTO } from '../../../shared/types';
import { Icon } from '../../components/ui/Icon';
import { Button, EmptyState, ErrorState, Field, Loading, Notice } from '../../components/ui/ui';
import { Stars } from '../../components/content/Editorial';
import { AdminShell } from './Admin';
import { Bool, dt, ImageField, ProductPicker, ResourcePage, useCan, type ResourceConfig } from './AdminKit';

// ---------------------------------------------------------------------------------------------
// Configurações dos recursos de conteúdo (CRUD genérico)
// ---------------------------------------------------------------------------------------------
const STATUS_PUB: [string, string][] = [['draft', 'Rascunho'], ['published', 'Publicado'], ['archived', 'Arquivado']];
const statusLabel = (v: unknown) => ({ draft: 'Rascunho', published: 'Publicado', active: 'Ativa', archived: 'Arquivo', ended: 'Encerrada' } as Record<string, string>)[String(v)] ?? String(v);

export const ANNOUNCEMENTS: ResourceConfig = {
  name: 'announcements', title: 'Avisos do topo', singular: 'Aviso', write: 'content.write',
  intro: 'Mensagens da barra preta do topo. Defina início e fim para campanhas com prazo; sem datas, o aviso fica ativo até ser desligado. Não anuncie frete grátis ou descontos que não existam no sistema.',
  fields: [
    { key: 'message', label: 'Mensagem', type: 'text', required: true, span: true },
    { key: 'linkUrl', label: 'Link (opcional)', type: 'url', hint: 'Ex.: /colecao/motorsport' },
    { key: 'position', label: 'Ordem', type: 'number', default: 0 },
    { key: 'startsAt', label: 'Início', type: 'datetime' },
    { key: 'endsAt', label: 'Fim', type: 'datetime' },
    { key: 'isActive', label: 'Ativo', type: 'checkbox', default: true },
  ],
  columns: [{ key: 'message', label: 'Mensagem' }, { key: 'linkUrl', label: 'Link' }, { key: 'startsAt', label: 'Início', render: (r) => dt(r.startsAt) }, { key: 'endsAt', label: 'Fim', render: (r) => dt(r.endsAt) }, { key: 'isActive', label: 'Ativo', render: (r) => <Bool v={r.isActive} /> }],
};

export const BANNERS: ResourceConfig = {
  name: 'banners', title: 'Banners', singular: 'Banner', write: 'content.write',
  intro: 'O banner "Editorial da home" substitui o bloco "Novos olhares" enquanto estiver ativo e dentro do período.',
  filters: [{ param: 'posicao', label: 'Posição', options: [['home_editorial', 'Editorial da home'], ['home_secondary', 'Secundário'], ['catalog_top', 'Topo do catálogo']] }],
  fields: [
    { key: 'placement', label: 'Posição', type: 'select', options: [['home_editorial', 'Editorial da home'], ['home_secondary', 'Secundário da home'], ['catalog_top', 'Topo do catálogo']], default: 'home_editorial' },
    { key: 'eyebrow', label: 'Sobretítulo', type: 'text' },
    { key: 'title', label: 'Título', type: 'text', required: true },
    { key: 'subtitle', label: 'Texto', type: 'text' },
    { key: 'imageUrl', label: 'Imagem', type: 'image', folder: 'banners', hint: 'JPG, PNG ou WebP. Versões otimizadas são geradas automaticamente.' },
    { key: 'imageAlt', label: 'Descrição da imagem (acessibilidade)', type: 'text', span: true },
    { key: 'linkUrl', label: 'Link do botão', type: 'url', required: true, default: '/' },
    { key: 'ctaLabel', label: 'Texto do botão', type: 'text', required: true, default: 'Explorar' },
    { key: 'startsAt', label: 'Início', type: 'datetime' },
    { key: 'endsAt', label: 'Fim', type: 'datetime' },
    { key: 'position', label: 'Ordem', type: 'number', default: 0 },
    { key: 'isActive', label: 'Ativo', type: 'checkbox', default: true },
  ],
  columns: [{ key: 'title', label: 'Título' }, { key: 'placement', label: 'Posição' }, { key: 'startsAt', label: 'Início', render: (r) => dt(r.startsAt) }, { key: 'endsAt', label: 'Fim', render: (r) => dt(r.endsAt) }, { key: 'isActive', label: 'Ativo', render: (r) => <Bool v={r.isActive} /> }],
};

export const COLLECTIONS: ResourceConfig = {
  name: 'collections', title: 'Coleções e Archive', singular: 'Coleção', feminine: true, write: 'catalog.write',
  intro: 'Coleções "Ativas" aparecem em /colecoes; "Arquivo" aparece no Archive. Coleções sem peças publicadas não devem ser destacadas.',
  filters: [{ param: 'status', label: 'Status', options: [['draft', 'Rascunho'], ['active', 'Ativas'], ['archived', 'Archive']] }],
  fields: [
    { key: 'name', label: 'Nome', type: 'text', required: true },
    { key: 'slug', label: 'Endereço (slug)', type: 'slug', slugFrom: 'name', required: true },
    { key: 'season', label: 'Temporada', type: 'text' },
    { key: 'status', label: 'Status', type: 'select', options: [['draft', 'Rascunho'], ['active', 'Ativa'], ['archived', 'Archive']], default: 'draft' },
    { key: 'description', label: 'Descrição', type: 'textarea' },
    { key: 'coverUrl', label: 'Capa', type: 'image', folder: 'colecoes' },
    { key: 'coverAlt', label: 'Descrição da capa', type: 'text', span: true },
    { key: 'productIds', label: 'Peças da coleção (na ordem de exibição)', type: 'products' },
    { key: 'position', label: 'Ordem', type: 'number', default: 0 },
    { key: 'isFeatured', label: 'Destacar na página inicial', type: 'checkbox', default: false },
    { key: 'seoTitle', label: 'Título para buscadores', type: 'text' },
    { key: 'seoDescription', label: 'Descrição para buscadores', type: 'text' },
  ],
  columns: [{ key: 'name', label: 'Coleção' }, { key: 'status', label: 'Status', render: (r) => statusLabel(r.status) }, { key: 'productIds', label: 'Peças', render: (r) => String((r.productIds as number[] | undefined)?.length ?? 0) }, { key: 'isFeatured', label: 'Destaque', render: (r) => <Bool v={r.isFeatured} /> }, { key: 'isDemo', label: 'Demo', render: (r) => (r.isDemo ? <span className="demo-tag">Demo</span> : '—') }],
  rowActions: (r) => <a className="icon-btn" href={`/colecao/${String(r.slug)}`} target="_blank" rel="noopener noreferrer" aria-label="Ver na loja"><Icon name="external" size={16} /></a>,
};

export const JOURNAL: ResourceConfig = {
  name: 'journal', title: 'Journal', singular: 'Artigo', write: 'content.write',
  intro: 'Texto em Markdown simples: ## título, **negrito**, listas com "- ", links [texto](/caminho) e citações com "> ". O HTML é sempre escapado.',
  filters: [{ param: 'status', label: 'Status', options: STATUS_PUB }],
  fields: [
    { key: 'title', label: 'Título', type: 'text', required: true },
    { key: 'slug', label: 'Endereço (slug)', type: 'slug', slugFrom: 'title', required: true },
    { key: 'category', label: 'Categoria', type: 'select', options: [['estilo', 'Estilo'], ['combinacoes', 'Combinações'], ['cuidados', 'Cuidados'], ['lancamentos', 'Lançamentos'], ['guias', 'Guias'], ['inspiracao', 'Inspiração']], default: 'estilo' },
    { key: 'status', label: 'Status', type: 'select', options: STATUS_PUB, default: 'draft' },
    { key: 'author', label: 'Autor', type: 'text', required: true, default: 'Equipe GAZU' },
    { key: 'publishedAt', label: 'Publicar em (agendamento)', type: 'datetime', hint: 'Vazio = no momento da publicação.' },
    { key: 'excerpt', label: 'Resumo', type: 'textarea' },
    { key: 'body', label: 'Conteúdo (Markdown)', type: 'markdown' },
    { key: 'coverUrl', label: 'Capa', type: 'image', folder: 'journal' },
    { key: 'coverAlt', label: 'Descrição da capa', type: 'text', span: true },
    { key: 'productIds', label: 'Produtos citados', type: 'products' },
    { key: 'seoTitle', label: 'Título para buscadores', type: 'text' },
    { key: 'seoDescription', label: 'Descrição para buscadores', type: 'text' },
  ],
  columns: [{ key: 'title', label: 'Artigo' }, { key: 'category', label: 'Categoria' }, { key: 'status', label: 'Status', render: (r) => statusLabel(r.status) }, { key: 'publishedAt', label: 'Publicação', render: (r) => dt(r.publishedAt) }, { key: 'isDemo', label: 'Demo', render: (r) => (r.isDemo ? <span className="demo-tag">Demo</span> : '—') }],
  rowActions: (r) => <a className="icon-btn" href={`/journal/${String(r.slug)}`} target="_blank" rel="noopener noreferrer" aria-label="Ver na loja"><Icon name="external" size={16} /></a>,
};

export const PAGES: ResourceConfig = {
  name: 'pages', title: 'Páginas institucionais', singular: 'Página', feminine: true, write: 'content.write',
  intro: 'Páginas publicadas ficam em /p/endereço. "pagamento" e "cancelamento" alimentam as páginas de mesmo nome. Textos legais devem ser revisados pelo responsável jurídico.',
  fields: [
    { key: 'title', label: 'Título', type: 'text', required: true },
    { key: 'slug', label: 'Endereço (slug)', type: 'slug', slugFrom: 'title', required: true },
    { key: 'status', label: 'Status', type: 'select', options: [['draft', 'Rascunho'], ['published', 'Publicada']], default: 'draft' },
    { key: 'seoDescription', label: 'Descrição para buscadores', type: 'text' },
    { key: 'body', label: 'Conteúdo (Markdown)', type: 'markdown', required: true },
  ],
  columns: [{ key: 'title', label: 'Página' }, { key: 'slug', label: 'Endereço' }, { key: 'status', label: 'Status', render: (r) => statusLabel(r.status) }, { key: 'updatedAt', label: 'Atualizada', render: (r) => dt(r.updatedAt) }],
};

export const FAQ: ResourceConfig = {
  name: 'faq', title: 'Perguntas frequentes', singular: 'Pergunta', feminine: true, write: 'content.write',
  intro: 'Aparecem na Central de ajuda. Vincule a um produto para exibir também na página dele. Responda apenas com políticas e informações reais da loja.',
  filters: [{ param: 'categoria', label: 'Categoria', options: [['pedidos', 'Pedidos'], ['pagamento', 'Pagamento'], ['entrega', 'Entrega'], ['trocas', 'Trocas'], ['produtos', 'Produtos'], ['conta', 'Conta'], ['privacidade', 'Privacidade']] }],
  fields: [
    { key: 'category', label: 'Categoria', type: 'select', options: [['geral', 'Geral'], ['pedidos', 'Pedidos'], ['pagamento', 'Pagamento'], ['entrega', 'Entrega'], ['trocas', 'Trocas'], ['produtos', 'Produtos'], ['conta', 'Conta'], ['privacidade', 'Privacidade']], default: 'geral' },
    { key: 'position', label: 'Ordem', type: 'number', default: 0 },
    { key: 'question', label: 'Pergunta', type: 'text', required: true, span: true },
    { key: 'answer', label: 'Resposta (Markdown simples)', type: 'textarea', required: true },
    { key: 'productId', label: 'Produto (opcional)', type: 'product' },
    { key: 'isActive', label: 'Ativa', type: 'checkbox', default: true },
  ],
  columns: [{ key: 'question', label: 'Pergunta' }, { key: 'category', label: 'Categoria' }, { key: 'productId', label: 'Produto', render: (r) => (r.productId ? `#${String(r.productId)}` : 'Geral') }, { key: 'isActive', label: 'Ativa', render: (r) => <Bool v={r.isActive} /> }],
};

export const SIZE_GUIDES: ResourceConfig = {
  name: 'size-guides', title: 'Guias de medidas', singular: 'Guia', write: 'catalog.write',
  intro: 'Associe o guia ao produto na edição do produto. Guias marcados como "referência" exibem o aviso de que as medidas devem ser confirmadas com o fornecedor.',
  fields: [
    { key: 'name', label: 'Nome', type: 'text', required: true, span: true },
    { key: 'table', label: 'Tabela', type: 'table' },
    { key: 'note', label: 'Observação exibida abaixo da tabela', type: 'textarea' },
    { key: 'isDemo', label: 'Tabela de referência (não confirmada pelo fornecedor)', type: 'checkbox', default: false },
  ],
  columns: [{ key: 'name', label: 'Guia' }, { key: 'productCount', label: 'Produtos' }, { key: 'isDemo', label: 'Referência', render: (r) => (r.isDemo ? <span className="demo-tag">Referência</span> : 'Confirmada') }],
};

export const LOOKBOOKS: ResourceConfig = {
  name: 'lookbooks', title: 'Lookbooks', singular: 'Lookbook', write: 'content.write',
  intro: 'Salve os dados do lookbook e depois monte as fotos com os pontos clicáveis. Marque somente peças que realmente aparecem na foto. Para publicar, é preciso ao menos um produto.',
  filters: [{ param: 'status', label: 'Status', options: STATUS_PUB }],
  fields: [
    { key: 'title', label: 'Título', type: 'text', required: true },
    { key: 'slug', label: 'Endereço (slug)', type: 'slug', slugFrom: 'title', required: true },
    { key: 'status', label: 'Status', type: 'select', options: STATUS_PUB, default: 'draft' },
    { key: 'position', label: 'Ordem', type: 'number', default: 0 },
    { key: 'description', label: 'Descrição', type: 'textarea' },
    { key: 'coverUrl', label: 'Capa (vazio = primeira foto)', type: 'image', folder: 'lookbooks' },
    { key: 'seoTitle', label: 'Título para buscadores', type: 'text' },
    { key: 'seoDescription', label: 'Descrição para buscadores', type: 'text' },
  ],
  columns: [{ key: 'title', label: 'Lookbook' }, { key: 'status', label: 'Status', render: (r) => statusLabel(r.status) }, { key: 'publishedAt', label: 'Publicado', render: (r) => dt(r.publishedAt) }, { key: 'isDemo', label: 'Demo', render: (r) => (r.isDemo ? <span className="demo-tag">Demo</span> : '—') }],
  rowActions: (r) => <a className="icon-btn" href={`/lookbook/${String(r.slug)}`} target="_blank" rel="noopener noreferrer" aria-label="Ver na loja"><Icon name="external" size={16} /></a>,
  afterEditor: (id) => (id ? <LookComposer id={id} /> : <p className="muted small span-2">Salve o lookbook para montar as fotos e os pontos de produto.</p>),
};

// ---------------------------------------------------------------------------------------------
// Editor de fotos e pontos clicáveis (hotspots) do lookbook
// ---------------------------------------------------------------------------------------------
interface CompImage { url: string; alt: string; width: number | null; height: number | null; hotspots: { productId: number; x: number; y: number; label: string | null }[] }

function LookComposer({ id }: { id: number }) {
  const { notify } = useStore();
  const [images, setImages] = useState<CompImage[] | null>(null);
  const [extra, setExtra] = useState<number[]>([]);
  const [active, setActive] = useState(0);
  const [pending, setPending] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);
  const frame = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    api.get<{ images: CompImage[]; extraProductIds: number[] }>(`/api/admin/lookbooks/${id}/composition`).then((r) => { setImages(r.images); setExtra(r.extraProductIds); }).catch((e: unknown) => notify(errorMessage(e), 'error'));
  }, [id, notify]);
  if (!images) return <Loading inline />;
  const img = images[active];
  const update = (fn: (im: CompImage) => CompImage) => setImages(images.map((im, i) => (i === active ? fn(im) : im)));
  const place = (e: MouseEvent<HTMLDivElement>) => {
    if (!img || !pending[0]) { notify('Escolha o produto abaixo e depois clique na foto onde ele aparece.', 'info'); return; }
    const r = e.currentTarget.getBoundingClientRect();
    const x = Math.round(((e.clientX - r.left) / r.width) * 1000) / 10;
    const y = Math.round(((e.clientY - r.top) / r.height) * 1000) / 10;
    update((im) => ({ ...im, hotspots: [...im.hotspots.filter((h) => h.productId !== pending[0]), { productId: pending[0]!, x, y, label: null }] }));
    setPending([]);
  };
  const save = async () => {
    setSaving(true);
    try {
      await api.put(`/api/admin/lookbooks/${id}/composition`, { images, extraProductIds: extra });
      notify('Composição do lookbook salva.', 'success');
    } catch (e) { notify(errorMessage(e), 'error'); } finally { setSaving(false); }
  };
  return (
    <section className="composer span-2">
      <h3 className="field-legend">Fotos e pontos de produto</h3>
      <div className="composer__thumbs">
        {images.map((im, i) => <button type="button" key={im.url + i} className={i === active ? 'is-active' : ''} onClick={() => setActive(i)}><img src={im.url} alt="" /><small>{im.hotspots.length} ponto(s)</small></button>)}
        <div className="composer__add">
          <ImageField label="Adicionar foto" value="" folder="lookbooks" onChange={(url, meta) => { if (url) { setImages([...images, { url, alt: '', width: meta?.width ?? null, height: meta?.height ?? null, hotspots: [] }]); setActive(images.length); } }} />
        </div>
      </div>
      {img ? (
        <div className="composer__stage">
          <div className="composer__frame" ref={frame} onClick={place} role="button" tabIndex={0} aria-label="Clique para posicionar o produto selecionado">
            <img src={img.url} alt={img.alt} />
            {img.hotspots.map((h, i) => <span key={h.productId} className="composer__dot" style={{ left: `${h.x}%`, top: `${h.y}%` }}>{i + 1}</span>)}
          </div>
          <div className="composer__side">
            <Field label="Descrição da foto (acessibilidade)" value={img.alt} onChange={(e) => update((im) => ({ ...im, alt: e.target.value }))} />
            <ProductPicker label="1. Escolha o produto que aparece na foto" value={pending} onChange={setPending} single />
            <p className="muted small">2. Clique na foto sobre a peça. Para mover, escolha o mesmo produto e clique de novo.</p>
            <ol className="composer__list">
              {img.hotspots.map((h, i) => (
                <li key={h.productId}><span>{i + 1}. Produto #{h.productId} ({h.x}%, {h.y}%)</span>
                  <input value={h.label ?? ''} placeholder="Rótulo (ex.: Camisa)" onChange={(e) => update((im) => ({ ...im, hotspots: im.hotspots.map((x) => (x.productId === h.productId ? { ...x, label: e.target.value || null } : x)) }))} aria-label="Rótulo do ponto" />
                  <button type="button" className="icon-btn" onClick={() => update((im) => ({ ...im, hotspots: im.hotspots.filter((x) => x.productId !== h.productId) }))} aria-label="Remover ponto"><Icon name="close" size={14} /></button>
                </li>
              ))}
            </ol>
            <div className="admin-row">
              <button type="button" className="link-btn" onClick={() => { setImages(images.filter((_, i) => i !== active)); setActive(0); }}>Remover esta foto</button>
            </div>
          </div>
        </div>
      ) : <p className="muted small">Adicione a primeira foto do look.</p>}
      <ProductPicker label="Outras peças do look (sem ponto na foto)" value={extra} onChange={setExtra} />
      <Button type="button" variant="secondary" loading={saving} onClick={() => void save()}>Salvar fotos e pontos</Button>
    </section>
  );
}

// ---------------------------------------------------------------------------------------------
// Central de conteúdo (abas)
// ---------------------------------------------------------------------------------------------
const CONTENT_TABS: { key: string; label: string; cfg: ResourceConfig }[] = [
  { key: 'avisos', label: 'Avisos do topo', cfg: ANNOUNCEMENTS },
  { key: 'banners', label: 'Banners', cfg: BANNERS },
  { key: 'colecoes', label: 'Coleções', cfg: COLLECTIONS },
  { key: 'lookbooks', label: 'Lookbooks', cfg: LOOKBOOKS },
  { key: 'journal', label: 'Journal', cfg: JOURNAL },
  { key: 'paginas', label: 'Páginas', cfg: PAGES },
  { key: 'faq', label: 'Perguntas frequentes', cfg: FAQ },
  { key: 'medidas', label: 'Guias de medidas', cfg: SIZE_GUIDES },
];

export function AdminContentHub({ tab }: { tab: string }) {
  const { navigate } = useRouter();
  const current = CONTENT_TABS.find((t) => t.key === tab) ?? CONTENT_TABS[0]!;
  return (
    <AdminShell title="Conteúdo">
      <nav className="admin-tabs admin-tabs--section" aria-label="Seções de conteúdo">
        {CONTENT_TABS.map((t) => <button key={t.key} className={t.key === current.key ? 'is-active' : ''} aria-current={t.key === current.key ? 'page' : undefined} onClick={() => navigate(`/admin/conteudo/${t.key}`)}>{t.label}</button>)}
      </nav>
      <h2 className="admin-subtitle">{current.cfg.title}</h2>
      <ResourcePage key={current.key} cfg={current.cfg} embedded />
    </AdminShell>
  );
}

// ---------------------------------------------------------------------------------------------
// Qualidade do catálogo
// ---------------------------------------------------------------------------------------------
interface AuditReport {
  generatedAt: string; totals: Record<'critical' | 'high' | 'medium' | 'low', number>;
  byCode: { code: string; label: string; severity: string; count: number }[];
  products: { productId: number; name: string; slug: string; status: string; issues: { code: string; severity: string; message: string }[]; blocking: { code: string }[] }[];
  emptyCategories: { id: number; name: string; slug: string }[]; invalidLinks: { source: string; id: number; url: string }[];
}
const SEV_LABEL: Record<string, string> = { critical: 'Crítico', high: 'Alto', medium: 'Médio', low: 'Baixo' };

export function AdminCatalogQuality() {
  const { data, error, loading, reload } = useApi<AuditReport>('/api/admin/catalog-audit');
  const [code, setCode] = useState('');
  const list = (data?.products ?? []).filter((p) => !code || p.issues.some((i) => i.code === code));
  return (
    <AdminShell title="Qualidade do catálogo" actions={<Button variant="secondary" size="sm" icon="refresh" onClick={reload}>Reanalisar</Button>}>
      <p className="muted small admin-intro">Problemas críticos impedem a publicação do produto. A análise considera imagens, descrição, variantes, estoque, preço, SEO, guia de medidas, composição, cuidados, peso e dimensões (frete), categorias vazias e links internos quebrados.</p>
      {loading && !data ? <Loading /> : error ? <ErrorState message={error} onRetry={reload} /> : data ? (
        <>
          <div className="kpis">{(['critical', 'high', 'medium', 'low'] as const).map((s) => <div key={s} className={`kpi kpi--sev-${s}`}><span>{SEV_LABEL[s]}</span><strong>{data.totals[s]}</strong></div>)}</div>
          <div className="admin-grid">
            <section className="admin-card">
              <h2>Problemas por tipo</h2>
              <ul className="audit-codes">
                <li><button className={!code ? 'is-active' : ''} onClick={() => setCode('')}>Todos <span>{data.products.length} produtos</span></button></li>
                {data.byCode.map((c) => <li key={c.code}><button className={code === c.code ? 'is-active' : ''} onClick={() => setCode(c.code)}><span className={`sev sev--${c.severity}`}>{SEV_LABEL[c.severity]}</span> {c.label} <span>{c.count}</span></button></li>)}
              </ul>
            </section>
            <section className="admin-card">
              <h2>Categorias e links</h2>
              {data.emptyCategories.length ? <Notice tone="warning" title="Categorias ativas sem produtos publicados">{data.emptyCategories.map((c) => c.name).join(', ')} — desative ou associe produtos (categorias vazias não aparecem no menu).</Notice> : <p className="muted small">Nenhuma categoria ativa vazia.</p>}
              {data.invalidLinks.length ? <Notice tone="error" title="Links internos quebrados">{data.invalidLinks.map((l) => `${l.source} #${l.id}: ${l.url}`).join(' · ')}</Notice> : <p className="muted small">Nenhum link interno quebrado em banners, avisos ou campanhas.</p>}
            </section>
          </div>
          {!list.length ? <EmptyState title="Nenhum problema encontrado" /> : (
            <div className="admin-table-wrap">
              <table className="admin-table">
                <thead><tr><th>Produto</th><th>Status</th><th>Problemas</th><th /></tr></thead>
                <tbody>{list.map((p) => (
                  <tr key={p.productId}>
                    <td><Link to={`/admin/produtos/${p.productId}`} className="admin-link">{p.name}</Link>{p.blocking.length ? <span className="sev sev--critical">Bloqueia publicação</span> : null}</td>
                    <td>{p.status}</td>
                    <td><ul className="audit-issues">{p.issues.filter((i) => !code || i.code === code).map((i) => <li key={i.code}><span className={`sev sev--${i.severity}`}>{SEV_LABEL[i.severity]}</span> {i.message}</li>)}</ul></td>
                    <td><Link to={`/admin/produtos/${p.productId}`} className="link-btn">Corrigir</Link></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
          <p className="muted small">Gerado em {dt(data.generatedAt)}.</p>
        </>
      ) : null}
    </AdminShell>
  );
}

// ---------------------------------------------------------------------------------------------
// Estoque (relatório) e lista de espera
// ---------------------------------------------------------------------------------------------
interface InventoryReport { threshold: number; totals: { outOfStock: number; low: number; reservedUnits: number; units: number }; variants: { id: number; sku: string; colorName: string; size: string; stock: number; costCents: number | null; productId: number; name: string; isActive: number; reserved: number; waiting: number; lastMovement: string | null }[] }

export function AdminInventory() {
  const { data, error, loading, reload } = useApi<InventoryReport>('/api/admin/inventory');
  const wl = useApi<{ items: { variantId: number; sku: string; colorName: string; size: string; stock: number; productId: number; name: string; waiting: number; notified: number; lastAt: string }[] }>('/api/admin/waitlist');
  const { notify } = useStore();
  const can = useCan();
  const notifyNow = async (variantId: number) => {
    try { const r = await api.post<{ notified: number }>(`/api/admin/waitlist/${variantId}/notify`); notify(r.notified ? `${r.notified} cliente(s) avisado(s).` : 'Nenhum aviso enviado (sem estoque ou sem inscritos pendentes).', 'info'); wl.reload(); } catch (e) { notify(errorMessage(e), 'error'); }
  };
  return (
    <AdminShell title="Estoque">
      <p className="muted small admin-intro">Ajustes de estoque são feitos na edição do produto (com motivo e histórico). Itens de pedidos aguardando pagamento ficam reservados até o pagamento ou o fim do prazo.</p>
      {loading && !data ? <Loading /> : error ? <ErrorState message={error} onRetry={reload} /> : data ? (
        <>
          <div className="kpis">
            <div className="kpi"><span>Unidades em estoque</span><strong>{data.totals.units}</strong></div>
            <div className="kpi"><span>Variantes esgotadas</span><strong>{data.totals.outOfStock}</strong></div>
            <div className="kpi"><span>Estoque baixo (≤ {data.threshold})</span><strong>{data.totals.low}</strong></div>
            <div className="kpi"><span>Reservado em pedidos</span><strong>{data.totals.reservedUnits}</strong><small>aguardando pagamento</small></div>
          </div>
          <section className="admin-card">
            <h2>Alertas de estoque</h2>
            {!data.variants.length ? <p className="muted small">Nenhuma variante esgotada, com estoque baixo ou com lista de espera.</p> : (
              <div className="admin-table-wrap"><table className="admin-table">
                <thead><tr><th>Produto</th><th>Variante</th><th>Estoque</th><th>Reservado</th><th>Lista de espera</th><th>Última movimentação</th></tr></thead>
                <tbody>{data.variants.map((v) => (
                  <tr key={v.id}><td><Link to={`/admin/produtos/${v.productId}`} className="admin-link">{v.name}</Link></td><td>{v.colorName} · {v.size}<br /><small className="muted">{v.sku}</small></td><td className={v.stock === 0 ? 'is-danger' : 'is-warn'}>{v.stock}</td><td>{v.reserved}</td><td>{v.waiting}</td><td>{dt(v.lastMovement)}</td></tr>
                ))}</tbody>
              </table></div>
            )}
          </section>
        </>
      ) : null}
      <section className="admin-card">
        <h2>Lista de espera (avise-me)</h2>
        {wl.loading && !wl.data ? <Loading inline /> : !wl.data?.items.length ? <p className="muted small">Ninguém na lista de espera.</p> : (
          <div className="admin-table-wrap"><table className="admin-table">
            <thead><tr><th>Produto</th><th>Variante</th><th>Estoque</th><th>Aguardando</th><th>Avisados</th><th /></tr></thead>
            <tbody>{wl.data.items.map((w) => (
              <tr key={w.variantId}><td><Link to={`/admin/produtos/${w.productId}`} className="admin-link">{w.name}</Link></td><td>{w.colorName} · {w.size}</td><td>{w.stock}</td><td>{w.waiting}</td><td>{w.notified}</td>
                <td>{can('catalog.write') && w.stock > 0 && w.waiting > 0 ? <Button size="sm" variant="secondary" onClick={() => void notifyNow(w.variantId)}>Avisar agora</Button> : null}</td></tr>
            ))}</tbody>
          </table></div>
        )}
        <p className="muted small">O aviso é enviado automaticamente quando a variante volta a ter estoque (uma única vez por inscrição).</p>
      </section>
    </AdminShell>
  );
}

// ---------------------------------------------------------------------------------------------
// Moderação de avaliações
// ---------------------------------------------------------------------------------------------
export function AdminReviews() {
  const [status, setStatus] = useState('pending');
  const { data, error, loading, reload, setData } = useApi<{ reviews: AdminReviewDTO[] }>(`/api/admin/reviews${status ? `?status=${status}` : ''}`);
  const { notify } = useStore();
  const can = useCan();
  const act = async (id: number, action: 'approved' | 'rejected' | 'pending') => {
    const note = action === 'rejected' ? window.prompt('Motivo (opcional, interno):') : null;
    try { await api.post(`/api/admin/reviews/${id}/moderate`, { action, note }); notify('Avaliação atualizada.', 'success'); reload(); } catch (e) { notify(errorMessage(e), 'error'); }
    void setData;
  };
  return (
    <AdminShell title="Avaliações">
      <p className="muted small admin-intro">Somente clientes com pedido entregue podem avaliar. A loja não cria nem edita avaliações; a moderação aprova ou recusa (ex.: ofensas, dados pessoais, spam).</p>
      <div className="admin-tabs">{[['pending', 'Pendentes'], ['approved', 'Aprovadas'], ['rejected', 'Recusadas'], ['', 'Todas']].map(([k, l]) => <button key={k} className={status === k ? 'is-active' : ''} onClick={() => setStatus(k!)}>{l}</button>)}</div>
      {loading && !data ? <Loading /> : error ? <ErrorState message={error} onRetry={reload} /> : !data?.reviews.length ? <EmptyState title="Nenhuma avaliação nesta lista" /> : (
        <div className="admin-stack">
          {data.reviews.map((r) => (
            <article key={r.id} className="admin-card review-mod">
              <div className="admin-card__head"><h2><Stars value={r.rating} /> {r.title || 'Sem título'}</h2><span className="tag">{r.status === 'pending' ? 'Pendente' : r.status === 'approved' ? 'Aprovada' : 'Recusada'}</span></div>
              <p>{r.body}</p>
              <p className="muted small">{r.authorName} ({r.email ?? 'conta removida'}) · <Link to={`/admin/produtos/${r.productId}`} className="link-btn">{r.productName}</Link>{r.orderNumber ? ` · pedido ${r.orderNumber}` : ''} · {formatDate(r.createdAt)}</p>
              {can('content.write') ? (
                <div className="admin-row">
                  {r.status !== 'approved' ? <Button size="sm" onClick={() => void act(r.id, 'approved')}>Aprovar</Button> : null}
                  {r.status !== 'rejected' ? <Button size="sm" variant="secondary" onClick={() => void act(r.id, 'rejected')}>Recusar</Button> : null}
                  {r.status !== 'pending' ? <Button size="sm" variant="ghost" onClick={() => void act(r.id, 'pending')}>Voltar para pendente</Button> : null}
                </div>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </AdminShell>
  );
}

export const priceCell = (c: unknown) => (c == null ? '—' : formatPrice(Number(c)));
