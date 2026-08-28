ALTER TABLE wedding_settings
ADD COLUMN gallery_download_enabled INTEGER NOT NULL DEFAULT 1
CHECK (gallery_download_enabled IN (0, 1));
