import { getAdminAccessToken } from '../lib/supabase';

export async function adminFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const token = await getAdminAccessToken();
  if (!token) throw new Error('La sessione amministratore è scaduta. Accedi nuovamente.');
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${token}`);
  return fetch(input, {
    ...init,
    headers,
    credentials: 'same-origin',
    redirect: 'manual',
  });
}
