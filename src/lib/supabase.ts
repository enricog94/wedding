export type SupabasePublicConfig = {
  supabaseUrl: string;
  anonKey: string;
};

export type SupabaseSession = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  expires_at?: number;
  token_type: string;
  user: {
    id: string;
    email?: string;
  };
};

const SESSION_STORAGE_KEY = 'wedding.supabase.session';
let configuration: SupabasePublicConfig | null = null;
let refreshPromise: Promise<SupabaseSession | null> | null = null;
let otpRequestPromise: Promise<void> | null = null;

function baseUrl(): string {
  if (!configuration) throw new Error('Supabase Auth is not configured');
  return configuration.supabaseUrl.replace(/\/+$/, '');
}

function authHeaders(accessToken?: string): HeadersInit {
  if (!configuration) throw new Error('Supabase Auth is not configured');
  return {
    apikey: configuration.anonKey,
    'content-type': 'application/json',
    ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
  };
}

async function authRequest<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(`${baseUrl()}/auth/v1${path}`, init);
  if (!response.ok) {
    const payload = await response.json().catch(() => null) as {
      error_description?: string;
      msg?: string;
      message?: string;
    } | null;
    throw new Error(payload?.error_description ?? payload?.msg ?? payload?.message ?? `HTTP ${response.status}`);
  }
  return response.json() as Promise<T>;
}

function normalizeSession(session: SupabaseSession): SupabaseSession {
  return {
    ...session,
    expires_at: session.expires_at ?? Math.floor(Date.now() / 1000) + session.expires_in,
  };
}

function persistSession(session: SupabaseSession | null): void {
  if (session) localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(normalizeSession(session)));
  else localStorage.removeItem(SESSION_STORAGE_KEY);
}

function storedSession(): SupabaseSession | null {
  const raw = localStorage.getItem(SESSION_STORAGE_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<SupabaseSession>;
    if (!parsed.access_token || !parsed.refresh_token || !parsed.user?.id) return null;
    return parsed as SupabaseSession;
  } catch {
    localStorage.removeItem(SESSION_STORAGE_KEY);
    return null;
  }
}

export function configureSupabase(config: SupabasePublicConfig): void {
  configuration = {
    supabaseUrl: config.supabaseUrl.trim().replace(/\/+$/, ''),
    anonKey: config.anonKey.trim(),
  };
}

export function getSupabasePublicConfig(): SupabasePublicConfig | null {
  return configuration ? { ...configuration } : null;
}

export async function requestAdminOtp(email: string): Promise<void> {
  return requestSupabaseOtp(email, false);
}

export async function requestSupabaseOtp(
  email: string,
  createUser = true,
): Promise<void> {
  if (otpRequestPromise) return otpRequestPromise;
  otpRequestPromise = authRequest('/otp', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({
      email,
      data: {},
      create_user: createUser,
      gotrue_meta_security: {},
      code_challenge: null,
      code_challenge_method: null,
    }),
  }).then(() => undefined).finally(() => {
    otpRequestPromise = null;
  });
  return otpRequestPromise;
}

export async function verifyAdminOtp(email: string, token: string): Promise<SupabaseSession> {
  return verifySupabaseOtp(email, token);
}

export async function verifySupabaseOtp(email: string, token: string): Promise<SupabaseSession> {
  const session = normalizeSession(await authRequest<SupabaseSession>('/verify', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ email, token, type: 'email' }),
  }));
  persistSession(session);
  return session;
}

async function refreshSession(session: SupabaseSession): Promise<SupabaseSession | null> {
  if (!refreshPromise) {
    refreshPromise = authRequest<SupabaseSession>('/token?grant_type=refresh_token', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({ refresh_token: session.refresh_token }),
    })
      .then((refreshed) => {
        const normalized = normalizeSession(refreshed);
        persistSession(normalized);
        return normalized;
      })
      .catch(() => {
        persistSession(null);
        return null;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

async function recoverRedirectSession(): Promise<SupabaseSession | null> {
  if (typeof window === 'undefined' || !window.location.hash) return null;

  const parameters = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const accessToken = parameters.get('access_token');
  const refreshToken = parameters.get('refresh_token');
  const authError = parameters.get('error_description') ?? parameters.get('error');
  if (!accessToken || !refreshToken) {
    if (authError) {
      window.history.replaceState(null, document.title, `${window.location.pathname}${window.location.search}`);
      throw new Error(authError);
    }
    return null;
  }

  const expiresInValue = Number(parameters.get('expires_in'));
  const expiresAtValue = Number(parameters.get('expires_at'));
  const expiresIn = Number.isFinite(expiresInValue) && expiresInValue > 0 ? expiresInValue : 3600;

  try {
    const user = await authRequest<SupabaseSession['user']>('/user', {
      method: 'GET',
      headers: authHeaders(accessToken),
    });
    if (!user.id) throw new Error('Identità Supabase non valida.');

    const session = normalizeSession({
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: expiresIn,
      expires_at: Number.isFinite(expiresAtValue) && expiresAtValue > 0 ? expiresAtValue : undefined,
      token_type: parameters.get('token_type') ?? 'bearer',
      user,
    });
    persistSession(session);
    return session;
  } finally {
    window.history.replaceState(null, document.title, `${window.location.pathname}${window.location.search}`);
  }
}

export async function getAdminSession(): Promise<SupabaseSession | null> {
  const redirectSession = await recoverRedirectSession();
  if (redirectSession) return redirectSession;
  const session = storedSession();
  if (!session) return null;
  const expiresAt = session.expires_at ?? 0;
  return expiresAt > Math.floor(Date.now() / 1000) + 60 ? session : refreshSession(session);
}

export const getSupabaseSession = getAdminSession;

export async function getAdminAccessToken(): Promise<string | null> {
  return (await getAdminSession())?.access_token ?? null;
}

export const getSupabaseAccessToken = getAdminAccessToken;

export async function signOutAdmin(): Promise<void> {
  const session = storedSession();
  persistSession(null);
  if (!session) return;
  await fetch(`${baseUrl()}/auth/v1/logout`, {
    method: 'POST',
    headers: authHeaders(session.access_token),
  }).catch(() => undefined);
}

export const signOutSupabase = signOutAdmin;

const AUTH_DESTINATION_PATTERN = /^\/fantasposi(?:\/[a-z0-9-]+)*\/?$/;

export function normalizeAuthDestination(value: string | null | undefined, fallback = '/fantasposi'): string {
  const normalizedFallback = fallback === '/admin' || AUTH_DESTINATION_PATTERN.test(fallback)
    ? fallback.replace(/\/$/, '') || '/fantasposi'
    : '/fantasposi';
  if (!value) return normalizedFallback;
  if (value === '/admin' || AUTH_DESTINATION_PATTERN.test(value)) {
    return value.replace(/\/$/, '') || normalizedFallback;
  }
  return normalizedFallback;
}

export function startSupabaseOAuth(provider: 'google', nextPath: string): void {
  const safeNext = normalizeAuthDestination(nextPath);
  const callbackUrl = new URL('/auth/callback', window.location.origin);
  callbackUrl.searchParams.set('next', safeNext);
  const parameters = new URLSearchParams({ provider, redirect_to: callbackUrl.toString() });
  window.location.assign(`${baseUrl()}/auth/v1/authorize?${parameters.toString()}`);
}
