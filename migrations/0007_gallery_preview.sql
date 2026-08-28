ALTER TABLE wedding_settings
ADD COLUMN gallery_preview_enabled INTEGER NOT NULL DEFAULT 1
CHECK (gallery_preview_enabled IN (0, 1));
