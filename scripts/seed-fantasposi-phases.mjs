import process from 'node:process';
import { Client } from 'pg';

const slugArgument = process.argv.find((argument) => argument.startsWith('--wedding-slug='));
const weddingSlug = slugArgument?.slice('--wedding-slug='.length).trim();
const connectionString = process.env.SUPABASE_DATABASE_URL?.trim();

if (!connectionString) {
  throw new Error('SUPABASE_DATABASE_URL is required');
}
if (!weddingSlug) {
  throw new Error('Pass --wedding-slug=<slug>');
}

const phases = [
  ['addii', 'Addio al celibato / nubilato', 10],
  ['serenata', 'Serenata / vigilia', 20],
  ['cerimonia', 'Cerimonia', 30],
  ['aperitivo', 'Aperitivo', 40],
  ['banchetto', 'Banchetto', 50],
  ['finale', 'Finale FantaSposi', 60],
];

const client = new Client({ connectionString });
try {
  await client.connect();
  const wedding = await client.query('SELECT id FROM public.weddings WHERE slug = $1 LIMIT 1', [weddingSlug]);
  if (wedding.rowCount !== 1) throw new Error(`Wedding not found: ${weddingSlug}`);

  for (const [code, name, sortOrder] of phases) {
    await client.query(
      `INSERT INTO public.fantasposi_phases (wedding_id, code, name, sort_order, status)
       VALUES ($1, $2, $3, $4, 'locked')
       ON CONFLICT (wedding_id, code) DO UPDATE
       SET name = EXCLUDED.name, sort_order = EXCLUDED.sort_order, updated_at = now()`,
      [wedding.rows[0].id, code, name, sortOrder],
    );
  }
  console.log(`Seeded ${phases.length} FantaSposi phases for ${weddingSlug}.`);
} finally {
  await client.end().catch(() => undefined);
}
