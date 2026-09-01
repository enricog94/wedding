import { useEffect, useMemo, useState } from 'react';
import {
  configureSupabase,
  getSupabaseSession,
  normalizeAuthDestination,
  type SupabasePublicConfig,
} from '../lib/supabase';

type CallbackState =
  | { status: 'loading' }
  | { status: 'error'; message: string };

export function AuthCallback() {
  const [state, setState] = useState<CallbackState>({ status: 'loading' });
  const destination = useMemo(() => {
    const parameters = new URLSearchParams(window.location.search);
    return normalizeAuthDestination(parameters.get('next'));
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/auth/config', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('Configurazione Supabase Auth non disponibile.');
        return response.json() as Promise<SupabasePublicConfig>;
      })
      .then(async (config) => {
        configureSupabase(config);
        const parameters = new URLSearchParams(window.location.search);
        const callbackError = parameters.get('error_description') ?? parameters.get('error');
        if (callbackError) throw new Error(callbackError);
        const session = await getSupabaseSession();
        if (!session) throw new Error('Accesso non completato. Riprova dalla pagina di login.');
        window.location.replace(destination);
      })
      .catch((callbackError: unknown) => {
        if (!(callbackError instanceof DOMException && callbackError.name === 'AbortError')) {
          setState({
            status: 'error',
            message: callbackError instanceof Error ? callbackError.message : 'Accesso non completato.',
          });
        }
      });
    return () => controller.abort();
  }, [destination]);

  return (
    <main className="admin-login">
      <section className="admin-login__panel" aria-live="polite">
        {state.status === 'loading' ? (
          <p>Completiamo l’accesso…</p>
        ) : (
          <>
            <p role="alert">{state.message}</p>
            <a className="button button--solid" href={destination}>Torna al login</a>
          </>
        )}
      </section>
    </main>
  );
}
