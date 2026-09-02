import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Database, DatabaseResult, DatabaseValue, PreparedStatement } from '../lib/supabase-db';
import type { WeddingResolution } from '../lib/wedding-resolver';
import { handleFantasposiRequest } from './fantasposi';

const userId = '11111111-1111-4111-8111-111111111111';

type TestPlayer = {
  id: number;
  wedding_id: number;
  user_id: string;
  display_name: string;
  avatar_media_id: null;
  avatar_preview_status: null;
  team: 'bride' | 'groom';
  onboarding_completed: true;
  active: true;
  joined_at: string;
};

function result<T>(results: T[]): DatabaseResult<T> {
  return { results, success: true, meta: { changes: results.length, last_row_id: 0 } };
}

function testDatabase(players: Map<number, TestPlayer>, queries: string[]): Database {
  return {
    prepare(query: string): PreparedStatement {
      let values: DatabaseValue[] = [];
      queries.push(query);
      const statement: PreparedStatement = {
        bind(...nextValues) { values = nextValues; return statement; },
        async first<T>() {
          if (query.includes('FROM fantasposi_players fp')) {
            const player = players.get(Number(values[0]));
            return (player?.user_id === values[1] ? player : null) as T | null;
          }
          if (query.includes('WITH player_upsert AS')) {
            const weddingId = Number(values[0]);
            const existing = players.get(weddingId);
            const player: TestPlayer = {
              id: existing?.id ?? weddingId * 10,
              wedding_id: weddingId,
              user_id: String(values[1]),
              display_name: String(values[2]),
              avatar_media_id: null,
              avatar_preview_status: null,
              team: values[3] as TestPlayer['team'],
              onboarding_completed: true,
              active: true,
              joined_at: existing?.joined_at ?? '2027-01-01T00:00:00Z',
            };
            players.set(weddingId, player);
            return player as T;
          }
          if (query.includes('WITH mission_summary AS')) {
            return {
              total_points: 0, mission_points: 0, prediction_points: 0,
              completed_mission_count: 0, available_mission_count: 0,
            } as T;
          }
          return null;
        },
        async all<T>() {
          if (query.includes('player_totals AS')) {
            const weddingId = Number(values[2]);
            const player = players.get(weddingId);
            return result(player ? [{
              player_id: player.id,
              display_name: player.display_name,
              team: player.team,
              avatar_media_id: null,
              avatar_preview_status: null,
              mission_points: 0,
              prediction_points: 0,
              points: 0,
              completed_missions: 0,
              team_points: 0,
              team_players: 1,
            } as T] : []);
          }
          return result<T>([]);
        },
        async run() { return result<Record<string, unknown>>([]); },
      };
      return statement;
    },
  };
}

function wedding(id: number, slug: string): WeddingResolution {
  return {
    resolved: true,
    hostname: `${slug}.example.test`,
    source: 'domain',
    wedding: {
      id, slug, bride_name: `Sposa ${id}`, groom_name: `Sposo ${id}`,
      wedding_date: '2027-07-24', status: 'active', theme: null,
      hero_eyebrow: null, hero_title: null, hero_subtitle: null,
      fantasposi_status: 'active',
    },
  };
}

async function responseBody<T>(response: Response): Promise<T> {
  return response.json() as Promise<T>;
}

describe('FantaSposi wedding-scoped player identity', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('keeps /me, bootstrap and leaderboard names isolated for the same user', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ id: userId, email: 'player@example.test' })));
    const queries: string[] = [];
    const players = new Map<number, TestPlayer>([
      [1, { id: 10, wedding_id: 1, user_id: userId, display_name: 'Enrico', avatar_media_id: null, avatar_preview_status: null, team: 'groom', onboarding_completed: true, active: true, joined_at: '2027-01-01T00:00:00Z' }],
      [2, { id: 20, wedding_id: 2, user_id: userId, display_name: 'enry_test', avatar_media_id: null, avatar_preview_status: null, team: 'bride', onboarding_completed: true, active: true, joined_at: '2027-01-01T00:00:00Z' }],
    ]);
    const DB = testDatabase(players, queries);
    const services = {
      createPresignedPutUrl: async () => 'https://upload.example.test',
      enqueueMediaPreview: async () => undefined,
    };
    const call = async (weddingId: number, path: string, init?: RequestInit) => {
      const response = await handleFantasposiRequest(
        new Request(`https://wedding.example.test${path}`, {
          ...init, headers: { authorization: 'Bearer test', ...init?.headers },
        }),
        {
          DB,
          SUPABASE_URL: 'https://supabase.example.test',
          SUPABASE_ANON_KEY: 'anon',
          MEDIA_BUCKET: {} as R2Bucket,
          WEDDING_CONTEXT: Promise.resolve(wedding(weddingId, `wedding-${weddingId}`)),
        },
        services,
      );
      expect(response).not.toBeNull();
      return response as Response;
    };

    expect((await responseBody<{ player: { displayName: string } }>(
      await call(1, '/api/fantasposi/me'),
    )).player.displayName).toBe('Enrico');
    expect((await responseBody<{ player: { displayName: string } }>(
      await call(2, '/api/fantasposi/me'),
    )).player.displayName).toBe('enry_test');

    const update = await call(2, '/api/fantasposi/onboarding', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ displayName: 'Pippo', team: 'bride' }),
    });
    expect(update.status).toBe(200);
    expect(players.get(1)?.display_name).toBe('Enrico');
    expect(players.get(2)?.display_name).toBe('Pippo');

    expect((await responseBody<{ player: { displayName: string } }>(
      await call(1, '/api/fantasposi/bootstrap'),
    )).player.displayName).toBe('Enrico');
    expect((await responseBody<{ player: { displayName: string } }>(
      await call(2, '/api/fantasposi/bootstrap'),
    )).player.displayName).toBe('Pippo');
    expect((await responseBody<{ players: Array<{ displayName: string }> }>(
      await call(1, '/api/fantasposi/leaderboard'),
    )).players[0]?.displayName).toBe('Enrico');
    expect((await responseBody<{ players: Array<{ displayName: string }> }>(
      await call(2, '/api/fantasposi/leaderboard'),
    )).players[0]?.displayName).toBe('Pippo');

    const playerQueries = queries.filter((query) => query.includes('display_name'));
    expect(playerQueries.some((query) => query.includes('BTRIM(player.display_name)'))).toBe(true);
    expect(playerQueries.every((query) => !query.includes('profile.display_name'))).toBe(true);
  });
});
