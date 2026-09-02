ALTER TABLE public.fantasposi_players
ADD COLUMN display_name text;

UPDATE public.fantasposi_players AS player
SET display_name = COALESCE(
    NULLIF(BTRIM(profile.display_name), ''),
    'Giocatore'
)
FROM public.profiles AS profile
WHERE profile.user_id = player.user_id;

UPDATE public.fantasposi_players
SET display_name = 'Giocatore'
WHERE display_name IS NULL OR BTRIM(display_name) = '';

ALTER TABLE public.fantasposi_players
ALTER COLUMN display_name SET NOT NULL;

ALTER TABLE public.fantasposi_players
ADD CONSTRAINT fantasposi_players_display_name_not_blank
CHECK (BTRIM(display_name) <> '');
