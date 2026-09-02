import type { Database } from '../lib/supabase-db';
import type { WeddingResolution } from '../lib/wedding-resolver';

export type ContentEnv = {
  DB: Database;
  WEDDING_CONTEXT?: Promise<WeddingResolution>;
};

type ContentWeddingRow = {
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
  hero_site_asset_id: number | null;
  hero_site_asset_status: string | null;
};

type SectionSettingsRow = {
  schedule_enabled: boolean;
  locations_enabled: boolean;
  info_enabled: boolean;
};

type ScheduleRow = {
  id: number;
  wedding_id: number;
  time_label: string;
  title: string;
  subtitle: string | null;
  description: string | null;
  sort_order: number;
  enabled: boolean;
};

type LocationRow = {
  id: number;
  wedding_id: number;
  name: string;
  type: string | null;
  address: string | null;
  maps_url: string | null;
  description: string | null;
  photo_media_id: number | null;
  photo_site_asset_id: number | null;
  sort_order: number;
  enabled: boolean;
  photo_preview_status?: string | null;
  photo_site_asset_status?: string | null;
};

type HomeContentRow = {
  wedding_id: number;
  story_enabled: boolean;
  story_eyebrow: string | null;
  story_title: string | null;
  story_intro: string | null;
  story_quote: string | null;
  story_quote_author: string | null;
  hero_site_asset_id: number | null;
  hero_site_asset_status?: string | null;
};

type StoryItemRow = {
  id: number;
  wedding_id: number;
  year_label: string | null;
  title: string;
  body: string | null;
  photo_media_id: number | null;
  photo_site_asset_id: number | null;
  sort_order: number;
  enabled: boolean;
  photo_preview_status?: string | null;
  photo_site_asset_status?: string | null;
};

type InfoRow = {
  id: number;
  wedding_id: number;
  category: string;
  title: string;
  content: string | null;
  image_site_asset_id: number | null;
  sort_order: number;
  enabled: boolean;
};

type ScheduleInput = Omit<ScheduleRow, 'id' | 'wedding_id' | 'enabled' | 'sort_order'> & {
  enabled: boolean;
  sortOrder: number;
};

type LocationInput = Omit<LocationRow, 'id' | 'wedding_id' | 'enabled' | 'sort_order' | 'maps_url' | 'photo_preview_status' | 'photo_site_asset_status'> & {
  mapsUrl: string | null;
  enabled: boolean;
  sortOrder: number;
};

type HomeContentInput = {
  storyEnabled: boolean;
  storyEyebrow: string | null;
  storyTitle: string | null;
  storyIntro: string | null;
  storyQuote: string | null;
  storyQuoteAuthor: string | null;
};

type StoryItemInput = {
  yearLabel: string;
  title: string;
  body: string | null;
  photoMediaId: number | null;
  photoSiteAssetId: number | null;
  sortOrder: number;
  enabled: boolean;
};

type InfoInput = Omit<InfoRow, 'id' | 'wedding_id' | 'enabled' | 'sort_order'> & {
  enabled: boolean;
  sortOrder: number;
};

const INFO_CATEGORIES = new Set([
  'parking', 'contacts', 'dress_code', 'transport', 'accommodation', 'faq', 'other',
]);

class ValidationError extends Error {}

function json(data: unknown, status = 200): Response {
  return Response.json(data, {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

function requireSingleChange(
  result: { meta: { changes: number } },
  operation: string,
): void {
  if (result.meta.changes !== 1) {
    throw new Error(`PostgreSQL did not ${operation}`);
  }
}

function asObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ValidationError('JSON body must be an object');
  }
  return value as Record<string, unknown>;
}

async function requestBody(request: Request): Promise<Record<string, unknown>> {
  try {
    return asObject(await request.json());
  } catch (error) {
    if (error instanceof ValidationError) throw error;
    throw new ValidationError('Invalid JSON body');
  }
}

function requiredString(input: Record<string, unknown>, key: string, maxLength: number): string {
  const value = typeof input[key] === 'string' ? input[key].trim() : '';
  if (!value) throw new ValidationError(`${key} is required`);
  if (value.length > maxLength) throw new ValidationError(`${key} is too long`);
  return value;
}

function optionalString(
  input: Record<string, unknown>,
  key: string,
  maxLength: number,
): string | null {
  if (input[key] === null || input[key] === undefined || input[key] === '') return null;
  if (typeof input[key] !== 'string') throw new ValidationError(`${key} must be a string`);
  const value = input[key].trim();
  if (!value) return null;
  if (value.length > maxLength) throw new ValidationError(`${key} is too long`);
  return value;
}

function requiredBoolean(input: Record<string, unknown>, key: string): boolean {
  if (typeof input[key] !== 'boolean') throw new ValidationError(`${key} must be boolean`);
  return input[key];
}

function requiredSortOrder(input: Record<string, unknown>): number {
  const value = input.sortOrder;
  if (!Number.isSafeInteger(value) || (value as number) < -100000 || (value as number) > 100000) {
    throw new ValidationError('sortOrder must be an integer between -100000 and 100000');
  }
  return value as number;
}

function optionalPositiveInteger(input: Record<string, unknown>, key: string): number | null {
  const value = input[key];
  if (value === null || value === undefined || value === '') return null;
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new ValidationError(`${key} must be a positive integer or null`);
  }
  return value as number;
}

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function optionalHttpsUrl(input: Record<string, unknown>, key: string): string | null {
  const value = optionalString(input, key, 500);
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('invalid');
    return url.toString();
  } catch {
    throw new ValidationError(`${key} must be a valid HTTPS URL`);
  }
}

function selectedContentPhoto(
  siteAssetId: number | null,
  siteAssetStatus: string | null | undefined,
  legacyMediaId: number | null,
  legacyPreviewStatus: string | null | undefined,
  admin: boolean,
) {
  if (siteAssetId && siteAssetStatus === 'ready') {
    return {
      id: siteAssetId,
      thumbnailUrl: `${admin ? '/api/admin' : '/api'}/site-assets/${siteAssetId}/view`,
      previewUrl: `${admin ? '/api/admin' : '/api'}/site-assets/${siteAssetId}/view`,
      source: 'site_asset' as const,
    };
  }
  if (legacyMediaId && legacyPreviewStatus === 'ready') {
    return {
      id: legacyMediaId,
      thumbnailUrl: `${admin ? '/api/admin' : '/api'}/media/${legacyMediaId}/thumbnail`,
      previewUrl: `${admin ? '/api/admin' : '/api'}/media/${legacyMediaId}/preview`,
      source: 'legacy_media' as const,
    };
  }
  return null;
}

function serializeWedding(row: ContentWeddingRow, admin = false) {
  return {
    id: row.id,
    slug: row.slug,
    brideName: row.bride_name,
    groomName: row.groom_name,
    weddingDate: row.wedding_date,
    status: row.status,
    theme: row.theme,
    heroEyebrow: row.hero_eyebrow,
    heroTitle: row.hero_title,
    heroSubtitle: row.hero_subtitle,
    heroPhoto: selectedContentPhoto(
      row.hero_site_asset_id,
      row.hero_site_asset_status,
      null,
      null,
      admin,
    ),
    ...(admin ? { heroSiteAssetId: row.hero_site_asset_id } : {}),
  };
}

function serializeSchedule(row: ScheduleRow, admin = false) {
  return {
    id: row.id,
    timeLabel: row.time_label,
    title: row.title,
    subtitle: row.subtitle,
    description: row.description,
    ...(admin ? { sortOrder: row.sort_order, enabled: row.enabled } : {}),
  };
}

function serializeLocation(row: LocationRow, admin = false) {
  const photo = selectedContentPhoto(
    row.photo_site_asset_id,
    row.photo_site_asset_status,
    row.photo_media_id,
    row.photo_preview_status,
    admin,
  );
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    address: row.address,
    mapsUrl: row.maps_url,
    description: row.description,
    photo,
    ...(admin ? {
      photoMediaId: row.photo_media_id,
      photoSiteAssetId: row.photo_site_asset_id,
    } : {}),
    ...(admin ? { sortOrder: row.sort_order, enabled: row.enabled } : {}),
  };
}

function serializeStoryItem(row: StoryItemRow, admin = false) {
  const photo = selectedContentPhoto(
    row.photo_site_asset_id,
    row.photo_site_asset_status,
    row.photo_media_id,
    row.photo_preview_status,
    admin,
  );
  return {
    id: row.id,
    yearLabel: row.year_label,
    title: row.title,
    body: row.body,
    photo,
    ...(admin ? {
      photoMediaId: row.photo_media_id,
      photoSiteAssetId: row.photo_site_asset_id,
      sortOrder: row.sort_order,
      enabled: row.enabled,
    } : {}),
  };
}

function serializeHomeContent(row: HomeContentRow | null, items: StoryItemRow[] = []) {
  return {
    storyEnabled: row?.story_enabled === true,
    storyEyebrow: row?.story_eyebrow ?? null,
    storyTitle: row?.story_title ?? null,
    storyIntro: row?.story_intro ?? null,
    storyQuote: row?.story_quote ?? null,
    storyQuoteAuthor: row?.story_quote_author ?? null,
    storyItems: items.map((item) => serializeStoryItem(item)),
  };
}

function serializeHomeContentAdmin(row: HomeContentRow | null) {
  return {
    storyEnabled: row?.story_enabled === true,
    storyEyebrow: row?.story_eyebrow ?? null,
    storyTitle: row?.story_title ?? null,
    storyIntro: row?.story_intro ?? null,
    storyQuote: row?.story_quote ?? null,
    storyQuoteAuthor: row?.story_quote_author ?? null,
  };
}

function serializeInfo(row: InfoRow, admin = false) {
  return {
    id: row.id,
    category: row.category,
    title: row.title,
    content: row.content,
    ...(admin ? {
      imageSiteAssetId: row.image_site_asset_id,
      sortOrder: row.sort_order,
      enabled: row.enabled,
    } : {}),
  };
}

async function findCurrentWedding(env: ContentEnv): Promise<ContentWeddingRow | null> {
  const resolution = await env.WEDDING_CONTEXT;
  if (!resolution?.resolved) return null;
  return env.DB.prepare(
    `SELECT w.id, w.slug, w.bride_name, w.groom_name, w.wedding_date, w.status, w.theme,
            w.hero_eyebrow, w.hero_title, w.hero_subtitle,
            h.hero_site_asset_id, a.status AS hero_site_asset_status
     FROM weddings w
     LEFT JOIN wedding_home_content h ON h.wedding_id = w.id
     LEFT JOIN site_assets a
       ON a.id = h.hero_site_asset_id AND a.wedding_id = w.id
     WHERE w.id = ?
     LIMIT 1`,
  )
    .bind(resolution.wedding.id)
    .first<ContentWeddingRow>();
}

async function currentWeddingResponse(env: ContentEnv): Promise<
  { wedding: ContentWeddingRow } | { response: Response }
> {
  const wedding = await findCurrentWedding(env);
  return wedding
    ? { wedding }
    : { response: json({ error: 'Configured wedding not found' }, 404) };
}

function parseSchedule(input: Record<string, unknown>): ScheduleInput {
  return {
    time_label: requiredString(input, 'timeLabel', 40),
    title: requiredString(input, 'title', 120),
    subtitle: optionalString(input, 'subtitle', 180),
    description: optionalString(input, 'description', 1200),
    sortOrder: requiredSortOrder(input),
    enabled: requiredBoolean(input, 'enabled'),
  };
}

function parseLocation(input: Record<string, unknown>): LocationInput {
  return {
    name: requiredString(input, 'name', 160),
    type: optionalString(input, 'type', 80),
    address: optionalString(input, 'address', 240),
    mapsUrl: optionalHttpsUrl(input, 'mapsUrl'),
    description: optionalString(input, 'description', 1200),
    photo_media_id: optionalPositiveInteger(input, 'photoMediaId'),
    photo_site_asset_id: optionalPositiveInteger(input, 'photoSiteAssetId'),
    sortOrder: requiredSortOrder(input),
    enabled: requiredBoolean(input, 'enabled'),
  };
}

function parseHomeContent(input: Record<string, unknown>): HomeContentInput {
  return {
    storyEnabled: requiredBoolean(input, 'storyEnabled'),
    storyEyebrow: optionalString(input, 'storyEyebrow', 80),
    storyTitle: optionalString(input, 'storyTitle', 160),
    storyIntro: optionalString(input, 'storyIntro', 2000),
    storyQuote: optionalString(input, 'storyQuote', 1200),
    storyQuoteAuthor: optionalString(input, 'storyQuoteAuthor', 160),
  };
}

function parseStoryItem(input: Record<string, unknown>): StoryItemInput {
  return {
    yearLabel: requiredString(input, 'yearLabel', 40),
    title: requiredString(input, 'title', 160),
    body: optionalString(input, 'body', 5000),
    photoMediaId: optionalPositiveInteger(input, 'photoMediaId'),
    photoSiteAssetId: optionalPositiveInteger(input, 'photoSiteAssetId'),
    sortOrder: requiredSortOrder(input),
    enabled: requiredBoolean(input, 'enabled'),
  };
}

function parseInfo(input: Record<string, unknown>): InfoInput {
  const category = requiredString(input, 'category', 40);
  if (!INFO_CATEGORIES.has(category)) throw new ValidationError('Unsupported info category');
  return {
    category,
    title: requiredString(input, 'title', 160),
    content: optionalString(input, 'content', 3000),
    image_site_asset_id: optionalPositiveInteger(input, 'imageSiteAssetId'),
    sortOrder: requiredSortOrder(input),
    enabled: requiredBoolean(input, 'enabled'),
  };
}

async function validateApprovedImage(
  env: ContentEnv,
  weddingId: number,
  mediaId: number | null,
): Promise<void> {
  if (mediaId === null) return;
  const media = await env.DB.prepare(
    `SELECT id
     FROM media
     WHERE id = ? AND wedding_id = ? AND status = 'approved'
       AND mime_type LIKE 'image/%' AND preview_status = 'ready'
     LIMIT 1`,
  ).bind(mediaId, weddingId).first<{ id: number }>();
  if (!media) throw new ValidationError('Selected media must be a preview-ready approved image from this wedding');
}

async function validateReadySiteAsset(
  env: ContentEnv,
  weddingId: number,
  siteAssetId: number | null,
): Promise<void> {
  if (siteAssetId === null) return;
  const asset = await env.DB.prepare(
    `SELECT id FROM site_assets
     WHERE id = ? AND wedding_id = ? AND status = 'ready'
       AND mime_type LIKE 'image/%'
     LIMIT 1`,
  ).bind(siteAssetId, weddingId).first<{ id: number }>();
  if (!asset) throw new ValidationError('Selected site asset must be a ready image from this wedding');
}

async function findHomeContent(env: ContentEnv, weddingId: number): Promise<HomeContentRow | null> {
  return env.DB.prepare(
    `SELECT h.wedding_id, h.story_enabled, h.story_eyebrow, h.story_title, h.story_intro,
            h.story_quote, h.story_quote_author, h.hero_site_asset_id,
            a.status AS hero_site_asset_status
     FROM wedding_home_content h
     LEFT JOIN site_assets a
       ON a.id = h.hero_site_asset_id AND a.wedding_id = h.wedding_id
     WHERE h.wedding_id = ?
     LIMIT 1`,
  ).bind(weddingId).first<HomeContentRow>();
}

async function listStoryItems(
  env: ContentEnv,
  weddingId: number,
  publicOnly: boolean,
): Promise<StoryItemRow[]> {
  const result = await env.DB.prepare(
    `SELECT s.id, s.wedding_id, s.year_label, s.title, s.body, s.photo_media_id,
            s.photo_site_asset_id, s.sort_order, s.enabled,
            m.preview_status AS photo_preview_status,
            a.status AS photo_site_asset_status
     FROM wedding_story_items s
     LEFT JOIN media m
       ON m.id = s.photo_media_id
      AND m.wedding_id = s.wedding_id
       AND m.status = 'approved'
       AND m.mime_type LIKE 'image/%'
     LEFT JOIN site_assets a
       ON a.id = s.photo_site_asset_id
      AND a.wedding_id = s.wedding_id
     WHERE s.wedding_id = ?${publicOnly ? ' AND s.enabled = TRUE' : ''}
     ORDER BY s.sort_order, s.id`,
  ).bind(weddingId).all<StoryItemRow>();
  return result.results;
}

async function publicContent(env: ContentEnv, wedding: ContentWeddingRow): Promise<Response> {
  const [settings, home, storyItems, schedule, locations, info] = await Promise.all([
    env.DB.prepare(
      `SELECT schedule_enabled, locations_enabled, info_enabled
       FROM wedding_settings WHERE wedding_id = ? LIMIT 1`,
    ).bind(wedding.id).first<SectionSettingsRow>(),
    findHomeContent(env, wedding.id),
    listStoryItems(env, wedding.id, true),
    env.DB.prepare(
      `SELECT id, wedding_id, time_label, title, subtitle, description, sort_order, enabled
       FROM wedding_schedule
       WHERE wedding_id = ? AND enabled = TRUE
       ORDER BY sort_order, id`,
    ).bind(wedding.id).all<ScheduleRow>(),
    env.DB.prepare(
      `SELECT l.id, l.wedding_id, l.name, l.type, l.address, l.maps_url, l.description,
              l.photo_media_id, l.photo_site_asset_id, l.sort_order, l.enabled,
              m.preview_status AS photo_preview_status,
              a.status AS photo_site_asset_status
       FROM wedding_locations l
       LEFT JOIN media m
         ON m.id = l.photo_media_id
        AND m.wedding_id = l.wedding_id
         AND m.status = 'approved'
         AND m.mime_type LIKE 'image/%'
       LEFT JOIN site_assets a
         ON a.id = l.photo_site_asset_id
        AND a.wedding_id = l.wedding_id
       WHERE l.wedding_id = ? AND l.enabled = TRUE
       ORDER BY l.sort_order, l.id`,
    ).bind(wedding.id).all<LocationRow>(),
    env.DB.prepare(
      `SELECT id, wedding_id, category, title, content, image_site_asset_id, sort_order, enabled
       FROM wedding_info_items
       WHERE wedding_id = ? AND enabled = TRUE
       ORDER BY sort_order, id`,
    ).bind(wedding.id).all<InfoRow>(),
  ]);

  return json({
    wedding: {
      ...serializeWedding(wedding),
      sections: {
        scheduleEnabled: settings?.schedule_enabled !== false,
        locationsEnabled: settings?.locations_enabled !== false,
        infoEnabled: settings?.info_enabled !== false,
      },
    },
    home: serializeHomeContent(home, storyItems),
    schedule: schedule.results.map((row) => serializeSchedule(row)),
    locations: locations.results.map((row) => serializeLocation(row)),
    info: info.results.map((row) => serializeInfo(row)),
  });
}

async function handleWeddingAdmin(
  request: Request,
  env: ContentEnv,
  wedding: ContentWeddingRow,
): Promise<Response> {
  if (request.method === 'GET') return json(serializeWedding(wedding, true));
  if (request.method !== 'PUT') return json({ error: 'Method not allowed' }, 405);

  const input = await requestBody(request);
  const brideName = requiredString(input, 'brideName', 80);
  const groomName = requiredString(input, 'groomName', 80);
  const weddingDate = requiredString(input, 'weddingDate', 10);
  if (!isValidDate(weddingDate)) throw new ValidationError('weddingDate must be a valid ISO date');
  const heroEyebrow = optionalString(input, 'heroEyebrow', 80);
  const heroTitle = optionalString(input, 'heroTitle', 160);
  const heroSubtitle = optionalString(input, 'heroSubtitle', 300);
  const heroSiteAssetId = optionalPositiveInteger(input, 'heroSiteAssetId');
  await validateReadySiteAsset(env, wedding.id, heroSiteAssetId);

  const weddingUpdate = await env.DB.prepare(
    `UPDATE weddings
     SET bride_name = ?, groom_name = ?, wedding_date = ?, hero_eyebrow = ?,
         hero_title = ?, hero_subtitle = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
  )
    .bind(brideName, groomName, weddingDate, heroEyebrow, heroTitle, heroSubtitle, wedding.id)
    .run();
  requireSingleChange(weddingUpdate, `update wedding ${wedding.id}`);
  const homeUpdate = await env.DB.prepare(
    `INSERT INTO wedding_home_content (wedding_id, hero_site_asset_id, updated_at)
     VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(wedding_id) DO UPDATE SET
       hero_site_asset_id = excluded.hero_site_asset_id,
       updated_at = CURRENT_TIMESTAMP`,
  ).bind(wedding.id, heroSiteAssetId).run();
  requireSingleChange(homeUpdate, `update home content for wedding ${wedding.id}`);

  const updated = await findCurrentWedding(env);
  if (!updated || updated.id !== wedding.id) throw new Error(`Wedding ${wedding.id} was not found after update`);
  if (
    updated.bride_name !== brideName
    || updated.groom_name !== groomName
    || updated.wedding_date !== weddingDate
    || updated.hero_eyebrow !== heroEyebrow
    || updated.hero_title !== heroTitle
    || updated.hero_subtitle !== heroSubtitle
    || updated.hero_site_asset_id !== heroSiteAssetId
  ) {
    throw new Error(`Wedding ${wedding.id} does not match the requested state`);
  }
  return json(serializeWedding(updated, true));
}

async function handleHomeContent(
  request: Request,
  env: ContentEnv,
  weddingId: number,
): Promise<Response> {
  if (request.method === 'GET') {
    return json(serializeHomeContentAdmin(await findHomeContent(env, weddingId)));
  }
  if (request.method !== 'PUT') return json({ error: 'Method not allowed' }, 405);

  const content = parseHomeContent(await requestBody(request));
  const update = await env.DB.prepare(
    `INSERT INTO wedding_home_content (
       wedding_id, story_enabled, story_eyebrow, story_title, story_intro,
       story_quote, story_quote_author, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(wedding_id) DO UPDATE SET
       story_enabled = excluded.story_enabled,
       story_eyebrow = excluded.story_eyebrow,
       story_title = excluded.story_title,
       story_intro = excluded.story_intro,
       story_quote = excluded.story_quote,
       story_quote_author = excluded.story_quote_author,
       updated_at = CURRENT_TIMESTAMP`,
  ).bind(
    weddingId, content.storyEnabled, content.storyEyebrow, content.storyTitle,
    content.storyIntro, content.storyQuote, content.storyQuoteAuthor,
  ).run();
  requireSingleChange(update, `update home content for wedding ${weddingId}`);

  const persisted = await findHomeContent(env, weddingId);
  if (!persisted) throw new Error(`Home content for wedding ${weddingId} was not found after update`);
  return json(serializeHomeContentAdmin(persisted));
}

async function handleStoryItems(
  request: Request,
  env: ContentEnv,
  weddingId: number,
  itemId: number | null,
): Promise<Response> {
  if (request.method === 'GET' && itemId === null) {
    const items = await listStoryItems(env, weddingId, false);
    return json({ story: items.map((item) => serializeStoryItem(item, true)), count: items.length, limit: 10 });
  }

  if (request.method === 'POST' && itemId === null) {
    const count = await env.DB.prepare(
      'SELECT COUNT(*) AS count FROM wedding_story_items WHERE wedding_id = ?',
    ).bind(weddingId).first<{ count: number }>();
    if ((count?.count ?? 0) >= 10) throw new ValidationError('A maximum of 10 story items is allowed');

    const item = parseStoryItem(await requestBody(request));
    await validateApprovedImage(env, weddingId, item.photoMediaId);
    await validateReadySiteAsset(env, weddingId, item.photoSiteAssetId);
    const result = await env.DB.prepare(
      `INSERT INTO wedding_story_items
         (wedding_id, year_label, title, body, photo_media_id, photo_site_asset_id,
          sort_order, enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      weddingId, item.yearLabel, item.title, item.body, item.photoMediaId, item.photoSiteAssetId,
      item.sortOrder, item.enabled,
    ).run();
    requireSingleChange(result, `create story item for wedding ${weddingId}`);
    if (result.meta.last_row_id <= 0) throw new Error('PostgreSQL did not return the created story item ID');
    const created = (await listStoryItems(env, weddingId, false))
      .find((candidate) => candidate.id === result.meta.last_row_id);
    if (!created) throw new Error('Created story item was not found');
    return json(serializeStoryItem(created, true), 201);
  }

  if (itemId === null) return json({ error: 'Not found' }, 404);
  const existing = await env.DB.prepare(
    'SELECT id FROM wedding_story_items WHERE id = ? AND wedding_id = ? LIMIT 1',
  ).bind(itemId, weddingId).first<{ id: number }>();
  if (!existing) return json({ error: 'Story item not found' }, 404);

  if (request.method === 'DELETE') {
    const deletion = await env.DB.prepare('DELETE FROM wedding_story_items WHERE id = ? AND wedding_id = ?')
      .bind(itemId, weddingId).run();
    const remaining = await env.DB.prepare(
      'SELECT id FROM wedding_story_items WHERE id = ? AND wedding_id = ? LIMIT 1',
    ).bind(itemId, weddingId).first<{ id: number }>();
    if (remaining) throw new Error(`Story item ${itemId} still exists after deletion`);
    return json({ id: itemId, deleted: true, changed: deletion.meta.changes === 1 });
  }
  if (request.method !== 'PUT') return json({ error: 'Method not allowed' }, 405);

  const item = parseStoryItem(await requestBody(request));
  await validateApprovedImage(env, weddingId, item.photoMediaId);
  await validateReadySiteAsset(env, weddingId, item.photoSiteAssetId);
  const update = await env.DB.prepare(
    `UPDATE wedding_story_items
     SET year_label = ?, title = ?, body = ?, photo_media_id = ?, photo_site_asset_id = ?,
          sort_order = ?, enabled = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND wedding_id = ?`,
  ).bind(
    item.yearLabel, item.title, item.body, item.photoMediaId, item.photoSiteAssetId, item.sortOrder,
    item.enabled, itemId, weddingId,
  ).run();
  requireSingleChange(update, `update story item ${itemId}`);
  const updated = (await listStoryItems(env, weddingId, false))
    .find((candidate) => candidate.id === itemId);
  if (!updated) throw new Error(`Story item ${itemId} was not found after update`);
  return json(serializeStoryItem(updated, true));
}

async function handleSchedule(
  request: Request,
  env: ContentEnv,
  weddingId: number,
  itemId: number | null,
): Promise<Response> {
  if (request.method === 'GET' && itemId === null) {
    const result = await env.DB.prepare(
      `SELECT id, wedding_id, time_label, title, subtitle, description, sort_order, enabled
       FROM wedding_schedule WHERE wedding_id = ? ORDER BY sort_order, id`,
    ).bind(weddingId).all<ScheduleRow>();
    return json({ schedule: result.results.map((row) => serializeSchedule(row, true)) });
  }

  if (request.method === 'POST' && itemId === null) {
    const item = parseSchedule(await requestBody(request));
    const result = await env.DB.prepare(
      `INSERT INTO wedding_schedule
         (wedding_id, time_label, title, subtitle, description, sort_order, enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      weddingId, item.time_label, item.title, item.subtitle, item.description,
      item.sortOrder, item.enabled,
    ).run();
    requireSingleChange(result, `create schedule item for wedding ${weddingId}`);
    if (result.meta.last_row_id <= 0) throw new Error('PostgreSQL did not return the created schedule item ID');
    const row = await env.DB.prepare(
      `SELECT id, wedding_id, time_label, title, subtitle, description, sort_order, enabled
       FROM wedding_schedule WHERE id = ? AND wedding_id = ?`,
    ).bind(result.meta.last_row_id, weddingId).first<ScheduleRow>();
    if (!row) throw new Error('Created schedule item was not found');
    return json(serializeSchedule(row, true), 201);
  }

  if (itemId === null) return json({ error: 'Not found' }, 404);
  const existing = await env.DB.prepare(
    'SELECT id FROM wedding_schedule WHERE id = ? AND wedding_id = ? LIMIT 1',
  ).bind(itemId, weddingId).first<{ id: number }>();
  if (!existing) return json({ error: 'Schedule item not found' }, 404);

  if (request.method === 'DELETE') {
    const deletion = await env.DB.prepare('DELETE FROM wedding_schedule WHERE id = ? AND wedding_id = ?')
      .bind(itemId, weddingId).run();
    const remaining = await env.DB.prepare(
      'SELECT id FROM wedding_schedule WHERE id = ? AND wedding_id = ? LIMIT 1',
    ).bind(itemId, weddingId).first<{ id: number }>();
    if (remaining) throw new Error(`Schedule item ${itemId} still exists after deletion`);
    return json({ id: itemId, deleted: true, changed: deletion.meta.changes === 1 });
  }
  if (request.method !== 'PUT') return json({ error: 'Method not allowed' }, 405);

  const item = parseSchedule(await requestBody(request));
  const update = await env.DB.prepare(
    `UPDATE wedding_schedule
     SET time_label = ?, title = ?, subtitle = ?, description = ?, sort_order = ?, enabled = ?
     WHERE id = ? AND wedding_id = ?`,
  ).bind(
    item.time_label, item.title, item.subtitle, item.description, item.sortOrder,
    item.enabled, itemId, weddingId,
  ).run();
  requireSingleChange(update, `update schedule item ${itemId}`);
  const row = await env.DB.prepare(
    `SELECT id, wedding_id, time_label, title, subtitle, description, sort_order, enabled
     FROM wedding_schedule WHERE id = ? AND wedding_id = ?`,
  ).bind(itemId, weddingId).first<ScheduleRow>();
  if (!row) throw new Error(`Schedule item ${itemId} was not found after update`);
  return json(serializeSchedule(row, true));
}

async function handleLocations(
  request: Request,
  env: ContentEnv,
  weddingId: number,
  itemId: number | null,
): Promise<Response> {
  if (request.method === 'GET' && itemId === null) {
    const result = await env.DB.prepare(
      `SELECT l.id, l.wedding_id, l.name, l.type, l.address, l.maps_url, l.description,
              l.photo_media_id, l.photo_site_asset_id, l.sort_order, l.enabled,
              m.preview_status AS photo_preview_status,
              a.status AS photo_site_asset_status
       FROM wedding_locations l
       LEFT JOIN media m
         ON m.id = l.photo_media_id
        AND m.wedding_id = l.wedding_id
         AND m.status = 'approved'
         AND m.mime_type LIKE 'image/%'
       LEFT JOIN site_assets a
         ON a.id = l.photo_site_asset_id
        AND a.wedding_id = l.wedding_id
       WHERE l.wedding_id = ? ORDER BY l.sort_order, l.id`,
    ).bind(weddingId).all<LocationRow>();
    return json({ locations: result.results.map((row) => serializeLocation(row, true)) });
  }

  if (request.method === 'POST' && itemId === null) {
    const item = parseLocation(await requestBody(request));
    await validateApprovedImage(env, weddingId, item.photo_media_id);
    await validateReadySiteAsset(env, weddingId, item.photo_site_asset_id);
    const result = await env.DB.prepare(
      `INSERT INTO wedding_locations
         (wedding_id, name, type, address, maps_url, description, photo_media_id,
          photo_site_asset_id, sort_order, enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      weddingId, item.name, item.type, item.address, item.mapsUrl, item.description,
      item.photo_media_id, item.photo_site_asset_id, item.sortOrder, item.enabled,
    ).run();
    requireSingleChange(result, `create location for wedding ${weddingId}`);
    if (result.meta.last_row_id <= 0) throw new Error('PostgreSQL did not return the created location ID');
    const row = await env.DB.prepare(
      `SELECT l.id, l.wedding_id, l.name, l.type, l.address, l.maps_url, l.description,
              l.photo_media_id, l.photo_site_asset_id, l.sort_order, l.enabled,
              m.preview_status AS photo_preview_status,
              a.status AS photo_site_asset_status
       FROM wedding_locations l
       LEFT JOIN media m ON m.id = l.photo_media_id
       LEFT JOIN site_assets a ON a.id = l.photo_site_asset_id AND a.wedding_id = l.wedding_id
       WHERE l.id = ? AND l.wedding_id = ?`,
    ).bind(result.meta.last_row_id, weddingId).first<LocationRow>();
    if (!row) throw new Error('Created location was not found');
    return json(serializeLocation(row, true), 201);
  }

  if (itemId === null) return json({ error: 'Not found' }, 404);
  const existing = await env.DB.prepare(
    'SELECT id FROM wedding_locations WHERE id = ? AND wedding_id = ? LIMIT 1',
  ).bind(itemId, weddingId).first<{ id: number }>();
  if (!existing) return json({ error: 'Location not found' }, 404);

  if (request.method === 'DELETE') {
    const deletion = await env.DB.prepare('DELETE FROM wedding_locations WHERE id = ? AND wedding_id = ?')
      .bind(itemId, weddingId).run();
    const remaining = await env.DB.prepare(
      'SELECT id FROM wedding_locations WHERE id = ? AND wedding_id = ? LIMIT 1',
    ).bind(itemId, weddingId).first<{ id: number }>();
    if (remaining) throw new Error(`Location ${itemId} still exists after deletion`);
    return json({ id: itemId, deleted: true, changed: deletion.meta.changes === 1 });
  }
  if (request.method !== 'PUT') return json({ error: 'Method not allowed' }, 405);

  const item = parseLocation(await requestBody(request));
  await validateApprovedImage(env, weddingId, item.photo_media_id);
  await validateReadySiteAsset(env, weddingId, item.photo_site_asset_id);
  const update = await env.DB.prepare(
    `UPDATE wedding_locations
     SET name = ?, type = ?, address = ?, maps_url = ?, description = ?, photo_media_id = ?,
          photo_site_asset_id = ?, sort_order = ?, enabled = ?
     WHERE id = ? AND wedding_id = ?`,
  ).bind(
    item.name, item.type, item.address, item.mapsUrl, item.description,
    item.photo_media_id, item.photo_site_asset_id, item.sortOrder, item.enabled, itemId, weddingId,
  ).run();
  requireSingleChange(update, `update location ${itemId}`);
  const row = await env.DB.prepare(
    `SELECT l.id, l.wedding_id, l.name, l.type, l.address, l.maps_url, l.description,
            l.photo_media_id, l.photo_site_asset_id, l.sort_order, l.enabled,
            m.preview_status AS photo_preview_status,
            a.status AS photo_site_asset_status
     FROM wedding_locations l
     LEFT JOIN media m ON m.id = l.photo_media_id
     LEFT JOIN site_assets a ON a.id = l.photo_site_asset_id AND a.wedding_id = l.wedding_id
     WHERE l.id = ? AND l.wedding_id = ?`,
  ).bind(itemId, weddingId).first<LocationRow>();
  if (!row) throw new Error(`Location ${itemId} was not found after update`);
  return json(serializeLocation(row, true));
}

async function handleInfo(
  request: Request,
  env: ContentEnv,
  weddingId: number,
  itemId: number | null,
): Promise<Response> {
  if (request.method === 'GET' && itemId === null) {
    const result = await env.DB.prepare(
      `SELECT id, wedding_id, category, title, content, image_site_asset_id, sort_order, enabled
       FROM wedding_info_items WHERE wedding_id = ? ORDER BY sort_order, id`,
    ).bind(weddingId).all<InfoRow>();
    return json({ info: result.results.map((row) => serializeInfo(row, true)) });
  }

  if (request.method === 'POST' && itemId === null) {
    const item = parseInfo(await requestBody(request));
    await validateReadySiteAsset(env, weddingId, item.image_site_asset_id);
    const result = await env.DB.prepare(
      `INSERT INTO wedding_info_items
         (wedding_id, category, title, content, image_site_asset_id, sort_order, enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      weddingId, item.category, item.title, item.content, item.image_site_asset_id,
      item.sortOrder, item.enabled,
    ).run();
    requireSingleChange(result, `create info item for wedding ${weddingId}`);
    if (result.meta.last_row_id <= 0) throw new Error('PostgreSQL did not return the created info item ID');
    const row = await env.DB.prepare(
      `SELECT id, wedding_id, category, title, content, image_site_asset_id, sort_order, enabled
       FROM wedding_info_items WHERE id = ? AND wedding_id = ?`,
    ).bind(result.meta.last_row_id, weddingId).first<InfoRow>();
    if (!row) throw new Error('Created info item was not found');
    return json(serializeInfo(row, true), 201);
  }

  if (itemId === null) return json({ error: 'Not found' }, 404);
  const existing = await env.DB.prepare(
    'SELECT id FROM wedding_info_items WHERE id = ? AND wedding_id = ? LIMIT 1',
  ).bind(itemId, weddingId).first<{ id: number }>();
  if (!existing) return json({ error: 'Info item not found' }, 404);

  if (request.method === 'DELETE') {
    const deletion = await env.DB.prepare('DELETE FROM wedding_info_items WHERE id = ? AND wedding_id = ?')
      .bind(itemId, weddingId).run();
    const remaining = await env.DB.prepare(
      'SELECT id FROM wedding_info_items WHERE id = ? AND wedding_id = ? LIMIT 1',
    ).bind(itemId, weddingId).first<{ id: number }>();
    if (remaining) throw new Error(`Info item ${itemId} still exists after deletion`);
    return json({ id: itemId, deleted: true, changed: deletion.meta.changes === 1 });
  }
  if (request.method !== 'PUT') return json({ error: 'Method not allowed' }, 405);

  const item = parseInfo(await requestBody(request));
  await validateReadySiteAsset(env, weddingId, item.image_site_asset_id);
  const update = await env.DB.prepare(
    `UPDATE wedding_info_items
     SET category = ?, title = ?, content = ?, image_site_asset_id = ?, sort_order = ?, enabled = ?
     WHERE id = ? AND wedding_id = ?`,
  ).bind(
    item.category, item.title, item.content, item.image_site_asset_id,
    item.sortOrder, item.enabled, itemId, weddingId,
  ).run();
  requireSingleChange(update, `update info item ${itemId}`);
  const row = await env.DB.prepare(
    `SELECT id, wedding_id, category, title, content, image_site_asset_id, sort_order, enabled
     FROM wedding_info_items WHERE id = ? AND wedding_id = ?`,
  ).bind(itemId, weddingId).first<InfoRow>();
  if (!row) throw new Error(`Info item ${itemId} was not found after update`);
  return json(serializeInfo(row, true));
}

export async function handleContentRequest(
  request: Request,
  env: ContentEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  const isPublicContent = request.method === 'GET' && url.pathname === '/api/wedding/content';
  const isAdminContent = url.pathname.startsWith('/api/admin/content/')
    || url.pathname === '/api/admin/home-content';
  if (!isPublicContent && !isAdminContent) return null;

  try {
    const current = await currentWeddingResponse(env);
    if ('response' in current) return current.response;
    const { wedding } = current;

    if (isPublicContent) return await publicContent(env, wedding);
    if (url.pathname === '/api/admin/content/wedding') {
      return await handleWeddingAdmin(request, env, wedding);
    }
    if (url.pathname === '/api/admin/home-content') {
      return await handleHomeContent(request, env, wedding.id);
    }

    const storyMatch = url.pathname.match(/^\/api\/admin\/content\/story(?:\/(\d+))?$/);
    if (storyMatch) {
      return await handleStoryItems(request, env, wedding.id, storyMatch[1] ? Number(storyMatch[1]) : null);
    }

    const scheduleMatch = url.pathname.match(/^\/api\/admin\/content\/schedule(?:\/(\d+))?$/);
    if (scheduleMatch) {
      return await handleSchedule(request, env, wedding.id, scheduleMatch[1] ? Number(scheduleMatch[1]) : null);
    }
    const locationsMatch = url.pathname.match(/^\/api\/admin\/content\/locations(?:\/(\d+))?$/);
    if (locationsMatch) {
      return await handleLocations(request, env, wedding.id, locationsMatch[1] ? Number(locationsMatch[1]) : null);
    }
    const infoMatch = url.pathname.match(/^\/api\/admin\/content\/info(?:\/(\d+))?$/);
    if (infoMatch) {
      return await handleInfo(request, env, wedding.id, infoMatch[1] ? Number(infoMatch[1]) : null);
    }
    return json({ error: 'Not found' }, 404);
  } catch (error) {
    if (error instanceof ValidationError) return json({ error: error.message }, 400);
    console.error('Unable to handle wedding content request', error);
    return json({ error: 'Wedding content unavailable' }, 500);
  }
}
