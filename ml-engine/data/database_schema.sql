-- SQLite database schema for storing emails and spam scan results
CREATE TABLE IF NOT EXISTS emails (
    id TEXT PRIMARY KEY,
    sender TEXT,
    recipient TEXT,
    subject TEXT,
    body TEXT,
    date TEXT,
    labels TEXT,
    read INTEGER,
    starred INTEGER
);

CREATE TABLE IF NOT EXISTS spam_results (
    email_id TEXT PRIMARY KEY,
    is_spam INTEGER,
    spam_score REAL,
    ml_prediction TEXT,
    ml_probability REAL,
    scanned_at TEXT,
    FOREIGN KEY(email_id) REFERENCES emails(id)
);
