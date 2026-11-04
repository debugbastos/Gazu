import { useEffect, useState, type FormEvent } from 'react';
import { api, ApiError, errorMessage } from '../../lib/api';
import { useApi } from '../../lib/hooks';
import { useStore } from '../../lib/store';
import { formatCep, formatDate, formatPrice, onlyDigits } from '../../../shared/format';
import type { CategoryDTO, PublicConfigDTO } from '../../../shared/types';
import { Button, Checkbox, Dialog, EmptyState, ErrorState, Field, Loading, SelectField, TextareaField } from '../../components/ui/ui';
import { AdminShell, fromCents, fromIso, toCents, toIso } from './Admin';

const slugify = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// ---------- Categorias ----------
export function AdminCategories() {
  const { notify } = useStore();
  const { data, error, loading, reload } = useApi<{ categories: CategoryDTO[]; tree: CategoryDTO[] }>('/api/admin/categories');
  const [edit, setEdit] = useState<{ id: number | null; name: string; slug: string; description: string; parentId: string; position: string; isActive: boolean; imageUrl: string } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const open = (c?: CategoryDTO, parentId?: number) => { setErrors({}); setEdit(c ? { id: c.id, name: c.name, slug: c.slug, description: c.description ?? '', parentId: c.parentId ? String(c.parentId) : '', position: String(c.position), isActive: c.isActive, imageUrl: c.imageUrl ?? '' } : { id: null, name: '', slug: '', description: '', parentId: parentId ? String(parentId) : '', position: '0', isActive: true, imageUrl: '' }); };
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!edit) return;
    setSaving(true);
    try {
      const body = { name: edit.name, slug: edit.slug || slugify(edit.name), description: edit.description || null, parentId: edit.parentId ? Number(edit.parentId) : null, position: Number(edit.position) || 0, isActive: edit.isActive, imageUrl: edit.imageUrl || null };
      if (edit.id) await api.put(`/api/admin/categories/${edit.id}`, body); else await api.post('/api/admin/categories', body);
      setEdit(null); reload(); notify('Categoria salva.', 'success');
    } catch (err) { if (err instanceof ApiError) setErrors(err.fieldErrors); notify(errorMessage(err), 'error'); } finally { setSaving(false); }
  };
  return (
    <AdminShell title="Categorias" actions={<Button icon="plus" onClick={() => open()}>Nova categoria</Button>}>
      {loading && !data ? <Loading /> : error ? <ErrorState message={error} onRetry={reload} /> : (
        <div className="admin-cat-tree">
          {(data?.tree ?? []).map((root) => (
            <section key={root.id} className="admin-card">
              <div className="admin-card__head">
                <h2>{root.name} {!root.isActive ? <span className="status">Inativa</span> : null}</h2>
                <div className="admin-row"><button className="link-btn" onClick={() => open(root)}>Editar</button><button className="link-btn" onClick={() => open(undefined, root.id)}>+ Subcategoria</button></div>
              </div>
              <ul className="admin-chips">
                {(root.children ?? []).map((c) => <li key={c.id}><button className={`chip${c.isActive ? '' : ' is-muted'}`} onClick={() => open(c)}>{c.name} <small className="muted">({c.productCount ?? 0})</small></button></li>)}
              </ul>
            </section>
          ))}
        </div>
      )}
      <Dialog open={Boolean(edit)} onClose={() => setEdit(null)} title={edit?.id ? 'Editar categoria' : 'Nova categoria'}>
        {edit ? (
          <form className="dialog__body" onSubmit={save}>
            <div className="admin-fields">
              <Field label="Nome" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value, slug: edit.id ? edit.slug : slugify(e.target.value) })} error={errors.name} required />
              <Field label="Slug" value={edit.slug} onChange={(e) => setEdit({ ...edit, slug: e.target.value })} error={errors.slug} />
              <SelectField label="Categoria-mãe" value={edit.parentId} onChange={(e) => setEdit({ ...edit, parentId: e.target.value })}>
                <option value="">Nenhuma (departamento)</option>
                {(data?.tree ?? []).filter((c) => c.id !== edit.id).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </SelectField>
              <Field label="Ordem" inputMode="numeric" value={edit.position} onChange={(e) => setEdit({ ...edit, position: e.target.value })} />
              <TextareaField label="Descrição" value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} className="span-2" />
              <Field label="Imagem (URL de /assets ou /uploads)" value={edit.imageUrl} onChange={(e) => setEdit({ ...edit, imageUrl: e.target.value })} optional className="span-2" />
              <div className="span-2"><Checkbox checked={edit.isActive} onChange={(v) => setEdit({ ...edit, isActive: v })} label="Ativa (visível na navegação)" /></div>
            </div>
            <div className="dialog__actions"><Button type="button" variant="ghost" onClick={() => setEdit(null)}>Cancelar</Button><Button loading={saving}>Salvar</Button></div>
          </form>
        ) : null}
      </Dialog>
    </AdminShell>
  );
}

// ---------- Cupons ----------
interface Coupon { id: number; code: string; description: string; discountType: 'percent' | 'fixed'; value: number; minOrderCents: number; startsAt: string | null; endsAt: string | null; maxUses: number | null; maxUsesPerUser: number | null; isActive: boolean; isDemo: boolean; usage: { confirmed: number; reserved: number; discountTotalCents: number }; categoryIds: number[]; productIds: number[] }

export function AdminCoupons() {
  const { notify } = useStore();
  const { data, error, loading, reload } = useApi<{ coupons: Coupon[] }>('/api/admin/coupons');
  const [edit, setEdit] = useState<{ id: number | null; code: string; description: string; discountType: 'percent' | 'fixed'; value: string; minOrder: string; startsAt: string; endsAt: string; maxUses: string; maxUsesPerUser: string; isActive: boolean; categoryIds: number[]; productIds: number[] } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const open = (c?: Coupon) => { setErrors({}); setEdit(c ? { id: c.id, code: c.code, description: c.description, discountType: c.discountType, value: c.discountType === 'percent' ? String(c.value) : fromCents(c.value), minOrder: fromCents(c.minOrderCents), startsAt: fromIso(c.startsAt), endsAt: fromIso(c.endsAt), maxUses: c.maxUses ? String(c.maxUses) : '', maxUsesPerUser: c.maxUsesPerUser ? String(c.maxUsesPerUser) : '', isActive: c.isActive, categoryIds: c.categoryIds, productIds: c.productIds } : { id: null, code: '', description: '', discountType: 'percent', value: '10', minOrder: '0,00', startsAt: '', endsAt: '', maxUses: '', maxUsesPerUser: '1', isActive: true, categoryIds: [], productIds: [] }); };
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!edit) return;
    const value = edit.discountType === 'percent' ? Number(edit.value) : toCents(edit.value);
    if (!value || value <= 0) { setErrors({ value: 'Informe um valor positivo.' }); return; }
    setSaving(true);
    try {
      const body = { code: edit.code, description: edit.description, discountType: edit.discountType, value, minOrderCents: toCents(edit.minOrder) ?? 0, startsAt: toIso(edit.startsAt), endsAt: toIso(edit.endsAt), maxUses: edit.maxUses ? Number(edit.maxUses) : null, maxUsesPerUser: edit.maxUsesPerUser ? Number(edit.maxUsesPerUser) : null, isActive: edit.isActive, categoryIds: edit.categoryIds, productIds: edit.productIds };
      if (edit.id) await api.put(`/api/admin/coupons/${edit.id}`, body); else await api.post('/api/admin/coupons', body);
      setEdit(null); reload(); notify('Cupom salvo.', 'success');
    } catch (err) { if (err instanceof ApiError) setErrors(err.fieldErrors); notify(errorMessage(err), 'error'); } finally { setSaving(false); }
  };
  return (
    <AdminShell title="Cupons" actions={<Button icon="plus" onClick={() => open()}>Novo cupom</Button>}>
      {loading && !data ? <Loading /> : error ? <ErrorState message={error} onRetry={reload} /> : !data?.coupons.length ? <EmptyState title="Nenhum cupom cadastrado" /> : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead><tr><th>Código</th><th>Desconto</th><th>Mínimo</th><th>Validade</th><th>Uso</th><th>Status</th></tr></thead>
            <tbody>{data.coupons.map((c) => (
              <tr key={c.id}>
                <td><button className="admin-link" onClick={() => open(c)}><code>{c.code}</code></button>{c.isDemo ? <span className="demo-tag">Demo</span> : null}<br /><small className="muted">{c.description}</small></td>
                <td>{c.discountType === 'percent' ? `${c.value}%` : formatPrice(c.value)}{c.categoryIds.length || c.productIds.length ? <><br /><small className="muted">restrito</small></> : null}</td>
                <td>{c.minOrderCents ? formatPrice(c.minOrderCents) : '—'}</td>
                <td>{c.startsAt ? formatDate(c.startsAt) : 'Imediato'} → {c.endsAt ? formatDate(c.endsAt) : 'sem fim'}</td>
                <td>{c.usage.confirmed}{c.maxUses ? ` / ${c.maxUses}` : ''} confirmados{c.usage.reserved ? `, ${c.usage.reserved} reservados` : ''}<br /><small className="muted">{formatPrice(c.usage.discountTotalCents)} concedidos</small></td>
                <td>{c.isActive ? <span className="status status--paid">Ativo</span> : <span className="status">Inativo</span>}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <Dialog open={Boolean(edit)} onClose={() => setEdit(null)} title={edit?.id ? `Cupom ${edit.code}` : 'Novo cupom'}>
        {edit ? (
          <form className="dialog__body" onSubmit={save} noValidate>
            <div className="admin-fields">
              <Field label="Código" value={edit.code} onChange={(e) => setEdit({ ...edit, code: e.target.value.toUpperCase() })} error={errors.code} required />
              <Field label="Descrição" value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} optional />
              <SelectField label="Tipo" value={edit.discountType} onChange={(e) => setEdit({ ...edit, discountType: e.target.value as 'percent' | 'fixed' })}>
                <option value="percent">Percentual (%)</option>
                <option value="fixed">Valor fixo (R$)</option>
              </SelectField>
              <Field label={edit.discountType === 'percent' ? 'Percentual (máx. 90)' : 'Valor (R$)'} inputMode="decimal" value={edit.value} onChange={(e) => setEdit({ ...edit, value: e.target.value })} error={errors.value} />
              <Field label="Pedido mínimo (R$)" inputMode="decimal" value={edit.minOrder} onChange={(e) => setEdit({ ...edit, minOrder: e.target.value })} />
              <Field label="Limite total de usos" inputMode="numeric" value={edit.maxUses} onChange={(e) => setEdit({ ...edit, maxUses: e.target.value })} optional />
              <Field label="Limite por cliente" inputMode="numeric" value={edit.maxUsesPerUser} onChange={(e) => setEdit({ ...edit, maxUsesPerUser: e.target.value })} optional />
              <Field label="Início" type="datetime-local" value={edit.startsAt} onChange={(e) => setEdit({ ...edit, startsAt: e.target.value })} optional />
              <Field label="Fim" type="datetime-local" value={edit.endsAt} onChange={(e) => setEdit({ ...edit, endsAt: e.target.value })} error={errors.endsAt} optional />
              <div className="span-2"><Checkbox checked={edit.isActive} onChange={(v) => setEdit({ ...edit, isActive: v })} label="Ativo" /></div>
            </div>
            <p className="muted small">O desconto é validado e calculado no servidor em cada cotação e novamente na criação do pedido.</p>
            <div className="dialog__actions"><Button type="button" variant="ghost" onClick={() => setEdit(null)}>Cancelar</Button><Button loading={saving}>Salvar cupom</Button></div>
          </form>
        ) : null}
      </Dialog>
    </AdminShell>
  );
}

// ---------- Frete (política manual por faixa de CEP) ----------
interface Rule { id: number; name: string; cepStart: string; cepEnd: string; priceCents: number; minDays: number; maxDays: number; freeAboveCents: number | null; isActive: number; position: number }

export function AdminShipping() {
  const { notify, config } = useStore();
  const { data, error, loading, reload } = useApi<{ rules: Rule[] }>('/api/admin/shipping-rules');
  const [edit, setEdit] = useState<{ id: number | null; name: string; cepStart: string; cepEnd: string; price: string; minDays: string; maxDays: string; freeAbove: string; isActive: boolean; position: string } | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const open = (r?: Rule) => { setErrors({}); setEdit(r ? { id: r.id, name: r.name, cepStart: r.cepStart, cepEnd: r.cepEnd, price: fromCents(r.priceCents), minDays: String(r.minDays), maxDays: String(r.maxDays), freeAbove: fromCents(r.freeAboveCents), isActive: Boolean(r.isActive), position: String(r.position) } : { id: null, name: '', cepStart: '', cepEnd: '', price: '', minDays: '', maxDays: '', freeAbove: '', isActive: true, position: '0' }); };
  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!edit) return;
    setSaving(true);
    try {
      const body = { name: edit.name, cepStart: onlyDigits(edit.cepStart), cepEnd: onlyDigits(edit.cepEnd), priceCents: toCents(edit.price) ?? -1, minDays: Number(edit.minDays), maxDays: Number(edit.maxDays), freeAboveCents: edit.freeAbove ? toCents(edit.freeAbove) : null, isActive: edit.isActive, position: Number(edit.position) || 0 };
      if (edit.id) await api.put(`/api/admin/shipping-rules/${edit.id}`, body); else await api.post('/api/admin/shipping-rules', body);
      setEdit(null); reload(); notify('Regra salva.', 'success');
    } catch (err) { if (err instanceof ApiError) setErrors(err.fieldErrors); notify(errorMessage(err), 'error'); } finally { setSaving(false); }
  };
  const remove = async (r: Rule) => {
    if (!window.confirm(`Excluir a regra "${r.name}"?`)) return;
    try { await api.del(`/api/admin/shipping-rules/${r.id}`); reload(); } catch (err) { notify(errorMessage(err), 'error'); }
  };
  return (
    <AdminShell title="Frete" actions={<Button icon="plus" onClick={() => open()}>Nova regra</Button>}>
      <p className="muted small admin-intro">Política manual de frete por faixa de CEP, usada enquanto não houver integração com transportadora. {config.shipping.provider === 'demo' ? 'O ambiente está em SHIPPING_PROVIDER=demo: as cotações exibidas na loja são simuladas.' : ''}</p>
      {loading && !data ? <Loading /> : error ? <ErrorState message={error} onRetry={reload} /> : !data?.rules.length ? <EmptyState title="Nenhuma regra de frete" text="Sem regras ativas, o checkout informa que a entrega não está disponível para o CEP." /> : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead><tr><th>Nome</th><th>Faixa de CEP</th><th>Valor</th><th>Prazo</th><th>Grátis acima de</th><th>Status</th><th /></tr></thead>
            <tbody>{data.rules.map((r) => (
              <tr key={r.id}>
                <td><button className="admin-link" onClick={() => open(r)}>{r.name}</button></td>
                <td>{formatCep(r.cepStart)} – {formatCep(r.cepEnd)}</td>
                <td>{formatPrice(r.priceCents)}</td>
                <td>{r.minDays}–{r.maxDays} dias úteis</td>
                <td>{r.freeAboveCents ? formatPrice(r.freeAboveCents) : '—'}</td>
                <td>{r.isActive ? <span className="status status--paid">Ativa</span> : <span className="status">Inativa</span>}</td>
                <td><button className="link-btn" onClick={() => void remove(r)}>Excluir</button></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <Dialog open={Boolean(edit)} onClose={() => setEdit(null)} title={edit?.id ? 'Editar regra' : 'Nova regra de frete'}>
        {edit ? (
          <form className="dialog__body" onSubmit={save} noValidate>
            <div className="admin-fields">
              <Field label="Nome exibido" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} error={errors.name} placeholder="Entrega padrão — Sudeste" className="span-2" />
              <Field label="CEP inicial" value={formatCep(edit.cepStart)} onChange={(e) => setEdit({ ...edit, cepStart: e.target.value })} error={errors.cepStart} inputMode="numeric" maxLength={9} />
              <Field label="CEP final" value={formatCep(edit.cepEnd)} onChange={(e) => setEdit({ ...edit, cepEnd: e.target.value })} error={errors.cepEnd} inputMode="numeric" maxLength={9} />
              <Field label="Valor (R$)" value={edit.price} onChange={(e) => setEdit({ ...edit, price: e.target.value })} error={errors.priceCents} inputMode="decimal" />
              <Field label="Grátis acima de (R$)" value={edit.freeAbove} onChange={(e) => setEdit({ ...edit, freeAbove: e.target.value })} inputMode="decimal" optional />
              <Field label="Prazo mínimo (dias úteis)" value={edit.minDays} onChange={(e) => setEdit({ ...edit, minDays: e.target.value })} inputMode="numeric" />
              <Field label="Prazo máximo (dias úteis)" value={edit.maxDays} onChange={(e) => setEdit({ ...edit, maxDays: e.target.value })} error={errors.maxDays} inputMode="numeric" />
              <Field label="Ordem" value={edit.position} onChange={(e) => setEdit({ ...edit, position: e.target.value })} inputMode="numeric" />
              <div><Checkbox checked={edit.isActive} onChange={(v) => setEdit({ ...edit, isActive: v })} label="Ativa" /></div>
            </div>
            <div className="dialog__actions"><Button type="button" variant="ghost" onClick={() => setEdit(null)}>Cancelar</Button><Button loading={saving}>Salvar regra</Button></div>
          </form>
        ) : null}
      </Dialog>
    </AdminShell>
  );
}

// ---------- Clientes ----------
interface CustomerRow { id: string; email: string; role: string; staffRole: string | null; isGuest: number; anonymizedAt: string | null; createdAt: string; emailVerified: number; name: string | null; orders: number; spentCents: number }
export function AdminCustomers() {
  const { notify, user } = useStore();
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const { data, error, loading, reload } = useApi<{ customers: CustomerRow[] }>(`/api/admin/customers?q=${encodeURIComponent(query)}`);
  const canPrivacy = Boolean(user?.permissions?.includes('customers.privacy'));
  const anonymize = async (c: CustomerRow) => {
    const typed = window.prompt(`Anonimizar a conta ${c.email}? Esta ação é irreversível. Pedidos e pagamentos são mantidos sem dados de contato (obrigação fiscal).\n\nDigite ANONIMIZAR para confirmar:`);
    if (typed !== 'ANONIMIZAR') return;
    try { await api.post(`/api/admin/privacy/users/${c.id}/anonymize`, { confirm: 'ANONIMIZAR' }); notify('Conta anonimizada.', 'success'); reload(); } catch (e) { notify(errorMessage(e), 'error'); }
  };
  return (
    <AdminShell title="Clientes">
      <form role="search" className="admin-search" onSubmit={(e) => { e.preventDefault(); setQuery(q.trim()); }}>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Nome ou e-mail" aria-label="Buscar clientes" />
      </form>
      <p className="muted small admin-intro">Exibimos apenas dados necessários à operação. Senhas, tokens e dados de cartão nunca são acessíveis pelo painel. "Visitante" = comprou sem cadastro.</p>
      {loading && !data ? <Loading /> : error ? <ErrorState message={error} onRetry={reload} /> : !data?.customers.length ? <EmptyState title="Nenhum cliente encontrado" /> : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead><tr><th>Cliente</th><th>E-mail</th><th>Pedidos</th><th>Comprado (pago)</th><th>Cadastro</th><th>Perfil</th>{canPrivacy ? <th>LGPD</th> : null}</tr></thead>
            <tbody>{data.customers.map((c) => (
              <tr key={c.id} className={c.anonymizedAt ? 'is-muted' : ''}>
                <td>{c.name ?? '—'}</td>
                <td>{c.email}{c.emailVerified ? '' : <small className="muted"> (não confirmado)</small>}</td>
                <td>{c.orders}</td>
                <td>{formatPrice(c.spentCents)}</td>
                <td>{formatDate(c.createdAt)}</td>
                <td>{c.anonymizedAt ? <span className="status">Anonimizado</span> : c.role === 'admin' ? <span className="status status--processing">Equipe{c.staffRole ? ` · ${c.staffRole}` : ''}</span> : c.isGuest ? <span className="status">Visitante</span> : 'Cliente'}</td>
                {canPrivacy ? <td className="admin-row">{!c.anonymizedAt ? <><a className="link-btn" href={`/api/admin/privacy/users/${c.id}/export`} download>Exportar</a>{c.role !== 'admin' ? <button className="link-btn" onClick={() => void anonymize(c)}>Anonimizar</button> : null}</> : null}</td> : null}
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
    </AdminShell>
  );
}
