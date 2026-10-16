import { useState, type FormEvent, type ReactNode } from 'react';
import { api, ApiError, errorMessage } from '../lib/api';
import { useDocumentTitle } from '../lib/hooks';
import { Link, useRouter, useSearchParams } from '../lib/router';
import { useStore } from '../lib/store';
import { Button, Checkbox, Field, Notice } from '../components/ui/ui';
import { Logo } from '../components/ui/Logo';

const OAUTH_ERRORS: Record<string, string> = {
  'sessao-expirada': 'A tentativa de login com Google expirou. Tente novamente.',
  'estado-invalido': 'Não foi possível validar o login com Google. Tente novamente.',
  google: 'O Google não confirmou o login. Tente novamente.',
  'email-nao-verificado': 'Seu e-mail do Google não está verificado.',
  cancelado: 'Login com Google cancelado.',
  access_denied: 'Login com Google cancelado.',
};

const safeReturn = (v: string | null): string => (v && v.startsWith('/') && !v.startsWith('//') ? v : '/conta');

function AuthShell({ title, subtitle, children, aside }: { title: string; subtitle?: string; children: ReactNode; aside?: ReactNode }) {
  useDocumentTitle(title);
  return (
    <div className="auth container">
      <div className="auth__card">
        <Logo variant="full" className="auth__logo" />
        <h1>{title}</h1>
        {subtitle ? <p className="muted">{subtitle}</p> : null}
        {children}
      </div>
      {aside ? <div className="auth__aside">{aside}</div> : null}
    </div>
  );
}

function GoogleButton({ returnTo }: { returnTo: string }) {
  const { config } = useStore();
  if (!config.googleAuth) return null;
  return (
    <>
      <a className="btn btn--secondary btn--md btn--block google-btn" href={`/api/auth/google/start?returnTo=${encodeURIComponent(returnTo)}`}>
        <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" /><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" /><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" /><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" /></svg>
        <span className="btn__label">Continuar com Google</span>
      </a>
      <p className="divider"><span>ou</span></p>
    </>
  );
}

export function LoginPage() {
  const [sp] = useSearchParams();
  const { navigate } = useRouter();
  const { refreshUser, config } = useStore();
  const demo = config.standalone?.demoLogin;
  const returnTo = safeReturn(sp.get('returnTo'));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(sp.get('erro') ? OAUTH_ERRORS[sp.get('erro')!] ?? 'Não foi possível entrar com Google.' : null);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await api.post('/api/auth/login', { email, password });
      await refreshUser();
      navigate(returnTo, { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };
  return (
    <AuthShell title="Entrar" subtitle="Acesse sua conta para acompanhar pedidos, endereços e favoritos.">
      <GoogleButton returnTo={returnTo} />
      {demo ? (
        <Notice tone="info" title="Versão de demonstração">
          Painel administrativo: <strong>{demo.email}</strong> / <strong>{demo.password}</strong>.{' '}
          <button type="button" className="link-btn" onClick={() => { setEmail(demo.email); setPassword(demo.password); }}>Preencher</button>
        </Notice>
      ) : null}
      <form onSubmit={submit} className="form-stack" noValidate>
        {error ? <Notice tone="error">{error}</Notice> : null}
        <Field label="E-mail" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <Field label="Senha" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        <Link to="/recuperar-senha" className="link-underline small">Esqueci minha senha</Link>
        <Button block size="lg" loading={loading}>Entrar</Button>
      </form>
      <p className="auth__switch">Ainda não tem conta? <Link to={`/cadastro?returnTo=${encodeURIComponent(returnTo)}`} className="link-underline">Criar conta</Link></p>
    </AuthShell>
  );
}

export function RegisterPage() {
  const [sp] = useSearchParams();
  const { navigate } = useRouter();
  const { refreshUser, notify } = useStore();
  const returnTo = safeReturn(sp.get('returnTo'));
  const [v, setV] = useState({ name: '', email: '', password: '', confirm: '' });
  const [accept, setAccept] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const errs: Record<string, string> = {};
    if (v.name.trim().length < 2) errs.name = 'Informe seu nome.';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email)) errs.email = 'E-mail inválido.';
    if (v.password.length < 8 || !/[A-Za-z]/.test(v.password) || !/\d/.test(v.password)) errs.password = 'Use ao menos 8 caracteres, com letras e números.';
    if (v.confirm !== v.password) errs.confirm = 'As senhas não conferem.';
    if (!accept) errs.accept = 'Aceite os termos para continuar.';
    setErrors(errs);
    if (Object.keys(errs).length) return;
    setLoading(true);
    setError(null);
    try {
      await api.post('/api/auth/register', { name: v.name, email: v.email, password: v.password, acceptTerms: true });
      await refreshUser();
      notify('Conta criada! Enviamos um link para confirmar seu e-mail.', 'success');
      navigate(returnTo, { replace: true });
    } catch (err) {
      if (err instanceof ApiError) setErrors(err.fieldErrors);
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };
  return (
    <AuthShell title="Criar conta" subtitle="Leva menos de um minuto.">
      <GoogleButton returnTo={returnTo} />
      <form onSubmit={submit} className="form-stack" noValidate>
        {error ? <Notice tone="error">{error}</Notice> : null}
        <Field label="Nome completo" autoComplete="name" value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} error={errors.name} required />
        <Field label="E-mail" type="email" autoComplete="email" value={v.email} onChange={(e) => setV({ ...v, email: e.target.value })} error={errors.email} required />
        <Field label="Senha" type="password" autoComplete="new-password" value={v.password} onChange={(e) => setV({ ...v, password: e.target.value })} error={errors.password} hint="Mínimo de 8 caracteres, com letras e números." required />
        <Field label="Confirmar senha" type="password" autoComplete="new-password" value={v.confirm} onChange={(e) => setV({ ...v, confirm: e.target.value })} error={errors.confirm} required />
        <Checkbox checked={accept} onChange={setAccept} label={<>Li e aceito os <Link to="/termos-de-uso" className="link-underline">Termos de uso</Link> e a <Link to="/politica-de-privacidade" className="link-underline">Política de privacidade</Link>.</>} />
        {errors.accept ? <p className="field__error" role="alert">{errors.accept}</p> : null}
        <Button block size="lg" loading={loading}>Criar conta</Button>
      </form>
      <p className="auth__switch">Já tem conta? <Link to={`/entrar?returnTo=${encodeURIComponent(returnTo)}`} className="link-underline">Entrar</Link></p>
    </AuthShell>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const r = await api.post<{ message: string }>('/api/auth/forgot-password', { email });
      setSent(r.message);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };
  return (
    <AuthShell title="Recuperar senha" subtitle="Informe seu e-mail para receber um link de redefinição.">
      {sent ? <Notice tone="success">{sent}</Notice> : (
        <form onSubmit={submit} className="form-stack">
          {error ? <Notice tone="error">{error}</Notice> : null}
          <Field label="E-mail" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <Button block size="lg" loading={loading}>Enviar link</Button>
        </form>
      )}
      <p className="auth__switch"><Link to="/entrar" className="link-underline">Voltar para o login</Link></p>
    </AuthShell>
  );
}

export function ResetPasswordPage() {
  const [sp] = useSearchParams();
  const { navigate } = useRouter();
  const { refreshUser, notify } = useStore();
  const token = sp.get('token') ?? '';
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (pw !== confirm) { setError('As senhas não conferem.'); return; }
    setLoading(true);
    setError(null);
    try {
      await api.post('/api/auth/reset-password', { token, password: pw });
      await refreshUser();
      notify('Senha redefinida com sucesso.', 'success');
      navigate('/conta', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };
  return (
    <AuthShell title="Nova senha">
      {!token ? <Notice tone="error">Link inválido. Solicite um novo em “Recuperar senha”.</Notice> : (
        <form onSubmit={submit} className="form-stack">
          {error ? <Notice tone="error">{error}</Notice> : null}
          <Field label="Nova senha" type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} hint="Mínimo de 8 caracteres, com letras e números." required />
          <Field label="Confirmar nova senha" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
          <Button block size="lg" loading={loading}>Salvar nova senha</Button>
        </form>
      )}
    </AuthShell>
  );
}
