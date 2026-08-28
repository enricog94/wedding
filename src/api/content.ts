export type ContentEnv = {
  DB: D1Database;
  CURRENT_WEDDING_SLUG: string;
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
};

type SectionSettingsRow = {
  schedule_enabled: number;
  locations_enabled: number;
  info_enabled: number;
};

type ScheduleRow = {
  id: number;
  wedding_id: number;
  time_label: string;
  title: string;
  subtitle: string | null;
  description: string | null;
  sort_order: number;
  enabled: number;
};

type LocationRow = {
  id: number;
  wedding_id: number;
  name: string;
  type: string | null;
  address: string | null;
  maps_url: string | null;
  description: string | null;
  sort_order: number;
  enabled: number;
};

type InfoRow = {
  id: number;
  wedding_id: number;
  category: string;
  title: string;
  content: string | null;
  sort_order: number;
  enabled: number;
};

type ScheduleInput = Omit<ScheduleRow, 'id' | 'wedding_id' | 'enabled' | 'sort_order'> & {
  enabled: boolean;
  sortOrder: number;
};

type LocationInput = Omit<LocationRow, 'id' | 'wedding_id' | 'enabled' | 'sort_order' | 'maps_url'> & {
  mapsUrl: string | null;
  enabled: boolean;
  sortOrder: number;
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

function serializeWedding(row: ContentWeddingRow) {
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
  };
}

function serializeSchedule(row: ScheduleRow, admin = false) {
  return {
    id: row.id,
    timeLabel: row.time_label,
    title: row.title,
    subtitle: row.subtitle,
    description: row.description,
    ...(admin ? { sortOrder: row.sort_order, enabled: row.enabled === 1 } : {}),
  };
}

function serializeLocation(row: LocationRow, admin = false) {
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    address: row.address,
    mapsUrl: row.maps_url,
    description: row.description,
    ...(admin ? { sortOrder: row.sort_order, enabled: row.enabled === 1 } : {}),
  };
}

function serializeInfo(row: InfoRow, admin = false) {
  return {
    id: row.id,
    category: row.category,
    title: row.title,
    content: row.content,
    ...(admin ? { sortOrder: row.sort_order, enabled: row.enabled === 1 } : {}),
  };
}

async function findCurrentWedding(env: ContentEnv): Promise<ContentWeddingRow | null> {
  const slug = env.CURRENT_WEDDING_SLUG?.trim();
  if (!slug) return null;
  return env.DB.prepare(
    `SELECT id, slug, bride_name, groom_name, wedding_date, status, theme,
            hero_eyebrow, hero_title, hero_subtitle
     FROM weddings
     WHERE slug = ?
     LIMIT 1`,
  )
    .bind(slug)
    .first<ContentWeddingRow>();
}

async function currentWeddingResponse(env: ContentEnv): Promise<
  { wedding: ContentWeddingRow } | { response: Response }
> {
  if (!env.CURRENT_WEDDING_SLUG?.trim()) {
    return { response: json({ error: 'Current wedding is not configured' }, 500) };
  }
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
    sortOrder: requiredSortOrder(input),
    enabled: requiredBoolean(input, 'enabled'),
  };
}

async function publicContent(env: ContentEnv, wedding: ContentWeddingRow): Promise<Response> {
  const [settings, schedule, locations, info] = await Promise.all([
    env.DB.prepare(
      `SELECT schedule_enabled, locations_enabled, info_enabled
       FROM wedding_settings WHERE wedding_id = ? LIMIT 1`,
    ).bind(wedding.id).first<SectionSettingsRow>(),
    env.DB.prepare(
      `SELECT id, wedding_id, time_label, title, subtitle, description, sort_order, enabled
       FROM wedding_schedule
       WHERE wedding_id = ? AND enabled = 1
       ORDER BY sort_order, id`,
    ).bind(wedding.id).all<ScheduleRow>(),
    env.DB.prepare(
      `SELECT id, wedding_id, name, type, address, maps_url, description, sort_order, enabled
       FROM wedding_locations
       WHERE wedding_id = ? AND enabled = 1
       ORDER BY sort_order, id`,
    ).bind(wedding.id).all<LocationRow>(),
    env.DB.prepare(
      `SELECT id, wedding_id, category, title, content, sort_order, enabled
       FROM wedding_info_items
       WHERE wedding_id = ? AND enabled = 1
       ORDER BY sort_order, id`,
    ).bind(wedding.id).all<InfoRow>(),
  ]);

  return json({
    wedding: {
      ...serializeWedding(wedding),
      sections: {
        scheduleEnabled: settings?.schedule_enabled !== 0,
        locationsEnabled: settings?.locations_enabled !== 0,
        infoEnabled: settings?.info_enabled !== 0,
      },
    },
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
  if (request.method === 'GET') return json(serializeWedding(wedding));
  if (request.method !== 'PUT') return json({ error: 'Method not allowed' }, 405);

  const input = await requestBody(request);
  const brideName = requiredString(input, 'brideName', 80);
  const groomName = requiredString(input, 'groomName', 80);
  const weddingDate = requiredString(input, 'weddingDate', 10);
  if (!isValidDate(weddingDate)) throw new ValidationError('weddingDate must be a valid ISO date');
  const heroEyebrow = optionalString(input, 'heroEyebrow', 80);
  const heroTitle = optionalString(input, 'heroTitle', 160);
  const heroSubtitle = optionalString(input, 'heroSubtitle', 300);

  await env.DB.prepare(
    `UPDATE weddings
     SET bride_name = ?, groom_name = ?, wedding_date = ?, hero_eyebrow = ?,
         hero_title = ?, hero_subtitle = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
  )
    .bind(brideName, groomName, weddingDate, heroEyebrow, heroTitle, heroSubtitle, wedding.id)
    .run();

  const updated = await findCurrentWedding(env);
  return json(serializeWedding(updated ?? wedding));
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
      item.sortOrder, Number(item.enabled),
    ).run();
    const row = await env.DB.prepare(
      `SELECT id, wedding_id, time_label, title, subtitle, description, sort_order, enabled
       FROM wedding_schedule WHERE id = ? AND wedding_id = ?`,
    ).bind(result.meta.last_row_id, weddingId).first<ScheduleRow>();
    return json(serializeSchedule(row!, true), 201);
  }

  if (itemId === null) return json({ error: 'Not found' }, 404);
  const existing = await env.DB.prepare(
    'SELECT id FROM wedding_schedule WHERE id = ? AND wedding_id = ? LIMIT 1',
  ).bind(itemId, weddingId).first<{ id: number }>();
  if (!existing) return json({ error: 'Schedule item not found' }, 404);

  if (request.method === 'DELETE') {
    await env.DB.prepare('DELETE FROM wedding_schedule WHERE id = ? AND wedding_id = ?')
      .bind(itemId, weddingId).run();
    return json({ id: itemId, deleted: true });
  }
  if (request.method !== 'PUT') return json({ error: 'Method not allowed' }, 405);

  const item = parseSchedule(await requestBody(request));
  await env.DB.prepare(
    `UPDATE wedding_schedule
     SET time_label = ?, title = ?, subtitle = ?, description = ?, sort_order = ?, enabled = ?
     WHERE id = ? AND wedding_id = ?`,
  ).bind(
    item.time_label, item.title, item.subtitle, item.description, item.sortOrder,
    Number(item.enabled), itemId, weddingId,
  ).run();
  const row = await env.DB.prepare(
    `SELECT id, wedding_id, time_label, title, subtitle, description, sort_order, enabled
     FROM wedding_schedule WHERE id = ? AND wedding_id = ?`,
  ).bind(itemId, weddingId).first<ScheduleRow>();
  return json(serializeSchedule(row!, true));
}

async function handleLocations(
  request: Request,
  env: ContentEnv,
  weddingId: number,
  itemId: number | null,
): Promise<Response> {
  if (request.method === 'GET' && itemId === null) {
    const result = await env.DB.prepare(
      `SELECT id, wedding_id, name, type, address, maps_url, description, sort_order, enabled
       FROM wedding_locations WHERE wedding_id = ? ORDER BY sort_order, id`,
    ).bind(weddingId).all<LocationRow>();
    return json({ locations: result.results.map((row) => serializeLocation(row, true)) });
  }

  if (request.method === 'POST' && itemId === null) {
    const item = parseLocation(await requestBody(request));
    const result = await env.DB.prepare(
      `INSERT INTO wedding_locations
         (wedding_id, name, type, address, maps_url, description, sort_order, enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      weddingId, item.name, item.type, item.address, item.mapsUrl, item.description,
      item.sortOrder, Number(item.enabled),
    ).run();
    const row = await env.DB.prepare(
      `SELECT id, wedding_id, name, type, address, maps_url, description, sort_order, enabled
       FROM wedding_locations WHERE id = ? AND wedding_id = ?`,
    ).bind(result.meta.last_row_id, weddingId).first<LocationRow>();
    return json(serializeLocation(row!, true), 201);
  }

  if (itemId === null) return json({ error: 'Not found' }, 404);
  const existing = await env.DB.prepare(
    'SELECT id FROM wedding_locations WHERE id = ? AND wedding_id = ? LIMIT 1',
  ).bind(itemId, weddingId).first<{ id: number }>();
  if (!existing) return json({ error: 'Location not found' }, 404);

  if (request.method === 'DELETE') {
    await env.DB.prepare('DELETE FROM wedding_locations WHERE id = ? AND wedding_id = ?')
      .bind(itemId, weddingId).run();
    return json({ id: itemId, deleted: true });
  }
  if (request.method !== 'PUT') return json({ error: 'Method not allowed' }, 405);

  const item = parseLocation(await requestBody(request));
  await env.DB.prepare(
    `UPDATE wedding_locations
     SET name = ?, type = ?, address = ?, maps_url = ?, description = ?, sort_order = ?, enabled = ?
     WHERE id = ? AND wedding_id = ?`,
  ).bind(
    item.name, item.type, item.address, item.mapsUrl, item.description, item.sortOrder,
    Number(item.enabled), itemId, weddingId,
  ).run();
  const row = await env.DB.prepare(
    `SELECT id, wedding_id, name, type, address, maps_url, description, sort_order, enabled
     FROM wedding_locations WHERE id = ? AND wedding_id = ?`,
  ).bind(itemId, weddingId).first<LocationRow>();
  return json(serializeLocation(row!, true));
}

async function handleInfo(
  request: Request,
  env: ContentEnv,
  weddingId: number,
  itemId: number | null,
): Promise<Response> {
  if (request.method === 'GET' && itemId === null) {
    const result = await env.DB.prepare(
      `SELECT id, wedding_id, category, title, content, sort_order, enabled
       FROM wedding_info_items WHERE wedding_id = ? ORDER BY sort_order, id`,
    ).bind(weddingId).all<InfoRow>();
    return json({ info: result.results.map((row) => serializeInfo(row, true)) });
  }

  if (request.method === 'POST' && itemId === null) {
    const item = parseInfo(await requestBody(request));
    const result = await env.DB.prepare(
      `INSERT INTO wedding_info_items
         (wedding_id, category, title, content, sort_order, enabled)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).bind(
      weddingId, item.category, item.title, item.content, item.sortOrder, Number(item.enabled),
    ).run();
    const row = await env.DB.prepare(
      `SELECT id, wedding_id, category, title, content, sort_order, enabled
       FROM wedding_info_items WHERE id = ? AND wedding_id = ?`,
    ).bind(result.meta.last_row_id, weddingId).first<InfoRow>();
    return json(serializeInfo(row!, true), 201);
  }

  if (itemId === null) return json({ error: 'Not found' }, 404);
  const existing = await env.DB.prepare(
    'SELECT id FROM wedding_info_items WHERE id = ? AND wedding_id = ? LIMIT 1',
  ).bind(itemId, weddingId).first<{ id: number }>();
  if (!existing) return json({ error: 'Info item not found' }, 404);

  if (request.method === 'DELETE') {
    await env.DB.prepare('DELETE FROM wedding_info_items WHERE id = ? AND wedding_id = ?')
      .bind(itemId, weddingId).run();
    return json({ id: itemId, deleted: true });
  }
  if (request.method !== 'PUT') return json({ error: 'Method not allowed' }, 405);

  const item = parseInfo(await requestBody(request));
  await env.DB.prepare(
    `UPDATE wedding_info_items
     SET category = ?, title = ?, content = ?, sort_order = ?, enabled = ?
     WHERE id = ? AND wedding_id = ?`,
  ).bind(
    item.category, item.title, item.content, item.sortOrder, Number(item.enabled), itemId, weddingId,
  ).run();
  const row = await env.DB.prepare(
    `SELECT id, wedding_id, category, title, content, sort_order, enabled
     FROM wedding_info_items WHERE id = ? AND wedding_id = ?`,
  ).bind(itemId, weddingId).first<InfoRow>();
  return json(serializeInfo(row!, true));
}

export async function handleContentRequest(
  request: Request,
  env: ContentEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  const isPublicContent = request.method === 'GET' && url.pathname === '/api/wedding/content';
  const isAdminContent = url.pathname.startsWith('/api/admin/content/');
  if (!isPublicContent && !isAdminContent) return null;

  try {
    const current = await currentWeddingResponse(env);
    if ('response' in current) return current.response;
    const { wedding } = current;

    if (isPublicContent) return await publicContent(env, wedding);
    if (url.pathname === '/api/admin/content/wedding') {
      return await handleWeddingAdmin(request, env, wedding);
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
