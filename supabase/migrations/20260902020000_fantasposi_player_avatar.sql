ALTER TABLE public.fantasposi_players
ADD COLUMN avatar_media_id bigint;

ALTER TABLE public.fantasposi_players
ADD CONSTRAINT fantasposi_players_avatar_media_wedding_fk
FOREIGN KEY (avatar_media_id, wedding_id)
REFERENCES public.media(id, wedding_id)
ON DELETE SET NULL (avatar_media_id);

CREATE INDEX fantasposi_players_avatar_media_idx
ON public.fantasposi_players(avatar_media_id)
WHERE avatar_media_id IS NOT NULL;
