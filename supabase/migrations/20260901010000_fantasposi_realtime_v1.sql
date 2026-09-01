-- FantaSposi Realtime V1 publishes catalog changes only.
-- Clients use these events strictly as invalidation signals and always refetch REST.

-- Tighten browser-visible catalog rows before publishing them. Worker policies
-- are role-specific and remain unchanged.
DROP POLICY IF EXISTS fantasposi_predictions_read_for_player
ON public.fantasposi_predictions;
CREATE POLICY fantasposi_predictions_read_for_player
ON public.fantasposi_predictions FOR SELECT TO authenticated
USING (
    active
    AND status <> 'draft'
    AND EXISTS (
        SELECT 1 FROM public.fantasposi_players player
        WHERE player.wedding_id = fantasposi_predictions.wedding_id
          AND player.user_id = (SELECT auth.uid())
          AND player.active
    )
);

DROP POLICY IF EXISTS fantasposi_prediction_options_read_for_player
ON public.fantasposi_prediction_options;
CREATE POLICY fantasposi_prediction_options_read_for_player
ON public.fantasposi_prediction_options FOR SELECT TO authenticated
USING (EXISTS (
    SELECT 1
    FROM public.fantasposi_predictions prediction
    INNER JOIN public.fantasposi_players player
      ON player.wedding_id = prediction.wedding_id
    WHERE prediction.id = fantasposi_prediction_options.prediction_id
      AND prediction.wedding_id = fantasposi_prediction_options.wedding_id
      AND prediction.active
      AND prediction.status <> 'draft'
      AND player.user_id = (SELECT auth.uid())
      AND player.active
));

DROP POLICY IF EXISTS fantasposi_missions_read_for_player
ON public.fantasposi_missions;
CREATE POLICY fantasposi_missions_read_for_player
ON public.fantasposi_missions FOR SELECT TO authenticated
USING (
    active
    AND EXISTS (
        SELECT 1 FROM public.fantasposi_players player
        WHERE player.wedding_id = fantasposi_missions.wedding_id
          AND player.user_id = (SELECT auth.uid())
          AND player.active
    )
);

DO $$
DECLARE
    relation_name text;
BEGIN
    FOREACH relation_name IN ARRAY ARRAY[
        'fantasposi_phases',
        'fantasposi_predictions',
        'fantasposi_prediction_options',
        'fantasposi_missions'
    ]
    LOOP
        IF NOT EXISTS (
            SELECT 1
            FROM pg_publication_tables
            WHERE pubname = 'supabase_realtime'
              AND schemaname = 'public'
              AND tablename = relation_name
        ) THEN
            EXECUTE format(
                'ALTER PUBLICATION supabase_realtime ADD TABLE public.%I',
                relation_name
            );
        END IF;
    END LOOP;
END
$$;
