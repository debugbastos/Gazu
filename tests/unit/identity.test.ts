import './_setup.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { getDb } from '../../src/server/db.ts';
import { redactOldAccountEmails } from '../../src/server/services/jobs.ts';
import { renderBrandEmail } from '../../src/server/services/notifications.ts';
import { client } from './_harness.ts';

const ROOT = path.resolve(import.meta.dirname, '../..');

test('e-mails de conta usam a identidade da marca (HTML com logotipo e texto puro)', async () => {
  const c = await client();
  const email = `marca${Date.now()}@teste.dev`;
  const r = await c.req('POST', '/api/auth/register', { name: 'Pessoa Marca', email, password: 'SenhaForte2026', acceptTerms: true });
  assert.equal(r.status, 200);
  const m = getDb().get<{ body_text: string; body_html: string | null; event: string }>('SELECT body_text, body_html, event FROM email_outbox WHERE to_email = ? ORDER BY id DESC LIMIT 1', email)!;
  assert.equal(m.event, 'account_verify');
  assert.ok(m.body_html?.includes('gazu-logo-email.png'), 'cabeçalho com o logotipo');
  assert.ok(m.body_html?.includes('Confirmar e-mail'), 'botão principal');
  assert.match(m.body_text, /verify-email\?token=/, 'versão em texto puro com o link');
});

test('modelo de e-mail não inventa contato nem CNPJ quando não configurados', () => {
  const { html, text } = renderBrandEmail({ subject: 'Teste', preheader: 'p', title: 'Título', intro: 'Olá' });
  assert.ok(!/CNPJ\s*\d/.test(html), 'sem CNPJ fictício');
  assert.ok(text.includes('TÍTULO') && text.includes('Olá'), 'versão em texto puro');
});

test('limpeza apaga o corpo de e-mails de acesso (links com token) após 3 dias e preserva os demais', () => {
  const db = getDb();
  const old = new Date(Date.now() - 4 * 86400_000).toISOString();
  const recent = new Date().toISOString();
  const ins = (event: string, created: string) => db.run("INSERT INTO email_outbox (to_email, subject, body_text, body_html, event, status, created_at) VALUES ('x@y.dev', 'S', 'link https://loja/redefinir-senha?token=abc', '<p>token</p>', ?, 'logged', ?)", event, created).lastInsertRowid;
  const a = ins('account_password_reset', old);
  const b = ins('account_password_reset', recent);
  const c = ins('order_paid', old);
  assert.ok(redactOldAccountEmails() >= 1);
  const get = (id: number) => db.get<{ body_text: string; body_html: string | null }>('SELECT body_text, body_html FROM email_outbox WHERE id = ?', id)!;
  assert.ok(!get(a).body_text.includes('token=') && get(a).body_html === null, 'corpo antigo removido');
  assert.ok(get(b).body_text.includes('token='), 'e-mail recente preservado (link ainda pode ser válido)');
  assert.ok(get(c).body_text.includes('token=') || get(c).body_html !== null, 'outros eventos não são afetados');
});

test('kit de marca: logotipos, favicons, manifesto e materiais impressos existem e são vetores/arquivos válidos', () => {
  const must = [
    'public/favicon.svg', 'public/favicon-32.png', 'public/apple-touch-icon.png', 'public/icon-192.png', 'public/icon-512.png', 'public/site.webmanifest',
    'public/assets/branding/logo/gazu-logo-preto.svg', 'public/assets/branding/logo/gazu-logo-branco.svg', 'public/assets/branding/logo/gazu-monograma-preto.svg', 'public/assets/branding/logo/gazu-logo-email.png',
    'public/assets/branding/print/tag-frente.svg', 'public/assets/branding/print/cartao-agradecimento-verso.svg', 'public/assets/branding/print/troca-devolucao.svg', 'public/assets/branding/print/cuidados.svg',
    'docs/IDENTIDADE-VISUAL.md',
  ];
  for (const f of must) assert.ok(fs.existsSync(path.join(ROOT, f)), `${f} ausente`);
  for (const f of fs.readdirSync(path.join(ROOT, 'public/assets/branding/print')).filter((x) => x.endsWith('.svg'))) {
    const svg = fs.readFileSync(path.join(ROOT, 'public/assets/branding/print', f), 'utf8');
    assert.match(svg, /width="[\d.]+mm" height="[\d.]+mm"/, `${f}: tamanho em milímetros`);
    assert.ok(!/R\$\s*\d/.test(svg), `${f}: nenhum preço impresso de antemão`);
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/site.webmanifest'), 'utf8'));
  assert.equal(manifest.theme_color, '#111111');
  assert.ok(manifest.icons.some((i: { purpose?: string }) => i.purpose === 'maskable'));
});

test('HTML das páginas declara manifesto, cor do tema e ícones', async () => {
  const c = await client();
  const res = await fetch(c.base + '/');
  const html = await res.text();
  assert.ok(html.includes('rel="manifest" href="/site.webmanifest"'));
  assert.ok(html.includes('name="theme-color"'));
  const man = await fetch(c.base + '/site.webmanifest');
  assert.equal(man.status, 200);
  assert.match(man.headers.get('content-type') ?? '', /manifest\+json/);
});
