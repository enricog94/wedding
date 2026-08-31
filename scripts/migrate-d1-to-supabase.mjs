import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const wranglerEntrypoint = resolve(projectRoot, 'node_modules', 'wrangler', 'bin', 'wrangler.js');

if (!existsSync(wranglerEntrypoint)) {
  throw new Error(
    `Local Wrangler CLI not found at ${wranglerEntrypoint}. Run npm install before starting the migration.`,
  );
}

const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/+$/, '');
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const d1Database = process.env.D1_DATABASE_NAME || 'wedding-db';

if (!supabaseUrl || !serviceRoleKey) {
  throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY before migrating data.');
}

const tables = [
  { name: 'app_config', conflict: 'key' },
  { name: 'weddings', conflict: 'id' },
  { name: 'media', conflict: 'id' },
  { name: 'site_assets', conflict: 'id' },
  { name: 'wedding_settings', conflict: 'wedding_id' },
  { name: 'wedding_home_content', conflict: 'wedding_id' },
  { name: 'wedding_schedule', conflict: 'id' },
  { name: 'wedding_locations', conflict: 'id' },
  { name: 'wedding_info_items', conflict: 'id' },
  { name: 'wedding_story_items', conflict: 'id' },
];

const booleanColumns = new Set([
  'gallery_enabled', 'gallery_preview_enabled', 'gallery_download_enabled',
  'guest_uploads_enabled', 'require_guest_approval', 'photobooth_auto_approve',
  'schedule_enabled', 'locations_enabled', 'info_enabled', 'story_enabled', 'enabled',
]);

const timestampColumns = new Set([
  'created_at', 'updated_at', 'uploaded_at', 'processed_at', 'preview_generated_at',
]);

function wranglerRows(table) {
  const command = `SELECT * FROM ${table}`;
  const output = execFileSync(
    process.execPath,
    [wranglerEntrypoint, 'd1', 'execute', d1Database, '--remote', '--json', '--command', command],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] },
  ).trim();
  let payload;
  try {
    payload = JSON.parse(output);
  } catch {
    const start = output.indexOf('[');
    const end = output.lastIndexOf(']');
    if (start < 0 || end < start) throw new Error(`Wrangler returned invalid JSON for ${table}.`);
    payload = JSON.parse(output.slice(start, end + 1));
  }
  const result = Array.isArray(payload) ? payload[0] : payload;
  if (!result?.success || !Array.isArray(result.results)) {
    throw new Error(`Unable to export D1 table ${table}.`);
  }
  return result.results;
}

function transformRow(row) {
  return Object.fromEntries(Object.entries(row).map(([column, value]) => {
    if (booleanColumns.has(column) && (value === 0 || value === 1)) return [column, value === 1];
    if (timestampColumns.has(column) && typeof value === 'string' && value) {
      const normalized = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
      return [column, normalized];
    }
    return [column, value];
  }));
}

async function upsertRows(table, conflict, rows) {
  for (let index = 0; index < rows.length; index += 200) {
    const batch = rows.slice(index, index + 200).map(transformRow);
    const response = await fetch(
      `${supabaseUrl}/rest/v1/${table}?on_conflict=${encodeURIComponent(conflict)}`,
      {
        method: 'POST',
        headers: {
          apikey: serviceRoleKey,
          authorization: `Bearer ${serviceRoleKey}`,
          'content-type': 'application/json',
          prefer: 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify(batch),
      },
    );
    if (!response.ok) {
      const detail = await response.text();
      throw new Error(`Supabase import failed for ${table}: HTTP ${response.status} ${detail}`);
    }
  }
}

async function assertEmptyTarget() {
  for (const table of tables) {
    const response = await fetch(
      `${supabaseUrl}/rest/v1/${table.name}?select=${encodeURIComponent(table.conflict)}&limit=1`,
      {
        headers: {
          apikey: serviceRoleKey,
          authorization: `Bearer ${serviceRoleKey}`,
        },
      },
    );
    if (!response.ok) {
      throw new Error(`Unable to inspect Supabase table ${table.name}: HTTP ${response.status} ${await response.text()}`);
    }
    const rows = await response.json();
    if (Array.isArray(rows) && rows.length > 0) {
      throw new Error(
        `Supabase target table ${table.name} is not empty. Use a fresh target or reconcile it manually before importing D1.`,
      );
    }
  }
}

await assertEmptyTarget();

for (const table of tables) {
  const rows = wranglerRows(table.name);
  if (rows.length) await upsertRows(table.name, table.conflict, rows);
  console.log(`${table.name}: ${rows.length} row(s) migrated`);
}

const resetResponse = await fetch(`${supabaseUrl}/rest/v1/rpc/reset_backend_sequences`, {
  method: 'POST',
  headers: {
    apikey: serviceRoleKey,
    authorization: `Bearer ${serviceRoleKey}`,
    'content-type': 'application/json',
  },
  body: '{}',
});
if (!resetResponse.ok) {
  throw new Error(`Unable to reset PostgreSQL sequences: HTTP ${resetResponse.status} ${await resetResponse.text()}`);
}

console.log('D1 data migration completed. The source D1 database was not modified.');
