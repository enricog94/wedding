import type { Database } from '../lib/supabase-db';
import type { WeddingResolution } from '../lib/wedding-resolver';
import {
  isValidTimeWindow,
  isValidFantasposiResetConfirmation,
  parseOptionalTimestamp,
  type FantasposiGameState,
} from '../lib/fantasposi-domain';

type AdminFantasyEnv = {
  DB: Database;
  WEDDING_CONTEXT?: Promise<WeddingResolution>;
};

type WeddingRow = { id: number; slug: string; fantasposi_status: FantasposiGameState };
type PhaseStatus = 'locked' | 'active' | 'completed';

type AdminPhaseRow = {
  id: number;
  code: string;
  name: string;
  sort_order: number;
  starts_at: string | null;
  ends_at: string | null;
  status: PhaseStatus;
  mission_count: number;
};

type AdminMissionRow = {
  id: number;
  code: string;
  title: string;
  description: string | null;
  mission_type: string;
  points: number;
  active: boolean;
  sort_order: number;
  opens_at: string | null;
  closes_at: string | null;
  effective_status: 'inactive' | 'scheduled' | 'available' | 'expired';
  phase_id: number;
  phase_name: string;
  phase_status: PhaseStatus;
  completion_count: number;
};

type PredictionStatus = 'draft' | 'open' | 'closed' | 'resolved';
type AdminPredictionRow = {
  id: number; code: string; question: string; description: string | null;
  points: number; status: PredictionStatus; active: boolean; sort_order: number;
  effective_status: 'draft' | 'scheduled' | 'open' | 'closed' | 'resolved';
  opens_at: string | null; closes_at: string | null; phase_id: number | null;
  phase_name: string | null; correct_option_id: number | null; response_count: number;
  points_awarded_total: number;
  option_id: number; option_code: string; option_label: string; option_sort_order: number;
};

type PredictionInput = {
  code: string; question: string; description: string | null; phaseId: number | null;
  points: number; sortOrder: number; opensAt: string | null; closesAt: string | null;
  options: { code: string; label: string; sortOrder: number }[];
};

const jsonHeaders = { 'content-type': 'application/json; charset=utf-8' };

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: jsonHeaders });
}

async function currentWedding(env: AdminFantasyEnv): Promise<WeddingRow | null> {
  const resolution = await env.WEDDING_CONTEXT;
  return resolution?.resolved ? resolution.wedding : null;
}

function serializePhase(phase: AdminPhaseRow) {
  return {
    id: phase.id,
    code: phase.code,
    name: phase.name,
    sortOrder: phase.sort_order,
    startsAt: phase.starts_at,
    endsAt: phase.ends_at,
    status: phase.status,
    missionCount: phase.mission_count,
  };
}

function serializeMission(mission: AdminMissionRow) {
  return {
    id: mission.id,
    code: mission.code,
    title: mission.title,
    description: mission.description,
    missionType: mission.mission_type,
    points: mission.points,
    active: mission.active,
    sortOrder: mission.sort_order,
    opensAt: mission.opens_at,
    closesAt: mission.closes_at,
    effectiveStatus: mission.effective_status,
    phaseId: mission.phase_id,
    phaseName: mission.phase_name,
    phaseStatus: mission.phase_status,
    completionCount: mission.completion_count,
  };
}

async function listPhases(env: AdminFantasyEnv, weddingId: number): Promise<AdminPhaseRow[]> {
  const result = await env.DB.prepare(
    `SELECT phase.id, phase.code, phase.name, phase.sort_order,
            phase.starts_at, phase.ends_at, phase.status,
            COUNT(mission.id)::integer AS mission_count
     FROM fantasposi_phases phase
     LEFT JOIN fantasposi_missions mission
       ON mission.phase_id = phase.id AND mission.wedding_id = phase.wedding_id
     WHERE phase.wedding_id = ?
     GROUP BY phase.id
     ORDER BY phase.sort_order, phase.id`,
  ).bind(weddingId).all<AdminPhaseRow>();
  return result.results;
}

async function listMissions(env: AdminFantasyEnv, weddingId: number): Promise<AdminMissionRow[]> {
  const result = await env.DB.prepare(
    `SELECT mission.id, mission.code, mission.title, mission.description,
            mission.mission_type, mission.points, mission.active, mission.sort_order,
            mission.opens_at, mission.closes_at,
            CASE
              WHEN mission.active = false OR phase.status <> 'active' THEN 'inactive'
              WHEN mission.opens_at IS NOT NULL AND CURRENT_TIMESTAMP < mission.opens_at THEN 'scheduled'
              WHEN mission.closes_at IS NOT NULL AND CURRENT_TIMESTAMP >= mission.closes_at THEN 'expired'
              ELSE 'available'
            END AS effective_status,
            phase.id AS phase_id, phase.name AS phase_name, phase.status AS phase_status,
            COUNT(completion.id)::integer AS completion_count
     FROM fantasposi_missions mission
     INNER JOIN fantasposi_phases phase
       ON phase.id = mission.phase_id AND phase.wedding_id = mission.wedding_id
     LEFT JOIN fantasposi_player_missions completion
       ON completion.mission_id = mission.id
      AND completion.wedding_id = mission.wedding_id
      AND completion.status = 'completed'
     WHERE mission.wedding_id = ?
     GROUP BY mission.id, phase.id
     ORDER BY phase.sort_order, phase.id, mission.sort_order, mission.id`,
  ).bind(weddingId).all<AdminMissionRow>();
  return result.results;
}

type MissionInput = {
  code: string;
  phaseId: number;
  title: string;
  description: string | null;
  missionType: 'action' | 'social' | 'photo';
  points: number;
  active: boolean;
  sortOrder: number;
  opensAt: string | null;
  closesAt: string | null;
};

type MissionInputResult =
  | { value: MissionInput; invalidField: null }
  | { value: null; invalidField: string };

export function parseMissionInput(input: unknown): MissionInputResult {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { value: null, invalidField: 'payload' };
  }
  const body = input as Record<string, unknown>;
  const code = typeof body.code === 'string' ? body.code.trim().toLowerCase() : '';
  const phaseId = body.phaseId;
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const description = typeof body.description === 'string' && body.description.trim()
    ? body.description.trim()
    : null;
  const missionType = body.missionType;
  const points = body.points;
  const active = body.active;
  const sortOrder = body.sortOrder;
  const opensAt = parseOptionalTimestamp(body.opensAt);
  const closesAt = parseOptionalTimestamp(body.closesAt);
  let invalidField: string | null = null;
  if (!/^[a-z0-9][a-z0-9-]{1,79}$/.test(code)) invalidField = 'code';
  else if (typeof phaseId !== 'number' || !Number.isSafeInteger(phaseId) || phaseId <= 0) invalidField = 'phaseId';
  else if (title.length < 2 || title.length > 140) invalidField = 'title';
  else if ((description?.length ?? 0) > 1000) invalidField = 'description';
  else if (missionType !== 'action' && missionType !== 'social' && missionType !== 'photo') invalidField = 'missionType';
  else if (typeof points !== 'number' || !Number.isSafeInteger(points) || points < 0 || points > 10_000) invalidField = 'points';
  else if (typeof active !== 'boolean') invalidField = 'active';
  else if (typeof sortOrder !== 'number' || !Number.isSafeInteger(sortOrder) || sortOrder < 0 || sortOrder > 100_000) invalidField = 'sortOrder';
  else if (opensAt === undefined) invalidField = 'opensAt';
  else if (closesAt === undefined) invalidField = 'closesAt';
  else if (!isValidTimeWindow(opensAt, closesAt)) invalidField = 'timeRange';

  if (invalidField) return { value: null, invalidField };
  return {
    value: {
      code, phaseId: phaseId as number, title, description,
      missionType: missionType as 'action' | 'social' | 'photo', points: points as number,
      active: active as boolean, sortOrder: sortOrder as number,
      opensAt: opensAt as string | null,
      closesAt: closesAt as string | null,
    },
    invalidField: null,
  };
}

export function parsePredictionInput(input: unknown): PredictionInput | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const body = input as Record<string, unknown>;
  const code = typeof body.code === 'string' ? body.code.trim().toLowerCase() : '';
  const question = typeof body.question === 'string' ? body.question.trim() : '';
  const description = typeof body.description === 'string' && body.description.trim()
    ? body.description.trim() : null;
  const phaseId = body.phaseId === null || body.phaseId === '' || body.phaseId === undefined
    ? null : body.phaseId;
  const points = body.points;
  const sortOrder = body.sortOrder;
  const opensAt = parseOptionalTimestamp(body.opensAt);
  const closesAt = parseOptionalTimestamp(body.closesAt);
  const rawOptions = Array.isArray(body.options) ? body.options : [];
  const options = rawOptions.map((value, index) => {
    const option = value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown> : {};
    return {
      code: typeof option.code === 'string' ? option.code.trim().toLowerCase() : '',
      label: typeof option.label === 'string' ? option.label.trim() : '',
      sortOrder: option.sortOrder === undefined ? index : option.sortOrder,
    };
  });
  if (!/^[a-z0-9][a-z0-9-]{1,79}$/.test(code)
    || question.length < 3 || question.length > 240
    || (description?.length ?? 0) > 1500
    || (phaseId !== null && (typeof phaseId !== 'number' || !Number.isSafeInteger(phaseId) || phaseId <= 0))
    || typeof points !== 'number' || !Number.isSafeInteger(points) || points < 0 || points > 10_000
    || typeof sortOrder !== 'number' || !Number.isSafeInteger(sortOrder) || sortOrder < 0 || sortOrder > 100_000
    || opensAt === undefined || closesAt === undefined
    || !isValidTimeWindow(opensAt, closesAt)
    || options.length < 2 || options.length > 12
    || options.some((option) => !/^[a-z0-9][a-z0-9-]{0,19}$/.test(option.code)
      || option.label.length < 1 || option.label.length > 160
      || typeof option.sortOrder !== 'number' || !Number.isSafeInteger(option.sortOrder)
      || option.sortOrder < 0 || option.sortOrder > 1000)
    || new Set(options.map((option) => option.code)).size !== options.length
  ) return null;
  return {
    code, question, description, phaseId: phaseId as number | null,
    points: points as number, sortOrder: sortOrder as number,
    opensAt, closesAt,
    options: options as PredictionInput['options'],
  };
}

function serializeAdminPredictions(rows: AdminPredictionRow[]) {
  const predictions = new Map<number, {
    id: number; code: string; question: string; description: string | null;
    points: number; status: PredictionStatus; active: boolean; sortOrder: number;
    effectiveStatus: AdminPredictionRow['effective_status'];
    opensAt: string | null; closesAt: string | null;
    phaseId: number | null; phaseName: string | null; correctOptionId: number | null;
    responseCount: number; pointsAwardedTotal: number;
    options: { id: number; code: string; label: string; sortOrder: number }[];
  }>();
  for (const row of rows) {
    const prediction = predictions.get(row.id) ?? {
      id: row.id, code: row.code, question: row.question, description: row.description,
      points: row.points, status: row.status, effectiveStatus: row.effective_status,
      active: row.active, sortOrder: row.sort_order,
      opensAt: row.opens_at, closesAt: row.closes_at,
      phaseId: row.phase_id, phaseName: row.phase_name,
      correctOptionId: row.correct_option_id, responseCount: row.response_count,
      pointsAwardedTotal: row.points_awarded_total, options: [],
    };
    prediction.options.push({
      id: row.option_id, code: row.option_code,
      label: row.option_label, sortOrder: row.option_sort_order,
    });
    predictions.set(row.id, prediction);
  }
  return [...predictions.values()];
}

async function listPredictions(env: AdminFantasyEnv, weddingId: number) {
  const result = await env.DB.prepare(
    `SELECT prediction.id, prediction.code, prediction.question, prediction.description,
            prediction.points, prediction.status,
            CASE
              WHEN prediction.status = 'draft' THEN 'draft'
              WHEN prediction.status = 'resolved' THEN 'resolved'
              WHEN prediction.status = 'closed' THEN 'closed'
              WHEN prediction.opens_at IS NOT NULL AND CURRENT_TIMESTAMP < prediction.opens_at THEN 'scheduled'
              WHEN prediction.closes_at IS NOT NULL AND CURRENT_TIMESTAMP >= prediction.closes_at THEN 'closed'
              ELSE 'open'
            END AS effective_status,
            prediction.active, prediction.sort_order,
            prediction.opens_at, prediction.closes_at, prediction.phase_id,
            phase.name AS phase_name, prediction.correct_option_id,
            (SELECT COUNT(*)::integer FROM fantasposi_player_predictions response
             WHERE response.prediction_id = prediction.id
               AND response.wedding_id = prediction.wedding_id) AS response_count,
            (SELECT COALESCE(SUM(response.points_awarded), 0)::integer
             FROM fantasposi_player_predictions response
             WHERE response.prediction_id = prediction.id
               AND response.wedding_id = prediction.wedding_id
               AND response.status = 'scored') AS points_awarded_total,
            option.id AS option_id, option.code AS option_code,
            option.label AS option_label, option.sort_order AS option_sort_order
     FROM fantasposi_predictions prediction
     INNER JOIN fantasposi_prediction_options option
       ON option.prediction_id = prediction.id AND option.wedding_id = prediction.wedding_id
     LEFT JOIN fantasposi_phases phase
       ON phase.id = prediction.phase_id AND phase.wedding_id = prediction.wedding_id
     WHERE prediction.wedding_id = ?
     ORDER BY prediction.sort_order, prediction.id, option.sort_order, option.id`,
  ).bind(weddingId).all<AdminPredictionRow>();
  return serializeAdminPredictions(result.results);
}

async function overviewResponse(env: AdminFantasyEnv, weddingId: number): Promise<Response> {
  const overview = await env.DB.prepare(
    `SELECT
       (SELECT COUNT(*)::integer FROM fantasposi_players
        WHERE wedding_id = ? AND active = true) AS active_players,
       (SELECT COUNT(*)::integer FROM fantasposi_missions
        WHERE wedding_id = ? AND active = true) AS active_missions,
       (SELECT COUNT(*)::integer FROM fantasposi_player_missions
        WHERE wedding_id = ? AND status = 'completed') AS completions,
       (SELECT COUNT(*)::integer FROM fantasposi_phases
        WHERE wedding_id = ? AND status = 'active') AS active_phases`,
  ).bind(weddingId, weddingId, weddingId, weddingId).first<{
    active_players: number;
    active_missions: number;
    completions: number;
    active_phases: number;
  }>();
  const teams = await env.DB.prepare(
    `WITH mission_points AS (
       SELECT player_id, COALESCE(SUM(points_awarded)
         FILTER (WHERE status = 'completed'), 0)::integer AS points
       FROM fantasposi_player_missions WHERE wedding_id = ? GROUP BY player_id
     ), prediction_points AS (
       SELECT player_id, COALESCE(SUM(points_awarded)
         FILTER (WHERE status = 'scored'), 0)::integer AS points
       FROM fantasposi_player_predictions WHERE wedding_id = ? GROUP BY player_id
     )
     SELECT player.team,
            COALESCE(SUM(COALESCE(mission_points.points, 0)
              + COALESCE(prediction_points.points, 0)), 0)::integer AS points
     FROM fantasposi_players player
     LEFT JOIN mission_points ON mission_points.player_id = player.id
     LEFT JOIN prediction_points ON prediction_points.player_id = player.id
     WHERE player.wedding_id = ? AND player.active = true GROUP BY player.team`,
  ).bind(weddingId, weddingId, weddingId).all<{ team: 'bride' | 'groom'; points: number }>();
  return json({
    gameState: (await env.DB.prepare(
      'SELECT fantasposi_status FROM weddings WHERE id = ? LIMIT 1',
    ).bind(weddingId).first<{ fantasposi_status: FantasposiGameState }>())?.fantasposi_status ?? 'setup',
    activePlayers: overview?.active_players ?? 0,
    activeMissions: overview?.active_missions ?? 0,
    completions: overview?.completions ?? 0,
    activePhases: overview?.active_phases ?? 0,
    teamPoints: {
      bride: teams.results.find((team) => team.team === 'bride')?.points ?? 0,
      groom: teams.results.find((team) => team.team === 'groom')?.points ?? 0,
    },
  });
}

async function transitionGameState(
  env: AdminFantasyEnv,
  wedding: WeddingRow,
  action: 'start' | 'finish',
): Promise<Response> {
  const expected: FantasposiGameState = action === 'start' ? 'setup' : 'active';
  const target: FantasposiGameState = action === 'start' ? 'active' : 'finished';
  if (wedding.fantasposi_status === target) {
    return json({ gameState: target, changed: false });
  }
  if (wedding.fantasposi_status !== expected) {
    return json({
      error: action === 'start'
        ? 'Il FantaSposi può essere avviato solo dalla preparazione.'
        : 'Il FantaSposi può essere chiuso solo mentre è in corso.',
      code: 'invalid_game_transition',
      gameState: wedding.fantasposi_status,
    }, 409);
  }
  const updated = await env.DB.prepare(
    `UPDATE weddings
     SET fantasposi_status = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND fantasposi_status = ?
     RETURNING fantasposi_status`,
  ).bind(target, wedding.id, expected).first<{ fantasposi_status: FantasposiGameState }>();
  if (updated) return json({ gameState: updated.fantasposi_status, changed: true });
  const current = await env.DB.prepare(
    'SELECT fantasposi_status FROM weddings WHERE id = ? LIMIT 1',
  ).bind(wedding.id).first<{ fantasposi_status: FantasposiGameState }>();
  return json({
    error: 'Lo stato del gioco è cambiato durante l’operazione.',
    code: 'game_state_conflict',
    gameState: current?.fantasposi_status ?? null,
  }, 409);
}

async function resetGameResponse(
  request: Request,
  env: AdminFantasyEnv,
  wedding: WeddingRow,
): Promise<Response> {
  const body = await request.json().catch(() => null) as { confirmation?: unknown } | null;
  if (!isValidFantasposiResetConfirmation(body?.confirmation)) {
    return json({ error: 'Conferma reset non valida.', code: 'invalid_reset_confirmation' }, 400);
  }
  const result = await env.DB.prepare(
    `WITH target AS MATERIALIZED (
       SELECT id FROM weddings WHERE id = ?
     ), deleted_missions AS (
       DELETE FROM fantasposi_player_missions completion
       USING target
       WHERE completion.wedding_id = target.id
       RETURNING completion.media_id
     ), deleted_predictions AS (
       DELETE FROM fantasposi_player_predictions response
       USING target
       WHERE response.wedding_id = target.id
       RETURNING response.id
     ), reset_wedding AS (
       UPDATE weddings wedding
       SET fantasposi_status = 'setup', updated_at = CURRENT_TIMESTAMP
       FROM target
       WHERE wedding.id = target.id
         AND (SELECT COUNT(*) FROM deleted_missions) >= 0
         AND (SELECT COUNT(*) FROM deleted_predictions) >= 0
       RETURNING wedding.fantasposi_status
     )
     SELECT reset_wedding.fantasposi_status,
            (SELECT COUNT(*)::integer FROM deleted_missions) AS deleted_completions,
            (SELECT COUNT(*)::integer FROM deleted_predictions) AS deleted_answers,
            (SELECT COUNT(*)::integer FROM deleted_missions WHERE media_id IS NOT NULL) AS orphaned_proofs
     FROM reset_wedding`,
  ).bind(wedding.id).first<{
    fantasposi_status: FantasposiGameState;
    deleted_completions: number;
    deleted_answers: number;
    orphaned_proofs: number;
  }>();
  if (!result) return json({ error: 'Reset FantaSposi non riuscito.' }, 500);
  return json({
    gameState: result.fantasposi_status,
    deletedCompletions: result.deleted_completions,
    deletedAnswers: result.deleted_answers,
    orphanedProofs: result.orphaned_proofs,
  });
}

export async function handleAdminFantasposiRequest(
  request: Request,
  env: AdminFantasyEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/admin/fantasposi/')) return null;

  try {
    const wedding = await currentWedding(env);
    if (!wedding) return json({ error: 'Configured wedding not found' }, 404);

    if (request.method === 'GET' && url.pathname === '/api/admin/fantasposi/overview') {
      return overviewResponse(env, wedding.id);
    }
    if (request.method === 'POST' && url.pathname === '/api/admin/fantasposi/game/start') {
      return transitionGameState(env, wedding, 'start');
    }
    if (request.method === 'POST' && url.pathname === '/api/admin/fantasposi/game/finish') {
      return transitionGameState(env, wedding, 'finish');
    }
    if (request.method === 'POST' && url.pathname === '/api/admin/fantasposi/game/reset') {
      return resetGameResponse(request, env, wedding);
    }
    if (request.method === 'GET' && url.pathname === '/api/admin/fantasposi/phases') {
      return json({ phases: (await listPhases(env, wedding.id)).map(serializePhase) });
    }
    const phaseMatch = url.pathname.match(/^\/api\/admin\/fantasposi\/phases\/(\d+)$/);
    if ((request.method === 'PATCH' || request.method === 'PUT') && phaseMatch) {
      const phaseId = Number(phaseMatch[1]);
      if (!Number.isSafeInteger(phaseId) || phaseId <= 0) return json({ error: 'Invalid phase ID' }, 400);
      const body = await request.json() as Record<string, unknown>;
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      const sortOrder = Number(body.sortOrder);
      const status = body.status;
      if (
        name.length < 2 || name.length > 100
        || !Number.isSafeInteger(sortOrder) || sortOrder < 0 || sortOrder > 100_000
        || (status !== 'locked' && status !== 'active' && status !== 'completed')
      ) return json({ error: 'Invalid phase data' }, 400);

      const updated = await env.DB.prepare(
        `WITH target AS MATERIALIZED (
           SELECT id
           FROM fantasposi_phases
           WHERE id = ? AND wedding_id = ?
         ),
         closed_previous AS (
           UPDATE fantasposi_phases
           SET status = 'completed', updated_at = CURRENT_TIMESTAMP
           WHERE wedding_id = ?
             AND status = 'active'
             AND id <> (SELECT id FROM target)
             AND ? = 'active'
             AND EXISTS (SELECT 1 FROM target)
           RETURNING id
         ),
         updated AS (
           UPDATE fantasposi_phases phase
           SET name = ?, sort_order = ?, status = ?, updated_at = CURRENT_TIMESTAMP
           FROM target
           WHERE phase.id = target.id AND phase.wedding_id = ?
             AND (SELECT COUNT(*) FROM closed_previous) >= 0
           RETURNING phase.id, phase.code, phase.name, phase.sort_order,
                     phase.starts_at, phase.ends_at, phase.status
         )
         SELECT updated.*, 0::integer AS mission_count FROM updated`,
      ).bind(phaseId, wedding.id, wedding.id, status, name, sortOrder, status, wedding.id)
        .first<AdminPhaseRow>();
      return updated ? json({ phase: serializePhase(updated) }) : json({ error: 'Phase not found' }, 404);
    }

    if (request.method === 'GET' && url.pathname === '/api/admin/fantasposi/missions') {
      return json({ missions: (await listMissions(env, wedding.id)).map(serializeMission) });
    }
    if (request.method === 'POST' && url.pathname === '/api/admin/fantasposi/missions') {
      const parsed = parseMissionInput(await request.json());
      if (!parsed.value) {
        console.warn('Invalid admin mission input', { invalidField: parsed.invalidField });
        return json({ error: `Invalid mission data: ${parsed.invalidField}` }, 400);
      }
      const input = parsed.value;
      const created = await env.DB.prepare(
        `INSERT INTO fantasposi_missions (
           wedding_id, phase_id, code, title, description,
           mission_type, points, active, sort_order, opens_at, closes_at
         )
         SELECT ?, phase.id, ?, ?, ?, ?, ?, ?, ?, ?, ?
         FROM fantasposi_phases phase
         WHERE phase.id = ? AND phase.wedding_id = ?
         RETURNING id`,
      ).bind(
        wedding.id, input.code, input.title, input.description, input.missionType,
        input.points, input.active, input.sortOrder, input.opensAt, input.closesAt,
        input.phaseId, wedding.id,
      ).first<{ id: number }>();
      if (!created) return json({ error: 'Phase not found' }, 400);
      const mission = (await listMissions(env, wedding.id)).find((entry) => entry.id === created.id);
      return mission ? json({ mission: serializeMission(mission) }, 201) : json({ error: 'Mission creation failed' }, 500);
    }

    const missionMatch = url.pathname.match(/^\/api\/admin\/fantasposi\/missions\/(\d+)$/);
    if ((request.method === 'PATCH' || request.method === 'PUT') && missionMatch) {
      const missionId = Number(missionMatch[1]);
      if (!Number.isSafeInteger(missionId) || missionId <= 0) return json({ error: 'Invalid mission ID' }, 400);
      const parsed = parseMissionInput(await request.json());
      if (!parsed.value) {
        console.warn('Invalid admin mission input', { invalidField: parsed.invalidField });
        return json({ error: `Invalid mission data: ${parsed.invalidField}` }, 400);
      }
      const input = parsed.value;
      const updated = await env.DB.prepare(
        `UPDATE fantasposi_missions mission
         SET phase_id = phase.id,
             code = ?, title = ?, description = ?, mission_type = ?, points = ?,
             active = ?, sort_order = ?, opens_at = ?, closes_at = ?,
             updated_at = CURRENT_TIMESTAMP
         FROM fantasposi_phases phase
         WHERE mission.id = ?
           AND mission.wedding_id = ?
           AND phase.id = ?
           AND phase.wedding_id = mission.wedding_id
         RETURNING mission.id`,
      ).bind(
        input.code, input.title, input.description, input.missionType, input.points,
        input.active, input.sortOrder, input.opensAt, input.closesAt,
        missionId, wedding.id, input.phaseId,
      ).first<{ id: number }>();
      if (!updated) return json({ error: 'Mission or phase not found' }, 404);
      const mission = (await listMissions(env, wedding.id)).find((entry) => entry.id === updated.id);
      return mission ? json({ mission: serializeMission(mission) }) : json({ error: 'Mission update failed' }, 500);
    }
    if (request.method === 'DELETE' && missionMatch) {
      const missionId = Number(missionMatch[1]);
      if (!Number.isSafeInteger(missionId) || missionId <= 0) return json({ error: 'Invalid mission ID' }, 400);
      const deleted = await env.DB.prepare(
        `DELETE FROM fantasposi_missions mission
         WHERE mission.id = ? AND mission.wedding_id = ?
           AND NOT EXISTS (
             SELECT 1 FROM fantasposi_player_missions completion
             WHERE completion.mission_id = mission.id
               AND completion.wedding_id = mission.wedding_id
           )
         RETURNING mission.id`,
      ).bind(missionId, wedding.id).first<{ id: number }>();
      if (deleted) return json({ deletedId: deleted.id });
      const existing = await env.DB.prepare(
        'SELECT id FROM fantasposi_missions WHERE id = ? AND wedding_id = ? LIMIT 1',
      ).bind(missionId, wedding.id).first<{ id: number }>();
      return existing
        ? json({ error: 'Mission has completions and cannot be deleted; deactivate it instead' }, 409)
        : json({ error: 'Mission not found' }, 404);
    }

    if (request.method === 'GET' && url.pathname === '/api/admin/fantasposi/predictions') {
      return json({ predictions: await listPredictions(env, wedding.id) });
    }
    if (request.method === 'POST' && url.pathname === '/api/admin/fantasposi/predictions') {
      const input = parsePredictionInput(await request.json());
      if (!input) return json({ error: 'Invalid prediction data' }, 400);
      const created = await env.DB.prepare(
        `WITH created AS (
           INSERT INTO fantasposi_predictions (
             wedding_id, phase_id, code, question, description, prediction_type,
             points, status, active, sort_order, opens_at, closes_at
           )
           SELECT ?, ?, ?, ?, ?, 'choice', ?, 'draft', true, ?, ?, ?
           WHERE ?::bigint IS NULL OR EXISTS (
             SELECT 1 FROM fantasposi_phases WHERE id = ? AND wedding_id = ?
           )
           RETURNING id, wedding_id
         ), options AS (
           INSERT INTO fantasposi_prediction_options (
             wedding_id, prediction_id, code, label, sort_order
           )
           SELECT created.wedding_id, created.id, option.code, option.label, option.sort_order
           FROM created
           CROSS JOIN jsonb_to_recordset(?::jsonb)
             AS option(code text, label text, sort_order integer)
           RETURNING prediction_id
         )
         SELECT created.id FROM created
         WHERE (SELECT COUNT(*) FROM options) > 0`,
      ).bind(
        wedding.id, input.phaseId, input.code, input.question, input.description,
        input.points, input.sortOrder, input.opensAt, input.closesAt,
        input.phaseId, input.phaseId, wedding.id, JSON.stringify(input.options.map((option) => ({
          code: option.code, label: option.label, sort_order: option.sortOrder,
        }))),
      ).first<{ id: number }>();
      if (!created) return json({ error: 'Prediction phase not found' }, 400);
      const prediction = (await listPredictions(env, wedding.id)).find((entry) => entry.id === created.id);
      return prediction ? json({ prediction }, 201) : json({ error: 'Prediction creation failed' }, 500);
    }

    const predictionMatch = url.pathname.match(/^\/api\/admin\/fantasposi\/predictions\/(\d+)$/);
    if ((request.method === 'PATCH' || request.method === 'PUT') && predictionMatch) {
      const predictionId = Number(predictionMatch[1]);
      if (!Number.isSafeInteger(predictionId) || predictionId <= 0) return json({ error: 'Invalid prediction ID' }, 400);
      const input = parsePredictionInput(await request.json());
      if (!input) return json({ error: 'Invalid prediction data' }, 400);
      const updated = await env.DB.prepare(
        `WITH target AS MATERIALIZED (
           SELECT prediction.id, prediction.wedding_id
           FROM fantasposi_predictions prediction
           WHERE prediction.id = ? AND prediction.wedding_id = ?
             AND prediction.status <> 'resolved'
             AND NOT EXISTS (
               SELECT 1 FROM fantasposi_player_predictions response
               WHERE response.prediction_id = prediction.id
                 AND response.wedding_id = prediction.wedding_id
             )
             AND (?::bigint IS NULL OR EXISTS (
               SELECT 1 FROM fantasposi_phases phase
               WHERE phase.id = ? AND phase.wedding_id = prediction.wedding_id
             ))
           FOR UPDATE OF prediction
         ), updated AS (
           UPDATE fantasposi_predictions prediction
           SET phase_id = ?, code = ?, question = ?, description = ?, points = ?,
               sort_order = ?, opens_at = ?, closes_at = ?, updated_at = CURRENT_TIMESTAMP
           FROM target
           WHERE prediction.id = target.id AND prediction.wedding_id = target.wedding_id
           RETURNING prediction.id, prediction.wedding_id
         ), deleted AS (
           DELETE FROM fantasposi_prediction_options option
           USING updated
           WHERE option.prediction_id = updated.id AND option.wedding_id = updated.wedding_id
           RETURNING option.id
         ), inserted AS (
           INSERT INTO fantasposi_prediction_options (
             wedding_id, prediction_id, code, label, sort_order
           )
           SELECT updated.wedding_id, updated.id, option.code, option.label, option.sort_order
           FROM updated
           CROSS JOIN jsonb_to_recordset(?::jsonb)
             AS option(code text, label text, sort_order integer)
           WHERE (SELECT COUNT(*) FROM deleted) >= 0
           RETURNING prediction_id
         )
         SELECT updated.id FROM updated
         WHERE (SELECT COUNT(*) FROM inserted) > 0`,
      ).bind(
        predictionId, wedding.id, input.phaseId, input.phaseId,
        input.phaseId, input.code, input.question, input.description, input.points,
        input.sortOrder, input.opensAt, input.closesAt,
        JSON.stringify(input.options.map((option) => ({
          code: option.code, label: option.label, sort_order: option.sortOrder,
        }))),
      ).first<{ id: number }>();
      if (!updated) {
        const existing = await env.DB.prepare(
          `SELECT prediction.status,
                  EXISTS (SELECT 1 FROM fantasposi_player_predictions response
                    WHERE response.prediction_id = prediction.id
                      AND response.wedding_id = prediction.wedding_id) AS has_responses
           FROM fantasposi_predictions prediction
           WHERE prediction.id = ? AND prediction.wedding_id = ? LIMIT 1`,
        ).bind(predictionId, wedding.id).first<{ status: string; has_responses: boolean }>();
        if (!existing) return json({ error: 'Prediction not found' }, 404);
        return json({ error: existing.has_responses
          ? 'Prediction has responses and its structure can no longer be changed'
          : 'Resolved prediction cannot be changed' }, 409);
      }
      const prediction = (await listPredictions(env, wedding.id)).find((entry) => entry.id === updated.id);
      return prediction ? json({ prediction }) : json({ error: 'Prediction update failed' }, 500);
    }
    if (request.method === 'DELETE' && predictionMatch) {
      const predictionId = Number(predictionMatch[1]);
      if (!Number.isSafeInteger(predictionId) || predictionId <= 0) return json({ error: 'Invalid prediction ID' }, 400);
      const deleted = await env.DB.prepare(
        `DELETE FROM fantasposi_predictions prediction
         WHERE prediction.id = ? AND prediction.wedding_id = ?
           AND NOT EXISTS (
             SELECT 1 FROM fantasposi_player_predictions response
             WHERE response.prediction_id = prediction.id
               AND response.wedding_id = prediction.wedding_id
           )
         RETURNING prediction.id`,
      ).bind(predictionId, wedding.id).first<{ id: number }>();
      if (deleted) return json({ deletedId: deleted.id });
      const existing = await env.DB.prepare(
        'SELECT id FROM fantasposi_predictions WHERE id = ? AND wedding_id = ? LIMIT 1',
      ).bind(predictionId, wedding.id).first<{ id: number }>();
      return existing
        ? json({ error: 'Prediction has responses and cannot be deleted; close it instead' }, 409)
        : json({ error: 'Prediction not found' }, 404);
    }

    const actionMatch = url.pathname.match(/^\/api\/admin\/fantasposi\/predictions\/(\d+)\/(open|close|resolve)$/);
    if (request.method === 'POST' && actionMatch) {
      const predictionId = Number(actionMatch[1]);
      const action = actionMatch[2];
      if (!Number.isSafeInteger(predictionId) || predictionId <= 0) return json({ error: 'Invalid prediction ID' }, 400);
      if (action === 'open' || action === 'close') {
        const desired = action === 'open' ? 'open' : 'closed';
        const allowed = action === 'open' ? ['draft', 'closed'] : ['open'];
        const changed = await env.DB.prepare(
          `UPDATE fantasposi_predictions
           SET status = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND wedding_id = ? AND status = ANY(?::text[])
           RETURNING id, status`,
        ).bind(desired, predictionId, wedding.id, `{${allowed.join(',')}}`)
          .first<{ id: number; status: PredictionStatus }>();
        if (changed) return json({ predictionId: changed.id, status: changed.status, unchanged: false });
        const existing = await env.DB.prepare(
          'SELECT status FROM fantasposi_predictions WHERE id = ? AND wedding_id = ? LIMIT 1',
        ).bind(predictionId, wedding.id).first<{ status: PredictionStatus }>();
        if (!existing) return json({ error: 'Prediction not found' }, 404);
        if (existing.status === desired) return json({ predictionId, status: desired, unchanged: true });
        return json({ error: `Prediction cannot transition from ${existing.status} to ${desired}` }, 409);
      }

      const body = await request.json() as Record<string, unknown>;
      const correctOptionId = Number(body.correctOptionId);
      if (!Number.isSafeInteger(correctOptionId) || correctOptionId <= 0) {
        return json({ error: 'Invalid correct option ID' }, 400);
      }
      const resolved = await env.DB.prepare(
        `WITH target AS MATERIALIZED (
           SELECT prediction.id, prediction.wedding_id, prediction.points, option.id AS option_id
           FROM fantasposi_predictions prediction
           INNER JOIN fantasposi_prediction_options option
             ON option.prediction_id = prediction.id AND option.wedding_id = prediction.wedding_id
           WHERE prediction.id = ? AND prediction.wedding_id = ?
             AND (
               prediction.status = 'closed'
               OR (prediction.status = 'open' AND prediction.closes_at IS NOT NULL
                 AND prediction.closes_at <= CURRENT_TIMESTAMP)
             )
             AND option.id = ?
           FOR UPDATE OF prediction
         ), resolved AS (
           UPDATE fantasposi_predictions prediction
           SET status = 'resolved', correct_option_id = target.option_id,
               updated_at = CURRENT_TIMESTAMP
           FROM target
           WHERE prediction.id = target.id AND prediction.wedding_id = target.wedding_id
           RETURNING prediction.id, prediction.wedding_id,
                     prediction.correct_option_id, target.points
         ), scored AS (
           UPDATE fantasposi_player_predictions response
           SET status = 'scored',
               points_awarded = CASE
                 WHEN response.selected_option_id = resolved.correct_option_id
                   THEN resolved.points ELSE 0 END,
               resolved_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
           FROM resolved
           WHERE response.prediction_id = resolved.id
             AND response.wedding_id = resolved.wedding_id
           RETURNING response.id
         )
         SELECT resolved.id, resolved.correct_option_id,
                (SELECT COUNT(*) FROM scored)::integer AS scored_count
         FROM resolved`,
      ).bind(predictionId, wedding.id, correctOptionId)
        .first<{ id: number; correct_option_id: number; scored_count: number }>();
      if (resolved) return json({
        predictionId: resolved.id, status: 'resolved',
        correctOptionId: resolved.correct_option_id, scoredCount: resolved.scored_count,
        unchanged: false,
      });
      const existing = await env.DB.prepare(
        `SELECT status, correct_option_id,
                EXISTS (SELECT 1 FROM fantasposi_prediction_options option
                  WHERE option.id = ? AND option.prediction_id = prediction.id
                    AND option.wedding_id = prediction.wedding_id) AS option_exists
         FROM fantasposi_predictions prediction
         WHERE prediction.id = ? AND prediction.wedding_id = ? LIMIT 1`,
      ).bind(correctOptionId, predictionId, wedding.id)
        .first<{ status: PredictionStatus; correct_option_id: number | null; option_exists: boolean }>();
      if (!existing) return json({ error: 'Prediction not found' }, 404);
      if (!existing.option_exists) return json({ error: 'Correct option does not belong to prediction' }, 400);
      if (existing.status === 'resolved' && existing.correct_option_id === correctOptionId) {
        return json({ predictionId, status: 'resolved', correctOptionId, unchanged: true });
      }
      if (existing.status === 'resolved') {
        return json({ error: 'Resolved prediction cannot be resolved with a different option' }, 409);
      }
      return json({ error: 'Prediction must be effectively closed before resolution' }, 409);
    }

    return json({ error: 'Admin FantaSposi endpoint not found' }, 404);
  } catch (error) {
    if ((error as { code?: string })?.code === '23505') {
      return json({ error: 'A phase, mission, prediction, or option with these unique values already exists' }, 409);
    }
    if (error instanceof SyntaxError) return json({ error: 'Invalid JSON body' }, 400);
    console.error('Admin FantaSposi API failed', error);
    return json({ error: 'Admin FantaSposi service unavailable' }, 500);
  }
}
