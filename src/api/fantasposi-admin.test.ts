import { describe, expect, it } from 'vitest';
import { parseMissionInput, parsePredictionInput } from './fantasposi-admin';

const missionPayload = (overrides: Record<string, unknown> = {}) => ({
  code: 'foto-team',
  phaseId: 1,
  title: 'Foto di squadra',
  description: null,
  missionType: 'action',
  points: 20,
  active: true,
  sortOrder: 0,
  opensAt: null,
  closesAt: null,
  ...overrides,
});

const predictionPayload = (overrides: Record<string, unknown> = {}) => ({
  code: 'primo-ballo',
  question: 'Quale sarà la prima canzone?',
  description: null,
  phaseId: null,
  points: 20,
  sortOrder: 0,
  opensAt: null,
  closesAt: null,
  options: [
    { code: 'a', label: 'Canzone A', sortOrder: 0 },
    { code: 'b', label: 'Canzone B', sortOrder: 1 },
  ],
  ...overrides,
});

describe('admin mission input', () => {
  it.each([
    [{ opensAt: null, closesAt: null }],
    [{ opensAt: '', closesAt: '' }],
    [{ opensAt: '2027-07-24T10:00:00Z', closesAt: null }],
    [{ opensAt: null, closesAt: '2027-07-24T11:00:00Z' }],
    [{ opensAt: '2027-07-24T10:00:00Z', closesAt: '2027-07-24T11:00:00Z' }],
    [{ missionType: 'photo' }],
    [{ missionType: 'social' }],
  ])('accepts valid payload variation %#', (variation) => {
    expect(parseMissionInput(missionPayload(variation)).invalidField).toBeNull();
  });

  it.each([
    [{ phaseId: '1' }, 'phaseId'],
    [{ phaseId: -1 }, 'phaseId'],
    [{ points: '20' }, 'points'],
    [{ points: 1.5 }, 'points'],
    [{ sortOrder: '' }, 'sortOrder'],
    [{ opensAt: 'invalid' }, 'opensAt'],
    [{ closesAt: 'invalid' }, 'closesAt'],
    [{ opensAt: '2027-07-24T11:00:00Z', closesAt: '2027-07-24T10:00:00Z' }, 'timeRange'],
    [{ opensAt: '2027-07-24T10:00:00Z', closesAt: '2027-07-24T10:00:00Z' }, 'timeRange'],
  ])('rejects invalid payload variation %#', (variation, invalidField) => {
    expect(parseMissionInput(missionPayload(variation)).invalidField).toBe(invalidField);
  });
});

describe('admin prediction input', () => {
  it('accepts null, one-sided and complete valid windows', () => {
    expect(parsePredictionInput(predictionPayload())).not.toBeNull();
    expect(parsePredictionInput(predictionPayload({ opensAt: '2027-07-24T10:00:00Z' }))).not.toBeNull();
    expect(parsePredictionInput(predictionPayload({ closesAt: '2027-07-24T11:00:00Z' }))).not.toBeNull();
    expect(parsePredictionInput(predictionPayload({
      opensAt: '2027-07-24T10:00:00Z', closesAt: '2027-07-24T11:00:00Z',
    }))).not.toBeNull();
  });

  it.each([
    { phaseId: '1' },
    { points: '20' },
    { sortOrder: '0' },
    { opensAt: 'invalid' },
    { closesAt: 'invalid' },
    { opensAt: '2027-07-24T11:00:00Z', closesAt: '2027-07-24T10:00:00Z' },
    { options: [{ code: 'a', label: 'A', sortOrder: '0' }, { code: 'b', label: 'B', sortOrder: 1 }] },
  ])('rejects malformed payload %#', (variation) => {
    expect(parsePredictionInput(predictionPayload(variation))).toBeNull();
  });
});
