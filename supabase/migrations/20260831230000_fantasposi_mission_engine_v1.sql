-- Mission Engine V1: historical awarded points and one active phase per wedding.

ALTER TABLE public.fantasposi_player_missions
ADD COLUMN points_awarded integer;

UPDATE public.fantasposi_player_missions completion
SET points_awarded = mission.points
FROM public.fantasposi_missions mission
WHERE mission.id = completion.mission_id
  AND mission.wedding_id = completion.wedding_id
  AND completion.status = 'completed';

UPDATE public.fantasposi_player_missions
SET points_awarded = 0
WHERE points_awarded IS NULL;

ALTER TABLE public.fantasposi_player_missions
ALTER COLUMN points_awarded SET DEFAULT 0,
ALTER COLUMN points_awarded SET NOT NULL,
ADD CONSTRAINT fantasposi_player_missions_points_awarded_nonnegative
    CHECK (points_awarded >= 0);

CREATE UNIQUE INDEX idx_fantasposi_one_active_phase_per_wedding
ON public.fantasposi_phases(wedding_id)
WHERE status = 'active';

GRANT SELECT, INSERT ON public.fantasposi_player_missions TO wedding_worker;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.fantasposi_missions TO wedding_worker;
GRANT SELECT, UPDATE ON public.fantasposi_phases TO wedding_worker;
GRANT USAGE, SELECT ON SEQUENCE public.fantasposi_player_missions_id_seq TO wedding_worker;
GRANT USAGE, SELECT ON SEQUENCE public.fantasposi_missions_id_seq TO wedding_worker;

CREATE POLICY fantasposi_player_missions_worker_write
ON public.fantasposi_player_missions FOR INSERT TO wedding_worker
WITH CHECK (true);
CREATE POLICY fantasposi_missions_worker_all
ON public.fantasposi_missions FOR ALL TO wedding_worker
USING (true) WITH CHECK (true);
CREATE POLICY fantasposi_phases_worker_update
ON public.fantasposi_phases FOR UPDATE TO wedding_worker
USING (true) WITH CHECK (true);
