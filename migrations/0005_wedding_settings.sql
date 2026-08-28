CREATE TABLE wedding_settings (
    wedding_id INTEGER PRIMARY KEY,
    gallery_enabled INTEGER NOT NULL DEFAULT 1 CHECK (gallery_enabled IN (0, 1)),
    guest_uploads_enabled INTEGER NOT NULL DEFAULT 1 CHECK (guest_uploads_enabled IN (0, 1)),
    require_guest_approval INTEGER NOT NULL DEFAULT 1 CHECK (require_guest_approval IN (0, 1)),
    photobooth_auto_approve INTEGER NOT NULL DEFAULT 1 CHECK (photobooth_auto_approve IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (wedding_id) REFERENCES weddings(id)
);

INSERT INTO wedding_settings (
    wedding_id,
    gallery_enabled,
    guest_uploads_enabled,
    require_guest_approval,
    photobooth_auto_approve
)
SELECT id, 1, 1, 1, 1
FROM weddings
WHERE slug = 'serena-enrico-2027';
