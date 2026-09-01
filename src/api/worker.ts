import { handleContentRequest } from './content';
import { handleFantasposiRequest } from './fantasposi';
import { handleAdminFantasposiRequest } from './fantasposi-admin';
import { createPostgresDatabase, type Database } from '../lib/supabase-db';

export interface WorkerEnv {
  MEDIA_BUCKET: R2Bucket;
  IMAGES: ImagesBinding;
  MEDIA_PROCESSING_QUEUE: Queue<MediaProcessingMessage>;
  ASSETS: Fetcher;
  CURRENT_WEDDING_SLUG: string;
  R2_ACCOUNT_ID: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  HYPERDRIVE?: Hyperdrive;
  SUPABASE_DATABASE_URL?: string;
}

export type Env = WorkerEnv & { DB: Database };

function withDatabase(env: WorkerEnv): Env {
  return {
    ...env,
    DB: createPostgresDatabase({
      connectionString: env.HYPERDRIVE?.connectionString ?? env.SUPABASE_DATABASE_URL,
    }),
  };
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

const SITE_ASSET_TYPES = new Set(['hero', 'story', 'location', 'info', 'other']);
const SITE_IMAGE_TYPES = {
  'image/jpeg': { extension: 'jpg' },
  'image/png': { extension: 'png' },
  'image/webp': { extension: 'webp' },
  'image/heic': { extension: 'heic' },
  'image/heif': { extension: 'heif' },
} as const;
const SITE_ASSET_MAX_SIZE = 20 * MEGABYTE;

type SupportedMimeType = keyof typeof MEDIA_TYPES;

export type MediaProcessingMessage =
  | { kind?: 'media'; mediaId: number }
  | { kind: 'site_asset'; siteAssetId: number };

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

type AdminAuthorization =
  | { authorized: true; identity: AdminIdentity }
  | { authorized: false; response: Response };

async function requireAdmin(request: Request, env: Env): Promise<AdminAuthorization> {
  const authorization = request.headers.get('authorization')?.trim() ?? '';
  const token = authorization.toLowerCase().startsWith('bearer ')
    ? authorization.slice(7).trim()
    : '';
  if (!token) {
    return {
      authorized: false,
      response: json({ error: 'Supabase authentication required' }, 401),
    };
  }

  const supabaseUrl = env.SUPABASE_URL?.trim().replace(/\/$/, '');
  const anonKey = env.SUPABASE_ANON_KEY?.trim();
  const weddingSlug = env.CURRENT_WEDDING_SLUG?.trim();
  if (!supabaseUrl || !anonKey || !weddingSlug) {
    console.error('Supabase admin authentication is not configured');
    return {
      authorized: false,
      response: json({ error: 'Admin authentication is not configured' }, 500),
    };
  }

  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { apikey: anonKey, authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      return { authorized: false, response: json({ error: 'Invalid or expired Supabase session' }, 401) };
    }
    const user = await response.json() as { id?: string; email?: string };
    if (!user.id) {
      return { authorized: false, response: json({ error: 'Invalid Supabase identity' }, 401) };
    }

    const role = await env.DB.prepare(
      `SELECT p.system_role, wm.role AS wedding_role
       FROM weddings w
       LEFT JOIN profiles p ON p.user_id = ?
       LEFT JOIN wedding_members wm ON wm.wedding_id = w.id AND wm.user_id = ?
       WHERE w.slug = ?
       LIMIT 1`,
    ).bind(user.id, user.id, weddingSlug).first<{ system_role: string | null; wedding_role: string | null }>();
    if (role?.system_role !== 'super_admin' && role?.wedding_role !== 'wedding_admin') {
      return { authorized: false, response: json({ error: 'Admin role required' }, 403) };
    }

    const identity: AdminIdentity = {
      subject: user.id,
      ...(user.email ? { email: user.email } : {}),
    };
    return { authorized: true, identity };
  } catch (error) {
    console.warn('Supabase admin validation failed', error);
    return {
      authorized: false,
      response: json({ error: 'Admin authentication unavailable' }, 500),
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
  gallery_enabled: boolean;
  gallery_preview_enabled: boolean;
  gallery_download_enabled: boolean;
  guest_uploads_enabled: boolean;
  require_guest_approval: boolean;
  photobooth_auto_approve: boolean;
  schedule_enabled: boolean;
  locations_enabled: boolean;
  info_enabled: boolean;
};

type WeddingSettings = {
  galleryEnabled: boolean;
  galleryPreviewEnabled: boolean;
  galleryDownloadEnabled: boolean;
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

type SiteAssetRow = {
  id: number;
  uuid: string;
  wedding_id: number;
  asset_type: string;
  original_filename: string | null;
  original_key: string;
  optimized_key: string | null;
  mime_type: string;
  size_bytes: number | null;
  width: number | null;
  height: number | null;
  status: string;
  created_at: string;
  uploaded_at: string | null;
  processed_at: string | null;
};

type SiteAssetProcessingRow = SiteAssetRow & { wedding_slug: string };

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
  galleryPreviewEnabled: true,
  galleryDownloadEnabled: true,
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
    galleryEnabled: row.gallery_enabled,
    galleryPreviewEnabled: row.gallery_preview_enabled,
    galleryDownloadEnabled: row.gallery_download_enabled,
    guestUploadsEnabled: row.guest_uploads_enabled,
    requireGuestApproval: row.require_guest_approval,
    photoboothAutoApprove: row.photobooth_auto_approve,
    scheduleEnabled: row.schedule_enabled,
    locationsEnabled: row.locations_enabled,
    infoEnabled: row.info_enabled,
  };
}

async function getWeddingSettings(env: Env, weddingId: number): Promise<WeddingSettings> {
  const row = await env.DB.prepare(
    `SELECT wedding_id, gallery_enabled, gallery_preview_enabled, gallery_download_enabled,
            guest_uploads_enabled,
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

function downloadFilename(media: Pick<MediaRow, 'id' | 'mime_type' | 'original_filename'>): {
  ascii: string;
  utf8: string;
} {
  const extension = MEDIA_TYPES[media.mime_type as SupportedMimeType]?.extension ?? 'bin';
  const fallback = `wedding-photo-${media.id}.${extension}`;
  const forbiddenCharacters = new Set(['\\', '/', ':', '*', '?', '"', '<', '>', '|', ';']);
  const sanitized = media.original_filename
    ? Array.from(media.original_filename.normalize('NFC'), (character) => {
        const codePoint = character.codePointAt(0) ?? 0;
        return codePoint <= 31 || (codePoint >= 127 && codePoint <= 159) || forbiddenCharacters.has(character)
          ? '_'
          : character;
      }).join('')
    : undefined;
  const candidate = sanitized
    ?.replace(/\s+/g, ' ')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 140);
  const meaningful = candidate?.replace(/[\s._-]/g, '');
  const utf8 = candidate && meaningful
    ? (/\.[a-z0-9]{1,10}$/i.test(candidate) ? candidate : `${candidate}.${extension}`)
    : fallback;
  const ascii = utf8
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7e]/g, '_');
  return { ascii: ascii || fallback, utf8 };
}

function downloadContentDisposition(media: Pick<MediaRow, 'id' | 'mime_type' | 'original_filename'>): string {
  const filename = downloadFilename(media);
  return `attachment; filename="${filename.ascii}"; filename*=UTF-8''${encodeRfc3986(filename.utf8)}`;
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

type MediaStatusMutation = 'updated' | 'unchanged' | 'not_found' | 'invalid_status' | 'preview_not_ready';

type BulkMediaMutationRow = {
  requested_id: number;
  previous_status: string | null;
  result_status: string | null;
  wedding_id: number | null;
  mime_type: string | null;
  preview_status: string | null;
};

async function setOwnedMediaStatus(
  env: Env,
  weddingId: number,
  mediaId: number,
  nextStatus: string,
  allowedStatuses: ReadonlySet<string>,
  requireReadyImagePreview = false,
): Promise<MediaStatusMutation> {
  const media = await findOwnedMedia(env, weddingId, mediaId);
  if (!media) return 'not_found';
  if (!allowedStatuses.has(media.status)) return 'invalid_status';
  if (requireReadyImagePreview && media.mime_type.startsWith('image/') && media.preview_status !== 'ready') {
    return 'preview_not_ready';
  }
  if (media.status === nextStatus) return 'unchanged';

  const update = await env.DB.prepare(
    'UPDATE media SET status = ? WHERE id = ? AND wedding_id = ? AND status = ?',
  ).bind(nextStatus, media.id, weddingId, media.status).run();
  if (update.meta.changes === 1) {
    const persisted = update.results[0] as unknown as Pick<MediaRow, 'id' | 'wedding_id' | 'status'> | undefined;
    if (
      !persisted
      || persisted.id !== media.id
      || persisted.wedding_id !== weddingId
      || persisted.status !== nextStatus
    ) {
      throw new Error(`Media ${media.id} did not reach status ${nextStatus}`);
    }
    return 'updated';
  }

  const current = await findOwnedMedia(env, weddingId, media.id);
  if (!current) return 'not_found';
  if (current.status !== nextStatus) {
    throw new Error(`Media ${media.id} did not reach status ${nextStatus}`);
  }
  return 'unchanged';
}

async function bulkSetOwnedMediaStatus(
  env: Env,
  weddingId: number,
  ids: number[],
  action: 'approve' | 'hide',
): Promise<{
  eligibleIds: number[];
  updatedIds: number[];
  unchangedIds: number[];
  previewNotReadyIds: number[];
  skippedIds: number[];
  notFoundIds: number[];
}> {
  const requestedValues = ids.map(() => '(?::bigint)').join(', ');
  const nextStatus = action === 'approve' ? 'approved' : 'hidden';
  const mutableStatuses = action === 'approve'
    ? "('pending')"
    : "('pending', 'approved')";
  const previewEligibility = action === 'approve'
    ? "AND (m.mime_type NOT LIKE 'image/%' OR m.preview_status = 'ready')"
    : '';
  const result = await env.DB.prepare(
    `WITH requested(id) AS (VALUES ${requestedValues}),
          candidates AS MATERIALIZED (
            SELECT m.id, m.wedding_id, m.status, m.mime_type, m.preview_status
            FROM media m
            INNER JOIN requested r ON r.id = m.id
            WHERE m.wedding_id = ?
          ),
          updated AS (
            UPDATE media m
            SET status = ?
            FROM candidates c
            WHERE m.id = c.id
              AND m.wedding_id = ?
              AND m.status IN ${mutableStatuses}
              ${previewEligibility}
            RETURNING m.id, m.wedding_id, m.status
          )
     SELECT r.id AS requested_id,
            c.status AS previous_status,
            u.status AS result_status,
            c.wedding_id,
            c.mime_type,
            c.preview_status
     FROM requested r
     LEFT JOIN candidates c ON c.id = r.id
     LEFT JOIN updated u ON u.id = r.id
     ORDER BY r.id`,
  ).bind(...ids, weddingId, nextStatus, weddingId).all<BulkMediaMutationRow>();

  const updatedIds: number[] = [];
  const unchangedIds: number[] = [];
  const previewNotReadyIds: number[] = [];
  const skippedIds: number[] = [];
  const notFoundIds: number[] = [];
  for (const row of result.results) {
    if (row.result_status === nextStatus && row.wedding_id === weddingId) {
      updatedIds.push(row.requested_id);
    } else if (row.previous_status === nextStatus && row.wedding_id === weddingId) {
      unchangedIds.push(row.requested_id);
    } else if (row.previous_status === null || row.wedding_id === null) {
      notFoundIds.push(row.requested_id);
    } else if (
      action === 'approve'
      && row.previous_status === 'pending'
      && row.mime_type?.startsWith('image/')
      && row.preview_status !== 'ready'
    ) {
      previewNotReadyIds.push(row.requested_id);
    } else {
      skippedIds.push(row.requested_id);
    }
  }
  return {
    eligibleIds: [...updatedIds, ...unchangedIds],
    updatedIds,
    unchangedIds,
    previewNotReadyIds,
    skippedIds,
    notFoundIds,
  };
}

async function deleteR2Keys(env: Env, keys: Array<string | null>): Promise<void> {
  for (const key of new Set(keys.filter((value): value is string => Boolean(value)))) {
    await env.MEDIA_BUCKET.delete(key);
  }
}

async function deleteOwnedMedia(env: Env, wedding: WeddingRow, mediaId: number): Promise<boolean> {
  const media = await findOwnedMedia(env, wedding.id, mediaId);
  if (!media) return false;

  await env.DB.prepare(
    'UPDATE wedding_story_items SET photo_media_id = NULL WHERE wedding_id = ? AND photo_media_id = ?',
  ).bind(wedding.id, media.id).run();
  await env.DB.prepare(
    'UPDATE wedding_locations SET photo_media_id = NULL WHERE wedding_id = ? AND photo_media_id = ?',
  ).bind(wedding.id, media.id).run();

  const directory = previewSourceDirectory(media.source);
  const deterministicThumbnailKey = `weddings/${wedding.slug}/${directory}/previews/${media.uuid}-thumbnail.webp`;
  const deterministicPreviewKey = `weddings/${wedding.slug}/${directory}/previews/${media.uuid}-large.webp`;
  const keys = [
    media.original_key,
    media.thumbnail_key,
    media.preview_key,
    deterministicThumbnailKey,
    deterministicPreviewKey,
  ];
  await deleteR2Keys(env, keys);

  const deletion = await env.DB.prepare('DELETE FROM media WHERE id = ? AND wedding_id = ?')
    .bind(media.id, wedding.id)
    .run();

  if (deletion.meta.changes !== 1) {
    const remaining = await findOwnedMedia(env, wedding.id, media.id);
    if (remaining) throw new Error(`PostgreSQL did not delete media ${media.id}`);
  }

  // Repeat the idempotent cleanup to cover a preview job that completed during deletion.
  await deleteR2Keys(env, keys);
  return true;
}

const SITE_ASSET_SELECT = `SELECT id, uuid, wedding_id, asset_type, original_filename,
                                  original_key, optimized_key, mime_type, size_bytes,
                                  width, height, status, created_at, uploaded_at, processed_at
                           FROM site_assets`;

function siteAssetPayload(row: SiteAssetRow, admin: boolean) {
  return {
    id: row.id,
    uuid: row.uuid,
    assetType: row.asset_type,
    originalFilename: row.original_filename,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    width: row.width,
    height: row.height,
    status: row.status,
    createdAt: row.created_at,
    uploadedAt: row.uploaded_at,
    processedAt: row.processed_at,
    viewUrl: row.status === 'ready'
      ? `${admin ? '/api/admin' : '/api'}/site-assets/${row.id}/view`
      : null,
  };
}

async function findOwnedSiteAsset(
  env: Env,
  weddingId: number,
  siteAssetId: number,
): Promise<SiteAssetRow | null> {
  return env.DB.prepare(
    `${SITE_ASSET_SELECT} WHERE id = ? AND wedding_id = ? LIMIT 1`,
  ).bind(siteAssetId, weddingId).first<SiteAssetRow>();
}

async function deleteOwnedSiteAsset(
  env: Env,
  wedding: WeddingRow,
  siteAssetId: number,
): Promise<boolean> {
  const asset = await findOwnedSiteAsset(env, wedding.id, siteAssetId);
  if (!asset) return false;

  await env.DB.prepare(
    'UPDATE wedding_home_content SET hero_site_asset_id = NULL WHERE wedding_id = ? AND hero_site_asset_id = ?',
  ).bind(wedding.id, asset.id).run();
  await env.DB.prepare(
    'UPDATE wedding_story_items SET photo_site_asset_id = NULL WHERE wedding_id = ? AND photo_site_asset_id = ?',
  ).bind(wedding.id, asset.id).run();
  await env.DB.prepare(
    'UPDATE wedding_locations SET photo_site_asset_id = NULL WHERE wedding_id = ? AND photo_site_asset_id = ?',
  ).bind(wedding.id, asset.id).run();
  await env.DB.prepare(
    'UPDATE wedding_info_items SET image_site_asset_id = NULL WHERE wedding_id = ? AND image_site_asset_id = ?',
  ).bind(wedding.id, asset.id).run();

  const deterministicOptimizedKey = `weddings/${wedding.slug}/site/optimized/${asset.uuid}.webp`;
  const keys = [asset.original_key, asset.optimized_key, deterministicOptimizedKey];
  await deleteR2Keys(env, keys);
  const deletion = await env.DB.prepare('DELETE FROM site_assets WHERE id = ? AND wedding_id = ?')
    .bind(asset.id, wedding.id).run();
  if (deletion.meta.changes !== 1) {
    const remaining = await findOwnedSiteAsset(env, wedding.id, asset.id);
    if (remaining) throw new Error(`PostgreSQL did not delete site asset ${asset.id}`);
  }
  await deleteR2Keys(env, keys);
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
    'galleryPreviewEnabled',
    'galleryDownloadEnabled',
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
    galleryPreviewEnabled: input.galleryPreviewEnabled as boolean,
    galleryDownloadEnabled: input.galleryDownloadEnabled as boolean,
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

const MEDIA_PREVIEW_ENQUEUE_ATTEMPTS = 3;
const MEDIA_PREVIEW_MAX_DELIVERY_ATTEMPTS = 3;
const MEDIA_PREVIEW_RECOVERY_LIMIT = 100;

async function enqueueMediaPreview(env: Env, mediaId: number): Promise<void> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MEDIA_PREVIEW_ENQUEUE_ATTEMPTS; attempt += 1) {
    try {
      await env.MEDIA_PROCESSING_QUEUE.send({ mediaId });
      return;
    } catch (error) {
      lastError = error;
      console.error(`Unable to enqueue media ${mediaId} preview (attempt ${attempt})`, error);
    }
  }
  throw new Error(`Preview enqueue failed: ${previewErrorMessage(lastError)}`);
}

async function withPreviewTimeout<T>(operation: Promise<T>, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} timed out after 45 seconds`)), 45_000);
  });
  try {
    return await Promise.race([operation, timeout]);
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
  }
}

async function markMediaPreviewFailed(env: Env, mediaId: number, error: unknown): Promise<boolean> {
  const update = await env.DB.prepare(
    `UPDATE media
     SET preview_status = 'failed', preview_error = ?, preview_generated_at = NULL
     WHERE id = ? AND preview_status = 'processing'`,
  )
    .bind(previewErrorMessage(error), mediaId)
    .run();
  return update.meta.changes === 1;
}

async function markMediaPreviewDeliveryExhausted(
  env: Env,
  mediaId: number,
  attempts: number,
): Promise<void> {
  const update = await env.DB.prepare(
    `UPDATE media
     SET preview_status = 'failed',
         preview_error = COALESCE(NULLIF(BTRIM(preview_error), ''), ?),
         preview_generated_at = NULL
     WHERE id = ? AND preview_status IN ('pending', 'processing')`,
  )
    .bind(`Preview processing stopped after ${attempts} delivery attempts`, mediaId)
    .run();
  if (update.meta.changes === 1) return;

  const current = await env.DB.prepare(
    'SELECT preview_status FROM media WHERE id = ? LIMIT 1',
  ).bind(mediaId).first<{ preview_status: string }>();
  if (current && (current.preview_status === 'pending' || current.preview_status === 'processing')) {
    throw new Error(`Media ${mediaId} remained ${current.preview_status} after exhausted delivery`);
  }
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
      const update = await env.DB.prepare(
        `UPDATE media
         SET preview_status = 'not_applicable', preview_error = NULL
         WHERE id = ?`,
      )
        .bind(media.id)
        .run();
      if (update.meta.changes !== 1) return 'missing';
    }
    return 'not_applicable';
  }
  if (media.preview_status === 'ready') return 'ready';

  const keys = previewKeys(media);
  try {
    const processing = await env.DB.prepare(
      `UPDATE media
       SET preview_status = 'processing', preview_error = NULL
       WHERE id = ? AND wedding_id = ? AND preview_status <> 'ready'`,
    )
      .bind(media.id, media.wedding_id)
      .run();
    if (processing.meta.changes !== 1) {
      const current = await findOwnedMedia(env, media.wedding_id, media.id);
      if (!current) return 'missing';
      if (current.preview_status === 'ready') return 'ready';
      throw new Error(`Media ${media.id} could not enter preview processing`);
    }

    await withPreviewTimeout(
      createPreviewVariant(env, media.original_key, keys.thumbnailKey, 720, 78),
      `Thumbnail generation for media ${media.id}`,
    );
    await withPreviewTimeout(
      createPreviewVariant(env, media.original_key, keys.previewKey, 1600, 82),
      `Large preview generation for media ${media.id}`,
    );
    const update = await env.DB.prepare(
      `UPDATE media
       SET thumbnail_key = ?, preview_key = ?, preview_status = 'ready',
           preview_error = NULL, preview_generated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND wedding_id = ? AND preview_status = 'processing'`,
    )
      .bind(keys.thumbnailKey, keys.previewKey, media.id, media.wedding_id)
      .run();
    if (update.meta.changes !== 1) {
      const current = await findOwnedMedia(env, media.wedding_id, media.id);
      if (current?.preview_status === 'ready') return 'ready';
      await deleteR2Keys(env, [keys.thumbnailKey, keys.previewKey]);
      return 'missing';
    }
    return 'generated';
  } catch (error) {
    const failed = await markMediaPreviewFailed(env, media.id, error);
    const current = failed ? null : await findOwnedMedia(env, media.wedding_id, media.id);
    if (current?.preview_status === 'ready') return 'ready';
    await deleteR2Keys(env, [keys.thumbnailKey, keys.previewKey]);
    if (!failed && !current) return 'missing';
    throw error;
  }
}

export async function processSiteAsset(
  env: Env,
  siteAssetId: number,
): Promise<'missing' | 'ready' | 'generated'> {
  const asset = await env.DB.prepare(
    `SELECT a.id, a.uuid, a.wedding_id, a.asset_type, a.original_filename,
            a.original_key, a.optimized_key, a.mime_type, a.size_bytes,
            a.width, a.height, a.status, a.created_at, a.uploaded_at,
            a.processed_at, w.slug AS wedding_slug
     FROM site_assets a
     INNER JOIN weddings w ON w.id = a.wedding_id
     WHERE a.id = ?
     LIMIT 1`,
  ).bind(siteAssetId).first<SiteAssetProcessingRow>();

  if (!asset) return 'missing';
  if (asset.status === 'ready' && asset.optimized_key) return 'ready';

  const processing = await env.DB.prepare(
    `UPDATE site_assets SET status = 'processing' WHERE id = ?`,
  ).bind(asset.id).run();
  if (processing.meta.changes !== 1) return 'missing';

  const optimizedKey = `weddings/${asset.wedding_slug}/site/optimized/${asset.uuid}.webp`;
  try {
    const original = await env.MEDIA_BUCKET.get(asset.original_key);
    if (!original) throw new Error('Original site asset object not found');
    const transformed = await env.IMAGES.input(original.body)
      .transform({ width: 2200, fit: 'scale-down' })
      .output({ format: 'image/webp', quality: 84 });
    await env.MEDIA_BUCKET.put(optimizedKey, transformed.image(), {
      httpMetadata: {
        contentType: 'image/webp',
        cacheControl: 'public, max-age=31536000, immutable',
      },
    });
    const update = await env.DB.prepare(
      `UPDATE site_assets
       SET optimized_key = ?, status = 'ready', processed_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
    ).bind(optimizedKey, asset.id).run();
    if (update.meta.changes !== 1) {
      await deleteR2Keys(env, [optimizedKey]);
      return 'missing';
    }
    return 'generated';
  } catch (error) {
    const update = await env.DB.prepare(
      `UPDATE site_assets SET status = 'failed', processed_at = NULL WHERE id = ?`,
    ).bind(asset.id).run();
    if (update.meta.changes !== 1) {
      await deleteR2Keys(env, [optimizedKey]);
      return 'missing';
    }
    throw error;
  }
}

async function siteAssetViewResponse(
  env: Env,
  asset: Pick<SiteAssetRow, 'optimized_key'>,
  request: Request,
  admin: boolean,
): Promise<Response> {
  if (!asset.optimized_key) return json({ error: 'Optimized site asset not found' }, 404);
  const object = await env.MEDIA_BUCKET.get(asset.optimized_key);
  if (!object) return json({ error: 'Optimized site asset object not found' }, 404);
  const etag = object.httpEtag;
  if (etag && request.headers.get('if-none-match') === etag) {
    return new Response(null, {
      status: 304,
      headers: {
        etag,
        'cache-control': admin ? 'private, no-store' : 'public, max-age=31536000, immutable',
      },
    });
  }
  return new Response(object.body, {
    headers: {
      'content-type': 'image/webp',
      'content-length': String(object.size),
      ...(etag ? { etag } : {}),
      'cache-control': admin ? 'private, no-store' : 'public, max-age=31536000, immutable',
    },
  });
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
  async fetch(request: Request, bindings: WorkerEnv): Promise<Response> {
    const env = withDatabase(bindings);
    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/api/health') {
      return json({ status: 'ok' });
    }

    if (request.method === 'GET' && url.pathname === '/api/auth/config') {
      const supabaseUrl = env.SUPABASE_URL?.trim().replace(/\/$/, '');
      const anonKey = env.SUPABASE_ANON_KEY?.trim();
      if (!supabaseUrl || !anonKey) return json({ error: 'Authentication is not configured' }, 500);
      return json({ supabaseUrl, anonKey });
    }

    const fantasposiResponse = await handleFantasposiRequest(request, env);
    if (fantasposiResponse) return fantasposiResponse;

    const adminAuthorization = url.pathname.startsWith('/api/admin/')
      ? await requireAdmin(request, env)
      : null;
    if (adminAuthorization && !adminAuthorization.authorized) {
      return adminAuthorization.response;
    }

    if (request.method === 'GET' && url.pathname === '/api/admin/session' && adminAuthorization?.authorized) {
      return json({
        userId: adminAuthorization.identity.subject,
        email: adminAuthorization.identity.email ?? null,
      });
    }

    const adminFantasposiResponse = adminAuthorization?.authorized
      ? await handleAdminFantasposiRequest(request, env)
      : null;
    if (adminFantasposiResponse) return adminFantasposiResponse;

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
          galleryPreviewEnabled: settings.galleryPreviewEnabled,
          galleryDownloadEnabled: settings.galleryDownloadEnabled,
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

        const update = await env.DB.prepare(
           `INSERT INTO wedding_settings (
              wedding_id, gallery_enabled, gallery_preview_enabled, gallery_download_enabled,
              guest_uploads_enabled,
              require_guest_approval, photobooth_auto_approve,
              schedule_enabled, locations_enabled, info_enabled, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(wedding_id) DO UPDATE SET
              gallery_enabled = excluded.gallery_enabled,
              gallery_preview_enabled = excluded.gallery_preview_enabled,
              gallery_download_enabled = excluded.gallery_download_enabled,
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
            settings.galleryEnabled,
            settings.galleryPreviewEnabled,
            settings.galleryDownloadEnabled,
            settings.guestUploadsEnabled,
            settings.requireGuestApproval,
            settings.photoboothAutoApprove,
            settings.scheduleEnabled,
            settings.locationsEnabled,
            settings.infoEnabled,
          )
          .run();
        if (update.meta.changes !== 1) {
          throw new Error('PostgreSQL did not persist wedding settings');
        }
        const persistedRow = update.results[0] as unknown as WeddingSettingsRow | undefined;
        if (!persistedRow || persistedRow.wedding_id !== wedding.id) {
          throw new Error('PostgreSQL did not return the persisted wedding settings');
        }
        const persisted = serializeWeddingSettings(persistedRow);
        const matchesRequested = (Object.keys(settings) as Array<keyof WeddingSettings>)
          .every((key) => persisted[key] === settings[key]);
        if (!matchesRequested) throw new Error('Wedding settings do not match the requested state');
        return json(persisted);
      } catch (error) {
        if (error instanceof SyntaxError) return json({ error: 'Invalid JSON body' }, 400);
        console.error('Unable to update wedding settings', error);
        return json({ error: 'Unable to update wedding settings' }, 500);
      }
    }

    if (request.method === 'GET' && url.pathname === '/api/admin/site-assets') {
      const assetType = url.searchParams.get('asset_type');
      if (assetType && !SITE_ASSET_TYPES.has(assetType)) {
        return json({ error: 'Invalid site asset type' }, 400);
      }
      try {
        const wedding = await findCurrentWedding(env);
        if (!env.CURRENT_WEDDING_SLUG?.trim()) {
          return json({ error: 'Current wedding is not configured' }, 500);
        }
        if (!wedding) return json({ error: 'Configured wedding not found' }, 404);
        const result = assetType
          ? await env.DB.prepare(
              `${SITE_ASSET_SELECT}
               WHERE wedding_id = ? AND asset_type = ?
               ORDER BY created_at DESC, id DESC`,
            ).bind(wedding.id, assetType).all<SiteAssetRow>()
          : await env.DB.prepare(
              `${SITE_ASSET_SELECT}
               WHERE wedding_id = ?
               ORDER BY created_at DESC, id DESC`,
            ).bind(wedding.id).all<SiteAssetRow>();
        return json({ siteAssets: result.results.map((row) => siteAssetPayload(row, true)) });
      } catch (error) {
        console.error('Unable to list site assets', error);
        return json({ error: 'Site assets unavailable' }, 500);
      }
    }

    if (request.method === 'POST' && url.pathname === '/api/admin/site-assets/create') {
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
        const filename = typeof input.filename === 'string' ? input.filename.trim() : '';
        const mimeType = typeof input.mimeType === 'string' ? input.mimeType.trim().toLowerCase() : '';
        const assetType = typeof input.assetType === 'string' ? input.assetType.trim().toLowerCase() : 'other';
        const size = input.size;
        if (!filename) return json({ error: 'Filename is required' }, 400);
        if (!Object.prototype.hasOwnProperty.call(SITE_IMAGE_TYPES, mimeType)) {
          return json({ error: 'Unsupported site image type' }, 400);
        }
        if (!SITE_ASSET_TYPES.has(assetType)) return json({ error: 'Invalid site asset type' }, 400);
        if (typeof size !== 'number' || !Number.isSafeInteger(size) || size <= 0) {
          return json({ error: 'Size must be a positive integer' }, 400);
        }
        if (size > SITE_ASSET_MAX_SIZE) return json({ error: 'File exceeds the 20 MB limit' }, 400);

        const uuid = crypto.randomUUID();
        const imageType = SITE_IMAGE_TYPES[mimeType as keyof typeof SITE_IMAGE_TYPES];
        const originalKey = `weddings/${wedding.slug}/site/originals/${uuid}.${imageType.extension}`;
        const uploadUrl = await createPresignedPutUrl(env, originalKey);
        const result = await env.DB.prepare(
          `INSERT INTO site_assets
             (uuid, wedding_id, asset_type, original_filename, original_key,
              mime_type, size_bytes, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'uploading')`,
        ).bind(uuid, wedding.id, assetType, filename, originalKey, mimeType, size).run();
        if (result.meta.changes !== 1 || result.meta.last_row_id <= 0) {
          throw new Error('PostgreSQL did not create the site asset record');
        }
        return json({
          siteAssetId: result.meta.last_row_id,
          uuid,
          originalKey,
          uploadUrl,
          method: 'PUT',
        }, 201);
      } catch (error) {
        if (error instanceof SyntaxError) return json({ error: 'Invalid JSON body' }, 400);
        console.error('Unable to create site asset', error);
        return json({ error: 'Unable to create site asset' }, 500);
      }
    }

    const completeSiteAsset = url.pathname.match(/^\/api\/admin\/site-assets\/(\d+)\/complete$/);
    if (request.method === 'POST' && completeSiteAsset) {
      const siteAssetId = Number(completeSiteAsset[1]);
      if (!Number.isSafeInteger(siteAssetId) || siteAssetId <= 0) {
        return json({ error: 'Invalid site asset ID' }, 400);
      }
      try {
        const wedding = await findCurrentWedding(env);
        if (!wedding) return json({ error: 'Configured wedding not found' }, 404);
        const asset = await findOwnedSiteAsset(env, wedding.id, siteAssetId);
        if (!asset) return json({ error: 'Site asset not found' }, 404);
        const object = await env.MEDIA_BUCKET.head(asset.original_key);
        if (!object) return json({ error: 'Uploaded object not found' }, 409);
        if (asset.size_bytes === null || object.size !== asset.size_bytes) {
          return json({ error: 'Uploaded object size does not match' }, 409);
        }
        if (asset.status !== 'ready') {
          const update = await env.DB.prepare(
            `UPDATE site_assets
             SET status = 'processing', uploaded_at = COALESCE(uploaded_at, CURRENT_TIMESTAMP)
             WHERE id = ? AND wedding_id = ? AND status = ?`,
          ).bind(asset.id, wedding.id, asset.status).run();
          if (update.meta.changes === 1) {
            const persisted = update.results[0] as unknown as SiteAssetRow | undefined;
            if (
              !persisted
              || persisted.id !== asset.id
              || persisted.wedding_id !== wedding.id
              || persisted.status !== 'processing'
            ) {
              throw new Error(`Site asset ${asset.id} did not reach processing status`);
            }
          } else {
            const current = await findOwnedSiteAsset(env, wedding.id, asset.id);
            if (!current) return json({ error: 'Site asset not found' }, 404);
            if (current.status === 'ready' && current.optimized_key) {
              return json({ siteAssetId: asset.id, status: 'ready', changed: false });
            }
            if (current.status !== 'processing') {
              throw new Error(`PostgreSQL did not complete site asset ${asset.id}`);
            }
          }
          await env.MEDIA_PROCESSING_QUEUE.send({ kind: 'site_asset', siteAssetId: asset.id });
        }
        return json({
          siteAssetId: asset.id,
          status: asset.status === 'ready' ? 'ready' : 'processing',
          changed: asset.status !== 'ready' && asset.status !== 'processing',
        });
      } catch (error) {
        console.error('Unable to complete site asset upload', error);
        return json({ error: 'Unable to complete site asset upload' }, 500);
      }
    }

    const adminSiteAssetView = url.pathname.match(/^\/api\/admin\/site-assets\/(\d+)\/view$/);
    if (request.method === 'GET' && adminSiteAssetView) {
      const siteAssetId = Number(adminSiteAssetView[1]);
      if (!Number.isSafeInteger(siteAssetId) || siteAssetId <= 0) return json({ error: 'Not found' }, 404);
      try {
        const wedding = await findCurrentWedding(env);
        if (!wedding) return json({ error: 'Configured wedding not found' }, 404);
        const asset = await findOwnedSiteAsset(env, wedding.id, siteAssetId);
        if (!asset || asset.status !== 'ready') return json({ error: 'Site asset not found' }, 404);
        return siteAssetViewResponse(env, asset, request, true);
      } catch (error) {
        console.error('Unable to serve admin site asset', error);
        return json({ error: 'Site asset unavailable' }, 500);
      }
    }

    const deleteSiteAsset = url.pathname.match(/^\/api\/admin\/site-assets\/(\d+)$/);
    if (request.method === 'DELETE' && deleteSiteAsset) {
      const siteAssetId = Number(deleteSiteAsset[1]);
      if (!Number.isSafeInteger(siteAssetId) || siteAssetId <= 0) {
        return json({ error: 'Invalid site asset ID' }, 400);
      }
      try {
        const wedding = await findCurrentWedding(env);
        if (!wedding) return json({ error: 'Configured wedding not found' }, 404);
        return await deleteOwnedSiteAsset(env, wedding, siteAssetId)
          ? json({ id: siteAssetId, deleted: true })
          : json({ error: 'Site asset not found' }, 404);
      } catch (error) {
        console.error('Unable to delete site asset', error);
        return json({ error: 'Unable to delete site asset' }, 500);
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
                    COUNT(*) FILTER (WHERE status = 'pending') AS pending,
                    COUNT(*) FILTER (WHERE status = 'approved') AS approved,
                    COUNT(*) FILTER (WHERE status = 'hidden') AS hidden,
                    COUNT(*) FILTER (WHERE mime_type LIKE 'image/%') AS photos,
                    COUNT(*) FILTER (WHERE mime_type LIKE 'video/%') AS videos,
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

        const allowedStatuses = action === 'approve'
          ? new Set(['pending', 'approved'])
          : action === 'restore'
            ? new Set(['hidden'])
            : new Set(['pending', 'approved', 'hidden']);
        const nextStatus = action === 'hide' ? 'hidden' : 'approved';
        const outcome = await setOwnedMediaStatus(
          env, wedding.id, mediaId, nextStatus, allowedStatuses, action !== 'hide',
        );
        if (outcome === 'not_found') return json({ error: 'Media not found' }, 404);
        if (outcome === 'invalid_status') {
          return json({ error: 'Media status is not valid for this action' }, 409);
        }
        if (outcome === 'preview_not_ready') {
          return json({ error: 'Image preview is not ready', code: 'preview_not_ready', mediaId }, 409);
        }

        return json({
          mediaId,
          status: nextStatus,
          changed: outcome === 'updated',
        });
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
        const deletedIds: number[] = [];
        let eligibleIds: number[] = [];
        let updatedIds: number[] = [];
        let unchangedIds: number[] = [];
        const previewNotReadyIds: number[] = [];
        const skippedIds: number[] = [];
        const notFoundIds: number[] = [];
        if (action === 'delete') {
          await runLimited(ids, 3, async (mediaId) => {
            if (await deleteOwnedMedia(env, wedding, mediaId)) {
              affected += 1;
              deletedIds.push(mediaId);
            } else notFoundIds.push(mediaId);
          });
        } else {
          const mutation = await bulkSetOwnedMediaStatus(env, wedding.id, ids, action);
          eligibleIds = mutation.eligibleIds;
          updatedIds = mutation.updatedIds;
          unchangedIds = mutation.unchangedIds;
          previewNotReadyIds.push(...mutation.previewNotReadyIds);
          skippedIds.push(...mutation.skippedIds);
          notFoundIds.push(...mutation.notFoundIds);
          affected = updatedIds.length;
        }

        return json({
          action,
          weddingId: wedding.id,
          requested: ids.length,
          requestedIds: ids,
          eligibleIds,
          changed: affected,
          rowCount: action === 'delete' ? deletedIds.length : updatedIds.length,
          deletedIds,
          updatedIds,
          unchangedIds,
          previewNotReadyIds,
          skippedIds,
          notFoundIds,
        });
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
        if (!await deleteOwnedMedia(env, wedding, mediaId)) {
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
            if (await deleteOwnedMedia(env, wedding, mediaId)) deleted += 1;
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
        if (result.meta.changes !== 1 || result.meta.last_row_id <= 0) {
          throw new Error('PostgreSQL did not create the media record');
        }

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
           WHERE id = ? AND wedding_id = ?
           LIMIT 1`,
        )
          .bind(mediaId, wedding.id)
          .first<MediaRow>();

        if (!media) {
          return json({ error: 'Media not found' }, 404);
        }

        const object = await env.MEDIA_BUCKET.head(media.original_key);
        if (!object) {
          return json({ error: 'Uploaded object not found' }, 409);
        }
        if (object.size !== media.size_bytes) {
          return json({ error: 'Uploaded object size does not match' }, 409);
        }

        if (isImageMimeType(media.mime_type) && media.preview_status !== 'ready') {
          await enqueueMediaPreview(env, media.id);
        }

        let mediaStatus = media.status;
        if (media.status === 'uploading') {
          const nextStatus = completedMediaStatus(media.source, settings);
          const update = await env.DB.prepare(
            `UPDATE media
             SET status = ?, uploaded_at = COALESCE(uploaded_at, CURRENT_TIMESTAMP)
             WHERE id = ? AND wedding_id = ? AND status = 'uploading'`,
          )
            .bind(nextStatus, media.id, wedding.id)
            .run();
          if (update.meta.changes === 1) {
            const completed = update.results[0] as unknown as MediaRow | undefined;
            if (
              !completed
              || completed.id !== media.id
              || completed.wedding_id !== wedding.id
              || completed.status !== nextStatus
              || !completed.uploaded_at
            ) {
              throw new Error(`Media ${media.id} did not reach status ${nextStatus}`);
            }
            mediaStatus = completed.status;
          } else {
            const completed = await findOwnedMedia(env, wedding.id, media.id);
            if (!completed) return json({ error: 'Media not found' }, 404);
            if (completed.status === 'uploading') {
              throw new Error(`PostgreSQL did not complete media ${media.id}`);
            }
            mediaStatus = completed.status;
          }
        }

        if (!isImageMimeType(media.mime_type) && media.preview_status !== 'not_applicable') {
          const update = await env.DB.prepare(
            `UPDATE media
             SET preview_status = 'not_applicable', preview_error = NULL
             WHERE id = ? AND wedding_id = ?`,
          )
            .bind(media.id, wedding.id)
            .run();
          if (update.meta.changes === 1) {
            const persisted = update.results[0] as unknown as MediaRow | undefined;
            if (!persisted || persisted.preview_status !== 'not_applicable') {
              throw new Error(`Media ${media.id} preview status was not updated`);
            }
          } else {
            const current = await findOwnedMedia(env, wedding.id, media.id);
            if (!current) return json({ error: 'Media not found' }, 404);
            if (current.preview_status !== 'not_applicable') {
              throw new Error(`Media ${media.id} preview status was not updated`);
            }
          }
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
          return json({ galleryEnabled: false, galleryPreviewEnabled: false, media: [] });
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
          galleryPreviewEnabled: settings.galleryPreviewEnabled,
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

    const downloadMedia = url.pathname.match(/^\/api\/media\/([^/]+)\/download$/);
    if (request.method === 'GET' && downloadMedia) {
      const mediaId = Number(downloadMedia[1]);
      if (!Number.isSafeInteger(mediaId) || mediaId <= 0) {
        return json({ error: 'Media not found' }, 404);
      }

      try {
        const wedding = await findCurrentWedding(env);
        if (!env.CURRENT_WEDDING_SLUG?.trim()) {
          return json({ error: 'Current wedding is not configured' }, 500);
        }
        if (!wedding) return json({ error: 'Media not found' }, 404);

        const settings = await getWeddingSettings(env, wedding.id);
        if (!settings.galleryEnabled || !settings.galleryDownloadEnabled) {
          return json({ error: 'Media not found' }, 404);
        }

        const media = await env.DB.prepare(
          `SELECT id, original_filename, original_key, mime_type
           FROM media
           WHERE id = ? AND wedding_id = ? AND status = 'approved'
                 AND original_key IS NOT NULL AND original_key != ''
           LIMIT 1`,
        )
          .bind(mediaId, wedding.id)
          .first<Pick<MediaRow, 'id' | 'original_filename' | 'original_key' | 'mime_type'>>();
        if (!media) return json({ error: 'Media not found' }, 404);

        const object = await env.MEDIA_BUCKET.get(media.original_key);
        if (!object) return json({ error: 'Media not found' }, 404);

        return new Response(object.body, {
          headers: {
            'content-type': media.mime_type,
            'content-length': String(object.size),
            'content-disposition': downloadContentDisposition(media),
            'cache-control': 'private, no-cache',
          },
        });
      } catch (error) {
        console.error('Unable to download gallery media', error);
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

    const publicSiteAssetView = url.pathname.match(/^\/api\/site-assets\/(\d+)\/view$/);
    if (request.method === 'GET' && publicSiteAssetView) {
      const siteAssetId = Number(publicSiteAssetView[1]);
      if (!Number.isSafeInteger(siteAssetId) || siteAssetId <= 0) return json({ error: 'Not found' }, 404);
      try {
        const wedding = await findCurrentWedding(env);
        if (!wedding) return json({ error: 'Configured wedding not found' }, 404);
        const asset = await findOwnedSiteAsset(env, wedding.id, siteAssetId);
        if (!asset || asset.status !== 'ready') return json({ error: 'Site asset not found' }, 404);
        return siteAssetViewResponse(env, asset, request, false);
      } catch (error) {
        console.error('Unable to serve public site asset', error);
        return json({ error: 'Site asset unavailable' }, 500);
      }
    }

    if (url.pathname.startsWith('/api/')) {
      return json({ error: 'Not found' }, 404);
    }

    return env.ASSETS.fetch(request);
  },

  async scheduled(_controller: ScheduledController, bindings: WorkerEnv): Promise<void> {
    const env = withDatabase(bindings);
    const stale = await env.DB.prepare(
      `SELECT id
       FROM media
       WHERE mime_type LIKE 'image/%'
         AND preview_status IN ('pending', 'processing')
         AND created_at <= CURRENT_TIMESTAMP - INTERVAL '10 minutes'
       ORDER BY created_at, id
       LIMIT ${MEDIA_PREVIEW_RECOVERY_LIMIT}`,
    ).all<{ id: number }>();

    await runLimited(stale.results, 3, async ({ id }) => {
      try {
        await enqueueMediaPreview(env, id);
      } catch (error) {
        console.error(`Unable to enqueue stale preview recovery for media ${id}`, error);
      }
    });
  },

  async queue(batch: MessageBatch<MediaProcessingMessage>, bindings: WorkerEnv): Promise<void> {
    const env = withDatabase(bindings);
    for (const message of batch.messages) {
      if (message.body?.kind === 'site_asset') {
        const siteAssetId = message.body.siteAssetId;
        if (!Number.isSafeInteger(siteAssetId) || siteAssetId <= 0) {
          console.warn('Ignoring invalid site asset processing message');
          message.ack();
          continue;
        }
        try {
          await processSiteAsset(env, siteAssetId);
          message.ack();
        } catch (error) {
          console.error(`Unable to optimize site asset ${siteAssetId}`, error);
          message.retry({ delaySeconds: Math.min(300, 30 * Math.max(1, message.attempts)) });
        }
        continue;
      }

      const mediaId = message.body?.mediaId;
      if (!Number.isSafeInteger(mediaId) || mediaId <= 0) {
        console.warn('Ignoring invalid media processing message');
        message.ack();
        continue;
      }

      if (message.attempts >= MEDIA_PREVIEW_MAX_DELIVERY_ATTEMPTS) {
        try {
          await markMediaPreviewDeliveryExhausted(env, mediaId, message.attempts);
          message.ack();
        } catch (error) {
          console.error(`Unable to persist exhausted preview delivery for media ${mediaId}`, error);
          message.retry({ delaySeconds: 300 });
        }
        continue;
      }

      try {
        await processMediaPreview(env, mediaId);
        message.ack();
      } catch (error) {
        console.error(`Unable to generate previews for media ${mediaId}`, error);
        try {
          await markMediaPreviewFailed(env, mediaId, error);
        } catch (statusError) {
          console.error(`Unable to persist preview failure for media ${mediaId}`, statusError);
        }
        message.retry({ delaySeconds: Math.min(300, 30 * Math.max(1, message.attempts)) });
      }
    }
  },
} satisfies ExportedHandler<WorkerEnv, MediaProcessingMessage>;
