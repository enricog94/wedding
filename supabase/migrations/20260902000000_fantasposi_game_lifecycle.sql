-- Wedding-scoped FantaSposi lifecycle. Existing games intentionally enter
-- setup and must be started explicitly by an authorized wedding admin.
ALTER TABLE public.weddings
    ADD COLUMN IF NOT EXISTS fantasposi_status text NOT NULL DEFAULT 'setup';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'weddings_fantasposi_status_check'
          AND conrelid = 'public.weddings'::regclass
    ) THEN
        ALTER TABLE public.weddings
            ADD CONSTRAINT weddings_fantasposi_status_check
            CHECK (fantasposi_status IN ('setup', 'active', 'finished'));
    END IF;
END
$$;
