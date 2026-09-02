import { describe, expect, it } from 'vitest';
import {
  effectiveMissionStatus,
  effectivePredictionStatus,
  isPhotoProofOriginalKey,
  isValidTimeWindow,
  missionRequiresPhotoProof,
  parseOptionalTimestamp,
  parsePhotoProofCreateInput,
  parsePhotoProofMediaId,
  parsePositiveInteger,
  photoProofPrefix,
  selectHomeMissionRecommendations,
  type RecommendedMissionCandidate,
} from './fantasposi-domain';

const now = Date.parse('2027-07-24T12:00:00.000Z');
const before = '2027-07-24T11:59:59.000Z';
const atNow = '2027-07-24T12:00:00.000Z';
const after = '2027-07-24T12:00:01.000Z';

const mission = (overrides: Partial<RecommendedMissionCandidate> = {}): RecommendedMissionCandidate => ({
  id: 1,
  sortOrder: 0,
  active: true,
  phaseStatus: 'active',
  completed: false,
  opensAt: null,
  closesAt: null,
  ...overrides,
});

describe('mission time windows', () => {
  it('keeps a legacy mission without timestamps available', () => {
    expect(effectiveMissionStatus(mission(), now)).toBe('available');
  });

  it.each([
    [{ opensAt: after }, 'scheduled'],
    [{ opensAt: atNow }, 'available'],
    [{ opensAt: before }, 'available'],
    [{ closesAt: after }, 'available'],
    [{ closesAt: atNow }, 'expired'],
    [{ closesAt: before }, 'expired'],
    [{ active: false }, 'inactive'],
    [{ phaseStatus: 'locked' }, 'inactive'],
    [{ completed: true }, 'completed'],
  ] as const)('maps %o to %s', (overrides, expected) => {
    expect(effectiveMissionStatus(mission(overrides), now)).toBe(expected);
  });

  it('fails closed for malformed timestamps', () => {
    expect(effectiveMissionStatus(mission({ opensAt: 'invalid' }), now)).toBe('inactive');
  });
});

describe('prediction time windows', () => {
  const prediction = (overrides: Partial<{
    status: 'open' | 'closed' | 'resolved'; opensAt: string | null; closesAt: string | null;
  }> = {}) => ({ status: 'open' as const, opensAt: null, closesAt: null, ...overrides });

  it.each([
    [{}, 'open'],
    [{ opensAt: after }, 'scheduled'],
    [{ opensAt: atNow }, 'open'],
    [{ opensAt: before }, 'open'],
    [{ closesAt: after }, 'open'],
    [{ closesAt: atNow }, 'closed'],
    [{ closesAt: before }, 'closed'],
    [{ status: 'closed' }, 'closed'],
    [{ status: 'resolved' }, 'resolved'],
  ] as const)('maps %o to %s', (overrides, expected) => {
    expect(effectivePredictionStatus(prediction(overrides), now)).toBe(expected);
  });

  it('fails closed for malformed timestamps', () => {
    expect(effectivePredictionStatus(prediction({ closesAt: 'invalid' }), now)).toBe('closed');
  });
});

describe('Home mission recommendations', () => {
  it('returns at most three available missions and the nearest scheduled mission', () => {
    const available = Array.from({ length: 20 }, (_, index) => mission({
      id: index + 1,
      sortOrder: 20 - index,
    }));
    const candidates = [
      ...available,
      mission({ id: 30, opensAt: '2027-07-24T14:00:00.000Z', sortOrder: 0 }),
      mission({ id: 31, opensAt: '2027-07-24T13:00:00.000Z', sortOrder: 99 }),
      mission({ id: 40, completed: true }),
      mission({ id: 41, active: false }),
      mission({ id: 42, closesAt: before }),
    ];

    const result = selectHomeMissionRecommendations(candidates, now);

    expect(result).toHaveLength(4);
    expect(result.slice(0, 3).map((item) => item.id)).toEqual([20, 19, 18]);
    expect(result[3]?.id).toBe(31);
    expect(result.map((item) => item.id)).not.toEqual(expect.arrayContaining([40, 41, 42]));
  });

  it('uses id as a deterministic final tie-breaker', () => {
    const result = selectHomeMissionRecommendations([
      mission({ id: 3 }), mission({ id: 1 }), mission({ id: 2 }), mission({ id: 4 }),
    ], now);
    expect(result.map((item) => item.id)).toEqual([1, 2, 3]);
  });
});

describe('optional timestamp validation', () => {
  it.each([null, undefined, ''])('normalizes %s to null', (value) => {
    expect(parseOptionalTimestamp(value)).toBeNull();
  });

  it('accepts one-sided and empty windows', () => {
    expect(isValidTimeWindow(null, null)).toBe(true);
    expect(isValidTimeWindow(atNow, null)).toBe(true);
    expect(isValidTimeWindow(null, atNow)).toBe(true);
  });

  it('requires opensAt to precede closesAt when both exist', () => {
    expect(isValidTimeWindow(before, after)).toBe(true);
    expect(isValidTimeWindow(atNow, atNow)).toBe(false);
    expect(isValidTimeWindow(after, before)).toBe(false);
  });

  it('rejects malformed and non-string timestamps', () => {
    expect(parseOptionalTimestamp('not-a-date')).toBeUndefined();
    expect(parseOptionalTimestamp(123)).toBeUndefined();
  });
});

describe('Photo Proof validation', () => {
  it('accepts a supported image payload', () => {
    expect(parsePhotoProofCreateInput({
      filename: ' prova.JPG ', mimeType: ' IMAGE/JPEG ', size: 1024,
    })).toEqual({
      value: { filename: 'prova.JPG', mimeType: 'image/jpeg', size: 1024 },
      invalidField: null,
    });
  });

  it.each([
    [null, 'payload'],
    [{ filename: '', mimeType: 'image/jpeg', size: 1 }, 'filename'],
    [{ filename: 'x.mp4', mimeType: 'video/mp4', size: 1 }, 'mimeType'],
    [{ filename: 'x.gif', mimeType: 'image/gif', size: 1 }, 'mimeType'],
    [{ filename: 'x.jpg', mimeType: 'image/jpeg', size: 0 }, 'size'],
    [{ filename: 'x.jpg', mimeType: 'image/jpeg', size: 1.5 }, 'size'],
    [{ filename: 'x.jpg', mimeType: 'image/jpeg', size: '1' }, 'size'],
    [{ filename: 'x.jpg', mimeType: 'image/jpeg', size: 20 * 1024 * 1024 + 1 }, 'maxSize'],
  ])('rejects malformed payload %#', (payload, invalidField) => {
    expect(parsePhotoProofCreateInput(payload)).toEqual({ value: null, invalidField });
  });

  it('accepts only a positive numeric integer mediaId', () => {
    expect(parsePhotoProofMediaId({ mediaId: 42 })).toBe(42);
    expect(parsePhotoProofMediaId({ mediaId: '42' })).toBeNull();
    expect(parsePhotoProofMediaId({ mediaId: 1.5 })).toBeNull();
    expect(parsePhotoProofMediaId({ mediaId: -1 })).toBeNull();
    expect(parsePhotoProofMediaId({})).toBeNull();
  });

  it('rejects coerced, decimal and non-positive identifiers', () => {
    expect(parsePositiveInteger(7)).toBe(7);
    expect(parsePositiveInteger('7')).toBeNull();
    expect(parsePositiveInteger(7.5)).toBeNull();
    expect(parsePositiveInteger(0)).toBeNull();
    expect(parsePositiveInteger(Number.NaN)).toBeNull();
  });

  it('keeps proof purpose, wedding and mission in the object prefix', () => {
    const prefix = photoProofPrefix('serena-enrico-2027', 'foto-team');
    expect(prefix).toBe('weddings/serena-enrico-2027/fantasposi/proofs/foto-team/originals/');
    expect(isPhotoProofOriginalKey(`${prefix}uuid.jpg`, 'serena-enrico-2027', 'foto-team')).toBe(true);
    expect(isPhotoProofOriginalKey(`${prefix}uuid.jpg`, 'altro-wedding', 'foto-team')).toBe(false);
    expect(isPhotoProofOriginalKey(`${prefix}uuid.jpg`, 'serena-enrico-2027', 'altra-missione')).toBe(false);
    expect(isPhotoProofOriginalKey(
      'weddings/serena-enrico-2027/guests/originals/uuid.jpg',
      'serena-enrico-2027',
      'foto-team',
    )).toBe(false);
  });

  it('preserves legacy behavior for non-photo missions', () => {
    expect(missionRequiresPhotoProof('photo')).toBe(true);
    expect(missionRequiresPhotoProof('action')).toBe(false);
    expect(missionRequiresPhotoProof('social')).toBe(false);
  });
});
