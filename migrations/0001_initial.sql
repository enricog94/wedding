CREATE TABLE app_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

INSERT INTO app_config (key, value)
VALUES ('wedding_date', '2027-07-24');
