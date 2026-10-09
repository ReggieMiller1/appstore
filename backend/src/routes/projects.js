const express = require("express");
const path = require("path");
const fs = require("fs");
const slugify = require("slugify");
const { db } = require("../db");
const { requireAuth } = require("../middleware/auth");
const { uploadProjectImage } = require("../middleware/upload");
const { getFullProject } = require("../utils/serializers");

const router = express.Router();

function findProjectRow(idOrSlug) {
  if (/^\d+$/.test(idOrSlug)) {
    return db.prepare("SELECT * FROM projects WHERE id = ?").get(Number(idOrSlug));
  }
  return db.prepare("SELECT * FROM projects WHERE slug = ?").get(idOrSlug);
}

function uniqueSlug(base) {
  let slug = slugify(base, { lower: true, strict: true }) || "project";
  let n = 1;
  while (db.prepare("SELECT 1 FROM projects WHERE slug = ?").get(slug)) {
    n += 1;
    slug = `${slugify(base, { lower: true, strict: true })}-${n}`;
  }
  return slug;
}

router.get("/", (req, res) => {
  const isAuthed = !!req.headers.authorization;
  let rows = db.prepare("SELECT * FROM projects ORDER BY sort_order, created_at DESC").all();
  if (!isAuthed) rows = rows.filter((r) => r.publish_status === "published");
  res.json({ projects: rows.map(getFullProject) });
});

router.get("/:idOrSlug", (req, res) => {
  const row = findProjectRow(req.params.idOrSlug);
  if (!row) return res.status(404).json({ error: "Project not found." });
  if (row.publish_status !== "published" && !req.headers.authorization) {
    return res.status(404).json({ error: "Project not found." });
  }
  res.json({ project: getFullProject(row) });
});

router.post("/", requireAuth, (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: "Name is required." });

  const slug = b.slug ? slugify(b.slug, { lower: true, strict: true }) : uniqueSlug(b.name);
  if (db.prepare("SELECT 1 FROM projects WHERE slug = ?").get(slug)) {
    return res.status(409).json({ error: `Slug "${slug}" is already in use.` });
  }

  const info = db
    .prepare(
      `INSERT INTO projects (slug, name, description, status, publish_status, github_url, live_url, featured)
       VALUES (@slug, @name, @description, @status, @publish_status, @github_url, @live_url, @featured)`
    )
    .run({
      slug,
      name: b.name,
      description: b.description || "",
      status: b.status || "In Progress",
      publish_status: b.publishStatus || "draft",
      github_url: b.githubUrl || null,
      live_url: b.liveUrl || null,
      featured: b.featured ? 1 : 0,
    });

  const projectId = info.lastInsertRowid;
  (b.technologies || []).forEach((t) =>
    db.prepare("INSERT INTO project_technologies (project_id, technology) VALUES (?, ?)").run(projectId, t)
  );
  (b.features || []).forEach((f, i) =>
    db.prepare("INSERT INTO project_features (project_id, feature, sort_order) VALUES (?, ?, ?)").run(projectId, f, i)
  );

  const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(projectId);
  res.status(201).json({ project: getFullProject(row) });
});

router.put("/:id", requireAuth, (req, res) => {
  const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "Project not found." });

  const b = req.body || {};
  const merged = {
    slug: b.slug ? slugify(b.slug, { lower: true, strict: true }) : row.slug,
    name: b.name ?? row.name,
    description: b.description ?? row.description,
    status: b.status ?? row.status,
    publish_status: b.publishStatus ?? row.publish_status,
    github_url: b.githubUrl ?? row.github_url,
    live_url: b.liveUrl ?? row.live_url,
    featured: b.featured !== undefined ? (b.featured ? 1 : 0) : row.featured,
  };

  if (merged.slug !== row.slug && db.prepare("SELECT 1 FROM projects WHERE slug = ? AND id != ?").get(merged.slug, row.id)) {
    return res.status(409).json({ error: `Slug "${merged.slug}" is already in use.` });
  }

  db.prepare(
    `UPDATE projects SET slug=@slug, name=@name, description=@description, status=@status,
       publish_status=@publish_status, github_url=@github_url, live_url=@live_url, featured=@featured,
       updated_at=datetime('now')
     WHERE id=@id`
  ).run({ ...merged, id: row.id });

  if (b.technologies) {
    db.prepare("DELETE FROM project_technologies WHERE project_id = ?").run(row.id);
    b.technologies.forEach((t) =>
      db.prepare("INSERT INTO project_technologies (project_id, technology) VALUES (?, ?)").run(row.id, t)
    );
  }
  if (b.features) {
    db.prepare("DELETE FROM project_features WHERE project_id = ?").run(row.id);
    b.features.forEach((f, i) =>
      db.prepare("INSERT INTO project_features (project_id, feature, sort_order) VALUES (?, ?, ?)").run(row.id, f, i)
    );
  }

  const updated = db.prepare("SELECT * FROM projects WHERE id = ?").get(row.id);
  res.json({ project: getFullProject(updated) });
});

router.delete("/:id", requireAuth, (req, res) => {
  const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "Project not found." });

  if (row.image_path) {
    const p = path.join(__dirname, "..", "..", row.image_path.replace(/^\/uploads\//, "uploads/"));
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  db.prepare("DELETE FROM projects WHERE id = ?").run(row.id);
  res.json({ success: true });
});

router.post("/:id/publish", requireAuth, (req, res) => {
  db.prepare("UPDATE projects SET publish_status='published', updated_at=datetime('now') WHERE id = ?").run(req.params.id);
  const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "Project not found." });
  res.json({ project: getFullProject(row) });
});

router.post("/:id/unpublish", requireAuth, (req, res) => {
  db.prepare("UPDATE projects SET publish_status='unpublished', updated_at=datetime('now') WHERE id = ?").run(req.params.id);
  const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "Project not found." });
  res.json({ project: getFullProject(row) });
});

router.post("/:id/image", requireAuth, uploadProjectImage.single("image"), (req, res) => {
  const row = db.prepare("SELECT * FROM projects WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "Project not found." });
  if (!req.file) return res.status(400).json({ error: "No file uploaded." });

  const publicPath = `/uploads/projects/${req.file.filename}`;
  db.prepare("UPDATE projects SET image_path = ?, updated_at=datetime('now') WHERE id = ?").run(publicPath, row.id);
  res.json({ image: publicPath });
});

module.exports = router;
