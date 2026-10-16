import crypto from 'node:crypto';
import readline from 'node:readline';
import { getDb } from '../db.ts';
import { hashPassword, passwordProblems } from '../auth/password.ts';

// Criação segura do primeiro administrador (executado apenas por quem tem acesso ao servidor):
//   npm run admin:create -- admin@sualoja.com.br
// Se o e-mail já existir, a conta é promovida a administradora (a senha atual é mantida).
// A senha é lida do terminal (sem eco) ou da variável ADMIN_PASSWORD (útil em automações).

async function askHidden(question: string): Promise<string> {
  if (process.env.ADMIN_PASSWORD) return process.env.ADMIN_PASSWORD;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const out = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
  out._writeToOutput = (s: string) => { if (s.includes(question)) out.output.write(s); };
  return new Promise((resolve) => rl.question(question, (a) => { rl.close(); process.stdout.write('\n'); resolve(a); }));
}

const email = (process.argv[2] ?? '').trim().toLowerCase();
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  console.error('Uso: npm run admin:create -- email@dominio.com');
  process.exit(1);
}
const db = getDb();
db.migrate();
const existing = db.get<{ id: string; role: string }>('SELECT id, role FROM users WHERE email = ?', email);
if (existing) {
  db.run("UPDATE users SET role = 'admin' WHERE id = ?", existing.id);
  db.run("INSERT INTO audit_log (actor, action, entity, entity_id) VALUES ('cli', 'user.promote_admin', 'user', ?)", existing.id);
  console.log(`Usuário ${email} promovido a administrador.`);
} else {
  const pw = await askHidden('Senha do administrador: ');
  const problem = passwordProblems(pw);
  if (problem) { console.error(problem); process.exit(1); }
  const id = crypto.randomUUID();
  const hash = await hashPassword(pw);
  db.tx(() => {
    db.run("INSERT INTO users (id, email, password_hash, role, email_verified_at) VALUES (?, ?, ?, 'admin', ?)", id, email, hash, new Date().toISOString());
    db.run('INSERT INTO profiles (user_id, full_name) VALUES (?, ?)', id, 'Administrador');
    db.run("INSERT INTO audit_log (actor, action, entity, entity_id) VALUES ('cli', 'user.create_admin', 'user', ?)", id);
  });
  console.log(`Administrador ${email} criado.`);
}
db.close();
