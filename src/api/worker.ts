import { handleContentRequest } from './content';

export interface Env {
  DB: D1Database;
  MEDIA_BUCKET: R2Bucket;
  IMAGES: ImagesBinding;
  MEDIA_PROCESSING_QUEUE: Queue<MediaProcessingMessage>;
  ASSETS: Fetcher;
  CURRENT_WEDDING_SLUG: string;
  R2_ACCOUNT_ID: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  TEAM_DOMAIN: string;
  POLICY_AUD: string;
}

const jsonHeaders = { 'content-type': 'application/json; charset=utf-8' };

const MEGABYTE = 1024 * 1024;
const R2_BUCKET_NAME = 'wedding-media';
const PRESIGNED_URL_TTL_SECONDS = 10 * 60;
const MEDIA_TYPES = {
  'image/jpeg': { extension: 'jpg', maxSize: 20 * MEGABYTE },
  'image/png': { extension: 'png', maxSize: 20 * MEGABYTE },
  'image/webp': { extension: 'webp', maxSize: 20 * MEGABYTE },
  'image/heic': { extension: 'heic', maxSize: 20 * MEGABYTE },
  'image/heif': { extension: 'heif', maxSize: 20 * MEGABYTE },
  'video/mp4': { extension: 'mp4', maxSize: 500 * MEGABYTE },
  'video/quicktime': { extension: 'mov', maxSize: 500 * MEGABYTE },
} as const;

type SupportedMimeType = keyof typeof MEDIA_TYPES;

export type MediaProcessingMessage = {
  mediaId: number;
};

const textEncoder = new TextEncoder();

function toHex(value: ArrayBuffer): string {
  return Array.from(new Uint8Array(value), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function sha256(value: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', textEncoder.encode(value)));
}

async function hmac(key: ArrayBuffer | string, value: string): Promise<ArrayBuffer> {
  const keyData = typeof key === 'string' ? textEncoder.encode(key) : key;
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return crypto.subtle.sign('HMAC', cryptoKey, textEncoder.encode(value));
}

function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

async function createPresignedPutUrl(env: Env, objectKey: string): Promise<string> {
  const accountId = env.R2_ACCOUNT_ID?.trim();
  const accessKeyId = env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY?.trim();
  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error('R2 signing credentials are not configured');
  }

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const date = amzDate.slice(0, 8);
  const scope = `${date}/auto/s3/aws4_request`;
  const host = `${R2_BUCKET_NAME}.${accountId}.eu.r2.cloudflarestorage.com`;
  const canonicalUri = `/${objectKey.split('/').map(encodeRfc3986).join('/')}`;
  const parameters = new URLSearchParams({
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Content-Sha256': 'UNSIGNED-PAYLOAD',
    'X-Amz-Credential': `${accessKeyId}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(PRESIGNED_URL_TTL_SECONDS),
    'X-Amz-SignedHeaders': 'host',
  });
  parameters.sort();
  const canonicalQuery = parameters.toString().replace(/%7E/g, '~');
  const canonicalRequest = [
    'PUT',
    canonicalUri,
    canonicalQuery,
    `host:${host}\n`,
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n');
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    await sha256(canonicalRequest),
  ].join('\n');

  const dateKey = await hmac(`AWS4${secretAccessKey}`, date);
  const regionKey = await hmac(dateKey, 'auto');
  const serviceKey = await hmac(regionKey, 's3');
  const signingKey = await hmac(serviceKey, 'aws4_request');
  const signature = toHex(await hmac(signingKey, stringToSign));

  return `https://${host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: jsonHeaders });
}

export type AdminIdentity = {
  subject: string;
  email?: string;
};

type AccessJwk = JsonWebKey & {
  kid?: string;
};

type AccessJwtOptions = {
  issuer: string;
  audience: string;
  keys: AccessJwk[];
  now?: number;
};

type AdminAuthorization =
  | { authorized: true; identity: AdminIdentity }
  | { authorized: false; response: Response };

const accessKeysCache = new Map<string, { expiresAt: number; keys: AccessJwk[] }>();

function decodeBase64Url(value: string): Uint8Array {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
  const decoded = atob(padded);
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

function asArrayBuffer(value: Uint8Array): ArrayBuffer {
  return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
}

function decodeJwtPart(value: string): Record<string, unknown> {
  const decoded = new TextDecoder().decode(decodeBase64Url(value));
  const parsed: unknown = JSON.parse(decoded);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid JWT payload');
  }
  return parsed as Record<string, unknown>;
}

export async function verifyAccessJwt(
  token: string,
  { issuer, audience, keys, now = Math.floor(Date.now() / 1000) }: AccessJwtOptions,
): Promise<AdminIdentity> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Invalid JWT');

  const [encodedHeader, encodedPayload, encodedSignature] = parts;
  const header = decodeJwtPart(encodedHeader);
  const payload = decodeJwtPart(encodedPayload);
  if (header.alg !== 'RS256' || typeof header.kid !== 'string') {
    throw new Error('Unsupported JWT');
  }

  const jwk = keys.find((candidate) => candidate.kid === header.kid && candidate.kty === 'RSA');
  if (!jwk) throw new Error('Unknown signing key');

  const publicKey = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify'],
  );
  const signatureValid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    publicKey,
    asArrayBuffer(decodeBase64Url(encodedSignature)),
    textEncoder.encode(`${encodedHeader}.${encodedPayload}`),
  );
  if (!signatureValid) throw new Error('Invalid JWT signature');

  const tokenAudience = payload.aud;
  const audienceValid = tokenAudience === audience
    || (Array.isArray(tokenAudience) && tokenAudience.includes(audience));
  if (payload.iss !== issuer || !audienceValid) throw new Error('Invalid JWT claims');
  if (typeof payload.exp !== 'number' || payload.exp <= now) throw new Error('Expired JWT');
  if (typeof payload.nbf === 'number' && payload.nbf > now) throw new Error('Inactive JWT');
  if (typeof payload.sub !== 'string' || !payload.sub.trim()) throw new Error('Missing subject');

  return {
    subject: payload.sub,
    ...(typeof payload.email === 'string' && payload.email.trim()
      ? { email: payload.email }
      : {}),
  };
}

async function getAccessKeys(teamDomain: string): Promise<AccessJwk[]> {
  const cached = accessKeysCache.get(teamDomain);
  if (cached && cached.expiresAt > Date.now()) return cached.keys;

  const response = await fetch(`${teamDomain}/cdn-cgi/access/certs`);
  if (!response.ok) throw new Error('Unable to load Access signing keys');
  const payload: unknown = await response.json();
  if (!payload || typeof payload !== 'object' || !Array.isArray((payload as { keys?: unknown }).keys)) {
    throw new Error('Invalid Access signing keys');
  }

  const keys = (payload as { keys: AccessJwk[] }).keys;
  accessKeysCache.set(teamDomain, { expiresAt: Date.now() + 5 * 60 * 1000, keys });
  return keys;
}

async function requireAdmin(request: Request, env: Env): Promise<AdminAuthorization> {
  const token = request.headers.get('cf-access-jwt-assertion')?.trim();
  if (!token) {
    return {
      authorized: false,
      response: json({ error: 'Cloudflare Access authentication required' }, 401),
    };
  }

  const teamDomain = env.TEAM_DOMAIN?.trim().replace(/\/$/, '');
  const audience = env.POLICY_AUD?.trim();
  if (!teamDomain || !audience) {
    console.error('Cloudflare Access validation is not configured');
    return {
      authorized: false,
      response: json({ error: 'Admin authentication is not configured' }, 500),
    };
  }

  try {
    const identity = await verifyAccessJwt(token, {
      issuer: teamDomain,
      audience,
      keys: await getAccessKeys(teamDomain),
    });
    return { authorized: true, identity };
  } catch (error) {
    console.warn('Cloudflare Access token validation failed', error);
    return {
      authorized: false,
      response: json({ error: 'Invalid Cloudflare Access authentication' }, 403),
    };
  }
}

type WeddingRow = {
  id: number;
  slug: string;
  bride_name: string;
  groom_name: string;
  wedding_date: string;
  status: string;
};

type WeddingSettingsRow = {
  wedding_id: number;
  gallery_enabled: number;
  guest_uploads_enabled: number;
  require_guest_approval: number;
  photobooth_auto_approve: number;
  schedule_enabled: number;
  locations_enabled: number;
  info_enabled: number;
};

type WeddingSettings = {
  galleryEnabled: boolean;
  guestUploadsEnabled: boolean;
  requireGuestApproval: boolean;
  photoboothAutoApprove: boolean;
  scheduleEnabled: boolean;
  locationsEnabled: boolean;
  infoEnabled: boolean;
};

type AdminMediaStatsRow = {
  total: number;
  pending: number;
  approved: number;
  hidden: number;
  photos: number;
  videos: number;
  storage_bytes: number;
};

type MediaRow = {
  id: number;
  uuid: string;
  wedding_id: number;
  source: string;
  original_filename: string | null;
  original_key: string;
  thumbnail_key: string | null;
  preview_key: string | null;
  preview_status: string;
  preview_error: string | null;
  preview_generated_at: string | null;
  mime_type: string;
  size_bytes: number;
  width: number | null;
  height: number | null;
  sha256: string | null;
  status: string;
  created_at: string;
  uploaded_at: string | null;
};

type MediaProcessingRow = MediaRow & {
  wedding_slug: string;
};

type GalleryRow = Pick<
  MediaRow,
  'id' | 'uuid' | 'source' | 'mime_type' | 'created_at' | 'preview_status'
>;

function serializeWedding(row: WeddingRow) {
  return {
    id: row.id,
    slug: row.slug,
    brideName: row.bride_name,
    groomName: row.groom_name,
    weddingDate: row.wedding_date,
    status: row.status,
  };
}

async function findWeddingBySlug(env: Env, slug: string): Promise<WeddingRow | null> {
  return env.DB.prepare(
    `SELECT id, slug, bride_name, groom_name, wedding_date, status
     FROM weddings
     WHERE slug = ?
     LIMIT 1`,
  )
    .bind(slug)
    .first<WeddingRow>();
}

async function findCurrentWedding(env: Env): Promise<WeddingRow | null> {
  const slug = env.CURRENT_WEDDING_SLUG?.trim();
  return slug ? findWeddingBySlug(env, slug) : null;
}

const DEFAULT_WEDDING_SETTINGS: WeddingSettings = {
  galleryEnabled: true,
  guestUploadsEnabled: true,
  requireGuestApproval: true,
  photoboothAutoApprove: true,
  scheduleEnabled: true,
  locationsEnabled: true,
  infoEnabled: true,
};

function serializeWeddingSettings(row: WeddingSettingsRow | null): WeddingSettings {
  if (!row) return DEFAULT_WEDDING_SETTINGS;
  return {
    galleryEnabled: row.gallery_enabled === 1,
    guestUploadsEnabled: row.guest_uploads_enabled === 1,
    requireGuestApproval: row.require_guest_approval === 1,
    photoboothAutoApprove: row.photobooth_auto_approve === 1,
    scheduleEnabled: row.schedule_enabled === 1,
    locationsEnabled: row.locations_enabled === 1,
    infoEnabled: row.info_enabled === 1,
  };
}

async function getWeddingSettings(env: Env, weddingId: number): Promise<WeddingSettings> {
  const row = await env.DB.prepare(
    `SELECT wedding_id, gallery_enabled, guest_uploads_enabled,
            require_guest_approval, photobooth_auto_approve,
            schedule_enabled, locations_enabled, info_enabled
     FROM wedding_settings
     WHERE wedding_id = ?
     LIMIT 1`,
  )
    .bind(weddingId)
    .first<WeddingSettingsRow>();
  return serializeWeddingSettings(row);
}

function completedMediaStatus(source: string, settings: WeddingSettings): 'pending' | 'approved' {
  if (source === 'guest') return settings.requireGuestApproval ? 'pending' : 'approved';
  if (source === 'photobooth') return settings.photoboothAutoApprove ? 'approved' : 'pending';
  return 'approved';
}

function serializeMedia(row: MediaRow) {
  return {
    id: row.id,
    uuid: row.uuid,
    source: row.source,
    originalFilename: row.original_filename,
    originalKey: row.original_key,
    thumbnailKey: row.thumbnail_key,
    previewKey: row.preview_key,
    previewStatus: row.preview_status,
    previewError: row.preview_error,
    previewGeneratedAt: row.preview_generated_at,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    width: row.width,
    height: row.height,
    sha256: row.sha256,
    status: row.status,
    createdAt: row.created_at,
    uploadedAt: row.uploaded_at,
  };
}

function adminMediaPayload(row: MediaRow) {
  return {
    ...serializeMedia(row),
    thumbnailUrl: row.preview_status === 'ready'
      ? `/api/admin/media/${row.id}/thumbnail`
      : null,
  };
}

const ADMIN_MEDIA_SELECT = `SELECT id, uuid, wedding_id, source, original_filename, original_key,
                                   thumbnail_key, preview_key, preview_status, preview_error,
                                   preview_generated_at, mime_type, size_bytes, width, height, sha256,
                                   status, created_at, uploaded_at
                            FROM media`;

async function findOwnedMedia(env: Env, weddingId: number, mediaId: number): Promise<MediaRow | null> {
  return env.DB.prepare(
    `${ADMIN_MEDIA_SELECT}
     WHERE id = ? AND wedding_id = ?
     LIMIT 1`,
  )
    .bind(mediaId, weddingId)
    .first<MediaRow>();
}

async function deleteOwnedMedia(env: Env, weddingId: number, mediaId: number): Promise<boolean> {
  const media = await findOwnedMedia(env, weddingId, mediaId);
  if (!media) return false;

  const keys = [media.original_key, media.thumbnail_key, media.preview_key]
    .filter((key): key is string => Boolean(key));
  for (const key of keys) await env.MEDIA_BUCKET.delete(key);

  await env.DB.prepare('DELETE FROM media WHERE id = ? AND wedding_id = ?')
    .bind(media.id, weddingId)
    .run();
  return true;
}

async function runLimited<T>(
  values: T[],
  limit: number,
  task: (value: T) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < values.length) {
      const value = values[nextIndex++];
      await task(value);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, worker));
}

function parseBooleanSettings(body: unknown): WeddingSettings | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const input = body as Record<string, unknown>;
  const keys = [
    'galleryEnabled',
    'guestUploadsEnabled',
    'requireGuestApproval',
    'photoboothAutoApprove',
    'scheduleEnabled',
    'locationsEnabled',
    'infoEnabled',
  ] as const;
  if (!keys.every((key) => typeof input[key] === 'boolean')) return null;
  return {
    galleryEnabled: input.galleryEnabled as boolean,
    guestUploadsEnabled: input.guestUploadsEnabled as boolean,
    requireGuestApproval: input.requireGuestApproval as boolean,
    photoboothAutoApprove: input.photoboothAutoApprove as boolean,
    scheduleEnabled: input.scheduleEnabled as boolean,
    locationsEnabled: input.locationsEnabled as boolean,
    infoEnabled: input.infoEnabled as boolean,
  };
}

function isImageMimeType(mimeType: string): boolean {
  return mimeType.startsWith('image/');
}

function previewSourceDirectory(source: string): string {
  return source === 'guest' ? 'guests' : source.replace(/[^a-z0-9-]/g, '') || 'media';
}

function previewKeys(media: MediaProcessingRow): { thumbnailKey: string; previewKey: string } {
  const directory = previewSourceDirectory(media.source);
  return {
    thumbnailKey: `weddings/${media.wedding_slug}/${directory}/previews/${media.uuid}-thumbnail.webp`,
    previewKey: `weddings/${media.wedding_slug}/${directory}/previews/${media.uuid}-large.webp`,
  };
}

function previewErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : 'Preview generation failed';
  return message.replace(/\s+/g, ' ').trim().slice(0, 240) || 'Preview generation failed';
}

async function createPreviewVariant(
  env: Env,
  originalKey: string,
  outputKey: string,
  width: number,
  quality: number,
): Promise<void> {
  const original = await env.MEDIA_BUCKET.get(originalKey);
  if (!original) throw new Error('Original media object not found');

  const transformed = await env.IMAGES.input(original.body)
    .transform({ width, fit: 'scale-down' })
    .output({ format: 'image/webp', quality });

  await env.MEDIA_BUCKET.put(outputKey, transformed.image(), {
    httpMetadata: {
      contentType: 'image/webp',
      cacheControl: 'private, no-cache',
    },
  });
}

export async function processMediaPreview(
  env: Env,
  mediaId: number,
): Promise<'missing' | 'not_applicable' | 'ready' | 'generated'> {
  const media = await env.DB.prepare(
    `SELECT m.id, m.uuid, m.wedding_id, m.source, m.original_filename, m.original_key,
            m.thumbnail_key, m.preview_key, m.preview_status, m.preview_error,
            m.preview_generated_at, m.mime_type, m.size_bytes, m.width, m.height,
            m.sha256, m.status, m.created_at, m.uploaded_at, w.slug AS wedding_slug
     FROM media m
     INNER JOIN weddings w ON w.id = m.wedding_id
     WHERE m.id = ?
     LIMIT 1`,
  )
    .bind(mediaId)
    .first<MediaProcessingRow>();

  if (!media) return 'missing';
  if (!isImageMimeType(media.mime_type)) {
    if (media.preview_status !== 'not_applicable') {
      await env.DB.prepare(
        `UPDATE media
         SET preview_status = 'not_applicable', preview_error = NULL
         WHERE id = ?`,
      )
        .bind(media.id)
        .run();
    }
    return 'not_applicable';
  }
  if (media.preview_status === 'ready') return 'ready';

  await env.DB.prepare(
    `UPDATE media
     SET preview_status = 'processing', preview_error = NULL
     WHERE id = ?`,
  )
    .bind(media.id)
    .run();

  try {
    const keys = previewKeys(media);
    await createPreviewVariant(env, media.original_key, keys.thumbnailKey, 720, 78);
    await createPreviewVariant(env, media.original_key, keys.previewKey, 1600, 82);
    await env.DB.prepare(
      `UPDATE media
       SET thumbnail_key = ?, preview_key = ?, preview_status = 'ready',
           preview_error = NULL, preview_generated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    )
      .bind(keys.thumbnailKey, keys.previewKey, media.id)
      .run();
    return 'generated';
  } catch (error) {
    await env.DB.prepare(
      `UPDATE media
       SET preview_status = 'failed', preview_error = ?, preview_generated_at = NULL
       WHERE id = ?`,
    )
      .bind(previewErrorMessage(error), media.id)
      .run();
    throw error;
  }
}

async function previewResponse(
  env: Env,
  media: Pick<MediaRow, 'thumbnail_key' | 'preview_key'>,
  variant: 'thumbnail' | 'preview',
  request: Request,
  admin: boolean,
): Promise<Response> {
  const key = variant === 'thumbnail' ? media.thumbnail_key : media.preview_key;
  if (!key) return json({ error: 'Preview not found' }, 404);

  const object = await env.MEDIA_BUCKET.get(key);
  if (!object) return json({ error: 'Preview object not found' }, 404);

  const etag = object.httpEtag;
  if (!admin && etag && request.headers.get('if-none-match') === etag) {
    return new Response(null, {
      status: 304,
      headers: { etag, 'cache-control': 'private, no-cache' },
    });
  }

  return new Response(object.body, {
    headers: {
      'content-type': 'image/webp',
      'content-length': String(object.size),
      ...(etag ? { etag } : {}),
      'cache-control': admin ? 'private, no-store' : 'private, no-cache',
    },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/api/health') {
      return json({ status: 'ok' });
    }

    const adminAuthorization = url.pathname.startsWith('/api/admin/')
      ? await requireAdmin(request, env)
      : null;
    if (adminAuthorization && !adminAuthorization.authorized) {
      return adminAuthorization.response;
    }

    const contentResponse = await handleContentRequest(request, env);
    if (contentResponse) return contentResponse;

    if (request.method === 'GET' && url.pathname === '/api/config') {
      try {
        const wedding = await findCurrentWedding(env);
        if (!wedding) {
          return json({ error: 'Configuration not found' }, 404);
        }

        return json({ weddingDate: wedding.wedding_date });
      } catch (error) {
        console.error('Unable to read wedding configuration', error);
        return json({ error: 'Configuration unavailable' }, 500);
      }
    }

    if (request.method === 'GET' && url.pathname === '/api/wedding/current') {
      const currentWeddingSlug = env.CURRENT_WEDDING_SLUG?.trim();
      if (!currentWeddingSlug) {
        return json({ error: 'Current wedding is not configured' }, 500);
      }

      try {
        const wedding = await findWeddingBySlug(env, currentWeddingSlug);

        if (!wedding) {
          return json({ error: 'Configured wedding not found' }, 404);
        }

        return json(serializeWedding(wedding));
      } catch (error) {
        console.error('Unable to read active wedding', error);
        return json({ error: 'Wedding unavailable' }, 500);
      }
    }

    if (request.method === 'GET' && url.pathname === '/api/wedding/settings') {
      try {
        const wedding = await findCurrentWedding(env);
        if (!env.CURRENT_WEDDING_SLUG?.trim()) {
          return json({ error: 'Current wedding is not configured' }, 500);
        }
        if (!wedding) return json({ error: 'Configured wedding not found' }, 404);
        const settings = await getWeddingSettings(env, wedding.id);
        return json({
          galleryEnabled: settings.galleryEnabled,
          guestUploadsEnabled: settings.guestUploadsEnabled,
        });
      } catch (error) {
        console.error('Unable to read public wedding settings', error);
        return json({ error: 'Wedding settings unavailable' }, 500);
      }
    }

    if (request.method === 'GET' && url.pathname === '/api/admin/settings') {
      try {
        const wedding = await findCurrentWedding(env);
        if (!env.CURRENT_WEDDING_SLUG?.trim()) {
          return json({ error: 'Current wedding is not configured' }, 500);
        }
        if (!wedding) return json({ error: 'Configured wedding not found' }, 404);
        return json(await getWeddingSettings(env, wedding.id));
      } catch (error) {
        console.error('Unable to read admin wedding settings', error);
        return json({ error: 'Wedding settings unavailable' }, 500);
      }
    }

    if (request.method === 'PUT' && url.pathname === '/api/admin/settings') {
      try {
        const wedding = await findCurrentWedding(env);
        if (!env.CURRENT_WEDDING_SLUG?.trim()) {
          return json({ error: 'Current wedding is not configured' }, 500);
        }
        if (!wedding) return json({ error: 'Configured wedding not found' }, 404);

        const settings = parseBooleanSettings(await request.json());
        if (!settings) return json({ error: 'All settings must be boolean values' }, 400);

        await env.DB.prepare(
           `INSERT INTO wedding_settings (
              wedding_id, gallery_enabled, guest_uploads_enabled,
              require_guest_approval, photobooth_auto_approve,
              schedule_enabled, locations_enabled, info_enabled, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(wedding_id) DO UPDATE SET
              gallery_enabled = excluded.gallery_enabled,
              guest_uploads_enabled = excluded.guest_uploads_enabled,
              require_guest_approval = excluded.require_guest_approval,
              photobooth_auto_approve = excluded.photobooth_auto_approve,
              schedule_enabled = excluded.schedule_enabled,
              locations_enabled = excluded.locations_enabled,
              info_enabled = excluded.info_enabled,
              updated_at = CURRENT_TIMESTAMP`,
        )
          .bind(
            wedding.id,
            Number(settings.galleryEnabled),
            Number(settings.guestUploadsEnabled),
            Number(settings.requireGuestApproval),
            Number(settings.photoboothAutoApprove),
            Number(settings.scheduleEnabled),
            Number(settings.locationsEnabled),
            Number(settings.infoEnabled),
          )
          .run();
        return json(settings);
      } catch (error) {
        if (error instanceof SyntaxError) return json({ error: 'Invalid JSON body' }, 400);
        console.error('Unable to update wedding settings', error);
        return json({ error: 'Unable to update wedding settings' }, 500);
      }
    }

    if (request.method === 'GET' && url.pathname === '/api/admin/media/pending') {
      try {
        const wedding = await findCurrentWedding(env);
        if (!env.CURRENT_WEDDING_SLUG?.trim()) {
          return json({ error: 'Current wedding is not configured' }, 500);
        }
        if (!wedding) {
          return json({ error: 'Configured wedding not found' }, 404);
        }

        const result = await env.DB.prepare(
          `SELECT id, uuid, wedding_id, source, original_filename, original_key,
                  thumbnail_key, preview_key, preview_status, preview_error,
                  preview_generated_at, mime_type, size_bytes, width, height, sha256,
                  status, created_at, uploaded_at
           FROM media
           WHERE wedding_id = ? AND status = 'pending'
           ORDER BY created_at DESC, id DESC`,
        )
          .bind(wedding.id)
          .all<MediaRow>();

        return json({
          media: result.results.map(adminMediaPayload),
        });
      } catch (error) {
        console.error('Unable to list pending media', error);
        return json({ error: 'Pending media unavailable' }, 500);
      }
    }

    if (request.method === 'GET' && url.pathname === '/api/admin/media') {
      const status = url.searchParams.get('status') ?? 'all';
      const source = url.searchParams.get('source') ?? 'all';
      const allowedStatuses = new Set(['all', 'uploading', 'pending', 'approved', 'hidden']);
      const allowedSources = new Set(['all', 'guest', 'photobooth', 'admin']);
      if (!allowedStatuses.has(status)) return json({ error: 'Invalid status filter' }, 400);
      if (!allowedSources.has(source)) return json({ error: 'Invalid source filter' }, 400);

      try {
        const wedding = await findCurrentWedding(env);
        if (!env.CURRENT_WEDDING_SLUG?.trim()) {
          return json({ error: 'Current wedding is not configured' }, 500);
        }
        if (!wedding) return json({ error: 'Configured wedding not found' }, 404);

        const conditions = ['wedding_id = ?'];
        const bindings: Array<number | string> = [wedding.id];
        if (status !== 'all') {
          conditions.push('status = ?');
          bindings.push(status);
        }
        if (source !== 'all') {
          conditions.push('source = ?');
          bindings.push(source);
        }

        const [mediaResult, stats] = await Promise.all([
          env.DB.prepare(
            `${ADMIN_MEDIA_SELECT}
             WHERE ${conditions.join(' AND ')}
             ORDER BY created_at DESC, id DESC`,
          )
            .bind(...bindings)
            .all<MediaRow>(),
          env.DB.prepare(
            `SELECT COUNT(*) AS total,
                    COALESCE(SUM(status = 'pending'), 0) AS pending,
                    COALESCE(SUM(status = 'approved'), 0) AS approved,
                    COALESCE(SUM(status = 'hidden'), 0) AS hidden,
                    COALESCE(SUM(mime_type LIKE 'image/%'), 0) AS photos,
                    COALESCE(SUM(mime_type LIKE 'video/%'), 0) AS videos,
                    COALESCE(SUM(size_bytes), 0) AS storage_bytes
             FROM media
             WHERE wedding_id = ?`,
          )
            .bind(wedding.id)
            .first<AdminMediaStatsRow>(),
        ]);

        return json({
          media: mediaResult.results.map(adminMediaPayload),
          stats: {
            total: stats?.total ?? 0,
            pending: stats?.pending ?? 0,
            approved: stats?.approved ?? 0,
            hidden: stats?.hidden ?? 0,
            photos: stats?.photos ?? 0,
            videos: stats?.videos ?? 0,
            storageBytes: stats?.storage_bytes ?? 0,
          },
        });
      } catch (error) {
        console.error('Unable to list admin media', error);
        return json({ error: 'Admin media unavailable' }, 500);
      }
    }

    const adminPreviewMedia = url.pathname.match(
      /^\/api\/admin\/media\/([^/]+)\/(thumbnail|preview)$/,
    );
    if (request.method === 'GET' && adminPreviewMedia) {
      const mediaId = Number(adminPreviewMedia[1]);
      const variant = adminPreviewMedia[2] as 'thumbnail' | 'preview';
      if (!Number.isSafeInteger(mediaId) || mediaId <= 0) {
        return json({ error: 'Invalid media ID' }, 400);
      }

      try {
        const wedding = await findCurrentWedding(env);
        if (!wedding) return json({ error: 'Configured wedding not found' }, 404);
        const media = await env.DB.prepare(
          `SELECT thumbnail_key, preview_key
           FROM media
           WHERE id = ? AND wedding_id = ? AND status IN ('uploading', 'pending', 'approved', 'hidden')
                 AND preview_status = 'ready'
           LIMIT 1`,
        )
          .bind(mediaId, wedding.id)
          .first<Pick<MediaRow, 'thumbnail_key' | 'preview_key'>>();
        if (!media) return json({ error: 'Preview not found' }, 404);
        return previewResponse(env, media, variant, request, true);
      } catch (error) {
        console.error('Unable to serve admin preview', error);
        return json({ error: 'Preview unavailable' }, 500);
      }
    }

    const adminViewMedia = url.pathname.match(/^\/api\/admin\/media\/([^/]+)\/view$/);
    if (request.method === 'GET' && adminViewMedia) {
      const mediaId = Number(adminViewMedia[1]);
      if (!Number.isSafeInteger(mediaId) || mediaId <= 0) {
        return json({ error: 'Invalid media ID' }, 400);
      }

      try {
        const wedding = await findCurrentWedding(env);
        if (!env.CURRENT_WEDDING_SLUG?.trim()) {
          return json({ error: 'Current wedding is not configured' }, 500);
        }
        if (!wedding) {
          return json({ error: 'Configured wedding not found' }, 404);
        }

        const media = await env.DB.prepare(
          `SELECT id, uuid, wedding_id, source, original_filename, original_key,
                  thumbnail_key, preview_key, preview_status, preview_error,
                  preview_generated_at, mime_type, size_bytes, width, height, sha256,
                  status, created_at, uploaded_at
           FROM media
           WHERE id = ? AND wedding_id = ? AND status IN ('uploading', 'pending', 'approved', 'hidden')
           LIMIT 1`,
        )
          .bind(mediaId, wedding.id)
          .first<MediaRow>();

        if (!media) {
          return json({ error: 'Media not found' }, 404);
        }

        const object = await env.MEDIA_BUCKET.get(media.original_key);
        if (!object) {
          return json({ error: 'Media object not found' }, 404);
        }

        return new Response(object.body, {
          headers: {
            'content-type': media.mime_type,
            'content-length': String(object.size),
            'cache-control': media.status === 'approved' ? 'private, max-age=300' : 'private, no-store',
          },
        });
      } catch (error) {
        console.error('Unable to serve admin media', error);
        return json({ error: 'Media unavailable' }, 500);
      }
    }

    const adminMediaAction = url.pathname.match(/^\/api\/admin\/media\/([^/]+)\/(approve|hide|restore)$/);
    if (request.method === 'POST' && adminMediaAction) {
      const mediaId = Number(adminMediaAction[1]);
      const action = adminMediaAction[2] as 'approve' | 'hide' | 'restore';
      if (!Number.isSafeInteger(mediaId) || mediaId <= 0) {
        return json({ error: 'Invalid media ID' }, 400);
      }

      try {
        const wedding = await findCurrentWedding(env);
        if (!env.CURRENT_WEDDING_SLUG?.trim()) {
          return json({ error: 'Current wedding is not configured' }, 500);
        }
        if (!wedding) {
          return json({ error: 'Configured wedding not found' }, 404);
        }

        const media = await env.DB.prepare(
          'SELECT id, wedding_id, status FROM media WHERE id = ? AND wedding_id = ? LIMIT 1',
        )
          .bind(mediaId, wedding.id)
          .first<Pick<MediaRow, 'id' | 'wedding_id' | 'status'>>();

        if (!media) {
          return json({ error: 'Media not found' }, 404);
        }

        const allowedStatuses = action === 'approve'
          ? new Set(['pending', 'approved'])
          : action === 'restore'
            ? new Set(['hidden'])
            : new Set(['pending', 'approved', 'hidden']);
        if (!allowedStatuses.has(media.status)) {
          return json({ error: 'Media status is not valid for this action' }, 409);
        }

        const nextStatus = action === 'hide' ? 'hidden' : 'approved';
        if (media.status !== nextStatus) {
          await env.DB.prepare('UPDATE media SET status = ? WHERE id = ? AND wedding_id = ?')
            .bind(nextStatus, media.id, wedding.id)
            .run();
        }

        return json({ mediaId: media.id, status: nextStatus });
      } catch (error) {
        console.error('Unable to moderate media', error);
        return json({ error: 'Unable to moderate media' }, 500);
      }
    }

    if (request.method === 'POST' && url.pathname === '/api/admin/media/bulk') {
      try {
        const wedding = await findCurrentWedding(env);
        if (!env.CURRENT_WEDDING_SLUG?.trim()) {
          return json({ error: 'Current wedding is not configured' }, 500);
        }
        if (!wedding) return json({ error: 'Configured wedding not found' }, 404);

        const body: unknown = await request.json();
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
          return json({ error: 'JSON body must be an object' }, 400);
        }
        const input = body as Record<string, unknown>;
        const action = input.action;
        const ids = Array.isArray(input.ids)
          ? [...new Set(input.ids.filter((id): id is number => Number.isSafeInteger(id) && id > 0))]
          : [];
        if (action !== 'approve' && action !== 'hide' && action !== 'delete') {
          return json({ error: 'Invalid bulk action' }, 400);
        }
        if (ids.length === 0 || ids.length > 100 || ids.length !== (input.ids as unknown[])?.length) {
          return json({ error: 'Provide between 1 and 100 unique valid media IDs' }, 400);
        }

        let affected = 0;
        await runLimited(ids, 3, async (mediaId) => {
          if (action === 'delete') {
            if (await deleteOwnedMedia(env, wedding.id, mediaId)) affected += 1;
            return;
          }

          const media = await findOwnedMedia(env, wedding.id, mediaId);
          if (!media) return;
          const allowed = action === 'approve'
            ? new Set(['pending', 'approved'])
            : new Set(['pending', 'approved', 'hidden']);
          if (!allowed.has(media.status)) return;
          const nextStatus = action === 'approve' ? 'approved' : 'hidden';
          if (media.status !== nextStatus) {
            await env.DB.prepare('UPDATE media SET status = ? WHERE id = ? AND wedding_id = ?')
              .bind(nextStatus, media.id, wedding.id)
              .run();
          }
          affected += 1;
        });

        return json({ action, affected });
      } catch (error) {
        if (error instanceof SyntaxError) return json({ error: 'Invalid JSON body' }, 400);
        console.error('Unable to run bulk media action', error);
        return json({ error: 'Bulk media action failed' }, 500);
      }
    }

    const deleteAdminMedia = url.pathname.match(/^\/api\/admin\/media\/([^/]+)$/);
    if (request.method === 'DELETE' && deleteAdminMedia) {
      const mediaId = Number(deleteAdminMedia[1]);
      if (!Number.isSafeInteger(mediaId) || mediaId <= 0) {
        return json({ error: 'Invalid media ID' }, 400);
      }

      try {
        const wedding = await findCurrentWedding(env);
        if (!env.CURRENT_WEDDING_SLUG?.trim()) {
          return json({ error: 'Current wedding is not configured' }, 500);
        }
        if (!wedding) return json({ error: 'Configured wedding not found' }, 404);
        if (!await deleteOwnedMedia(env, wedding.id, mediaId)) {
          return json({ error: 'Media not found' }, 404);
        }
        return json({ mediaId, deleted: true });
      } catch (error) {
        console.error('Unable to delete media', error);
        return json({ error: 'Unable to delete media' }, 500);
      }
    }

    if (request.method === 'DELETE' && url.pathname === '/api/admin/media') {
      try {
        const wedding = await findCurrentWedding(env);
        if (!env.CURRENT_WEDDING_SLUG?.trim()) {
          return json({ error: 'Current wedding is not configured' }, 500);
        }
        if (!wedding) return json({ error: 'Configured wedding not found' }, 404);

        const body: unknown = await request.json();
        if (
          !body
          || typeof body !== 'object'
          || Array.isArray(body)
          || (body as Record<string, unknown>).confirmation !== 'ELIMINA TUTTO'
        ) {
          return json({ error: 'Strong confirmation is required' }, 400);
        }

        let deleted = 0;
        while (true) {
          const batch = await env.DB.prepare(
            'SELECT id FROM media WHERE wedding_id = ? ORDER BY id LIMIT 50',
          )
            .bind(wedding.id)
            .all<{ id: number }>();
          const ids = batch.results.map((row) => row.id);
          if (ids.length === 0) break;
          await runLimited(ids, 3, async (mediaId) => {
            if (await deleteOwnedMedia(env, wedding.id, mediaId)) deleted += 1;
          });
        }

        return json({ deleted });
      } catch (error) {
        if (error instanceof SyntaxError) return json({ error: 'Invalid JSON body' }, 400);
        console.error('Unable to delete all wedding media', error);
        return json({ error: 'Unable to delete all wedding media' }, 500);
      }
    }

    if (request.method === 'POST' && url.pathname === '/api/media/create') {
      try {
        const wedding = await findCurrentWedding(env);
        if (!env.CURRENT_WEDDING_SLUG?.trim()) {
          return json({ error: 'Current wedding is not configured' }, 500);
        }
        if (!wedding) {
          return json({ error: 'Configured wedding not found' }, 404);
        }

        const settings = await getWeddingSettings(env, wedding.id);
        if (!settings.guestUploadsEnabled) {
          return json({
            error: 'Guest uploads are currently disabled',
            code: 'guest_uploads_disabled',
          }, 403);
        }

        const body: unknown = await request.json();
        if (!body || typeof body !== 'object' || Array.isArray(body)) {
          return json({ error: 'JSON body must be an object' }, 400);
        }
        const input = body as Record<string, unknown>;
        const filename = typeof input.filename === 'string' ? input.filename.trim() : '';
        const mimeType =
          typeof input.mimeType === 'string' ? input.mimeType.trim().toLowerCase() : '';
        const size = input.size;

        if (!filename) {
          return json({ error: 'Filename is required' }, 400);
        }
        if (!Object.prototype.hasOwnProperty.call(MEDIA_TYPES, mimeType)) {
          return json({ error: 'Unsupported media type' }, 400);
        }
        if (typeof size !== 'number' || !Number.isSafeInteger(size) || size <= 0) {
          return json({ error: 'Size must be a positive integer' }, 400);
        }

        const mediaType = MEDIA_TYPES[mimeType as SupportedMimeType];
        if (size > mediaType.maxSize) {
          return json({ error: 'File exceeds the allowed size' }, 400);
        }

        const uuid = crypto.randomUUID();
        const originalKey = `weddings/${wedding.slug}/guests/originals/${uuid}.${mediaType.extension}`;
        const uploadUrl = await createPresignedPutUrl(env, originalKey);
        const result = await env.DB.prepare(
          `INSERT INTO media
             (uuid, wedding_id, source, original_filename, original_key, mime_type,
              size_bytes, status, preview_status)
           VALUES (?, ?, 'guest', ?, ?, ?, ?, 'uploading', ?)`,
        )
          .bind(
            uuid,
            wedding.id,
            filename,
            originalKey,
            mimeType,
            size,
            mimeType.startsWith('video/') ? 'not_applicable' : 'pending',
          )
          .run();

        return json(
          {
            mediaId: result.meta.last_row_id,
            uuid,
            originalKey,
            uploadUrl,
            method: 'PUT',
          },
          201,
        );
      } catch (error) {
        if (error instanceof SyntaxError) {
          return json({ error: 'Invalid JSON body' }, 400);
        }
        console.error('Unable to create media record', error);
        return json({ error: 'Unable to create media' }, 500);
      }
    }

    const completeMedia = url.pathname.match(/^\/api\/media\/([^/]+)\/complete$/);
    if (request.method === 'POST' && completeMedia) {
      const mediaId = Number(completeMedia[1]);
      if (!Number.isSafeInteger(mediaId) || mediaId <= 0) {
        return json({ error: 'Invalid media ID' }, 400);
      }

      try {
        const wedding = await findCurrentWedding(env);
        if (!env.CURRENT_WEDDING_SLUG?.trim()) {
          return json({ error: 'Current wedding is not configured' }, 500);
        }
        if (!wedding) {
          return json({ error: 'Configured wedding not found' }, 404);
        }

        const settings = await getWeddingSettings(env, wedding.id);

        const media = await env.DB.prepare(
          `SELECT id, uuid, wedding_id, source, original_filename, original_key,
                  thumbnail_key, preview_key, preview_status, preview_error,
                  preview_generated_at, mime_type, size_bytes, width, height, sha256,
                  status, created_at, uploaded_at
           FROM media
           WHERE id = ?
           LIMIT 1`,
        )
          .bind(mediaId)
          .first<MediaRow>();

        if (!media || media.wedding_id !== wedding.id) {
          return json({ error: 'Media not found' }, 404);
        }

        const object = await env.MEDIA_BUCKET.head(media.original_key);
        if (!object) {
          return json({ error: 'Uploaded object not found' }, 409);
        }
        if (object.size !== media.size_bytes) {
          return json({ error: 'Uploaded object size does not match' }, 409);
        }

        let mediaStatus = media.status;
        if (media.status === 'uploading') {
          const nextStatus = completedMediaStatus(media.source, settings);
          await env.DB.prepare(
            `UPDATE media
             SET status = ?, uploaded_at = COALESCE(uploaded_at, CURRENT_TIMESTAMP)
             WHERE id = ? AND wedding_id = ? AND status = 'uploading'`,
          )
            .bind(nextStatus, media.id, wedding.id)
            .run();
          mediaStatus = nextStatus;
        }

        if (isImageMimeType(media.mime_type) && media.preview_status !== 'ready') {
          await env.MEDIA_PROCESSING_QUEUE.send({ mediaId: media.id });
        } else if (!isImageMimeType(media.mime_type) && media.preview_status !== 'not_applicable') {
          await env.DB.prepare(
            `UPDATE media
             SET preview_status = 'not_applicable', preview_error = NULL
             WHERE id = ?`,
          )
            .bind(media.id)
            .run();
        }

        return json({ mediaId: media.id, status: mediaStatus });
      } catch (error) {
        console.error('Unable to complete media upload', error);
        return json({ error: 'Unable to complete media upload' }, 500);
      }
    }

    if (request.method === 'GET' && url.pathname === '/api/media') {
      try {
        const wedding = await findCurrentWedding(env);
        if (!env.CURRENT_WEDDING_SLUG?.trim()) {
          return json({ error: 'Current wedding is not configured' }, 500);
        }
        if (!wedding) {
          return json({ error: 'Configured wedding not found' }, 404);
        }

        const result = await env.DB.prepare(
          `SELECT id, uuid, wedding_id, source, original_filename, original_key,
                  thumbnail_key, preview_key, preview_status, preview_error,
                  preview_generated_at, mime_type, size_bytes, width, height, sha256,
                  status, created_at, uploaded_at
           FROM media
           WHERE wedding_id = ?
           ORDER BY created_at DESC, id DESC`,
        )
          .bind(wedding.id)
          .all<MediaRow>();

        return json({ media: result.results.map(serializeMedia) });
      } catch (error) {
        console.error('Unable to list media', error);
        return json({ error: 'Unable to list media' }, 500);
      }
    }

    if (request.method === 'GET' && url.pathname === '/api/gallery') {
      try {
        const wedding = await findCurrentWedding(env);
        if (!env.CURRENT_WEDDING_SLUG?.trim()) {
          return json({ error: 'Current wedding is not configured' }, 500);
        }
        if (!wedding) {
          return json({ error: 'Configured wedding not found' }, 404);
        }

        const settings = await getWeddingSettings(env, wedding.id);
        if (!settings.galleryEnabled) {
          return json({ galleryEnabled: false, media: [] });
        }

        const result = await env.DB.prepare(
          `SELECT id, uuid, source, mime_type, created_at, preview_status
           FROM media
           WHERE wedding_id = ? AND status = 'approved'
           ORDER BY created_at DESC, id DESC`,
        )
          .bind(wedding.id)
          .all<GalleryRow>();

        return json({
          galleryEnabled: true,
          media: result.results.map((row) => ({
            id: row.id,
            uuid: row.uuid,
            source: row.source,
            mimeType: row.mime_type,
            createdAt: row.created_at,
            mediaUrl: `/api/media/${row.id}/view`,
            thumbnailUrl: row.preview_status === 'ready'
              ? `/api/media/${row.id}/thumbnail`
              : null,
            previewUrl: row.preview_status === 'ready'
              ? `/api/media/${row.id}/preview`
              : null,
            previewStatus: row.preview_status,
          })),
        });
      } catch (error) {
        console.error('Unable to list gallery media', error);
        return json({ error: 'Gallery unavailable' }, 500);
      }
    }

    const previewMedia = url.pathname.match(/^\/api\/media\/([^/]+)\/(thumbnail|preview)$/);
    if (request.method === 'GET' && previewMedia) {
      const mediaId = Number(previewMedia[1]);
      const variant = previewMedia[2] as 'thumbnail' | 'preview';
      if (!Number.isSafeInteger(mediaId) || mediaId <= 0) {
        return json({ error: 'Invalid media ID' }, 400);
      }

      try {
        const wedding = await findCurrentWedding(env);
        if (!env.CURRENT_WEDDING_SLUG?.trim()) {
          return json({ error: 'Current wedding is not configured' }, 500);
        }
        if (!wedding) return json({ error: 'Configured wedding not found' }, 404);
        if (!(await getWeddingSettings(env, wedding.id)).galleryEnabled) {
          return json({ error: 'Preview not found' }, 404);
        }

        const media = await env.DB.prepare(
          `SELECT thumbnail_key, preview_key
           FROM media
           WHERE id = ? AND wedding_id = ? AND status = 'approved'
                 AND preview_status = 'ready'
           LIMIT 1`,
        )
          .bind(mediaId, wedding.id)
          .first<Pick<MediaRow, 'thumbnail_key' | 'preview_key'>>();
        if (!media) return json({ error: 'Preview not found' }, 404);
        return previewResponse(env, media, variant, request, false);
      } catch (error) {
        console.error('Unable to serve gallery preview', error);
        return json({ error: 'Preview unavailable' }, 500);
      }
    }

    const viewMedia = url.pathname.match(/^\/api\/media\/([^/]+)\/view$/);
    if (request.method === 'GET' && viewMedia) {
      const mediaId = Number(viewMedia[1]);
      if (!Number.isSafeInteger(mediaId) || mediaId <= 0) {
        return json({ error: 'Invalid media ID' }, 400);
      }

      try {
        const wedding = await findCurrentWedding(env);
        if (!env.CURRENT_WEDDING_SLUG?.trim()) {
          return json({ error: 'Current wedding is not configured' }, 500);
        }
        if (!wedding) {
          return json({ error: 'Configured wedding not found' }, 404);
        }
        if (!(await getWeddingSettings(env, wedding.id)).galleryEnabled) {
          return json({ error: 'Media not found' }, 404);
        }

        const media = await env.DB.prepare(
          `SELECT id, uuid, wedding_id, source, original_filename, original_key,
                  thumbnail_key, preview_key, preview_status, preview_error,
                  preview_generated_at, mime_type, size_bytes, width, height, sha256,
                  status, created_at, uploaded_at
           FROM media
           WHERE id = ? AND wedding_id = ? AND status = 'approved'
           LIMIT 1`,
        )
          .bind(mediaId, wedding.id)
          .first<MediaRow>();

        if (!media) {
          return json({ error: 'Media not found' }, 404);
        }

        const object = await env.MEDIA_BUCKET.get(media.original_key);
        if (!object) {
          return json({ error: 'Media object not found' }, 404);
        }

        return new Response(object.body, {
          headers: {
            'content-type': media.mime_type,
            'content-length': String(object.size),
            'cache-control': 'private, max-age=300',
          },
        });
      } catch (error) {
        console.error('Unable to serve gallery media', error);
        return json({ error: 'Media unavailable' }, 500);
      }
    }

    const weddingBySlug = url.pathname.match(/^\/api\/weddings\/([a-z0-9-]+)$/);
    if (request.method === 'GET' && weddingBySlug) {
      try {
        const wedding = await findWeddingBySlug(env, weddingBySlug[1]);

        if (!wedding) {
          return json({ error: 'Wedding not found' }, 404);
        }

        return json(serializeWedding(wedding));
      } catch (error) {
        console.error('Unable to read wedding by slug', error);
        return json({ error: 'Wedding unavailable' }, 500);
      }
    }

    if (url.pathname.startsWith('/api/')) {
      return json({ error: 'Not found' }, 404);
    }

    return env.ASSETS.fetch(request);
  },

  async queue(batch: MessageBatch<MediaProcessingMessage>, env: Env): Promise<void> {
    for (const message of batch.messages) {
      const mediaId = message.body?.mediaId;
      if (!Number.isSafeInteger(mediaId) || mediaId <= 0) {
        console.warn('Ignoring invalid media processing message');
        message.ack();
        continue;
      }

      try {
        await processMediaPreview(env, mediaId);
        message.ack();
      } catch (error) {
        console.error(`Unable to generate previews for media ${mediaId}`, error);
        message.retry({ delaySeconds: Math.min(300, 30 * Math.max(1, message.attempts)) });
      }
    }
  },
} satisfies ExportedHandler<Env, MediaProcessingMessage>;
