ALTER TABLE weddings ADD COLUMN hero_eyebrow TEXT;
ALTER TABLE weddings ADD COLUMN hero_title TEXT;
ALTER TABLE weddings ADD COLUMN hero_subtitle TEXT;

ALTER TABLE wedding_settings ADD COLUMN schedule_enabled INTEGER NOT NULL DEFAULT 1 CHECK (schedule_enabled IN (0, 1));
ALTER TABLE wedding_settings ADD COLUMN locations_enabled INTEGER NOT NULL DEFAULT 1 CHECK (locations_enabled IN (0, 1));
ALTER TABLE wedding_settings ADD COLUMN info_enabled INTEGER NOT NULL DEFAULT 1 CHECK (info_enabled IN (0, 1));

CREATE TABLE wedding_schedule (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    wedding_id INTEGER NOT NULL,
    time_label TEXT NOT NULL,
    title TEXT NOT NULL,
    subtitle TEXT,
    description TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
    FOREIGN KEY (wedding_id) REFERENCES weddings(id)
);

CREATE TABLE wedding_locations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    wedding_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    type TEXT,
    address TEXT,
    maps_url TEXT,
    description TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
    FOREIGN KEY (wedding_id) REFERENCES weddings(id)
);

CREATE TABLE wedding_info_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    wedding_id INTEGER NOT NULL,
    category TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
    FOREIGN KEY (wedding_id) REFERENCES weddings(id)
);

CREATE INDEX idx_wedding_schedule_public
ON wedding_schedule(wedding_id, enabled, sort_order, id);

CREATE INDEX idx_wedding_locations_public
ON wedding_locations(wedding_id, enabled, sort_order, id);

CREATE INDEX idx_wedding_info_items_public
ON wedding_info_items(wedding_id, enabled, sort_order, id);

UPDATE weddings
SET hero_eyebrow = 'Ci sposiamo'
WHERE slug = 'serena-enrico-2027';

INSERT INTO wedding_schedule (
    wedding_id, time_label, title, subtitle, sort_order, enabled
)
SELECT id, '10:00', 'Rinfresco', 'A casa degli sposi', 10, 1
FROM weddings
WHERE slug = 'serena-enrico-2027';

INSERT INTO wedding_schedule (
    wedding_id, time_label, title, subtitle, sort_order, enabled
)
SELECT id, '11:00', 'Cerimonia', 'Chiesetta di Cendrole', 20, 1
FROM weddings
WHERE slug = 'serena-enrico-2027';

INSERT INTO wedding_schedule (
    wedding_id, time_label, title, subtitle, sort_order, enabled
)
SELECT id, '13:00 circa', 'Ricevimento', 'Villa Peggy''s', 30, 1
FROM weddings
WHERE slug = 'serena-enrico-2027';

INSERT INTO wedding_locations (
    wedding_id, name, type, sort_order, enabled
)
SELECT id, 'Chiesetta di Cendrole', 'Cerimonia', 10, 1
FROM weddings
WHERE slug = 'serena-enrico-2027';

INSERT INTO wedding_locations (
    wedding_id, name, type, sort_order, enabled
)
SELECT id, 'Villa Peggy''s', 'Ricevimento', 20, 1
FROM weddings
WHERE slug = 'serena-enrico-2027';

PRAGMA optimize;
