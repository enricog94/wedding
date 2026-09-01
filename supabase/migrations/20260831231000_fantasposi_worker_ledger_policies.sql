-- Audit fix: the mission engine reads and updates its completion ledger.
-- The browser remains read-only and restricted to its own player by the
-- existing authenticated policy.

GRANT UPDATE ON public.fantasposi_player_missions TO wedding_worker;

CREATE POLICY fantasposi_player_missions_worker_select
ON public.fantasposi_player_missions FOR SELECT TO wedding_worker
USING (true);

CREATE POLICY fantasposi_player_missions_worker_update
ON public.fantasposi_player_missions FOR UPDATE TO wedding_worker
USING (true) WITH CHECK (true);
