CREATE TABLE media (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uuid TEXT NOT NULL UNIQUE,
    wedding_id INTEGER NOT NULL,
    source TEXT NOT NULL,
    original_filename TEXT,
    original_key TEXT NOT NULL,
    preview_key TEXT,
    mime_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    width INTEGER,
    height INTEGER,
    sha256 TEXT,
    status TEXT NOT NULL DEFAULT 'uploading',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    uploaded_at TEXT,
    FOREIGN KEY (wedding_id) REFERENCES weddings(id)
);

CREATE INDEX idx_media_wedding_id ON media(wedding_id);
CREATE INDEX idx_media_status ON media(status);
CREATE INDEX idx_media_source ON media(source);
CREATE INDEX idx_media_created_at ON media(created_at);
