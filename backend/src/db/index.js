const path = require("path");
const fs = require("fs");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");

const DB_PATH = path.join(__dirname, "..", "..", "data", "cms.sqlite3");
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS apps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  short_description TEXT DEFAULT '',
  long_description TEXT DEFAULT '',
  icon_path TEXT,
  version TEXT DEFAULT '0.1.0',
  category TEXT DEFAULT 'Other',
  developer TEXT DEFAULT '',
  size_label TEXT,
  release_date TEXT,
  updated_date TEXT,
  github_url TEXT,
  website_url TEXT,
  featured INTEGER DEFAULT 0,
  status TEXT DEFAULT 'draft', -- draft | published | unpublished
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS app_platforms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  app_id INTEGER NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  platform TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_technologies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  app_id INTEGER NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  technology TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_features (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  app_id INTEGER NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS app_screenshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  app_id INTEGER NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS app_downloads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  app_id INTEGER NOT NULL REFERENCES apps(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  version TEXT,
  filename TEXT,
  path TEXT,             -- local storage path (self-hosted files)
  external_url TEXT,     -- OR an external download URL instead of a hosted file
  size_bytes INTEGER,
  release_date TEXT,
  download_count INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  image_path TEXT,
  status TEXT DEFAULT 'Completed',
  publish_status TEXT DEFAULT 'draft', -- draft | published | unpublished
  github_url TEXT,
  live_url TEXT,
  featured INTEGER DEFAULT 0,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS project_technologies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  technology TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS project_features (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  feature TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS skill_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS skills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL REFERENCES skill_categories(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0,
  featured INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS timeline_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  year TEXT,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS what_i_build (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS site_settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS social_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform TEXT NOT NULL,
  url TEXT NOT NULL,
  sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS contact_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  subject TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT DEFAULT 'unread', -- unread | read
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS download_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  app_download_id INTEGER REFERENCES app_downloads(id) ON DELETE SET NULL,
  app_id INTEGER,
  platform TEXT,
  downloaded_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS site_views (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  path TEXT,
  viewed_at TEXT DEFAULT (datetime('now'))
);
`);

function seedAdmin() {
  const email =  "smirfpiano@gmail.com";
  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
  if (!existing) {
    const password ="iamsmirfmiller";
    const hash = bcrypt.hashSync(password, 10);
    db.prepare("INSERT INTO users (email, password_hash) VALUES (?, ?)").run(email, hash);
    console.log(`[seed] Created admin user: ${email}`);
  }
}

function seedSettings() {
  const count = db.prepare("SELECT COUNT(*) as c FROM site_settings").get().c;
  if (count > 0) return;

  const defaults = {
    name: "[YOUR NAME]",
    role: "Full-Stack & Mobile Developer",
    tagline: "I Build Digital Products That Solve Real Problems.",
    description:
      "Explore my applications, projects, and experiments — built with modern technologies and designed with real users in mind.",
    email: "[YOUR EMAIL]",
    github: "[GITHUB URL]",
    linkedin: "[LINKEDIN URL]",
    location: "Eswatini",
    about_intro:
      "I'm a developer who enjoys building complete, working products — not just prototypes. My focus is on software that performs reliably in the real world.",
  };
  const insert = db.prepare("INSERT INTO site_settings (key, value) VALUES (?, ?)");
  const tx = db.transaction((entries) => {
    for (const [k, v] of Object.entries(entries)) insert.run(k, v);
  });
  tx(defaults);
  console.log("[seed] Inserted default site settings");
}

module.exports = { db, seedAdmin, seedSettings };
