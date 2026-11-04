import { useEffect, useState, type FormEvent } from 'react';
import { api, errorMessage } from '../../lib/api';
import { useApi } from '../../lib/hooks';
import { Link } from '../../lib/router';
import { useStore } from '../../lib/store';
import type { HomeSectionKey } from '../../../shared/types';
import { Icon } from '../../components/ui/Icon';
import { Button, Checkbox, ErrorState, Field, Loading, Notice, TextareaField } from '../../components/ui/ui';
import { AdminShell, fromCents, toCents } from './Admin';
import { useCan } from './AdminKit';

// Configurações administráveis. Campos vazios = ainda não fornecidos pela loja: o site não inventa
// CNPJ, endereço, telefone, prazos comerciais nem custos.

interface StoreSettings {
  announcements: string[]; heroTagline: string[]; heroCollectionLabel: string[]; showAccessoriesOnHome: boolean;
  contact: { email: string; phone: string; whatsapp: string; serviceHours: string };
  company: { legalName: string; cnpj: string; address: string };
  social: { instagram: string; tiktok: string; facebook: string };
  home: { sections: { key: HomeSectionKey; enabled: boolean }[] };
  operations: { packagingCostCents: number | null; lowStockThreshold: number; newArrivalsDays: number; abandonedCartHours: number; exchangeDays: number | null };
  whatsapp: { showButton: boolean; defaultMessage: string };
  newsletter: { enabled: boolean; title: string; text: string };
  reviews: { enabled: boolean; requireModeration: boolean };
  shippingSender: { name: string; phone: string; email: string; document: string; street: string; number: string; complement: string; district: string; city: string; state: string; cep: string };
}

const SECTION_LABEL: Record<HomeSectionKey, string> = {
  categories: 'Categorias visuais', editorial: 'Banner editorial', trust: 'Confiança e suporte', featured: 'O melhor da GAZU (destaques)', new: 'Novidades',
  collections: 'Coleções em destaque', lookbook: 'Lookbook comprável', journal: 'Editorial GAZU (Journal)', clothing: 'Seleção de roupas', sneakers: 'Seleção de tênis', accessories: 'Acessórios', newsletter: 'Newsletter',
};

export function AdminSettings() {
  const { notify } = useStore();
  const can = useCan();
  const { data, error, loading, reload } = useApi<StoreSettings>('/api/admin/settings');
  const [s, setS] = useState<StoreSettings | null>(null);
  const [pack, setPack] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (data) { setS(data); setPack(fromCents(data.operations.packagingCostCents)); } }, [data]);
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!s) return;
    setSaving(true);
    try {
      const clean: StoreSettings = {
        ...s, heroTagline: s.heroTagline.map((a) => a.trim()).filter(Boolean), heroCollectionLabel: s.heroCollectionLabel.map((a) => a.trim()).filter(Boolean),
        operations: { ...s.operations, packagingCostCents: pack.trim() ? toCents(pack) : null },
      };
      const r = await api.put<StoreSettings>('/api/admin/settings', clean);
      setS(r);
      setPack(fromCents(r.operations.packagingCostCents));
      notify('Configurações salvas. Recarregue a loja para ver as mudanças.', 'success');
    } catch (err) { notify(errorMessage(err), 'error'); } finally { setSaving(false); }
  };
  const lines = (v: string) => v.split('\n');
  const moveSection = (i: number, d: number) => {
    if (!s) return;
    const list = [...s.home.sections];
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j]!, list[i]!];
    setS({ ...s, home: { sections: list } });
  };
  const num = (v: string, min: number, max: number) => Math.max(min, Math.min(max, Number(v.replace(/\D/g, '')) || min));
  const writable = can('settings.write');

  return (
    <AdminShell title="Configurações">
      {!writable ? <Notice tone="info">Sua função permite apenas visualizar as configurações.</Notice> : null}
      {loading && !s ? <Loading /> : error && !s ? <ErrorState message={error} onRetry={reload} /> : s ? (
        <form className="admin-form" onSubmit={save}>
          <section className="admin-card">
            <h2>Página inicial</h2>
            <p className="muted small">Ordem e visibilidade das seções da home. Os avisos do topo ficam em <Link to="/admin/conteudo/avisos" className="link-underline">Conteúdo › Avisos do topo</Link> (com início e fim de exibição).</p>
            <ol className="section-order">
              {s.home.sections.map((sec, i) => (
                <li key={sec.key} className={sec.enabled ? '' : 'is-off'}>
                  <span className="section-order__n">{String(i + 1).padStart(2, '0')}</span>
                  <Checkbox checked={sec.enabled} onChange={(v) => setS({ ...s, home: { sections: s.home.sections.map((x) => (x.key === sec.key ? { ...x, enabled: v } : x)) } })} label={SECTION_LABEL[sec.key] ?? sec.key} />
                  <span className="admin-row">
                    <button type="button" className="icon-btn" onClick={() => moveSection(i, -1)} aria-label={`Subir ${SECTION_LABEL[sec.key]}`} disabled={i === 0}><Icon name="chevronLeft" size={14} /></button>
                    <button type="button" className="icon-btn" onClick={() => moveSection(i, 1)} aria-label={`Descer ${SECTION_LABEL[sec.key]}`} disabled={i === s.home.sections.length - 1}><Icon name="chevronRight" size={14} /></button>
                  </span>
                </li>
              ))}
            </ol>
            <div className="admin-fields">
              <TextareaField label="Chamada do hero (uma linha por verso)" value={s.heroTagline.join('\n')} onChange={(e) => setS({ ...s, heroTagline: lines(e.target.value).slice(0, 4) })} />
              <TextareaField label="Selo de coleção do hero (uma linha por verso)" value={s.heroCollectionLabel.join('\n')} onChange={(e) => setS({ ...s, heroCollectionLabel: lines(e.target.value).slice(0, 4) })} />
              <div className="span-2"><Checkbox checked={s.showAccessoriesOnHome} onChange={(v) => setS({ ...s, showAccessoriesOnHome: v })} label="Exibir a vitrine de acessórios" /></div>
            </div>
            <p className="muted small">Não anuncie frete grátis, descontos ou prazos que não estejam configurados no sistema.</p>
          </section>

          <section className="admin-card">
            <h2>Atendimento e WhatsApp</h2>
            <div className="admin-fields">
              <Field label="E-mail de atendimento" type="email" value={s.contact.email} onChange={(e) => setS({ ...s, contact: { ...s.contact, email: e.target.value } })} optional />
              <Field label="Telefone" value={s.contact.phone} onChange={(e) => setS({ ...s, contact: { ...s.contact, phone: e.target.value } })} optional />
              <Field label="WhatsApp (com DDD)" value={s.contact.whatsapp} onChange={(e) => setS({ ...s, contact: { ...s.contact, whatsapp: e.target.value } })} optional hint="Usado no botão “Falar no WhatsApp” (link wa.me)." />
              <Field label="Horário de atendimento" value={s.contact.serviceHours} onChange={(e) => setS({ ...s, contact: { ...s.contact, serviceHours: e.target.value } })} optional />
              <div className="span-2"><Checkbox checked={s.whatsapp.showButton} onChange={(v) => setS({ ...s, whatsapp: { ...s.whatsapp, showButton: v } })} label="Mostrar botão flutuante do WhatsApp (somente com número preenchido)" /></div>
              <Field label="Mensagem inicial do WhatsApp" value={s.whatsapp.defaultMessage} onChange={(e) => setS({ ...s, whatsapp: { ...s.whatsapp, defaultMessage: e.target.value } })} className="span-2" />
            </div>
          </section>

          <section className="admin-card">
            <h2>Newsletter e avaliações</h2>
            <div className="admin-fields">
              <div className="span-2"><Checkbox checked={s.newsletter.enabled} onChange={(v) => setS({ ...s, newsletter: { ...s.newsletter, enabled: v } })} label="Newsletter ativa (com confirmação por e-mail)" /></div>
              <Field label="Título da newsletter" value={s.newsletter.title} onChange={(e) => setS({ ...s, newsletter: { ...s.newsletter, title: e.target.value } })} />
              <Field label="Texto da newsletter" value={s.newsletter.text} onChange={(e) => setS({ ...s, newsletter: { ...s.newsletter, text: e.target.value } })} />
              <div className="span-2 admin-checks">
                <Checkbox checked={s.reviews.enabled} onChange={(v) => setS({ ...s, reviews: { ...s.reviews, enabled: v } })} label="Avaliações de produtos (somente compras entregues)" />
                <Checkbox checked={s.reviews.requireModeration} onChange={(v) => setS({ ...s, reviews: { ...s.reviews, requireModeration: v } })} label="Moderar antes de publicar" />
              </div>
            </div>
          </section>

          <section className="admin-card">
            <h2>Operação e custos</h2>
            <div className="admin-fields">
              <Field label="Custo de embalagem por pedido (R$)" value={pack} onChange={(e) => setPack(e.target.value)} optional inputMode="decimal" hint="Usado no financeiro. Deixe vazio se ainda não souber: o lucro estimado indicará o dado ausente." />
              <Field label="Alerta de estoque baixo (unidades)" value={String(s.operations.lowStockThreshold)} onChange={(e) => setS({ ...s, operations: { ...s.operations, lowStockThreshold: num(e.target.value, 0, 100) } })} inputMode="numeric" />
              <Field label="Selo “Novo” por (dias)" value={String(s.operations.newArrivalsDays)} onChange={(e) => setS({ ...s, operations: { ...s.operations, newArrivalsDays: num(e.target.value, 1, 365) } })} inputMode="numeric" />
              <Field label="Lembrete de carrinho após (horas)" value={String(s.operations.abandonedCartHours)} onChange={(e) => setS({ ...s, operations: { ...s.operations, abandonedCartHours: num(e.target.value, 1, 168) } })} inputMode="numeric" hint="Enviado uma vez, só para clientes que autorizaram e-mails de marketing." />
              <Field label="Prazo de troca de tamanho/cor (dias)" value={s.operations.exchangeDays == null ? '' : String(s.operations.exchangeDays)} onChange={(e) => setS({ ...s, operations: { ...s.operations, exchangeDays: e.target.value.trim() ? num(e.target.value, 1, 365) : null } })} optional inputMode="numeric" hint="Vazio = sem prazo automático (cada caso é avaliado). Desistência (7 dias) e defeito (90 dias) seguem o CDC." />
            </div>
          </section>

          <section className="admin-card">
            <h2>Remetente das etiquetas (Melhor Envio)</h2>
            <p className="muted small">Necessário para comprar etiquetas. Use os dados reais do remetente cadastrados na conta do Melhor Envio.</p>
            <div className="admin-fields">
              {([['name', 'Nome / razão social'], ['document', 'CPF ou CNPJ'], ['email', 'E-mail'], ['phone', 'Telefone'], ['cep', 'CEP'], ['street', 'Rua'], ['number', 'Número'], ['complement', 'Complemento'], ['district', 'Bairro'], ['city', 'Cidade'], ['state', 'UF']] as const).map(([k, l]) => (
                <Field key={k} label={l} value={s.shippingSender[k]} onChange={(e) => setS({ ...s, shippingSender: { ...s.shippingSender, [k]: k === 'state' ? e.target.value.toUpperCase().slice(0, 2) : e.target.value } })} optional={k === 'complement'} />
              ))}
            </div>
          </section>

          <section className="admin-card">
            <h2>Dados da empresa</h2>
            <div className="admin-fields">
              <Field label="Razão social" value={s.company.legalName} onChange={(e) => setS({ ...s, company: { ...s.company, legalName: e.target.value } })} optional />
              <Field label="CNPJ" value={s.company.cnpj} onChange={(e) => setS({ ...s, company: { ...s.company, cnpj: e.target.value } })} optional />
              <Field label="Endereço" value={s.company.address} onChange={(e) => setS({ ...s, company: { ...s.company, address: e.target.value } })} optional className="span-2" />
            </div>
          </section>

          <section className="admin-card">
            <h2>Redes sociais</h2>
            <div className="admin-fields">
              <Field label="Instagram (URL)" type="url" value={s.social.instagram} onChange={(e) => setS({ ...s, social: { ...s.social, instagram: e.target.value } })} optional />
              <Field label="TikTok (URL)" type="url" value={s.social.tiktok} onChange={(e) => setS({ ...s, social: { ...s.social, tiktok: e.target.value } })} optional />
              <Field label="Facebook (URL)" type="url" value={s.social.facebook} onChange={(e) => setS({ ...s, social: { ...s.social, facebook: e.target.value } })} optional />
            </div>
          </section>
          {writable ? <div className="admin-savebar"><Button size="lg" loading={saving}>Salvar configurações</Button></div> : null}
        </form>
      ) : null}
    </AdminShell>
  );
}
