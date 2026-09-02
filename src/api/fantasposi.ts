import type { Database } from '../lib/supabase-db';
import type { WeddingResolution } from '../lib/wedding-resolver';
import {
  fantasposiMutationBlock,
  isOwnedPlayerAvatarMedia,
  isPhotoProofOriginalKey,
  missionRequiresPhotoProof,
  parsePhotoProofCreateInput,
  parseAvatarCreateInput,
  parsePhotoProofMediaId,
  parsePositiveInteger,
  photoProofPrefix,
  playerAvatarPrefix,
  selectHomeMissionRecommendations,
  type FantasposiGameState,
} from '../lib/fantasposi-domain';
import {
  FANTASPOSI_AVATAR_SOURCE,
  FANTASPOSI_PROOF_SOURCE,
  MEDIA_TYPES,
  isSupportedImageMimeType,
} from '../lib/media-types';

type FantasposiEnv = {
  DB: Database;
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  MEDIA_BUCKET: R2Bucket;
  WEDDING_CONTEXT?: Promise<WeddingResolution>;
};

type FantasposiMediaServices = {
  createPresignedPutUrl: (objectKey: string) => Promise<string>;
  enqueueMediaPreview: (mediaId: number) => Promise<void>;
};

type AuthenticatedUser = {
  id: string;
  email: string | null;
};

type WeddingRow = {
  id: number;
  slug: string;
  bride_name: string;
  groom_name: string;
  wedding_date: string;
  fantasposi_status: FantasposiGameState;
};

type PlayerRow = {
  id: number | null;
  wedding_id: number | null;
  user_id: string;
  display_name: string | null;
  avatar_media_id: number | null;
  avatar_preview_status: string | null;
  team: 'bride' | 'groom' | null;
  onboarding_completed: boolean | null;
  active: boolean | null;
  joined_at: string | null;
};

type PhaseRow = {
  id: number;
  code: string;
  name: string;
  sort_order: number;
  starts_at: string | null;
  ends_at: string | null;
  status: 'locked' | 'active' | 'completed';
};

type MissionRow = {
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
  phase_code: string;
  phase_name: string;
  phase_status: 'locked' | 'active' | 'completed';
  phase_sort_order: number;
  completed_at: string | null;
  points_awarded: number | null;
};

type GameSummaryRow = {
  total_points: number;
  mission_points: number;
  prediction_points: number;
  completed_mission_count: number;
  available_mission_count: number;
};

type CompletionRow = {
  id: number;
  player_id: number;
  mission_id: number;
  status: string;
  completed_at: string;
  points_awarded: number;
  media_id: number | null;
};

type PhotoMissionRow = {
  id: number;
  code: string;
  active: boolean;
  opens_at: string | null;
  closes_at: string | null;
  phase_status: 'locked' | 'active' | 'completed';
  effective_status: 'scheduled' | 'available' | 'expired';
};

type ProofMediaRow = {
  id: number;
  wedding_id: number;
  uploader_user_id: string | null;
  source: string;
  original_key: string;
  mime_type: string;
  size_bytes: number;
  status: string;
  preview_status: string;
  uploaded_at: string | null;
};

type AvatarMediaRow = ProofMediaRow & {
  thumbnail_key: string | null;
};

type LeaderboardRow = {
  player_id: number;
  display_name: string;
  team: 'bride' | 'groom';
  points: number;
  mission_points: number;
  prediction_points: number;
  completed_missions: number;
  team_points: number;
  team_players: number;
  avatar_media_id: number | null;
  avatar_preview_status: string | null;
};

type PredictionRow = {
  id: number;
  code: string;
  question: string;
  description: string | null;
  points: number;
  status: 'open' | 'closed' | 'resolved';
  effective_status: 'scheduled' | 'open' | 'closed' | 'resolved';
  opens_at: string | null;
  closes_at: string | null;
  phase_id: number | null;
  phase_name: string | null;
  phase_status: 'locked' | 'active' | 'completed' | null;
  option_id: number;
  option_code: string;
  option_label: string;
  option_sort_order: number;
  selected_option_id: number | null;
  points_awarded: number | null;
  correct_option_id: number | null;
  can_answer: boolean;
  phase_active: boolean;
};

type AuthResult =
  | { authenticated: true; user: AuthenticatedUser }
  | { authenticated: false; response: Response };

const jsonHeaders = { 'content-type': 'application/json; charset=utf-8' };

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: jsonHeaders });
}

async function authenticate(request: Request, env: FantasposiEnv): Promise<AuthResult> {
  const authorization = request.headers.get('authorization')?.trim() ?? '';
  const token = authorization.toLowerCase().startsWith('bearer ')
    ? authorization.slice(7).trim()
    : '';
  if (!token) {
    return { authenticated: false, response: json({ error: 'Supabase authentication required' }, 401) };
  }

  const supabaseUrl = env.SUPABASE_URL?.trim().replace(/\/$/, '');
  const anonKey = env.SUPABASE_ANON_KEY?.trim();
  if (!supabaseUrl || !anonKey) {
    return { authenticated: false, response: json({ error: 'Authentication is not configured' }, 500) };
  }

  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: { apikey: anonKey, authorization: `Bearer ${token}` },
    });
    if (!response.ok) {
      return { authenticated: false, response: json({ error: 'Invalid or expired Supabase session' }, 401) };
    }
    const payload = await response.json() as { id?: string; email?: string };
    if (!payload.id) {
      return { authenticated: false, response: json({ error: 'Invalid Supabase identity' }, 401) };
    }
    return {
      authenticated: true,
      user: { id: payload.id, email: payload.email?.trim() || null },
    };
  } catch (error) {
    console.warn('FantaSposi Supabase authentication failed', error);
    return { authenticated: false, response: json({ error: 'Authentication unavailable' }, 500) };
  }
}

async function currentWedding(env: FantasposiEnv): Promise<WeddingRow | null> {
  const resolution = await env.WEDDING_CONTEXT;
  return resolution?.resolved ? resolution.wedding : null;
}

function gameMutationResponse(wedding: WeddingRow): Response | null {
  const block = fantasposiMutationBlock(wedding.fantasposi_status);
  return block ? json({ error: block.error, code: block.code }, block.status) : null;
}

async function playerForUser(
  env: FantasposiEnv,
  weddingId: number,
  userId: string,
): Promise<PlayerRow | null> {
  return env.DB.prepare(
    `SELECT fp.id, fp.wedding_id, p.user_id, p.display_name,
            fp.avatar_media_id, avatar.preview_status AS avatar_preview_status,
            fp.team, fp.onboarding_completed, fp.active, fp.joined_at
     FROM profiles p
     LEFT JOIN fantasposi_players fp
       ON fp.user_id = p.user_id AND fp.wedding_id = ?
     LEFT JOIN media avatar
       ON avatar.id = fp.avatar_media_id AND avatar.wedding_id = fp.wedding_id
      AND avatar.source = 'fantasposi_avatar'
     WHERE p.user_id = ?
     LIMIT 1`,
  ).bind(weddingId, userId).first<PlayerRow>();
}

function playerAvatarUrl(player: Pick<PlayerRow, 'avatar_media_id' | 'avatar_preview_status'>): string | null {
  return player.avatar_media_id && player.avatar_preview_status === 'ready'
    ? `/api/fantasposi/avatar/${player.avatar_media_id}`
    : null;
}

function serializeWedding(wedding: WeddingRow) {
  return {
    id: wedding.id,
    slug: wedding.slug,
    brideName: wedding.bride_name,
    groomName: wedding.groom_name,
    weddingDate: wedding.wedding_date,
    teams: {
      bride: `Team ${wedding.bride_name}`,
      groom: `Team ${wedding.groom_name}`,
    },
  };
}

function serializePlayer(player: PlayerRow | null) {
  if (!player?.id || !player.team) return null;
  return {
    id: player.id,
    userId: player.user_id,
    displayName: player.display_name,
    avatarMediaId: player.avatar_media_id,
    avatarUrl: playerAvatarUrl(player),
    team: player.team,
    onboardingCompleted: player.onboarding_completed === true,
    active: player.active === true,
    joinedAt: player.joined_at,
    points: 0,
  };
}

function serializeMission(mission: MissionRow) {
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
    effectiveStatus: mission.completed_at ? 'completed' : mission.effective_status,
    phase: {
      id: mission.phase_id,
      code: mission.phase_code,
      name: mission.phase_name,
      status: mission.phase_status,
      sortOrder: mission.phase_sort_order,
    },
    completed: Boolean(mission.completed_at),
    completedAt: mission.completed_at,
    pointsAwarded: mission.points_awarded,
  };
}

async function activePlayer(
  env: FantasposiEnv,
  weddingId: number,
  userId: string,
): Promise<PlayerRow | null> {
  const player = await playerForUser(env, weddingId, userId);
  return player?.id && player.active && player.onboarding_completed ? player : null;
}

async function missionsForPlayer(
  env: FantasposiEnv,
  weddingId: number,
  playerId: number,
): Promise<MissionRow[]> {
  const result = await env.DB.prepare(
    `SELECT mission.id, mission.code, mission.title, mission.description,
            mission.mission_type, mission.points, mission.active, mission.sort_order,
            mission.opens_at, mission.closes_at,
            CASE
              WHEN mission.active = false THEN 'inactive'
              WHEN mission.opens_at IS NOT NULL AND CURRENT_TIMESTAMP < mission.opens_at THEN 'scheduled'
              WHEN mission.closes_at IS NOT NULL AND CURRENT_TIMESTAMP >= mission.closes_at THEN 'expired'
              ELSE 'available'
            END AS effective_status,
            phase.id AS phase_id, phase.code AS phase_code, phase.name AS phase_name,
            phase.status AS phase_status, phase.sort_order AS phase_sort_order,
            completion.completed_at, completion.points_awarded
     FROM fantasposi_missions mission
     INNER JOIN fantasposi_phases phase
       ON phase.id = mission.phase_id AND phase.wedding_id = mission.wedding_id
     LEFT JOIN fantasposi_player_missions completion
       ON completion.mission_id = mission.id
      AND completion.player_id = ?
      AND completion.wedding_id = mission.wedding_id
      AND completion.status = 'completed'
     WHERE mission.wedding_id = ?
       AND mission.active = true
       AND mission.mission_type IN ('action', 'social', 'photo')
       AND phase.status = 'active'
     ORDER BY phase.sort_order, phase.id, mission.sort_order, mission.id`,
  ).bind(playerId, weddingId).all<MissionRow>();
  return result.results;
}

async function gameSummary(
  env: FantasposiEnv,
  weddingId: number,
  playerId: number,
): Promise<GameSummaryRow> {
  return (await env.DB.prepare(
    `WITH mission_summary AS (
       SELECT COALESCE(SUM(completion.points_awarded)
                FILTER (WHERE completion.status = 'completed'), 0)::integer AS mission_points,
              COUNT(completion.id)
                FILTER (WHERE completion.status = 'completed')::integer AS completed_mission_count,
              COUNT(mission.id)
                FILTER (WHERE mission.active = true
                  AND phase.status = 'active'
                  AND (mission.opens_at IS NULL OR mission.opens_at <= CURRENT_TIMESTAMP)
                  AND (mission.closes_at IS NULL OR mission.closes_at > CURRENT_TIMESTAMP)
                  AND completion.id IS NULL)::integer AS available_mission_count
       FROM fantasposi_missions mission
       INNER JOIN fantasposi_phases phase
         ON phase.id = mission.phase_id AND phase.wedding_id = mission.wedding_id
       LEFT JOIN fantasposi_player_missions completion
         ON completion.mission_id = mission.id
        AND completion.player_id = ?
        AND completion.wedding_id = mission.wedding_id
        AND completion.status = 'completed'
       WHERE mission.wedding_id = ?
         AND mission.mission_type IN ('action', 'social', 'photo')
     ), prediction_summary AS (
       SELECT COALESCE(SUM(points_awarded)
                FILTER (WHERE status = 'scored'), 0)::integer AS prediction_points
       FROM fantasposi_player_predictions
       WHERE wedding_id = ? AND player_id = ?
     )
     SELECT mission_points, prediction_points,
            (mission_points + prediction_points)::integer AS total_points,
            completed_mission_count, available_mission_count
     FROM mission_summary CROSS JOIN prediction_summary`,
  ).bind(playerId, weddingId, weddingId, playerId).first<GameSummaryRow>()) ?? {
    total_points: 0,
    mission_points: 0,
    prediction_points: 0,
    completed_mission_count: 0,
    available_mission_count: 0,
  };
}

function serializePredictions(rows: PredictionRow[]) {
  const predictions = new Map<number, {
    id: number; code: string; question: string; description: string | null; points: number;
    status: PredictionRow['status']; effectiveStatus: PredictionRow['effective_status'];
    opensAt: string | null; closesAt: string | null;
    phase: { id: number; name: string } | null; options: { id: number; code: string; label: string }[];
    selectedOptionId: number | null; answered: boolean; canAnswer: boolean;
    phaseActive: boolean;
    correctOptionId?: number; pointsAwarded: number | null;
  }>();
  for (const row of rows) {
    const item = predictions.get(row.id) ?? {
      id: row.id, code: row.code, question: row.question, description: row.description,
      points: row.points, status: row.status, effectiveStatus: row.effective_status,
      opensAt: row.opens_at, closesAt: row.closes_at,
      phase: row.phase_id && row.phase_name ? { id: row.phase_id, name: row.phase_name } : null,
      options: [], selectedOptionId: row.selected_option_id,
      answered: row.selected_option_id !== null, canAnswer: row.can_answer,
      phaseActive: row.phase_active,
      pointsAwarded: row.points_awarded,
      ...(row.status === 'resolved' && row.correct_option_id
        ? { correctOptionId: row.correct_option_id } : {}),
    };
    item.options.push({ id: row.option_id, code: row.option_code, label: row.option_label });
    predictions.set(row.id, item);
  }
  return [...predictions.values()];
}

async function predictionRows(
  env: FantasposiEnv,
  weddingId: number,
  playerId: number,
): Promise<PredictionRow[]> {
  const result = await env.DB.prepare(
    `SELECT prediction.id, prediction.code, prediction.question, prediction.description,
            prediction.points, prediction.status,
            CASE
              WHEN prediction.status = 'resolved' THEN 'resolved'
              WHEN prediction.status = 'closed' THEN 'closed'
              WHEN prediction.opens_at IS NOT NULL AND CURRENT_TIMESTAMP < prediction.opens_at THEN 'scheduled'
              WHEN prediction.closes_at IS NOT NULL AND CURRENT_TIMESTAMP >= prediction.closes_at THEN 'closed'
              ELSE 'open'
            END AS effective_status,
            prediction.opens_at, prediction.closes_at,
            prediction.phase_id, phase.name AS phase_name, phase.status AS phase_status,
            option.id AS option_id, option.code AS option_code, option.label AS option_label,
            option.sort_order AS option_sort_order,
            answer.selected_option_id, answer.points_awarded,
            CASE WHEN prediction.status = 'resolved' THEN prediction.correct_option_id END AS correct_option_id,
            (prediction.status = 'open'
              AND (prediction.opens_at IS NULL OR prediction.opens_at <= CURRENT_TIMESTAMP)
              AND (prediction.closes_at IS NULL OR prediction.closes_at > CURRENT_TIMESTAMP)
              AND (prediction.phase_id IS NULL OR phase.status = 'active')) AS can_answer
            ,(prediction.phase_id IS NULL OR phase.status = 'active') AS phase_active
     FROM fantasposi_predictions prediction
     INNER JOIN fantasposi_prediction_options option
       ON option.prediction_id = prediction.id AND option.wedding_id = prediction.wedding_id
     LEFT JOIN fantasposi_phases phase
       ON phase.id = prediction.phase_id AND phase.wedding_id = prediction.wedding_id
     LEFT JOIN fantasposi_player_predictions answer
       ON answer.prediction_id = prediction.id
      AND answer.player_id = ?
      AND answer.wedding_id = prediction.wedding_id
     WHERE prediction.wedding_id = ?
       AND prediction.active = true
       AND prediction.status <> 'draft'
       AND (prediction.phase_id IS NULL OR phase.status IN ('active', 'completed'))
     ORDER BY prediction.sort_order, prediction.id, option.sort_order, option.id`,
  ).bind(playerId, weddingId).all<PredictionRow>();
  return result.results;
}

async function predictionsResponse(request: Request, env: FantasposiEnv): Promise<Response> {
  const resolved = await context(request, env);
  if (!resolved.ok) return resolved.response;
  const player = await activePlayer(env, resolved.wedding.id, resolved.user.id);
  if (!player?.id) return json({ error: 'Active FantaSposi player required' }, 403);
  return json({ predictions: serializePredictions(await predictionRows(env, resolved.wedding.id, player.id)) });
}

async function answerPredictionResponse(
  request: Request,
  env: FantasposiEnv,
  predictionId: number,
): Promise<Response> {
  const resolved = await context(request, env);
  if (!resolved.ok) return resolved.response;
  const gameBlock = gameMutationResponse(resolved.wedding);
  if (gameBlock) return gameBlock;
  const player = await activePlayer(env, resolved.wedding.id, resolved.user.id);
  if (!player?.id) return json({ error: 'Active FantaSposi player required' }, 403);
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return json({ error: 'JSON body must be an object' }, 400);
  }
  const optionId = parsePositiveInteger((input as Record<string, unknown>).optionId);
  if (optionId === null) return json({ error: 'Invalid option ID' }, 400);

  const answer = await env.DB.prepare(
    `WITH target AS MATERIALIZED (
       SELECT prediction.id AS prediction_id, prediction.wedding_id, option.id AS option_id
       FROM fantasposi_predictions prediction
       INNER JOIN fantasposi_prediction_options option
         ON option.prediction_id = prediction.id AND option.wedding_id = prediction.wedding_id
       LEFT JOIN fantasposi_phases phase
         ON phase.id = prediction.phase_id AND phase.wedding_id = prediction.wedding_id
       WHERE prediction.id = ? AND prediction.wedding_id = ? AND option.id = ?
         AND EXISTS (
           SELECT 1 FROM weddings wedding
           WHERE wedding.id = prediction.wedding_id AND wedding.fantasposi_status = 'active'
         )
         AND prediction.active = true AND prediction.status = 'open'
         AND (prediction.opens_at IS NULL OR prediction.opens_at <= CURRENT_TIMESTAMP)
         AND (prediction.closes_at IS NULL OR prediction.closes_at > CURRENT_TIMESTAMP)
         AND (prediction.phase_id IS NULL OR phase.status = 'active')
       FOR UPDATE OF prediction
     )
     INSERT INTO fantasposi_player_predictions (
       wedding_id, player_id, prediction_id, answer, status,
       selected_option_id, answered_at, submitted_at, updated_at
     )
     SELECT wedding_id, ?, prediction_id, jsonb_build_object('optionId', option_id),
            'submitted', option_id, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
     FROM target
     ON CONFLICT (player_id, prediction_id) DO UPDATE
     SET selected_option_id = EXCLUDED.selected_option_id,
         answer = EXCLUDED.answer,
         status = 'submitted', points_awarded = NULL, resolved_at = NULL,
         answered_at = CURRENT_TIMESTAMP, submitted_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     RETURNING prediction_id, selected_option_id, answered_at`,
  ).bind(predictionId, resolved.wedding.id, optionId, player.id)
    .first<{ prediction_id: number; selected_option_id: number; answered_at: string }>();
  if (!answer) {
    const exists = await env.DB.prepare(
      `SELECT prediction.status,
              CASE
                WHEN prediction.status = 'resolved' THEN 'resolved'
                WHEN prediction.status = 'closed' THEN 'closed'
                WHEN prediction.opens_at IS NOT NULL AND CURRENT_TIMESTAMP < prediction.opens_at THEN 'scheduled'
                WHEN prediction.closes_at IS NOT NULL AND CURRENT_TIMESTAMP >= prediction.closes_at THEN 'closed'
                ELSE 'open'
              END AS effective_status,
              EXISTS (
                SELECT 1 FROM fantasposi_prediction_options option
                WHERE option.id = ? AND option.prediction_id = prediction.id
                  AND option.wedding_id = prediction.wedding_id
              ) AS option_exists
       FROM fantasposi_predictions prediction
       WHERE prediction.id = ? AND prediction.wedding_id = ? LIMIT 1`,
    ).bind(optionId, predictionId, resolved.wedding.id)
      .first<{ status: string; effective_status: string; option_exists: boolean }>();
    if (!exists) return json({ error: 'Prediction not found' }, 404);
    if (!exists.option_exists) return json({ error: 'Selected option does not belong to prediction' }, 400);
    if (exists.effective_status === 'scheduled') {
      return json({ error: 'Il pronostico non è ancora aperto.', code: 'prediction_scheduled' }, 409);
    }
    return json({ error: 'Il pronostico si è appena chiuso.', code: 'prediction_closed' }, 409);
  }
  return json({ predictionId: answer.prediction_id, selectedOptionId: answer.selected_option_id, answeredAt: answer.answered_at });
}

async function context(request: Request, env: FantasposiEnv): Promise<
  | { ok: true; user: AuthenticatedUser; wedding: WeddingRow }
  | { ok: false; response: Response }
> {
  const authentication = await authenticate(request, env);
  if (!authentication.authenticated) return { ok: false, response: authentication.response };
  const wedding = await currentWedding(env);
  if (!wedding) return { ok: false, response: json({ error: 'Configured wedding not found' }, 404) };
  return { ok: true, user: authentication.user, wedding };
}

async function meResponse(request: Request, env: FantasposiEnv): Promise<Response> {
  const resolved = await context(request, env);
  if (!resolved.ok) return resolved.response;
  const player = await playerForUser(env, resolved.wedding.id, resolved.user.id);
  const serializedPlayer = serializePlayer(player);
  return json({
    authenticated: true,
    user: {
      id: resolved.user.id,
      email: resolved.user.email,
      displayName: player?.display_name ?? null,
      avatarUrl: player ? playerAvatarUrl(player) : null,
    },
    wedding: serializeWedding(resolved.wedding),
    membership: serializedPlayer,
    player: serializedPlayer,
    onboardingCompleted: serializedPlayer?.onboardingCompleted ?? false,
    team: serializedPlayer?.team ?? null,
  });
}

async function bootstrapResponse(request: Request, env: FantasposiEnv): Promise<Response> {
  const resolved = await context(request, env);
  if (!resolved.ok) return resolved.response;
  const player = await playerForUser(env, resolved.wedding.id, resolved.user.id);
  const serializedPlayer = serializePlayer(player);
  if (!serializedPlayer) return json({ error: 'FantaSposi onboarding required' }, 409);
  if (!serializedPlayer.active) return json({ error: 'FantaSposi membership is inactive' }, 403);
  if (!serializedPlayer.onboardingCompleted) return json({ error: 'FantaSposi onboarding required' }, 409);

  const phases = await env.DB.prepare(
    `SELECT id, code, name, sort_order, starts_at, ends_at, status
     FROM fantasposi_phases
     WHERE wedding_id = ?
     ORDER BY sort_order, id`,
  ).bind(resolved.wedding.id).all<PhaseRow>();
  const currentPhase = phases.results.find((phase) => phase.status === 'active') ?? null;
  const summary = await gameSummary(env, resolved.wedding.id, serializedPlayer.id);
  const currentMissions = await missionsForPlayer(env, resolved.wedding.id, serializedPlayer.id);
  const recommendedMissions = selectHomeMissionRecommendations(
    currentMissions.map((mission) => ({
      id: mission.id,
      sortOrder: mission.sort_order,
      active: mission.active,
      phaseStatus: mission.phase_status,
      completed: Boolean(mission.completed_at),
      opensAt: mission.opens_at,
      closesAt: mission.closes_at,
      mission,
    })),
    Date.now(),
  ).map((candidate) => candidate.mission);
  const predictions = serializePredictions(await predictionRows(env, resolved.wedding.id, serializedPlayer.id));
  const openPredictions = predictions.filter((prediction) => prediction.canAnswer);
  const teamScores = await env.DB.prepare(
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
  ).bind(resolved.wedding.id, resolved.wedding.id, resolved.wedding.id)
    .all<{ team: 'bride' | 'groom'; points: number }>();

  return json({
    gameState: resolved.wedding.fantasposi_status,
    wedding: serializeWedding(resolved.wedding),
    player: { ...serializedPlayer, points: summary.total_points },
    currentPhase,
    phases: phases.results.map((phase) => ({
      id: phase.id,
      code: phase.code,
      name: phase.name,
      sortOrder: phase.sort_order,
      startsAt: phase.starts_at,
      endsAt: phase.ends_at,
      status: phase.status,
    })),
    featureFlags: {
      missionsLive: true,
      predictionsLive: true,
      leaderboardLive: true,
    },
    totalPoints: summary.total_points,
    missionPoints: summary.mission_points,
    predictionPoints: summary.prediction_points,
    completedMissionCount: summary.completed_mission_count,
    availableMissionCount: summary.available_mission_count,
    recommendedMissions: recommendedMissions.map(serializeMission),
    openPredictionCount: openPredictions.length,
    recommendedPredictions: openPredictions.slice(0, 2).map((prediction) => ({
      id: prediction.id,
      question: prediction.question,
      points: prediction.points,
    })),
    teamPoints: {
      bride: teamScores.results.find((entry) => entry.team === 'bride')?.points ?? 0,
      groom: teamScores.results.find((entry) => entry.team === 'groom')?.points ?? 0,
    },
  });
}

async function missionsResponse(request: Request, env: FantasposiEnv): Promise<Response> {
  const resolved = await context(request, env);
  if (!resolved.ok) return resolved.response;
  const player = await activePlayer(env, resolved.wedding.id, resolved.user.id);
  if (!player?.id) return json({ error: 'Active FantaSposi player required' }, 403);
  const missions = await missionsForPlayer(env, resolved.wedding.id, player.id);
  const phases = new Map<number, {
    phase: { id: number; code: string; name: string; status: string };
    missions: ReturnType<typeof serializeMission>[];
  }>();
  for (const mission of missions) {
    const group = phases.get(mission.phase_id) ?? {
      phase: {
        id: mission.phase_id,
        code: mission.phase_code,
        name: mission.phase_name,
        status: mission.phase_status,
      },
      missions: [],
    };
    group.missions.push(serializeMission(mission));
    phases.set(mission.phase_id, group);
  }
  const summary = await gameSummary(env, resolved.wedding.id, player.id);
  return json({ phases: [...phases.values()], ...{
    totalPoints: summary.total_points,
    completedMissionCount: summary.completed_mission_count,
    availableMissionCount: summary.available_mission_count,
  } });
}

async function leaderboardResponse(request: Request, env: FantasposiEnv): Promise<Response> {
  const resolved = await context(request, env);
  if (!resolved.ok) return resolved.response;
  const currentPlayer = await activePlayer(env, resolved.wedding.id, resolved.user.id);
  if (!currentPlayer?.id || !currentPlayer.team) {
    return json({ error: 'Active FantaSposi player required' }, 403);
  }

  const result = await env.DB.prepare(
    `WITH mission_totals AS (
       SELECT player_id,
              COALESCE(SUM(points_awarded) FILTER (WHERE status = 'completed'), 0)::integer AS points,
              COUNT(id) FILTER (WHERE status = 'completed')::integer AS completed_missions
       FROM fantasposi_player_missions WHERE wedding_id = ? GROUP BY player_id
     ), prediction_totals AS (
       SELECT player_id,
              COALESCE(SUM(points_awarded) FILTER (WHERE status = 'scored'), 0)::integer AS points
       FROM fantasposi_player_predictions WHERE wedding_id = ? GROUP BY player_id
     ), player_totals AS (
       SELECT player.id AS player_id,
              COALESCE(NULLIF(BTRIM(profile.display_name), ''), 'Giocatore') AS display_name,
              player.team, player.avatar_media_id,
              avatar.preview_status AS avatar_preview_status,
              COALESCE(mission.points, 0)::integer AS mission_points,
              COALESCE(prediction.points, 0)::integer AS prediction_points,
              (COALESCE(mission.points, 0) + COALESCE(prediction.points, 0))::integer AS points,
              COALESCE(mission.completed_missions, 0)::integer AS completed_missions
       FROM fantasposi_players player
       LEFT JOIN profiles profile ON profile.user_id = player.user_id
       LEFT JOIN media avatar
         ON avatar.id = player.avatar_media_id AND avatar.wedding_id = player.wedding_id
        AND avatar.source = 'fantasposi_avatar'
       LEFT JOIN mission_totals mission ON mission.player_id = player.id
       LEFT JOIN prediction_totals prediction ON prediction.player_id = player.id
       WHERE player.wedding_id = ?
         AND player.active = true
     )
     SELECT player_id, display_name, team, avatar_media_id, avatar_preview_status,
            mission_points, prediction_points, points, completed_missions,
            SUM(points) OVER (PARTITION BY team)::integer AS team_points,
            COUNT(*) OVER (PARTITION BY team)::integer AS team_players
     FROM player_totals
     ORDER BY points DESC, completed_missions DESC, LOWER(display_name) ASC, player_id ASC`,
  ).bind(resolved.wedding.id, resolved.wedding.id, resolved.wedding.id).all<LeaderboardRow>();

  const players = result.results.map((player, index) => ({
    playerId: player.player_id,
    displayName: player.display_name,
    team: player.team,
    points: player.points,
    missionPoints: player.mission_points,
    predictionPoints: player.prediction_points,
    completedMissions: player.completed_missions,
    rank: index + 1,
    isCurrentUser: player.player_id === currentPlayer.id,
    avatarUrl: player.avatar_media_id && player.avatar_preview_status === 'ready'
      ? `/api/fantasposi/avatar/${player.avatar_media_id}`
      : null,
  }));
  const current = players.find((player) => player.isCurrentUser);
  const brideTeam = result.results.find((player) => player.team === 'bride');
  const groomTeam = result.results.find((player) => player.team === 'groom');

  return json({
    teams: {
      bride: {
        name: resolved.wedding.bride_name,
        points: brideTeam?.team_points ?? 0,
        players: brideTeam?.team_players ?? 0,
      },
      groom: {
        name: resolved.wedding.groom_name,
        points: groomTeam?.team_points ?? 0,
        players: groomTeam?.team_players ?? 0,
      },
    },
    players,
    currentPlayer: current ? {
      playerId: current.playerId,
      rank: current.rank,
      points: current.points,
      missionPoints: current.missionPoints,
      predictionPoints: current.predictionPoints,
      team: current.team,
    } : null,
  });
}

async function photoMissionState(
  env: FantasposiEnv,
  weddingId: number,
  missionId: number,
): Promise<PhotoMissionRow | null> {
  return env.DB.prepare(
    `SELECT mission.id, mission.code, mission.active, mission.opens_at, mission.closes_at,
            phase.status AS phase_status,
            CASE
              WHEN mission.opens_at IS NOT NULL AND CURRENT_TIMESTAMP < mission.opens_at THEN 'scheduled'
              WHEN mission.closes_at IS NOT NULL AND CURRENT_TIMESTAMP >= mission.closes_at THEN 'expired'
              ELSE 'available'
            END AS effective_status
     FROM fantasposi_missions mission
     INNER JOIN fantasposi_phases phase
       ON phase.id = mission.phase_id AND phase.wedding_id = mission.wedding_id
     WHERE mission.id = ? AND mission.wedding_id = ? AND mission.mission_type = 'photo'
     LIMIT 1`,
  ).bind(missionId, weddingId).first<PhotoMissionRow>();
}

function unavailablePhotoMissionResponse(mission: PhotoMissionRow | null): Response | null {
  if (!mission) return json({ error: 'Photo mission not found' }, 404);
  if (mission.effective_status === 'scheduled') {
    return json({ error: 'La missione non è ancora disponibile.', code: 'mission_scheduled' }, 409);
  }
  if (mission.effective_status === 'expired') {
    return json({ error: 'Il tempo per questa missione è scaduto.', code: 'mission_expired' }, 409);
  }
  if (!mission.active || mission.phase_status !== 'active') {
    return json({ error: 'Mission is not currently available' }, 409);
  }
  return null;
}

async function createPhotoProofResponse(
  request: Request,
  env: FantasposiEnv,
  services: FantasposiMediaServices,
  missionId: number,
): Promise<Response> {
  const resolved = await context(request, env);
  if (!resolved.ok) return resolved.response;
  const gameBlock = gameMutationResponse(resolved.wedding);
  if (gameBlock) return gameBlock;
  const player = await activePlayer(env, resolved.wedding.id, resolved.user.id);
  if (!player?.id) return json({ error: 'Active FantaSposi player required' }, 403);

  const mission = await photoMissionState(env, resolved.wedding.id, missionId);
  const unavailable = unavailablePhotoMissionResponse(mission);
  if (unavailable || !mission) return unavailable ?? json({ error: 'Photo mission not found' }, 404);

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  const parsed = parsePhotoProofCreateInput(input);
  if (!parsed.value) {
    const errors = {
      payload: 'JSON body must be an object',
      filename: 'Filename is required',
      mimeType: 'A supported image is required',
      size: 'Size must be a positive integer',
      maxSize: 'Image exceeds the allowed size',
    } as const;
    return json({ error: errors[parsed.invalidField] }, 400);
  }
  const { filename, mimeType, size } = parsed.value;
  const mediaType = MEDIA_TYPES[mimeType];

  const uuid = crypto.randomUUID();
  const originalKey = `${photoProofPrefix(resolved.wedding.slug, mission.code)}${uuid}.${mediaType.extension}`;
  const uploadUrl = await services.createPresignedPutUrl(originalKey);
  const created = await env.DB.prepare(
    `INSERT INTO media (
       uuid, wedding_id, uploader_user_id, source, original_filename, original_key,
       mime_type, size_bytes, status, preview_status
     )
     SELECT ?, ?, ?, ?, ?, ?, ?, ?, 'uploading', 'pending'
     WHERE EXISTS (
       SELECT 1 FROM weddings WHERE id = ? AND fantasposi_status = 'active'
     )
     RETURNING id`,
  ).bind(
    uuid, resolved.wedding.id, resolved.user.id, FANTASPOSI_PROOF_SOURCE,
    filename, originalKey, mimeType, size, resolved.wedding.id,
  ).first<{ id: number }>();
  if (!created) {
    const current = await currentWedding(env);
    const block = current ? gameMutationResponse(current) : null;
    return block ?? json({ error: 'Photo proof could not be created' }, 409);
  }

  return json({
    mediaId: created.id,
    uuid,
    originalKey,
    uploadUrl,
    method: 'PUT',
  }, 201);
}

async function completePhotoProofUploadResponse(
  request: Request,
  env: FantasposiEnv,
  services: FantasposiMediaServices,
  missionId: number,
  mediaId: number,
): Promise<Response> {
  const resolved = await context(request, env);
  if (!resolved.ok) return resolved.response;
  const gameBlock = gameMutationResponse(resolved.wedding);
  if (gameBlock) return gameBlock;
  const player = await activePlayer(env, resolved.wedding.id, resolved.user.id);
  if (!player?.id) return json({ error: 'Active FantaSposi player required' }, 403);

  const mission = await photoMissionState(env, resolved.wedding.id, missionId);
  if (!mission) return json({ error: 'Photo mission not found' }, 404);
  const media = await env.DB.prepare(
    `SELECT id, wedding_id, uploader_user_id, source, original_key, mime_type,
            size_bytes, status, preview_status, uploaded_at
     FROM media
     WHERE id = ? AND wedding_id = ? AND uploader_user_id = ? AND source = ?
     LIMIT 1`,
  ).bind(
    mediaId, resolved.wedding.id, resolved.user.id, FANTASPOSI_PROOF_SOURCE,
  ).first<ProofMediaRow>();
  if (!media
    || !isPhotoProofOriginalKey(media.original_key, resolved.wedding.slug, mission.code)
    || !isSupportedImageMimeType(media.mime_type)) {
    return json({ error: 'Photo proof not found' }, 404);
  }

  const object = await env.MEDIA_BUCKET.head(media.original_key);
  if (!object) return json({ error: 'Uploaded photo not found' }, 409);
  if (object.size !== media.size_bytes) return json({ error: 'Uploaded photo size does not match' }, 409);

  if (media.status === 'uploading') {
    const update = await env.DB.prepare(
      `UPDATE media
       SET status = 'pending', uploaded_at = COALESCE(uploaded_at, CURRENT_TIMESTAMP)
       WHERE id = ? AND wedding_id = ? AND uploader_user_id = ?
          AND source = ? AND status = 'uploading'
          AND EXISTS (
            SELECT 1 FROM weddings wedding
            WHERE wedding.id = media.wedding_id AND wedding.fantasposi_status = 'active'
          )
       RETURNING id, status, uploaded_at`,
    ).bind(
      media.id, resolved.wedding.id, resolved.user.id, FANTASPOSI_PROOF_SOURCE,
    ).first<{ id: number; status: string; uploaded_at: string | null }>();
    if (!update || update.status !== 'pending' || !update.uploaded_at) {
      throw new Error(`Photo proof ${media.id} did not complete`);
    }
  } else if (media.status !== 'pending') {
    return json({ error: 'Photo proof is not uploadable' }, 409);
  }

  if (media.preview_status !== 'ready') await services.enqueueMediaPreview(media.id);
  return json({ mediaId: media.id, status: 'pending' });
}

async function createPlayerAvatarResponse(
  request: Request,
  env: FantasposiEnv,
  services: FantasposiMediaServices,
): Promise<Response> {
  const resolved = await context(request, env);
  if (!resolved.ok) return resolved.response;
  const player = await activePlayer(env, resolved.wedding.id, resolved.user.id);
  if (!player?.id) return json({ error: 'Active FantaSposi player required' }, 403);

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  const parsed = parseAvatarCreateInput(input);
  if (!parsed.value) {
    const errors = {
      payload: 'JSON body must be an object',
      filename: 'Filename is required',
      mimeType: 'Seleziona una foto JPEG, PNG, WebP, HEIC o HEIF.',
      size: 'La foto deve avere una dimensione valida.',
      maxSize: 'La foto profilo non può superare 10 MB.',
    } as const;
    return json({ error: errors[parsed.invalidField] }, 400);
  }

  const { filename, mimeType, size } = parsed.value;
  const uuid = crypto.randomUUID();
  const originalKey = `${playerAvatarPrefix(resolved.wedding.slug, player.id)}${uuid}.${MEDIA_TYPES[mimeType].extension}`;
  const uploadUrl = await services.createPresignedPutUrl(originalKey);
  const created = await env.DB.prepare(
    `INSERT INTO media (
       uuid, wedding_id, uploader_user_id, source, original_filename, original_key,
       mime_type, size_bytes, status, preview_status
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'uploading', 'pending')
     RETURNING id`,
  ).bind(
    uuid, resolved.wedding.id, resolved.user.id, FANTASPOSI_AVATAR_SOURCE,
    filename, originalKey, mimeType, size,
  ).first<{ id: number }>();
  if (!created) throw new Error('Avatar media record was not created');

  return json({ mediaId: created.id, uuid, uploadUrl, method: 'PUT' }, 201);
}

async function completePlayerAvatarResponse(
  request: Request,
  env: FantasposiEnv,
  services: FantasposiMediaServices,
  mediaId: number,
): Promise<Response> {
  const resolved = await context(request, env);
  if (!resolved.ok) return resolved.response;
  const player = await activePlayer(env, resolved.wedding.id, resolved.user.id);
  if (!player?.id) return json({ error: 'Active FantaSposi player required' }, 403);

  const media = await env.DB.prepare(
    `SELECT id, wedding_id, uploader_user_id, source, original_key, mime_type,
            size_bytes, status, preview_status, uploaded_at, thumbnail_key
     FROM media WHERE id = ? AND wedding_id = ? LIMIT 1`,
  ).bind(mediaId, resolved.wedding.id).first<AvatarMediaRow>();
  if (!media || !isOwnedPlayerAvatarMedia({
    weddingId: media.wedding_id,
    uploaderUserId: media.uploader_user_id,
    source: media.source,
    originalKey: media.original_key,
  }, {
    weddingId: resolved.wedding.id,
    userId: resolved.user.id,
    weddingSlug: resolved.wedding.slug,
    playerId: player.id,
  }) || !isSupportedImageMimeType(media.mime_type)) {
    return json({ error: 'Foto profilo non trovata.' }, 404);
  }

  const object = await env.MEDIA_BUCKET.head(media.original_key);
  if (!object) return json({ error: 'La foto caricata non è stata trovata.' }, 409);
  if (object.size !== media.size_bytes) return json({ error: 'La dimensione della foto non corrisponde.' }, 409);

  if (media.status === 'uploading') {
    const completed = await env.DB.prepare(
      `UPDATE media
       SET status = 'pending', uploaded_at = COALESCE(uploaded_at, CURRENT_TIMESTAMP)
       WHERE id = ? AND wedding_id = ? AND uploader_user_id = ?
         AND source = ? AND status = 'uploading'
       RETURNING id, status`,
    ).bind(media.id, resolved.wedding.id, resolved.user.id, FANTASPOSI_AVATAR_SOURCE)
      .first<{ id: number; status: string }>();
    if (!completed || completed.status !== 'pending') {
      throw new Error(`Avatar media ${media.id} did not complete`);
    }
  } else if (media.status !== 'pending') {
    return json({ error: 'La foto profilo non è aggiornabile.' }, 409);
  }

  const assigned = await env.DB.prepare(
    `UPDATE fantasposi_players
     SET avatar_media_id = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND wedding_id = ? AND user_id = ? AND active = true
     RETURNING id, avatar_media_id`,
  ).bind(media.id, player.id, resolved.wedding.id, resolved.user.id)
    .first<{ id: number; avatar_media_id: number | null }>();
  if (!assigned || assigned.avatar_media_id !== media.id) {
    throw new Error(`Player ${player.id} did not receive avatar ${media.id}`);
  }

  if (media.preview_status !== 'ready') await services.enqueueMediaPreview(media.id);
  return json({
    mediaId: media.id,
    previewStatus: media.preview_status,
    avatarUrl: media.preview_status === 'ready' ? `/api/fantasposi/avatar/${media.id}` : null,
  });
}

async function playerAvatarResponse(
  request: Request,
  env: FantasposiEnv,
  mediaId: number,
): Promise<Response> {
  const resolved = await context(request, env);
  if (!resolved.ok) return resolved.response;
  const viewer = await activePlayer(env, resolved.wedding.id, resolved.user.id);
  if (!viewer?.id) return json({ error: 'Active FantaSposi player required' }, 403);

  const media = await env.DB.prepare(
    `SELECT media.thumbnail_key
     FROM media
     INNER JOIN fantasposi_players player
       ON player.avatar_media_id = media.id AND player.wedding_id = media.wedding_id
     WHERE media.id = ? AND media.wedding_id = ? AND media.source = ?
       AND media.preview_status = 'ready' AND player.active = true
     LIMIT 1`,
  ).bind(mediaId, resolved.wedding.id, FANTASPOSI_AVATAR_SOURCE)
    .first<{ thumbnail_key: string | null }>();
  if (!media?.thumbnail_key) return json({ error: 'Foto profilo non disponibile.' }, 404);
  const object = await env.MEDIA_BUCKET.get(media.thumbnail_key);
  if (!object) return json({ error: 'Foto profilo non disponibile.' }, 404);
  return new Response(object.body, {
    headers: {
      'content-type': 'image/webp',
      'content-length': String(object.size),
      'cache-control': 'private, max-age=300',
      ...(object.httpEtag ? { etag: object.httpEtag } : {}),
    },
  });
}

async function completePhotoMissionResponse(
  request: Request,
  env: FantasposiEnv,
  resolved: { user: AuthenticatedUser; wedding: WeddingRow },
  player: PlayerRow & { id: number },
  missionId: number,
): Promise<Response> {
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return json({ error: 'Photo mission requires mediaId' }, 400);
  }
  const mediaId = parsePhotoProofMediaId(input);
  if (mediaId === null) {
    return json({ error: 'Photo mission requires a valid mediaId' }, 400);
  }

  const existing = await env.DB.prepare(
    `SELECT id, player_id, mission_id, status, completed_at, points_awarded, media_id
     FROM fantasposi_player_missions
     WHERE wedding_id = ? AND player_id = ? AND mission_id = ? AND status = 'completed'
     LIMIT 1`,
  ).bind(resolved.wedding.id, player.id, missionId).first<CompletionRow>();
  if (existing) {
    if (existing.media_id !== mediaId) {
      return json({ error: 'Mission already completed with a different photo proof' }, 409);
    }
    return completedMissionPayload(env, resolved.wedding.id, player.id, missionId, existing, true);
  }

  const mission = await photoMissionState(env, resolved.wedding.id, missionId);
  const unavailable = unavailablePhotoMissionResponse(mission);
  if (unavailable || !mission) return unavailable ?? json({ error: 'Photo mission not found' }, 404);
  const expectedPrefix = photoProofPrefix(resolved.wedding.slug, mission.code);
  const media = await env.DB.prepare(
    `SELECT id, wedding_id, uploader_user_id, source, original_key, mime_type,
            size_bytes, status, preview_status, uploaded_at
     FROM media
     WHERE id = ? AND wedding_id = ? AND uploader_user_id = ? AND source = ?
     LIMIT 1`,
  ).bind(
    mediaId, resolved.wedding.id, resolved.user.id, FANTASPOSI_PROOF_SOURCE,
  ).first<ProofMediaRow>();
  if (!media) return json({ error: 'Photo proof not found' }, 404);
  if (!isPhotoProofOriginalKey(media.original_key, resolved.wedding.slug, mission.code)) {
    return json({ error: 'Photo proof does not belong to this mission' }, 409);
  }
  if (!isSupportedImageMimeType(media.mime_type)) return json({ error: 'Photo proof must be an image' }, 409);
  if (media.status !== 'pending' || !media.uploaded_at) return json({ error: 'Photo proof upload is incomplete' }, 409);
  const proofObject = await env.MEDIA_BUCKET.head(media.original_key);
  if (!proofObject) return json({ error: 'Photo proof object not found' }, 409);
  if (proofObject.size !== media.size_bytes) {
    return json({ error: 'Photo proof object size does not match' }, 409);
  }

  let completion = await env.DB.prepare(
    `UPDATE fantasposi_player_missions completion
     SET status = 'completed', completed_at = CURRENT_TIMESTAMP,
         points_awarded = mission.points, media_id = media.id,
         updated_at = CURRENT_TIMESTAMP
     FROM fantasposi_missions mission
     INNER JOIN fantasposi_phases phase
       ON phase.id = mission.phase_id AND phase.wedding_id = mission.wedding_id
     INNER JOIN media
       ON media.id = ? AND media.wedding_id = mission.wedding_id
      AND media.uploader_user_id = ? AND media.source = ?
      AND media.mime_type LIKE 'image/%' AND media.status = 'pending'
      AND media.uploaded_at IS NOT NULL AND media.original_key LIKE ?
     WHERE completion.wedding_id = ? AND completion.player_id = ?
       AND completion.mission_id = mission.id AND completion.mission_id = ?
       AND completion.status <> 'completed'
       AND mission.wedding_id = completion.wedding_id
        AND mission.mission_type = 'photo' AND mission.active = true
        AND EXISTS (
          SELECT 1 FROM weddings wedding
          WHERE wedding.id = mission.wedding_id AND wedding.fantasposi_status = 'active'
        )
       AND phase.status = 'active'
       AND (mission.opens_at IS NULL OR mission.opens_at <= CURRENT_TIMESTAMP)
       AND (mission.closes_at IS NULL OR mission.closes_at > CURRENT_TIMESTAMP)
       AND NOT EXISTS (
         SELECT 1 FROM fantasposi_player_missions used
         WHERE used.media_id = media.id AND used.id <> completion.id
       )
     RETURNING completion.id, completion.player_id, completion.mission_id,
               completion.status, completion.completed_at,
               completion.points_awarded, completion.media_id`,
  ).bind(
    media.id, resolved.user.id, FANTASPOSI_PROOF_SOURCE, `${expectedPrefix}%`,
    resolved.wedding.id, player.id, missionId,
  ).first<CompletionRow>();

  if (!completion) completion = await env.DB.prepare(
    `INSERT INTO fantasposi_player_missions (
       wedding_id, player_id, mission_id, status, completed_at,
       points_awarded, media_id, updated_at
     )
     SELECT mission.wedding_id, ?, mission.id, 'completed', CURRENT_TIMESTAMP,
            mission.points, media.id, CURRENT_TIMESTAMP
     FROM fantasposi_missions mission
     INNER JOIN fantasposi_phases phase
       ON phase.id = mission.phase_id AND phase.wedding_id = mission.wedding_id
     INNER JOIN media
       ON media.id = ? AND media.wedding_id = mission.wedding_id
      AND media.uploader_user_id = ? AND media.source = ?
      AND media.mime_type LIKE 'image/%' AND media.status = 'pending'
      AND media.uploaded_at IS NOT NULL AND media.original_key LIKE ?
      WHERE mission.id = ? AND mission.wedding_id = ?
        AND EXISTS (
          SELECT 1 FROM weddings wedding
          WHERE wedding.id = mission.wedding_id AND wedding.fantasposi_status = 'active'
        )
       AND mission.mission_type = 'photo' AND mission.active = true
       AND phase.status = 'active'
       AND (mission.opens_at IS NULL OR mission.opens_at <= CURRENT_TIMESTAMP)
       AND (mission.closes_at IS NULL OR mission.closes_at > CURRENT_TIMESTAMP)
       AND NOT EXISTS (
         SELECT 1 FROM fantasposi_player_missions used WHERE used.media_id = media.id
       )
     ON CONFLICT DO NOTHING
     RETURNING id, player_id, mission_id, status, completed_at, points_awarded, media_id`,
  ).bind(
    player.id, media.id, resolved.user.id, FANTASPOSI_PROOF_SOURCE,
    `${expectedPrefix}%`, missionId, resolved.wedding.id,
  ).first<CompletionRow>();

  if (!completion) {
    const concurrent = await env.DB.prepare(
      `SELECT id, player_id, mission_id, status, completed_at, points_awarded, media_id
       FROM fantasposi_player_missions
       WHERE wedding_id = ? AND player_id = ? AND mission_id = ? AND status = 'completed'
       LIMIT 1`,
    ).bind(resolved.wedding.id, player.id, missionId).first<CompletionRow>();
    if (concurrent) {
      if (concurrent.media_id !== media.id) {
        return json({ error: 'Mission already completed with a different photo proof' }, 409);
      }
      return completedMissionPayload(
        env, resolved.wedding.id, player.id, missionId, concurrent, true,
      );
    }
    const used = await env.DB.prepare(
      'SELECT id FROM fantasposi_player_missions WHERE media_id = ? LIMIT 1',
    ).bind(media.id).first<{ id: number }>();
    if (used) return json({ error: 'Photo proof has already been used for another mission' }, 409);
    return json({ error: 'Photo mission completion could not be recorded' }, 409);
  }
  return completedMissionPayload(env, resolved.wedding.id, player.id, missionId, completion, false);
}

async function completeMissionResponse(
  request: Request,
  env: FantasposiEnv,
  missionId: number,
): Promise<Response> {
  const resolved = await context(request, env);
  if (!resolved.ok) return resolved.response;
  const gameBlock = gameMutationResponse(resolved.wedding);
  if (gameBlock) return gameBlock;
  const player = await activePlayer(env, resolved.wedding.id, resolved.user.id);
  if (!player?.id) return json({ error: 'Active FantaSposi player required' }, 403);

  const missionType = await env.DB.prepare(
    'SELECT mission_type FROM fantasposi_missions WHERE id = ? AND wedding_id = ? LIMIT 1',
  ).bind(missionId, resolved.wedding.id).first<{ mission_type: string }>();
  if (missionRequiresPhotoProof(missionType?.mission_type ?? '')) {
    return completePhotoMissionResponse(
      request, env, resolved, { ...player, id: player.id }, missionId,
    );
  }

  let completion = await env.DB.prepare(
    `UPDATE fantasposi_player_missions completion
     SET status = 'completed',
         completed_at = CURRENT_TIMESTAMP,
         points_awarded = mission.points,
         updated_at = CURRENT_TIMESTAMP
     FROM fantasposi_missions mission
     INNER JOIN fantasposi_phases phase
       ON phase.id = mission.phase_id AND phase.wedding_id = mission.wedding_id
     WHERE completion.wedding_id = ?
       AND completion.player_id = ?
       AND completion.mission_id = mission.id
       AND completion.mission_id = ?
       AND completion.status <> 'completed'
       AND mission.wedding_id = completion.wedding_id
       AND EXISTS (
         SELECT 1 FROM weddings wedding
         WHERE wedding.id = mission.wedding_id AND wedding.fantasposi_status = 'active'
       )
       AND mission.active = true
       AND phase.status = 'active'
       AND (mission.opens_at IS NULL OR mission.opens_at <= CURRENT_TIMESTAMP)
       AND (mission.closes_at IS NULL OR mission.closes_at > CURRENT_TIMESTAMP)
       AND mission.mission_type IN ('action', 'social')
     RETURNING completion.id, completion.player_id, completion.mission_id,
               completion.status, completion.completed_at, completion.points_awarded,
               completion.media_id`,
  ).bind(resolved.wedding.id, player.id, missionId).first<CompletionRow>();

  if (!completion) {
    completion = await env.DB.prepare(
      `INSERT INTO fantasposi_player_missions (
       wedding_id, player_id, mission_id, status, completed_at, points_awarded, updated_at
       )
       SELECT mission.wedding_id, ?, mission.id, 'completed', CURRENT_TIMESTAMP,
              mission.points, CURRENT_TIMESTAMP
       FROM fantasposi_missions mission
       INNER JOIN fantasposi_phases phase
         ON phase.id = mission.phase_id AND phase.wedding_id = mission.wedding_id
       WHERE mission.id = ?
         AND mission.wedding_id = ?
         AND EXISTS (
           SELECT 1 FROM weddings wedding
           WHERE wedding.id = mission.wedding_id AND wedding.fantasposi_status = 'active'
         )
         AND mission.active = true
         AND phase.status = 'active'
         AND (mission.opens_at IS NULL OR mission.opens_at <= CURRENT_TIMESTAMP)
         AND (mission.closes_at IS NULL OR mission.closes_at > CURRENT_TIMESTAMP)
         AND mission.mission_type IN ('action', 'social')
       ON CONFLICT (player_id, mission_id) DO NOTHING
       RETURNING id, player_id, mission_id, status, completed_at, points_awarded, media_id`,
    ).bind(player.id, missionId, resolved.wedding.id).first<CompletionRow>();
  }

  if (!completion) {
    const existing = await env.DB.prepare(
      `SELECT completion.id, completion.player_id, completion.mission_id,
              completion.status, completion.completed_at, completion.points_awarded,
              completion.media_id
       FROM fantasposi_player_missions completion
       WHERE completion.wedding_id = ?
         AND completion.player_id = ?
         AND completion.mission_id = ?
         AND completion.status = 'completed'
       LIMIT 1`,
    ).bind(resolved.wedding.id, player.id, missionId).first<CompletionRow>();
    if (existing) return completedMissionPayload(env, resolved.wedding.id, player.id, missionId, existing, true);

    const missionState = await env.DB.prepare(
      `SELECT mission.active, mission.mission_type, mission.opens_at, mission.closes_at,
              phase.status AS phase_status,
              CASE
                WHEN mission.opens_at IS NOT NULL AND CURRENT_TIMESTAMP < mission.opens_at THEN 'scheduled'
                WHEN mission.closes_at IS NOT NULL AND CURRENT_TIMESTAMP >= mission.closes_at THEN 'expired'
                ELSE 'available'
              END AS effective_status
       FROM fantasposi_missions mission
       INNER JOIN fantasposi_phases phase
         ON phase.id = mission.phase_id AND phase.wedding_id = mission.wedding_id
       WHERE mission.id = ? AND mission.wedding_id = ? LIMIT 1`,
    ).bind(missionId, resolved.wedding.id).first<{
      active: boolean;
      mission_type: string;
      opens_at: string | null;
      closes_at: string | null;
      phase_status: string;
      effective_status: 'scheduled' | 'available' | 'expired';
    }>();
    if (!missionState) return json({ error: 'Mission not found' }, 404);
    if (missionState.effective_status === 'scheduled') {
      return json({ error: 'La missione non è ancora disponibile.', code: 'mission_scheduled' }, 409);
    }
    if (missionState.effective_status === 'expired') {
      return json({ error: 'Il tempo per questa missione è scaduto.', code: 'mission_expired' }, 409);
    }
    return json({
      error: missionState.active && missionState.phase_status === 'active'
        && (missionState.mission_type === 'action' || missionState.mission_type === 'social')
        ? 'Mission completion could not be recorded'
        : 'Mission is not currently available for manual completion',
    }, 409);
  }

  return completedMissionPayload(env, resolved.wedding.id, player.id, missionId, completion, false);
}

async function completedMissionPayload(
  env: FantasposiEnv,
  weddingId: number,
  playerId: number,
  missionId: number,
  completion: CompletionRow,
  alreadyCompleted: boolean,
): Promise<Response> {
  const mission = await env.DB.prepare(
    `SELECT mission.id, mission.code, mission.title, mission.description,
            mission.mission_type, mission.points, mission.active, mission.sort_order,
            mission.opens_at, mission.closes_at,
            CASE
              WHEN mission.active = false THEN 'inactive'
              WHEN mission.opens_at IS NOT NULL AND CURRENT_TIMESTAMP < mission.opens_at THEN 'scheduled'
              WHEN mission.closes_at IS NOT NULL AND CURRENT_TIMESTAMP >= mission.closes_at THEN 'expired'
              ELSE 'available'
            END AS effective_status,
            phase.id AS phase_id, phase.code AS phase_code, phase.name AS phase_name,
            phase.status AS phase_status, phase.sort_order AS phase_sort_order,
            completion.completed_at, completion.points_awarded
     FROM fantasposi_missions mission
     INNER JOIN fantasposi_phases phase
       ON phase.id = mission.phase_id AND phase.wedding_id = mission.wedding_id
     INNER JOIN fantasposi_player_missions completion
       ON completion.mission_id = mission.id
      AND completion.player_id = ?
      AND completion.wedding_id = mission.wedding_id
     WHERE mission.id = ? AND mission.wedding_id = ?
     LIMIT 1`,
  ).bind(playerId, missionId, weddingId).first<MissionRow>();
  if (!mission) return json({ error: 'Mission not found' }, 404);
  const summary = await gameSummary(env, weddingId, playerId);
  return json({
    mission: serializeMission(mission),
    completion: {
      id: completion.id,
      completedAt: completion.completed_at,
      pointsAwarded: completion.points_awarded,
      mediaId: completion.media_id,
    },
    alreadyCompleted,
    pointsAwarded: completion.points_awarded,
    mediaId: completion.media_id,
    totalPoints: summary.total_points,
  });
}

async function onboardingResponse(request: Request, env: FantasposiEnv): Promise<Response> {
  const resolved = await context(request, env);
  if (!resolved.ok) return resolved.response;

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return json({ error: 'JSON body must be an object' }, 400);
  }
  const body = input as Record<string, unknown>;
  const displayName = typeof body.displayName === 'string' ? body.displayName.trim() : '';
  const team = body.team;
  if (displayName.length < 2 || displayName.length > 60) {
    return json({ error: 'Display name must contain between 2 and 60 characters' }, 400);
  }
  if (team !== 'bride' && team !== 'groom') {
    return json({ error: 'Team must be bride or groom' }, 400);
  }

  const existingPlayer = await playerForUser(env, resolved.wedding.id, resolved.user.id);
  if (resolved.wedding.fantasposi_status === 'finished') {
    return json({ error: 'Il FantaSposi è concluso.', code: 'game_finished' }, 409);
  }
  if (resolved.wedding.fantasposi_status === 'active'
    && existingPlayer?.onboarding_completed
    && existingPlayer.team !== team) {
    return json({
      error: 'Il team non può essere cambiato dopo l’avvio del FantaSposi.',
      code: 'team_locked',
    }, 409);
  }

  const result = await env.DB.prepare(
    `WITH profile_upsert AS (
       INSERT INTO profiles (user_id, display_name, updated_at)
       VALUES (?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT (user_id) DO UPDATE
       SET display_name = EXCLUDED.display_name, updated_at = CURRENT_TIMESTAMP
       RETURNING user_id, display_name
     ),
     player_upsert AS (
       INSERT INTO fantasposi_players (
         wedding_id, user_id, team, onboarding_completed, active, joined_at, updated_at
       )
       VALUES (?, ?, ?, true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT (wedding_id, user_id) DO UPDATE
       SET team = EXCLUDED.team,
           onboarding_completed = true,
           updated_at = CURRENT_TIMESTAMP
       WHERE fantasposi_players.active = true
       RETURNING id, wedding_id, user_id, team, onboarding_completed, active, joined_at,
                 avatar_media_id
     )
     SELECT player_upsert.id, player_upsert.wedding_id, player_upsert.user_id,
            profile_upsert.display_name, player_upsert.avatar_media_id,
            avatar.preview_status AS avatar_preview_status,
            player_upsert.team, player_upsert.onboarding_completed,
            player_upsert.active, player_upsert.joined_at
     FROM player_upsert
     INNER JOIN profile_upsert ON profile_upsert.user_id = player_upsert.user_id
     LEFT JOIN media avatar
       ON avatar.id = player_upsert.avatar_media_id
      AND avatar.wedding_id = player_upsert.wedding_id
      AND avatar.source = 'fantasposi_avatar'`,
  ).bind(
    resolved.user.id,
    displayName,
    resolved.wedding.id,
    resolved.user.id,
    team,
  ).first<PlayerRow>();

  if (!result) return json({ error: 'FantaSposi membership is inactive' }, 403);
  return json({
    wedding: serializeWedding(resolved.wedding),
    player: serializePlayer(result),
    onboardingCompleted: true,
  });
}

export async function handleFantasposiRequest(
  request: Request,
  env: FantasposiEnv,
  mediaServices: FantasposiMediaServices,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith('/api/fantasposi/')) return null;

  try {
    if (request.method === 'GET' && url.pathname === '/api/fantasposi/me') {
      return meResponse(request, env);
    }
    if (request.method === 'GET' && url.pathname === '/api/fantasposi/bootstrap') {
      return bootstrapResponse(request, env);
    }
    if (request.method === 'GET' && url.pathname === '/api/fantasposi/missions') {
      return missionsResponse(request, env);
    }
    if (request.method === 'GET' && url.pathname === '/api/fantasposi/leaderboard') {
      return leaderboardResponse(request, env);
    }
    if (request.method === 'GET' && url.pathname === '/api/fantasposi/predictions') {
      return predictionsResponse(request, env);
    }
    if (request.method === 'POST' && url.pathname === '/api/fantasposi/avatar/create') {
      return createPlayerAvatarResponse(request, env, mediaServices);
    }
    const completeAvatar = url.pathname.match(/^\/api\/fantasposi\/avatar\/(\d+)\/complete$/);
    if (request.method === 'POST' && completeAvatar) {
      const mediaId = Number(completeAvatar[1]);
      if (!Number.isSafeInteger(mediaId) || mediaId <= 0) {
        return json({ error: 'Invalid avatar media ID' }, 400);
      }
      return completePlayerAvatarResponse(request, env, mediaServices, mediaId);
    }
    const viewAvatar = url.pathname.match(/^\/api\/fantasposi\/avatar\/(\d+)$/);
    if (request.method === 'GET' && viewAvatar) {
      const mediaId = Number(viewAvatar[1]);
      if (!Number.isSafeInteger(mediaId) || mediaId <= 0) {
        return json({ error: 'Invalid avatar media ID' }, 400);
      }
      return playerAvatarResponse(request, env, mediaId);
    }
    const createPhotoProof = url.pathname.match(/^\/api\/fantasposi\/missions\/(\d+)\/proof\/create$/);
    if (request.method === 'POST' && createPhotoProof) {
      const missionId = Number(createPhotoProof[1]);
      if (!Number.isSafeInteger(missionId) || missionId <= 0) {
        return json({ error: 'Invalid mission ID' }, 400);
      }
      return createPhotoProofResponse(request, env, mediaServices, missionId);
    }
    const completePhotoProof = url.pathname.match(
      /^\/api\/fantasposi\/missions\/(\d+)\/proof\/(\d+)\/complete$/,
    );
    if (request.method === 'POST' && completePhotoProof) {
      const missionId = Number(completePhotoProof[1]);
      const mediaId = Number(completePhotoProof[2]);
      if (!Number.isSafeInteger(missionId) || missionId <= 0
        || !Number.isSafeInteger(mediaId) || mediaId <= 0) {
        return json({ error: 'Invalid photo proof ID' }, 400);
      }
      return completePhotoProofUploadResponse(request, env, mediaServices, missionId, mediaId);
    }
    const answerPrediction = url.pathname.match(/^\/api\/fantasposi\/predictions\/(\d+)\/answer$/);
    if (request.method === 'PUT' && answerPrediction) {
      const predictionId = Number(answerPrediction[1]);
      if (!Number.isSafeInteger(predictionId) || predictionId <= 0) {
        return json({ error: 'Invalid prediction ID' }, 400);
      }
      return answerPredictionResponse(request, env, predictionId);
    }
    const completeMission = url.pathname.match(/^\/api\/fantasposi\/missions\/(\d+)\/complete$/);
    if (request.method === 'POST' && completeMission) {
      const missionId = Number(completeMission[1]);
      if (!Number.isSafeInteger(missionId) || missionId <= 0) {
        return json({ error: 'Invalid mission ID' }, 400);
      }
      return completeMissionResponse(request, env, missionId);
    }
    if (request.method === 'POST' && url.pathname === '/api/fantasposi/onboarding') {
      return onboardingResponse(request, env);
    }
    return json({ error: 'FantaSposi endpoint not found' }, 404);
  } catch (error) {
    console.error('FantaSposi API failed', error);
    return json({ error: 'FantaSposi service unavailable' }, 500);
  }
}
