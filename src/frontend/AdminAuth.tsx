import { FormEvent, useEffect, useState } from 'react';
import {
  configureSupabase,
  getAdminSession,
  requestAdminOtp,
  signOutAdmin,
  startSupabaseOAuth,
  verifyAdminOtp,
  type SupabasePublicConfig,
  type SupabaseSession,
} from '../lib/supabase';
import { AdminPage } from './AdminPage';
import { adminFetch } from './adminApi';

type AuthState =
  | { status: 'loading' }
  | { status: 'anonymous' }
  | { status: 'authenticated'; session: SupabaseSession }
  | { status: 'forbidden'; message: string }
  | { status: 'configuration-error'; message: string };

async function authorizeSession(session: SupabaseSession): Promise<AuthState> {
  const response = await adminFetch('/api/admin/session');
  if (response.status === 401) return { status: 'anonymous' };
  if (response.status === 403) {
    return { status: 'forbidden', message: 'Questo account non è autorizzato ad amministrare il matrimonio.' };
  }
  if (!response.ok) throw new Error(`Verifica ruolo admin non riuscita (HTTP ${response.status}).`);
  return { status: 'authenticated', session };
}

export function AdminAuth() {
  const [auth, setAuth] = useState<AuthState>({ status: 'loading' });
  const [email, setEmail] = useState('');
  const [otpEmail, setOtpEmail] = useState('');
  const [code, setCode] = useState('');
  const [codeRequested, setCodeRequested] = useState(false);
  const [busy, setBusy] = useState(false);
  const [resendLocked, setResendLocked] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/auth/config', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('Configurazione Supabase Auth non disponibile.');
        return response.json() as Promise<SupabasePublicConfig>;
      })
      .then(async (config) => {
        configureSupabase(config);
        const session = await getAdminSession();
        setAuth(session ? await authorizeSession(session) : { status: 'anonymous' });
      })
      .catch((loadError: unknown) => {
        if (!(loadError instanceof DOMException && loadError.name === 'AbortError')) {
          setAuth({
            status: 'configuration-error',
            message: loadError instanceof Error ? loadError.message : 'Autenticazione non disponibile.',
          });
        }
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!resendLocked) return undefined;
    const timeout = window.setTimeout(() => setResendLocked(false), 60_000);
    return () => window.clearTimeout(timeout);
  }, [resendLocked]);

  const requestCode = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true); setError(''); setNotice('');
    try {
      const requestedEmail = email.trim();
      await requestAdminOtp(requestedEmail);
      setOtpEmail(requestedEmail);
      setCodeRequested(true);
      setResendLocked(true);
      setNotice(`Abbiamo inviato un codice a ${requestedEmail}. Usa l’ultimo codice ricevuto.`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Invio del codice non riuscito.');
    } finally {
      setBusy(false);
    }
  };

  const resendCode = async () => {
    setBusy(true); setError(''); setNotice('');
    try {
      await requestAdminOtp(otpEmail);
      setCode('');
      setResendLocked(true);
      setNotice(`Nuovo codice inviato a ${otpEmail}. Il codice precedente non è più valido.`);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Invio del codice non riuscito.');
    } finally {
      setBusy(false);
    }
  };

  const verifyCode = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true); setError('');
    try {
      const session = await verifyAdminOtp(otpEmail, code);
      setAuth(await authorizeSession(session));
    } catch (verifyError) {
      setError(verifyError instanceof Error ? verifyError.message : 'Codice non valido o scaduto.');
    } finally {
      setBusy(false);
    }
  };

  if (auth.status === 'loading') {
    return <main className="admin-login"><p>Verifica sessione amministratore…</p></main>;
  }
  if (auth.status === 'configuration-error') {
    return <main className="admin-login"><p role="alert">{auth.message}</p></main>;
  }
  if (auth.status === 'forbidden') {
    return (
      <main className="admin-login">
        <section className="admin-login__panel">
          <p role="alert">{auth.message}</p>
          <button type="button" onClick={() => void signOutAdmin().finally(() => setAuth({ status: 'anonymous' }))}>
            Esci
          </button>
        </section>
      </main>
    );
  }
  if (auth.status === 'authenticated') {
    return (
      <AdminPage
        adminEmail={auth.session.user.email}
        onLogout={() => void signOutAdmin().finally(() => setAuth({ status: 'anonymous' }))}
      />
    );
  }

  return (
    <main className="admin-login">
      <section className="admin-login__panel" aria-labelledby="admin-login-title">
        <p className="section-title__eyebrow">Area riservata</p>
        <h1 id="admin-login-title">Accesso amministratore</h1>
        <p>Ricevi via email il codice temporaneo per accedere al pannello.</p>
        <button type="button" disabled={busy} onClick={() => startSupabaseOAuth('google', '/admin')}>
          Continua con Google
        </button>
        <div className="admin-login__separator"><span>oppure</span></div>
        <form onSubmit={codeRequested ? verifyCode : requestCode}>
          <label>
            Email
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              disabled={busy || codeRequested}
              autoComplete="email"
              required
            />
          </label>
          {codeRequested && (
            <label>
              Codice ricevuto
              <input
                type="text"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]+"
                required
              />
            </label>
          )}
          {notice && <p className="admin-login__notice" role="status">{notice}</p>}
          {error && <p className="admin-state admin-state--error" role="alert">{error}</p>}
          <button type="submit" disabled={busy}>{codeRequested ? 'Accedi' : 'Invia codice'}</button>
          {codeRequested && (
            <>
              <button type="button" disabled={busy || resendLocked} onClick={() => void resendCode()}>
                {resendLocked ? 'Attendi prima di reinviare' : 'Invia di nuovo'}
              </button>
              <button type="button" disabled={busy} onClick={() => { setCodeRequested(false); setOtpEmail(''); setCode(''); setError(''); setNotice(''); }}>Usa un’altra email</button>
            </>
          )}
        </form>
      </section>
    </main>
  );
}
