ALTER TABLE media ADD COLUMN thumbnail_key TEXT;
ALTER TABLE media ADD COLUMN preview_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE media ADD COLUMN preview_error TEXT;
ALTER TABLE media ADD COLUMN preview_generated_at TEXT;

UPDATE media
SET preview_status = 'not_applicable'
WHERE mime_type IN ('video/mp4', 'video/quicktime');
