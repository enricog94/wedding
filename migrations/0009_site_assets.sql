CREATE TABLE site_assets (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid TEXT NOT NULL UNIQUE,
    wedding_id INTEGER NOT NULL,
    asset_type TEXT NOT NULL DEFAULT 'other'
        CHECK (asset_type IN ('hero', 'story', 'location', 'info', 'other')),
    original_filename TEXT,
    original_key TEXT NOT NULL,
    optimized_key TEXT,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER,
    width INTEGER,
    height INTEGER,
    status TEXT NOT NULL DEFAULT 'uploading'
        CHECK (status IN ('uploading', 'processing', 'ready', 'failed')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    uploaded_at TEXT,
    processed_at TEXT,
    FOREIGN KEY (wedding_id) REFERENCES weddings(id)
);

CREATE INDEX idx_site_assets_wedding_id ON site_assets(wedding_id);
CREATE INDEX idx_site_assets_asset_type ON site_assets(asset_type);
CREATE INDEX idx_site_assets_status ON site_assets(status);

ALTER TABLE wedding_home_content
ADD COLUMN hero_site_asset_id INTEGER REFERENCES site_assets(id) ON DELETE SET NULL;

ALTER TABLE wedding_story_items
ADD COLUMN photo_site_asset_id INTEGER REFERENCES site_assets(id) ON DELETE SET NULL;

ALTER TABLE wedding_locations
ADD COLUMN photo_site_asset_id INTEGER REFERENCES site_assets(id) ON DELETE SET NULL;

ALTER TABLE wedding_info_items
ADD COLUMN image_site_asset_id INTEGER REFERENCES site_assets(id) ON DELETE SET NULL;

PRAGMA optimize;
