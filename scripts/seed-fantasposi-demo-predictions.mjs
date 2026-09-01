import process from 'node:process';
import { Client } from 'pg';

const slugArgument = process.argv.find((argument) => argument.startsWith('--wedding-slug='));
const weddingSlug = slugArgument?.slice('--wedding-slug='.length).trim();
const connectionString = process.env.SUPABASE_DATABASE_URL?.trim();

if (!connectionString) throw new Error('SUPABASE_DATABASE_URL is required');
if (!weddingSlug) throw new Error('Pass --wedding-slug=<slug>');

const predictions = [
  ['demo_pianto', null, 'Chi piangerà per primo?', 'Una scelta sola, prima che l’emozione prenda il sopravvento.', 20,
    [['a', 'Serena'], ['b', 'Enrico'], ['c', 'Entrambi'], ['d', 'Nessuno']]],
  ['demo_discorso', 'banchetto', 'Quanto durerà il discorso più lungo?', null, 25,
    [['a', 'Meno di 3 minuti'], ['b', 'Da 3 a 7 minuti'], ['c', 'Più di 7 minuti']]],
  ['demo_ballo', 'banchetto', 'Chi inizierà per primo a ballare?', null, 20,
    [['a', 'Serena'], ['b', 'Enrico'], ['c', 'Un invitato']]],
];

const client = new Client({ connectionString });
try {
  await client.connect();
  const wedding = await client.query('SELECT id FROM public.weddings WHERE slug = $1 LIMIT 1', [weddingSlug]);
  if (wedding.rowCount !== 1) throw new Error(`Wedding not found: ${weddingSlug}`);
  const weddingId = wedding.rows[0].id;

  for (let index = 0; index < predictions.length; index += 1) {
    const [code, phaseCode, question, description, points, options] = predictions[index];
    await client.query('BEGIN');
    try {
      const prediction = await client.query(
        `INSERT INTO public.fantasposi_predictions (
           wedding_id, phase_id, code, question, description, prediction_type,
           points, status, active, sort_order
         )
         SELECT $1, phase.id, $2, $3, $4, 'choice', $5, 'draft', true, $6
         FROM (SELECT 1) seed
         LEFT JOIN public.fantasposi_phases phase
           ON phase.wedding_id = $1 AND phase.code = $7
         WHERE $7::text IS NULL OR phase.id IS NOT NULL
         ON CONFLICT (wedding_id, code) DO UPDATE
         SET question = EXCLUDED.question, description = EXCLUDED.description,
             points = EXCLUDED.points, phase_id = EXCLUDED.phase_id,
             sort_order = EXCLUDED.sort_order, updated_at = now()
         WHERE public.fantasposi_predictions.status = 'draft'
           AND NOT EXISTS (
             SELECT 1 FROM public.fantasposi_player_predictions response
             WHERE response.prediction_id = public.fantasposi_predictions.id
           )
         RETURNING id`,
        [weddingId, code, question, description, points, (index + 1) * 10, phaseCode],
      );
      if (prediction.rowCount === 1) {
        const predictionId = prediction.rows[0].id;
        await client.query('DELETE FROM public.fantasposi_prediction_options WHERE prediction_id = $1 AND wedding_id = $2', [predictionId, weddingId]);
        for (let optionIndex = 0; optionIndex < options.length; optionIndex += 1) {
          const [optionCode, label] = options[optionIndex];
          await client.query(
            `INSERT INTO public.fantasposi_prediction_options
             (wedding_id, prediction_id, code, label, sort_order)
             VALUES ($1, $2, $3, $4, $5)`,
            [weddingId, predictionId, optionCode, label, optionIndex],
          );
        }
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  }
  console.log(`Seeded up to ${predictions.length} demo FantaSposi predictions for ${weddingSlug}.`);
} finally {
  await client.end().catch(() => undefined);
}
