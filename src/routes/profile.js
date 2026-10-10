const express = require("express");
const { db } = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

function getSettings() {
  const rows = db.prepare("SELECT key, value FROM site_settings").all();
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

function getSkillCategories() {
  const cats = db.prepare("SELECT * FROM skill_categories ORDER BY sort_order").all();
  return cats.map((cat) => ({
    id: cat.id,
    category: cat.category,
    skills: db
      .prepare("SELECT id, name, featured FROM skills WHERE category_id = ? ORDER BY sort_order")
      .all(cat.id)
      .map((s) => s.name),
  }));
}

function getFeaturedSkills() {
  return db
    .prepare("SELECT name FROM skills WHERE featured = 1 ORDER BY sort_order")
    .all()
    .map((s) => s.name);
}

function getTimeline() {
  return db.prepare("SELECT id, year, title, description FROM timeline_entries ORDER BY sort_order").all();
}

function getWhatIBuild() {
  return db.prepare("SELECT id, label FROM what_i_build ORDER BY sort_order").all().map((r) => r.label);
}

function getSocialLinks() {
  return db.prepare("SELECT id, platform, url FROM social_links ORDER BY sort_order").all();
}

// ---- Public: full profile bundle for the website ----
router.get("/", (req, res) => {
  res.json({
    settings: getSettings(),
    skillCategories: getSkillCategories(),
    featuredSkills: getFeaturedSkills(),
    timeline: getTimeline(),
    whatIBuild: getWhatIBuild(),
    socialLinks: getSocialLinks(),
  });
});

// ---- Admin: update site settings (key/value merge) ----
router.put("/settings", requireAuth, (req, res) => {
  const updates = req.body || {};
  const upsert = db.prepare(
    "INSERT INTO site_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  );
  const tx = db.transaction((entries) => {
    for (const [k, v] of Object.entries(entries)) upsert.run(k, String(v ?? ""));
  });
  tx(updates);
  res.json({ settings: getSettings() });
});

// ---- Admin: replace skill categories wholesale ----
router.put("/skills", requireAuth, (req, res) => {
  const categories = req.body?.categories; // [{ category, skills: [{ name, featured }] }]
  if (!Array.isArray(categories)) return res.status(400).json({ error: "Body must include a `categories` array." });

  const tx = db.transaction(() => {
    db.prepare("DELETE FROM skills").run();
    db.prepare("DELETE FROM skill_categories").run();
    categories.forEach((cat, i) => {
      const info = db.prepare("INSERT INTO skill_categories (category, sort_order) VALUES (?, ?)").run(cat.category, i);
      (cat.skills || []).forEach((s, j) => {
        const name = typeof s === "string" ? s : s.name;
        const featured = typeof s === "string" ? 0 : s.featured ? 1 : 0;
        db.prepare("INSERT INTO skills (category_id, name, sort_order, featured) VALUES (?, ?, ?, ?)").run(
          info.lastInsertRowid,
          name,
          j,
          featured
        );
      });
    });
  });
  tx();
  res.json({ skillCategories: getSkillCategories(), featuredSkills: getFeaturedSkills() });
});

// ---- Admin: replace timeline wholesale ----
router.put("/timeline", requireAuth, (req, res) => {
  const entries = req.body?.entries; // [{ year, title, description }]
  if (!Array.isArray(entries)) return res.status(400).json({ error: "Body must include an `entries` array." });

  const tx = db.transaction(() => {
    db.prepare("DELETE FROM timeline_entries").run();
    entries.forEach((e, i) =>
      db
        .prepare("INSERT INTO timeline_entries (year, title, description, sort_order) VALUES (?, ?, ?, ?)")
        .run(e.year || "", e.title, e.description || "", i)
    );
  });
  tx();
  res.json({ timeline: getTimeline() });
});

// ---- Admin: replace "what I build" list wholesale ----
router.put("/what-i-build", requireAuth, (req, res) => {
  const items = req.body?.items;
  if (!Array.isArray(items)) return res.status(400).json({ error: "Body must include an `items` array." });

  const tx = db.transaction(() => {
    db.prepare("DELETE FROM what_i_build").run();
    items.forEach((label, i) => db.prepare("INSERT INTO what_i_build (label, sort_order) VALUES (?, ?)").run(label, i));
  });
  tx();
  res.json({ whatIBuild: getWhatIBuild() });
});

// ---- Admin: manage social links ----
router.put("/social-links", requireAuth, (req, res) => {
  const links = req.body?.links; // [{ platform, url }]
  if (!Array.isArray(links)) return res.status(400).json({ error: "Body must include a `links` array." });

  const tx = db.transaction(() => {
    db.prepare("DELETE FROM social_links").run();
    links.forEach((l, i) =>
      db.prepare("INSERT INTO social_links (platform, url, sort_order) VALUES (?, ?, ?)").run(l.platform, l.url, i)
    );
  });
  tx();
  res.json({ socialLinks: getSocialLinks() });
});

module.exports = router;
