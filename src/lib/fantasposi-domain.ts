import {
  MEDIA_TYPES,
  type SupportedImageMimeType,
} from './media-types';

export type EffectiveMissionStatus =
  | 'inactive'
  | 'scheduled'
  | 'available'
  | 'expired'
  | 'completed';

export type EffectivePredictionStatus = 'scheduled' | 'open' | 'closed' | 'resolved';

export type FantasposiGameState = 'setup' | 'active' | 'finished';

export type FantasposiMutationBlock = {
  status: 409;
  code: 'game_not_active' | 'game_finished';
  error: string;
};

export type MissionTiming = {
  active: boolean;
  phaseStatus: string;
  completed: boolean;
  opensAt: string | null;
  closesAt: string | null;
};

export type PredictionTiming = {
  status: 'open' | 'closed' | 'resolved';
  opensAt: string | null;
  closesAt: string | null;
};

export type RecommendedMissionCandidate = MissionTiming & {
  id: number;
  sortOrder: number;
};

export type PhotoProofCreateInput = {
  filename: string;
  mimeType: SupportedImageMimeType;
  size: number;
};

export type PhotoProofCreateInputResult =
  | { value: PhotoProofCreateInput; invalidField: null }
  | { value: null; invalidField: 'payload' | 'filename' | 'mimeType' | 'size' | 'maxSize' };

function parsedInstant(value: string | null): number | null | undefined {
  if (value === null) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

export function fantasposiMutationBlock(
  state: FantasposiGameState,
): FantasposiMutationBlock | null {
  if (state === 'active') return null;
  return state === 'finished'
    ? { status: 409, code: 'game_finished', error: 'Il FantaSposi è concluso.' }
    : { status: 409, code: 'game_not_active', error: 'Il FantaSposi non è ancora iniziato.' };
}

export function isValidFantasposiResetConfirmation(value: unknown): boolean {
  return value === 'RESET FANTASPOSI';
}

export function formatFantasposiCountdown(target: string | null, now: number): string | null {
  const targetTime = parsedInstant(target);
  if (targetTime === null || targetTime === undefined) return null;
  const seconds = Math.max(0, Math.ceil((targetTime - now) / 1_000));
  const hours = Math.floor(seconds / 3_600);
  const days = Math.floor(hours / 24);
  const minutes = Math.floor((seconds % 3_600) / 60);
  const remainingSeconds = seconds % 60;
  if (days > 0) return `${days}g ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  return `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
}

export function effectiveMissionStatus(
  mission: MissionTiming,
  now: number,
): EffectiveMissionStatus {
  if (mission.completed) return 'completed';
  if (!mission.active || mission.phaseStatus !== 'active') return 'inactive';
  const opensAt = parsedInstant(mission.opensAt);
  const closesAt = parsedInstant(mission.closesAt);
  if (opensAt === undefined || closesAt === undefined) return 'inactive';
  if (opensAt !== null && now < opensAt) return 'scheduled';
  if (closesAt !== null && now >= closesAt) return 'expired';
  return 'available';
}

export function effectivePredictionStatus(
  prediction: PredictionTiming,
  now: number,
): EffectivePredictionStatus {
  if (prediction.status === 'resolved') return 'resolved';
  if (prediction.status === 'closed') return 'closed';
  const opensAt = parsedInstant(prediction.opensAt);
  const closesAt = parsedInstant(prediction.closesAt);
  if (opensAt === undefined || closesAt === undefined) return 'closed';
  if (opensAt !== null && now < opensAt) return 'scheduled';
  if (closesAt !== null && now >= closesAt) return 'closed';
  return 'open';
}

export function selectHomeMissionRecommendations<T extends RecommendedMissionCandidate>(
  missions: readonly T[],
  now: number,
): T[] {
  const available = missions
    .filter((mission) => effectiveMissionStatus(mission, now) === 'available')
    .sort((left, right) => (
      left.sortOrder - right.sortOrder
      || (left.opensAt ?? '').localeCompare(right.opensAt ?? '')
      || left.id - right.id
    ))
    .slice(0, 3);
  const scheduled = missions
    .filter((mission) => effectiveMissionStatus(mission, now) === 'scheduled')
    .sort((left, right) => (
      (left.opensAt ?? '').localeCompare(right.opensAt ?? '')
      || left.sortOrder - right.sortOrder
      || left.id - right.id
    ))[0];
  return [...available, ...(scheduled ? [scheduled] : [])];
}

export function parseOptionalTimestamp(value: unknown): string | null | undefined {
  if (value === null || value === '' || value === undefined) return null;
  if (typeof value !== 'string') return undefined;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return undefined;
  return new Date(parsed).toISOString();
}

export function isValidTimeWindow(
  opensAt: string | null | undefined,
  closesAt: string | null | undefined,
): boolean {
  if (opensAt === undefined || closesAt === undefined) return false;
  return !opensAt || !closesAt || opensAt < closesAt;
}

export function parsePhotoProofCreateInput(input: unknown): PhotoProofCreateInputResult {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { value: null, invalidField: 'payload' };
  }
  const body = input as Record<string, unknown>;
  const filename = typeof body.filename === 'string' ? body.filename.trim() : '';
  const mimeType = typeof body.mimeType === 'string' ? body.mimeType.trim().toLowerCase() : '';
  const size = body.size;
  if (!filename) return { value: null, invalidField: 'filename' };
  if (!Object.prototype.hasOwnProperty.call(MEDIA_TYPES, mimeType) || !mimeType.startsWith('image/')) {
    return { value: null, invalidField: 'mimeType' };
  }
  if (typeof size !== 'number' || !Number.isSafeInteger(size) || size <= 0) {
    return { value: null, invalidField: 'size' };
  }
  const supportedMimeType = mimeType as SupportedImageMimeType;
  if (size > MEDIA_TYPES[supportedMimeType].maxSize) {
    return { value: null, invalidField: 'maxSize' };
  }
  return {
    value: { filename, mimeType: supportedMimeType, size },
    invalidField: null,
  };
}

export function parsePhotoProofMediaId(input: unknown): number | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  return parsePositiveInteger((input as Record<string, unknown>).mediaId);
}

export function parsePositiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}

export function photoProofPrefix(weddingSlug: string, missionCode: string): string {
  return `weddings/${encodeURIComponent(weddingSlug)}/fantasposi/proofs/${encodeURIComponent(missionCode)}/originals/`;
}

export function isPhotoProofOriginalKey(
  objectKey: string,
  weddingSlug: string,
  missionCode: string,
): boolean {
  return objectKey.startsWith(photoProofPrefix(weddingSlug, missionCode));
}

export function missionRequiresPhotoProof(missionType: string): boolean {
  return missionType === 'photo';
}
