-- FantaSposi Photo Proof V1 reuses private media metadata and the existing R2 bucket.

ALTER TABLE public.media
ADD COLUMN uploader_user_id uuid REFERENCES public.profiles(user_id) ON DELETE SET NULL;

CREATE INDEX idx_media_wedding_uploader
    ON public.media(wedding_id, uploader_user_id)
    WHERE uploader_user_id IS NOT NULL;

ALTER TABLE public.fantasposi_player_missions
ADD COLUMN media_id bigint REFERENCES public.media(id) ON DELETE RESTRICT,
ADD CONSTRAINT fantasposi_player_missions_media_wedding_fk
    FOREIGN KEY (media_id, wedding_id)
    REFERENCES public.media(id, wedding_id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX idx_fantasposi_player_missions_unique_media
    ON public.fantasposi_player_missions(media_id)
    WHERE media_id IS NOT NULL;

-- mission_type already permits 'photo' in the foundation CHECK constraint.
