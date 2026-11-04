const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });

export const formatPrice = (cents: number): string => brl.format(cents / 100);

export const onlyDigits = (s: string): string => s.replace(/\D+/g, '');

export const formatCep = (cep: string): string => {
  const d = onlyDigits(cep).slice(0, 8);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
};

export const formatDate = (iso: string): string =>
  new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });

export const formatDateTime = (iso: string): string =>
  new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

export const ORDER_STATUS_LABEL: Record<string, string> = {
  pending_payment: 'Aguardando pagamento',
  paid: 'Pagamento aprovado',
  processing: 'Em separação',
  shipped: 'Enviado',
  delivered: 'Entregue',
  cancelled: 'Cancelado',
  refunded: 'Reembolsado',
};

export const PAYMENT_STATUS_LABEL: Record<string, string> = {
  pending: 'Pendente',
  in_process: 'Em processamento',
  expired: 'Expirado',
  approved: 'Aprovado',
  rejected: 'Recusado',
  cancelled: 'Cancelado',
  refunded: 'Estornado',
  partially_refunded: 'Estornado parcialmente',
};

export const PAYMENT_METHOD_LABEL: Record<string, string> = {
  pix: 'Pix',
  credit_card: 'Cartão de crédito',
  debit_card: 'Cartão de débito',
  boleto: 'Boleto bancário',
  demo: 'Pagamento simulado (demonstração)',
};

export const SHIPMENT_STATUS_LABEL: Record<string, string> = {
  pending: 'Aguardando preparação',
  preparing: 'Em preparação',
  label_purchased: 'Etiqueta gerada',
  shipped: 'Enviado',
  in_transit: 'Em trânsito',
  out_for_delivery: 'Saiu para entrega',
  delivered: 'Entregue',
  delivery_failed: 'Falha na entrega',
  returned: 'Devolvido ao remetente',
  cancelled: 'Envio cancelado',
};

export const RETURN_STATUS_LABEL: Record<string, string> = {
  requested: 'Solicitada', approved: 'Aprovada', rejected: 'Recusada', awaiting_item: 'Aguardando envio do produto',
  received: 'Produto recebido', refunded: 'Reembolsada', exchanged: 'Troca concluída', closed: 'Encerrada',
};
export const RETURN_TYPE_LABEL: Record<string, string> = {
  withdrawal: 'Desistência (7 dias)', exchange: 'Troca', defect: 'Produto com defeito', other: 'Outro motivo',
};
export const TICKET_STATUS_LABEL: Record<string, string> = {
  open: 'Aberto', in_progress: 'Em atendimento', waiting_customer: 'Aguardando cliente', resolved: 'Resolvido', closed: 'Encerrado',
};
export const TICKET_CATEGORY_LABEL: Record<string, string> = {
  produto: 'Dúvida sobre produto', pedido: 'Problema com pedido', pagamento: 'Pagamento', entrega: 'Entrega e rastreamento',
  troca: 'Troca ou devolução', reembolso: 'Reembolso', defeito: 'Produto recebido com problema', contato: 'Contato geral', outro: 'Outro assunto',
};

export const AUDIENCE_LABEL: Record<string, string> = {
  masculino: 'Masculino',
  feminino: 'Feminino',
  unissex: 'Unissex',
  menino: 'Menino',
  menina: 'Menina',
};

export const UF = ['AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA', 'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN', 'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO'] as const;
