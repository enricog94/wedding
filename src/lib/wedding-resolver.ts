import type { Database } from './supabase-db';
import type { FantasposiGameState } from './fantasposi-domain';

export type ResolvedWedding = {
  id: number;
  slug: string;
  bride_name: string;
  groom_name: string;
  wedding_date: string;
  status: string;
  theme: string | null;
  hero_eyebrow: string | null;
  hero_title: string | null;
  hero_subtitle: string | null;
  fantasposi_status: FantasposiGameState;
};

export type WeddingResolutionSource = 'domain' | 'fallback';

export type WeddingResolution =
  | {
    resolved: true;
    hostname: string;
    source: WeddingResolutionSource;
    wedding: ResolvedWedding;
  }
  | {
    resolved: false;
    hostname: string;
    reason: 'wedding_not_configured' | 'invalid_domain_mapping';
  };

export type WeddingResolverEnv = {
  DB: Database;
  CURRENT_WEDDING_SLUG?: string;
  WEDDING_CONTEXT?: Promise<WeddingResolution>;
};

type DomainRow = ResolvedWedding & { mapped_wedding_id: number };

const WEDDING_COLUMNS = `wedding.id, wedding.slug, wedding.bride_name,
  wedding.groom_name, wedding.wedding_date, wedding.status, wedding.theme,
  wedding.hero_eyebrow, wedding.hero_title, wedding.hero_subtitle,
  wedding.fantasposi_status`;

export function normalizeWeddingHostname(value: string): string {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return '';
  if (trimmed === '::1' || trimmed === '[::1]') return '::1';
  try {
    return new URL(`http://${trimmed}`).hostname.toLowerCase();
  } catch {
    return '';
  }
}

export function isFallbackWeddingHost(hostname: string): boolean {
  const normalized = normalizeWeddingHostname(hostname);
  return normalized === 'localhost'
    || normalized === '127.0.0.1'
    || normalized === '::1'
    || normalized.endsWith('.workers.dev');
}

export function selectWeddingResolution<T>(
  hostname: string,
  mappedWedding: T | null,
  fallbackWedding: T | null,
): { source: WeddingResolutionSource; wedding: T } | null {
  if (mappedWedding) return { source: 'domain', wedding: mappedWedding };
  if (isFallbackWeddingHost(hostname) && fallbackWedding) {
    return { source: 'fallback', wedding: fallbackWedding };
  }
  return null;
}

export async function resolveWeddingFromRequest(
  request: Request,
  env: WeddingResolverEnv,
): Promise<WeddingResolution> {
  const hostname = normalizeWeddingHostname(new URL(request.url).hostname);
  const domain = await env.DB.prepare(
    `SELECT domain.wedding_id AS mapped_wedding_id, ${WEDDING_COLUMNS}
     FROM wedding_domains domain
     LEFT JOIN weddings wedding ON wedding.id = domain.wedding_id
     WHERE domain.hostname = ?
     LIMIT 1`,
  ).bind(hostname).first<DomainRow>();

  if (domain) {
    if (!domain.id || domain.id !== domain.mapped_wedding_id) {
      return { resolved: false, hostname, reason: 'invalid_domain_mapping' };
    }
    return { resolved: true, hostname, source: 'domain', wedding: domain };
  }

  if (!isFallbackWeddingHost(hostname)) {
    return { resolved: false, hostname, reason: 'wedding_not_configured' };
  }
  const fallbackSlug = env.CURRENT_WEDDING_SLUG?.trim();
  if (!fallbackSlug) {
    return { resolved: false, hostname, reason: 'wedding_not_configured' };
  }
  const fallbackWedding = await env.DB.prepare(
    `SELECT ${WEDDING_COLUMNS}
     FROM weddings wedding
     WHERE wedding.slug = ?
     LIMIT 1`,
  ).bind(fallbackSlug).first<ResolvedWedding>();
  return fallbackWedding
    ? { resolved: true, hostname, source: 'fallback', wedding: fallbackWedding }
    : { resolved: false, hostname, reason: 'wedding_not_configured' };
}

export function getWeddingResolution(
  request: Request,
  env: WeddingResolverEnv,
): Promise<WeddingResolution> {
  env.WEDDING_CONTEXT ??= resolveWeddingFromRequest(request, env);
  return env.WEDDING_CONTEXT;
}
