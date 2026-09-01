import process from 'node:process';
import { Client } from 'pg';

const slugArgument = process.argv.find((argument) => argument.startsWith('--wedding-slug='));
const weddingSlug = slugArgument?.slice('--wedding-slug='.length).trim();
const connectionString = process.env.SUPABASE_DATABASE_URL?.trim();

if (!connectionString) throw new Error('SUPABASE_DATABASE_URL is required');
if (!weddingSlug) throw new Error('Pass --wedding-slug=<slug>');

const missions = [
  ['demo_brindisi', 'addii', 'Fai un brindisi con qualcuno che non conoscevi', 'Presentati, alza il bicchiere e brinda insieme.', 'social', 20, 10],
  ['demo_altra_squadra', 'addii', 'Conosci un invitato dell’altra squadra', 'Scopri come conosce gli sposi e fate squadra per un momento.', 'social', 25, 20],
  ['demo_testimone', 'aperitivo', 'Fai un selfie con un testimone', 'Un ricordo veloce con uno dei protagonisti della giornata.', 'action', 20, 30],
  ['demo_ballo', 'banchetto', 'Balla con qualcuno che non conoscevi', 'Lascia il tavolo e coinvolgi un nuovo compagno di pista.', 'social', 30, 10],
  ['demo_applauso', 'banchetto', 'Lancia un applauso contagioso', 'Fai partire un applauso e coinvolgi almeno il tuo tavolo.', 'action', 15, 20],
  ['demo_dedica', 'finale', 'Dedica una frase agli sposi', 'Trova gli sposi e lascia loro una breve dedica a voce.', 'action', 25, 10],
];

const client = new Client({ connectionString });
try {
  await client.connect();
  const wedding = await client.query('SELECT id FROM public.weddings WHERE slug = $1 LIMIT 1', [weddingSlug]);
  if (wedding.rowCount !== 1) throw new Error(`Wedding not found: ${weddingSlug}`);

  let seeded = 0;
  for (const [code, phaseCode, title, description, missionType, points, sortOrder] of missions) {
    const result = await client.query(
      `INSERT INTO public.fantasposi_missions (
         wedding_id, phase_id, code, title, description, mission_type, points, active, sort_order
       )
       SELECT $1, phase.id, $2, $3, $4, $5, $6, true, $7
       FROM public.fantasposi_phases phase
       WHERE phase.wedding_id = $1 AND phase.code = $8
       ON CONFLICT (wedding_id, code) DO UPDATE
       SET phase_id = EXCLUDED.phase_id,
           title = EXCLUDED.title,
           description = EXCLUDED.description,
           mission_type = EXCLUDED.mission_type,
           points = EXCLUDED.points,
           sort_order = EXCLUDED.sort_order,
           updated_at = now()
       RETURNING id`,
      [wedding.rows[0].id, code, title, description, missionType, points, sortOrder, phaseCode],
    );
    seeded += result.rowCount ?? 0;
  }
  console.log(`Seeded ${seeded} demo FantaSposi missions for ${weddingSlug}.`);
} finally {
  await client.end().catch(() => undefined);
}
