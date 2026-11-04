import { env } from '../config.ts';
import { getDb } from '../db.ts';
import { on } from '../events.ts';
import { formatPrice as formatBRL, ORDER_STATUS_LABEL, PAYMENT_METHOD_LABEL, RETURN_STATUS_LABEL, SHIPMENT_STATUS_LABEL } from '../../shared/format.ts';
import { sendEmail } from './email.ts';
import { getSettings } from './settings.ts';
import { logError } from './monitoring.ts';

// Comunicações transacionais da GAZU.
// - Disparadas por eventos de domínio somente DEPOIS do COMMIT (ver events.ts): nada é enviado se a operação falhar.
// - Deduplicadas por chave (tabela notifications.dedupe_key): repetir um webhook ou uma ação não reenvia a mensagem.
// - Identidade visual de e-mail: fundo claro, tipografia sem serifa, títulos em caixa alta, preto #111111,
//   botão retangular sem cantos arredondados (mesma linguagem do site). Logotipo em texto (não depende de imagem externa).
// - Pedidos de visitante: o link de acesso com token só é enviado na confirmação; depois, o rastreio público.

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const url = (path: string) => new URL(path, env.APP_URL).toString();

export interface EmailContent { subject: string; preheader: string; title: string; intro: string; rows?: [string, string][]; blocks?: string[]; cta?: { label: string; href: string }; outro?: string }

/** Monta HTML (com estilos inline, compatível com clientes de e-mail) e a versão em texto puro. */
export function renderBrandEmail(c: EmailContent): { html: string; text: string } {
  const s = getSettings();
  const contact = [s.contact.email, s.contact.whatsapp ? `WhatsApp ${s.contact.whatsapp}` : '', s.contact.serviceHours].filter(Boolean).join(' · ');
  const company = [s.company.legalName, s.company.cnpj ? `CNPJ ${s.company.cnpj}` : ''].filter(Boolean).join(' — ');
  const rows = (c.rows ?? []).map(([k, v]) => `<tr><td style="padding:8px 0;border-bottom:1px solid #e6e5e1;color:#6b6b6b;font-size:13px">${esc(k)}</td><td style="padding:8px 0;border-bottom:1px solid #e6e5e1;text-align:right;font-size:13px;color:#111111">${esc(v)}</td></tr>`).join('');
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(c.subject)}</title></head>
<body style="margin:0;padding:0;background:#f7f6f3;font-family:Inter,'Helvetica Neue',Arial,sans-serif;color:#111111">
<span style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(c.preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f6f3"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #e6e5e1">
<tr><td style="padding:28px 32px;border-bottom:1px solid #111111"><img src="${esc(url('/assets/branding/logo/gazu-logo-email.png'))}" width="132" height="24" alt="GAZU" style="display:inline-block;border:0;height:24px;width:132px;font-size:22px;font-weight:700;letter-spacing:0.12em;color:#111111;vertical-align:middle"><span style="float:right;font-size:10px;letter-spacing:0.22em;color:#6b6b6b;text-transform:uppercase;line-height:24px">Moda que se move com você</span></td></tr>
<tr><td style="padding:32px">
<h1 style="margin:0 0 16px;font-size:20px;line-height:1.25;letter-spacing:0.06em;text-transform:uppercase;font-weight:700">${esc(c.title)}</h1>
<p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#242424">${esc(c.intro)}</p>
${rows ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px">${rows}</table>` : ''}
${(c.blocks ?? []).map((b) => `<p style="margin:0 0 16px;font-size:14px;line-height:1.6;color:#242424">${esc(b)}</p>`).join('')}
${c.cta ? `<p style="margin:28px 0"><a href="${esc(c.cta.href)}" style="display:inline-block;background:#111111;color:#ffffff;text-decoration:none;padding:14px 28px;font-size:12px;letter-spacing:0.14em;text-transform:uppercase;font-weight:600">${esc(c.cta.label)}</a></p>` : ''}
${c.outro ? `<p style="margin:0;font-size:13px;line-height:1.6;color:#6b6b6b">${esc(c.outro)}</p>` : ''}
</td></tr>
<tr><td style="padding:20px 32px;background:#111111;color:#b9b8b4;font-size:11px;line-height:1.6">
<a href="${esc(url('/ajuda'))}" style="color:#ffffff;text-decoration:none;letter-spacing:0.14em;text-transform:uppercase">Central de ajuda</a>${contact ? `<br>${esc(contact)}` : ''}${company ? `<br>${esc(company)}` : ''}<br>Este é um e-mail transacional sobre sua compra ou solicitação na GAZU.
</td></tr></table></td></tr></table></body></html>`;
  const text = [
    'GAZU', '', c.title.toUpperCase(), '', c.intro, '',
    ...(c.rows ?? []).map(([k, v]) => `${k}: ${v}`), ...(c.rows?.length ? [''] : []),
    ...(c.blocks ?? []).flatMap((b) => [b, '']),
    ...(c.cta ? [`${c.cta.label}: ${c.cta.href}`, ''] : []),
    ...(c.outro ? [c.outro, ''] : []),
    `Central de ajuda: ${url('/ajuda')}`, ...(contact ? [contact] : []),
  ].join('\n');
  return { html, text };
}

export type NotifyResult = 'sent' | 'logged' | 'failed' | 'duplicate' | 'skipped';

/** Envia uma notificação uma única vez por chave de deduplicação. */
export async function notify(input: { event: string; recipient: string; dedupeKey: string; content: EmailContent; orderId?: number | null; userId?: string | null }): Promise<NotifyResult> {
  const db = getDb();
  const inserted = db.run(
    "INSERT OR IGNORE INTO notifications (event, channel, recipient, order_id, user_id, status, dedupe_key) VALUES (?, 'email', ?, ?, ?, 'skipped', ?)",
    input.event, input.recipient, input.orderId ?? null, input.userId ?? null, input.dedupeKey,
  );
  if (!inserted.changes) return 'duplicate';
  try {
    const { html, text } = renderBrandEmail(input.content);
    const r = await sendEmail(input.recipient, input.content.subject, text, { html, event: input.event });
    db.run('UPDATE notifications SET status = ?, email_outbox_id = ? WHERE dedupe_key = ?', r.status, r.id, input.dedupeKey);
    return r.status;
  } catch (e) {
    db.run("UPDATE notifications SET status = 'failed', detail = ? WHERE dedupe_key = ?", String((e as Error).message).slice(0, 200), input.dedupeKey);
    logError('error', 'notifications', e, { event: input.event, orderId: input.orderId });
    return 'failed';
  }
}

interface OrderInfo { id: number; number: string; status: string; total_cents: number; user_id: string; customer_email: string | null; customer_name: string | null; email: string; is_guest: number; shipping_label: string; shipping_days_text: string | null; is_demo: number }

function orderInfo(orderId: number): OrderInfo | null {
  return getDb().get<OrderInfo>(
    `SELECT o.id, o.number, o.status, o.total_cents, o.user_id, o.customer_email, o.customer_name, u.email, u.is_guest, o.shipping_label, o.shipping_days_text, o.is_demo
       FROM orders o JOIN users u ON u.id = o.user_id WHERE o.id = ?`, orderId,
  ) ?? null;
}

const firstName = (o: OrderInfo) => (o.customer_name ?? '').trim().split(/\s+/)[0] || 'Olá';
const recipientOf = (o: OrderInfo) => o.customer_email ?? o.email;
/** Link do pedido: conta (cliente cadastrado) ou rastreio público (visitante, sem token em e-mails posteriores). */
const orderHref = (o: OrderInfo) => (o.is_guest ? url(`/rastreio?pedido=${encodeURIComponent(o.number)}`) : url(`/conta/pedidos/${encodeURIComponent(o.number)}`));
const demoNote = (o: OrderInfo) => (o.is_demo ? ['ATENÇÃO: pedido de DEMONSTRAÇÃO — nenhum valor real foi cobrado e nada será enviado.'] : []);

function itemsRows(orderId: number): [string, string][] {
  return getDb().all<{ product_name: string; color_name: string; size: string; quantity: number; line_total_cents: number }>('SELECT * FROM order_items WHERE order_id = ? ORDER BY id', orderId)
    .map((i) => [`${i.quantity}× ${i.product_name} — ${i.color_name}, ${i.size}`, formatBRL(i.line_total_cents)]);
}

export async function notifyOrderCreated(orderId: number, guestToken?: string): Promise<NotifyResult> {
  const o = orderInfo(orderId);
  if (!o) return 'skipped';
  const href = guestToken ? url(`/pedido/${encodeURIComponent(o.number)}?acesso=${encodeURIComponent(guestToken)}`) : orderHref(o);
  return notify({
    event: 'order.created', recipient: recipientOf(o), orderId: o.id, userId: o.user_id, dedupeKey: `order:${o.id}:created`,
    content: {
      subject: `Recebemos seu pedido ${o.number} — GAZU`, preheader: 'Seu pedido foi registrado e aguarda o pagamento.',
      title: 'Pedido recebido', intro: `${firstName(o)}, recebemos o seu pedido ${o.number}. Os itens ficam reservados até a confirmação do pagamento.`,
      rows: [...itemsRows(o.id), ['Entrega', `${o.shipping_label}${o.shipping_days_text ? ` (${o.shipping_days_text})` : ''}`], ['Total', formatBRL(o.total_cents)]],
      blocks: [...demoNote(o), ...(guestToken ? ['Guarde este e-mail: o botão abaixo é o seu acesso ao pedido (compra sem cadastro). Não compartilhe este link.'] : [])],
      cta: { label: 'Ver pedido e pagar', href }, outro: 'Se você não reconhece esta compra, responda a este e-mail ou fale com a nossa central de ajuda.',
    },
  });
}

async function onPaymentPending(orderId: number, paymentId: number): Promise<void> {
  const o = orderInfo(orderId);
  const p = getDb().get<{ method: string; expires_at: string | null; boleto_url: string | null; pix_ticket_url: string | null; amount_cents: number }>('SELECT * FROM payments WHERE id = ?', paymentId);
  if (!o || !p || (p.method !== 'pix' && p.method !== 'boleto')) return;
  const until = p.expires_at ? new Date(p.expires_at).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' }) : null;
  await notify({
    event: 'order.payment_pending', recipient: recipientOf(o), orderId: o.id, userId: o.user_id, dedupeKey: `payment:${paymentId}:pending`,
    content: {
      subject: `${p.method === 'pix' ? 'Pix' : 'Boleto'} gerado para o pedido ${o.number}`, preheader: 'Conclua o pagamento para confirmarmos seu pedido.',
      title: p.method === 'pix' ? 'Seu Pix está pronto' : 'Seu boleto está pronto',
      intro: `O pagamento do pedido ${o.number} (${formatBRL(p.amount_cents)}) aguarda confirmação do banco.${until ? ` Prazo: ${until} (horário de Brasília).` : ''}`,
      blocks: [p.method === 'boleto' ? 'A compensação do boleto pode levar até 3 dias úteis após o pagamento.' : 'A confirmação do Pix costuma ser imediata.', ...demoNote(o)],
      cta: p.boleto_url ? { label: 'Abrir boleto', href: p.boleto_url } : p.pix_ticket_url ? { label: 'Abrir Pix', href: p.pix_ticket_url } : { label: 'Ver pedido', href: orderHref(o) },
    },
  });
}

async function onPaid(orderId: number): Promise<void> {
  const o = orderInfo(orderId);
  if (!o) return;
  const p = getDb().get<{ method: string; installments: number | null }>("SELECT method, installments FROM payments WHERE order_id = ? AND status = 'approved' ORDER BY id DESC LIMIT 1", orderId);
  await notify({
    event: 'order.paid', recipient: recipientOf(o), orderId: o.id, userId: o.user_id, dedupeKey: `order:${o.id}:paid`,
    content: {
      subject: `Pagamento aprovado — pedido ${o.number}`, preheader: 'Seu pagamento foi confirmado. Agora é com a gente.',
      title: 'Pagamento aprovado', intro: `${firstName(o)}, o pagamento do pedido ${o.number} foi confirmado pelo provedor. Vamos preparar o envio.`,
      rows: [['Forma de pagamento', `${PAYMENT_METHOD_LABEL[p?.method ?? ''] ?? '—'}${p?.installments && p.installments > 1 ? ` em ${p.installments}x` : ''}`], ['Total', formatBRL(o.total_cents)], ['Entrega', o.shipping_label]],
      blocks: demoNote(o), cta: { label: 'Acompanhar pedido', href: orderHref(o) },
    },
  });
}

const SHIP_TEXT: Record<string, { title: string; intro: string }> = {
  preparing: { title: 'Pedido em preparação', intro: 'Estamos separando e embalando seus itens.' },
  shipped: { title: 'Pedido enviado', intro: 'Seu pedido saiu da GAZU e está a caminho.' },
  in_transit: { title: 'Pedido em trânsito', intro: 'Seu pedido está em trânsito com a transportadora.' },
  out_for_delivery: { title: 'Saiu para entrega', intro: 'Seu pedido saiu para entrega hoje.' },
  delivered: { title: 'Pedido entregue', intro: 'A entrega do seu pedido foi confirmada. Esperamos que você goste!' },
  delivery_failed: { title: 'Tentativa de entrega sem sucesso', intro: 'A transportadora não conseguiu concluir a entrega. Confira as informações de rastreio ou fale com a gente.' },
};

async function onShipment(orderId: number, status: string): Promise<void> {
  const o = orderInfo(orderId);
  const t = SHIP_TEXT[status];
  if (!o || !t) return;
  const s = getDb().get<{ carrier: string | null; tracking_code: string | null; tracking_url: string | null }>("SELECT carrier, tracking_code, tracking_url FROM shipments WHERE order_id = ? AND status <> 'cancelled' ORDER BY id DESC LIMIT 1", orderId);
  const blocks = [...demoNote(o)];
  if (status === 'delivered') {
    blocks.push('Precisa trocar ou devolver? Você pode solicitar pelo próprio pedido: desistência em até 7 dias após o recebimento e produto com defeito em até 90 dias.');
    if (!o.is_guest && getSettings().reviews.enabled) blocks.push('Quando quiser, conte o que achou dos produtos: a sua avaliação ajuda outras pessoas.');
  }
  await notify({
    event: `shipment.${status}`, recipient: recipientOf(o), orderId: o.id, userId: o.user_id, dedupeKey: `order:${o.id}:ship:${status}`,
    content: {
      subject: `${t.title} — ${o.number}`, preheader: t.intro, title: t.title, intro: `${firstName(o)}, ${t.intro.charAt(0).toLowerCase()}${t.intro.slice(1)}`,
      rows: [['Pedido', o.number], ...(s?.carrier ? [['Transportadora', s.carrier] as [string, string]] : []), ...(s?.tracking_code ? [['Código de rastreio', s.tracking_code] as [string, string]] : []), ['Situação', SHIPMENT_STATUS_LABEL[status] ?? status]],
      blocks, cta: s?.tracking_url ? { label: 'Rastrear entrega', href: s.tracking_url } : { label: 'Ver pedido', href: orderHref(o) },
    },
  });
}

async function onCancelled(orderId: number, reason: string): Promise<void> {
  const o = orderInfo(orderId);
  if (!o) return;
  const expired = reason === 'expired';
  await notify({
    event: 'order.cancelled', recipient: recipientOf(o), orderId: o.id, userId: o.user_id, dedupeKey: `order:${o.id}:cancelled`,
    content: {
      subject: `Pedido ${o.number} cancelado`, preheader: expired ? 'O prazo de pagamento terminou.' : 'Seu pedido foi cancelado.',
      title: 'Pedido cancelado',
      intro: expired ? `${firstName(o)}, o prazo para pagamento do pedido ${o.number} terminou e ele foi cancelado. Nenhuma cobrança foi feita.` : `${firstName(o)}, o pedido ${o.number} foi cancelado.${/cliente|administrador/i.test(reason) ? '' : ` Motivo: ${reason}`}`,
      blocks: ['Os itens voltaram para o estoque. Se ainda quiser, você pode fazer um novo pedido pelo site.'], cta: { label: 'Voltar à loja', href: url('/') },
    },
  });
}

async function onRefund(orderId: number, refundId: number, amountCents: number): Promise<void> {
  const o = orderInfo(orderId);
  if (!o) return;
  const method = getDb().get<{ method: string }>('SELECT p.method FROM refunds r JOIN payments p ON p.id = r.payment_id WHERE r.id = ?', refundId)?.method;
  await notify({
    event: 'refund.confirmed', recipient: recipientOf(o), orderId: o.id, userId: o.user_id, dedupeKey: `refund:${refundId}:confirmed`,
    content: {
      subject: `Estorno confirmado — pedido ${o.number}`, preheader: `Estorno de ${formatBRL(amountCents)} confirmado.`,
      title: 'Estorno confirmado', intro: `${firstName(o)}, o provedor de pagamento confirmou o estorno de ${formatBRL(amountCents)} referente ao pedido ${o.number}.`,
      blocks: [method === 'credit_card' ? 'No cartão de crédito, o valor aparece na fatura conforme o fechamento do banco emissor (pode levar até duas faturas).' : 'O valor volta para a conta de origem do pagamento; o prazo depende do banco.'],
      cta: { label: 'Ver pedido', href: orderHref(o) },
    },
  });
}

async function onReturn(returnId: number, status: string): Promise<void> {
  const r = getDb().get<{ number: string; order_id: number }>('SELECT number, order_id FROM return_requests WHERE id = ?', returnId);
  if (!r) return;
  const o = orderInfo(r.order_id);
  if (!o) return;
  const last = getDb().get<{ id: number; message: string }>('SELECT id, message FROM return_events WHERE return_id = ? AND is_internal = 0 ORDER BY id DESC LIMIT 1', returnId);
  await notify({
    event: 'return.updated', recipient: recipientOf(o), orderId: o.id, userId: o.user_id, dedupeKey: `return:${returnId}:event:${last?.id ?? status}`,
    content: {
      subject: `Troca/devolução ${r.number}: ${RETURN_STATUS_LABEL[status] ?? status}`, preheader: 'Atualização da sua solicitação.',
      title: `Solicitação ${r.number}`, intro: `${firstName(o)}, há uma atualização na sua solicitação de troca/devolução do pedido ${o.number}.`,
      rows: [['Situação', RETURN_STATUS_LABEL[status] ?? status]], blocks: last ? [last.message] : [], cta: { label: 'Ver solicitação', href: orderHref(o) },
    },
  });
}

async function onStatus(orderId: number, status: string): Promise<void> {
  // Mudanças operacionais são comunicadas pelo envio (dedupe compartilhada); "processing" vira "preparing".
  if (status === 'processing') await onShipment(orderId, 'preparing');
  else if (status === 'shipped' || status === 'delivered') await onShipment(orderId, status);
  else if (status in ORDER_STATUS_LABEL) return;
}

export function registerNotificationHandlers(): void {
  on('order.created', async ({ orderId }) => {
    // Visitantes recebem a confirmação com o link de acesso diretamente na rota de checkout.
    const o = orderInfo(orderId);
    if (o && !o.is_guest) await notifyOrderCreated(orderId);
  });
  on('order.payment_pending', ({ orderId, paymentId }) => onPaymentPending(orderId, paymentId));
  on('order.paid', ({ orderId }) => onPaid(orderId));
  on('order.status', ({ orderId, status }) => onStatus(orderId, status));
  on('shipment.updated', ({ orderId, status }) => onShipment(orderId, status));
  on('order.cancelled', ({ orderId, reason }) => onCancelled(orderId, reason));
  on('refund.confirmed', ({ orderId, refundId, amountCents }) => onRefund(orderId, refundId, amountCents));
  on('return.updated', ({ returnId, status }) => onReturn(returnId, status));
}
