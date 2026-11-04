// Markdown restrito e seguro para conteúdo administrável (Journal, páginas institucionais, FAQ).
// Todo texto é escapado ANTES da formatação; só são gerados elementos de uma lista fechada e
// links com destino relativo ("/...") ou http(s). Não há HTML bruto, scripts ou atributos de evento.

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function safeHref(href: string): string | null {
  const h = href.trim();
  if (/^\/(?!\/)/.test(h)) return h;
  if (/^https?:\/\/[^\s]+$/i.test(h)) return h;
  if (/^mailto:[^\s@]+@[^\s@]+$/i.test(h)) return h;
  return null;
}

function inline(text: string): string {
  let s = esc(text);
  s = s.replace(/\[([^\]]{1,200})\]\(([^)\s]{1,500})\)/g, (_, label: string, href: string) => {
    const decoded = href.replace(/&amp;/g, '&');
    const ok = safeHref(decoded);
    if (!ok) return label;
    const external = /^https?:/i.test(ok);
    return `<a href="${esc(ok)}"${external ? ' target="_blank" rel="noopener noreferrer"' : ''}>${label}</a>`;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  return s;
}

export function renderMarkdown(src: string): string {
  const blocks = src.replace(/\r\n?/g, '\n').trim().split(/\n{2,}/);
  const out: string[] = [];
  for (const block of blocks) {
    const lines = block.split('\n');
    const first = lines[0] ?? '';
    if (/^###\s+/.test(first) && lines.length === 1) { out.push(`<h3>${inline(first.replace(/^###\s+/, ''))}</h3>`); continue; }
    if (/^##\s+/.test(first) && lines.length === 1) { out.push(`<h2>${inline(first.replace(/^##\s+/, ''))}</h2>`); continue; }
    if (lines.every((l) => /^\s*[-*]\s+/.test(l))) { out.push(`<ul>${lines.map((l) => `<li>${inline(l.replace(/^\s*[-*]\s+/, ''))}</li>`).join('')}</ul>`); continue; }
    if (lines.every((l) => /^\s*\d+[.)]\s+/.test(l))) { out.push(`<ol>${lines.map((l) => `<li>${inline(l.replace(/^\s*\d+[.)]\s+/, ''))}</li>`).join('')}</ol>`); continue; }
    if (lines.every((l) => /^>\s?/.test(l))) { out.push(`<blockquote>${lines.map((l) => inline(l.replace(/^>\s?/, ''))).join('<br>')}</blockquote>`); continue; }
    // Título seguido de parágrafo no mesmo bloco
    if (/^#{2,3}\s+/.test(first)) {
      const level = first.startsWith('###') ? 3 : 2;
      out.push(`<h${level}>${inline(first.replace(/^#{2,3}\s+/, ''))}</h${level}>`);
      if (lines.length > 1) out.push(`<p>${lines.slice(1).map(inline).join('<br>')}</p>`);
      continue;
    }
    out.push(`<p>${lines.map(inline).join('<br>')}</p>`);
  }
  return out.join('\n');
}

/** Texto puro (para resumos, meta descriptions e e-mails em texto). */
export function markdownToText(src: string): string {
  return src.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[*#>]/g, '').replace(/\n{3,}/g, '\n\n').trim();
}
