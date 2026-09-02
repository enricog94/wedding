import process from 'node:process';
import { Client } from 'pg';

const connectionString = process.env.SUPABASE_DATABASE_URL?.trim();
if (!connectionString) throw new Error('SUPABASE_DATABASE_URL is required');

const TEST_WEDDING = {
  slug: 'test-wedding',
  bride: 'Test Sposa',
  groom: 'Test Sposo',
  date: '2027-01-01',
};
const DOMAIN_MAPPINGS = [
  ['wedding.eshome.it', 'serena-enrico-2027'],
  ['test.eshome.it', TEST_WEDDING.slug],
];

const client = new Client({ connectionString });
try {
  await client.connect();
  await client.query('BEGIN');
  await client.query(
    `INSERT INTO public.weddings (
       slug, bride_name, groom_name, wedding_date, status, fantasposi_status
     ) VALUES ($1, $2, $3, $4, 'active', 'setup')
     ON CONFLICT (slug) DO NOTHING`,
    [TEST_WEDDING.slug, TEST_WEDDING.bride, TEST_WEDDING.groom, TEST_WEDDING.date],
  );

  const configured = [];
  for (const [hostname, slug] of DOMAIN_MAPPINGS) {
    const wedding = await client.query(
      'SELECT id, slug FROM public.weddings WHERE slug = $1 LIMIT 1',
      [slug],
    );
    if (wedding.rowCount !== 1) throw new Error(`Wedding not found: ${slug}`);
    const weddingId = wedding.rows[0].id;
    const existing = await client.query(
      'SELECT wedding_id FROM public.wedding_domains WHERE hostname = $1 LIMIT 1',
      [hostname],
    );
    if (existing.rowCount === 1 && existing.rows[0].wedding_id !== weddingId) {
      throw new Error(`Domain ${hostname} is already assigned to another wedding`);
    }
    const otherPrimary = await client.query(
      `SELECT hostname FROM public.wedding_domains
       WHERE wedding_id = $1 AND is_primary = true AND hostname <> $2 LIMIT 1`,
      [weddingId, hostname],
    );
    if (otherPrimary.rowCount === 1) {
      throw new Error(`Wedding ${slug} already has primary domain ${otherPrimary.rows[0].hostname}`);
    }
    await client.query(
      `INSERT INTO public.wedding_domains (wedding_id, hostname, is_primary)
       VALUES ($1, $2, true)
       ON CONFLICT (hostname) DO UPDATE
       SET is_primary = true, updated_at = now()
       WHERE public.wedding_domains.wedding_id = EXCLUDED.wedding_id`,
      [weddingId, hostname],
    );
    configured.push({ hostname, slug, weddingId });
  }
  await client.query('COMMIT');
  console.log(JSON.stringify({ testWedding: TEST_WEDDING, domains: configured }, null, 2));
} catch (error) {
  await client.query('ROLLBACK').catch(() => undefined);
  throw error;
} finally {
  await client.end().catch(() => undefined);
}
