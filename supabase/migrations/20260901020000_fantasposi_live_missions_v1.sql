-- FantaSposi Live Missions V1: optional availability windows.
-- NULL timestamps preserve the existing Mission Engine behaviour.

ALTER TABLE public.fantasposi_missions
    ADD COLUMN opens_at timestamptz,
    ADD COLUMN closes_at timestamptz,
    ADD CONSTRAINT fantasposi_missions_open_window_check
        CHECK (opens_at IS NULL OR closes_at IS NULL OR opens_at < closes_at);

CREATE INDEX idx_fantasposi_missions_wedding_live_window
    ON public.fantasposi_missions(wedding_id, active, opens_at, closes_at);
