import { useState } from 'react';
import { api } from '../../lib/api';
import { formatCep, onlyDigits, UF } from '../../../shared/format';
import { Checkbox, Field, SelectField } from '../ui/ui';

export interface AddressValues {
  label: string; recipient: string; cep: string; street: string; number: string; complement: string; district: string; city: string; state: string; isDefault: boolean;
}

export const emptyAddress = (recipient = ''): AddressValues => ({ label: 'Casa', recipient, cep: '', street: '', number: '', complement: '', district: '', city: '', state: '', isDefault: false });

export function validateAddress(a: AddressValues): Record<string, string> {
  const e: Record<string, string> = {};
  if (a.recipient.trim().length < 3) e.recipient = 'Informe o nome do destinatário.';
  if (onlyDigits(a.cep).length !== 8) e.cep = 'CEP inválido.';
  if (a.street.trim().length < 2) e.street = 'Informe a rua.';
  if (!a.number.trim()) e.number = 'Informe o número (ou "s/n").';
  if (a.district.trim().length < 2) e.district = 'Informe o bairro.';
  if (a.city.trim().length < 2) e.city = 'Informe a cidade.';
  if (!(UF as readonly string[]).includes(a.state)) e.state = 'Selecione a UF.';
  return e;
}

/** Formulário de endereço com preenchimento opcional por CEP (se o serviço falhar, o preenchimento é manual). */
export function AddressForm({ value, onChange, errors, showDefault }: { value: AddressValues; onChange: (v: AddressValues) => void; errors: Record<string, string>; showDefault?: boolean }) {
  const [lookup, setLookup] = useState<'idle' | 'loading' | 'notfound' | 'unavailable'>('idle');
  const set = (k: keyof AddressValues, v: string | boolean) => onChange({ ...value, [k]: v });
  const onCep = async (raw: string) => {
    const cep = onlyDigits(raw).slice(0, 8);
    onChange({ ...value, cep });
    if (cep.length !== 8) return;
    setLookup('loading');
    try {
      const r = await api.get<{ found: boolean; unavailable?: boolean; street?: string; district?: string; city?: string; state?: string }>(`/api/cep/${cep}`);
      if (r.found) {
        onChange({ ...value, cep, street: r.street || value.street, district: r.district || value.district, city: r.city || value.city, state: r.state || value.state });
        setLookup('idle');
      } else setLookup(r.unavailable ? 'unavailable' : 'notfound');
    } catch {
      setLookup('unavailable');
    }
  };
  return (
    <div className="address-form">
      <Field label="Nome do destinatário" value={value.recipient} onChange={(e) => set('recipient', e.target.value)} error={errors.recipient} autoComplete="name" required className="span-2" />
      <Field
        label="CEP" value={formatCep(value.cep)} onChange={(e) => void onCep(e.target.value)} error={errors.cep} inputMode="numeric" autoComplete="postal-code" required maxLength={9}
        hint={lookup === 'loading' ? 'Buscando endereço…' : lookup === 'notfound' ? 'CEP não encontrado — preencha manualmente.' : lookup === 'unavailable' ? 'Preenchimento automático indisponível — preencha manualmente.' : undefined}
      />
      <Field label="Identificação" value={value.label} onChange={(e) => set('label', e.target.value)} placeholder="Casa, trabalho…" optional maxLength={40} />
      <Field label="Rua" value={value.street} onChange={(e) => set('street', e.target.value)} error={errors.street} autoComplete="address-line1" required className="span-2" />
      <Field label="Número" value={value.number} onChange={(e) => set('number', e.target.value)} error={errors.number} required maxLength={20} />
      <Field label="Complemento" value={value.complement} onChange={(e) => set('complement', e.target.value)} optional autoComplete="address-line2" maxLength={80} />
      <Field label="Bairro" value={value.district} onChange={(e) => set('district', e.target.value)} error={errors.district} required />
      <Field label="Cidade" value={value.city} onChange={(e) => set('city', e.target.value)} error={errors.city} autoComplete="address-level2" required />
      <SelectField label="UF" value={value.state} onChange={(e) => set('state', e.target.value)} error={errors.state} required>
        <option value="">Selecione</option>
        {UF.map((u) => <option key={u} value={u}>{u}</option>)}
      </SelectField>
      {showDefault ? <div className="span-2"><Checkbox checked={value.isDefault} onChange={(v) => set('isDefault', v)} label="Usar como endereço principal" /></div> : null}
    </div>
  );
}
