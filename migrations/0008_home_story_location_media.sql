CREATE TABLE wedding_home_content (
    wedding_id INTEGER PRIMARY KEY,
    story_enabled INTEGER NOT NULL DEFAULT 1 CHECK (story_enabled IN (0, 1)),
    story_eyebrow TEXT,
    story_title TEXT,
    story_intro TEXT,
    story_quote TEXT,
    story_quote_author TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (wedding_id) REFERENCES weddings(id)
);

CREATE TABLE wedding_story_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    wedding_id INTEGER NOT NULL,
    year_label TEXT,
    title TEXT NOT NULL,
    body TEXT,
    photo_media_id INTEGER,
    sort_order INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (wedding_id) REFERENCES weddings(id),
    FOREIGN KEY (photo_media_id) REFERENCES media(id) ON DELETE SET NULL
);

CREATE INDEX idx_wedding_story_items_wedding_id
ON wedding_story_items(wedding_id);

CREATE INDEX idx_wedding_story_items_order
ON wedding_story_items(wedding_id, sort_order, id);

ALTER TABLE wedding_locations
ADD COLUMN photo_media_id INTEGER REFERENCES media(id) ON DELETE SET NULL;

INSERT INTO wedding_home_content (
    wedding_id,
    story_enabled,
    story_eyebrow,
    story_title
)
SELECT id, 0, 'Noi', 'La nostra storia'
FROM weddings
WHERE slug = 'serena-enrico-2027';

PRAGMA optimize;
