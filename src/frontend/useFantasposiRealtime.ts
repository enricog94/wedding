import { useEffect, useRef, useState } from 'react';
import { RealtimeClient } from '@supabase/realtime-js';
import { getSupabaseAccessToken, getSupabasePublicConfig } from '../lib/supabase';

export type FantasposiInvalidation = 'all' | 'phases' | 'missions' | 'predictions';

type RealtimeOptions = {
  weddingId: number;
  onInvalidate: (scope: FantasposiInvalidation) => void;
};

const TABLE_SCOPES = [
  ['fantasposi_phases', 'phases'],
  ['fantasposi_predictions', 'predictions'],
  ['fantasposi_prediction_options', 'predictions'],
  ['fantasposi_missions', 'missions'],
] as const;

export function useFantasposiRealtime({ weddingId, onInvalidate }: RealtimeOptions): void {
  const callbackRef = useRef(onInvalidate);
  useEffect(() => {
    callbackRef.current = onInvalidate;
  }, [onInvalidate]);

  useEffect(() => {
    const config = getSupabasePublicConfig();
    if (!config || !Number.isSafeInteger(weddingId) || weddingId <= 0) return undefined;

    const pending = new Set<FantasposiInvalidation>();
    let debounceTimer: number | undefined;
    let hasSubscribed = false;
    let disposed = false;
    let client: RealtimeClient | null = null;
    const invalidate = (scope: FantasposiInvalidation) => {
      pending.add(scope);
      if (debounceTimer !== undefined) return;
      debounceTimer = window.setTimeout(() => {
        const scopes = [...pending];
        pending.clear(); debounceTimer = undefined;
        if (scopes.includes('all')) {
          console.info('[FantaRealtime] invalidating all');
          callbackRef.current('all');
        } else {
          scopes.forEach((entry) => {
            console.info(`[FantaRealtime] invalidating ${entry}`);
            callbackRef.current(entry);
          });
        }
      }, 200);
    };

    console.info('[FantaRealtime] creating channel');
    console.info(`[FantaRealtime] weddingId=${weddingId}`);
    void (async () => {
      const token = await getSupabaseAccessToken();
      console.info(`[FantaRealtime] auth token present=${Boolean(token)}`);
      if (disposed || !token) return;

      client = new RealtimeClient(`${config.supabaseUrl.replace(/\/+$/, '')}/realtime/v1`, {
        params: { apikey: config.anonKey },
        accessToken: getSupabaseAccessToken,
        logLevel: 'error',
      });
      await client.setAuth(token);
      if (disposed) {
        await client.disconnect();
        return;
      }

      const channel = client.channel(`fantasposi-${weddingId}`);
      for (const [table, scope] of TABLE_SCOPES) {
        for (const event of ['INSERT', 'UPDATE'] as const) {
          channel.on('postgres_changes', {
            event, schema: 'public', table, filter: `wedding_id=eq.${weddingId}`,
          }, () => {
            const entity = table === 'fantasposi_prediction_options'
              ? 'prediction option'
              : table.replace(/^fantasposi_/, '').replace(/s$/, '');
            console.info(`[FantaRealtime] event ${entity} ${event}`);
            invalidate(scope);
          });
        }
      }
      channel.subscribe((status, error) => {
        console.info(`[FantaRealtime] status=${status}`);
        if (error) console.error(`[FantaRealtime] ${status}`, error);
        if (status === 'SUBSCRIBED') {
          if (hasSubscribed) invalidate('all');
          hasSubscribed = true;
        }
      });
    })().catch((error: unknown) => {
      if (!disposed) console.error('[FantaRealtime] CHANNEL_ERROR', error);
    });

    const recover = () => invalidate('all');
    const recoverVisible = () => {
      if (document.visibilityState === 'visible') recover();
    };
    window.addEventListener('focus', recover);
    window.addEventListener('online', recover);
    document.addEventListener('visibilitychange', recoverVisible);

    return () => {
      disposed = true;
      if (debounceTimer !== undefined) window.clearTimeout(debounceTimer);
      window.removeEventListener('focus', recover);
      window.removeEventListener('online', recover);
      document.removeEventListener('visibilitychange', recoverVisible);
      // Close the socket immediately so a remount cannot overlap with the old
      // subscription while the protocol-level unsubscribe is completing.
      if (client) void client.disconnect();
    };
  }, [weddingId]);
}

export function useFantasposiClock(enabled: boolean, intervalMs = 1_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return undefined;
    const update = () => {
      if (document.visibilityState === 'visible') setNow(Date.now());
    };
    const interval = window.setInterval(update, intervalMs);
    document.addEventListener('visibilitychange', update);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', update);
    };
  }, [enabled, intervalMs]);
  return now;
}
