CREATE TABLE weddings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT NOT NULL UNIQUE,
    bride_name TEXT NOT NULL,
    groom_name TEXT NOT NULL,
    wedding_date TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    theme TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO weddings (slug, bride_name, groom_name, wedding_date, status)
VALUES ('serena-enrico-2027', 'Serena', 'Enrico', '2027-07-24', 'active');
