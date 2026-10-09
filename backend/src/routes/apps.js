const express = require("express");
const path = require("path");
const fs = require("fs");
const slugify = require("slugify");
const { db } = require("../db");
const { requireAuth } = require("../middleware/auth");
const { uploadIcon, uploadScreenshots, uploadAppFile } = require("../middleware/upload");
const { getFullApp } = require("../utils/serializers");

const router = express.Router();

function findAppRow(idOrSlug) {
  if (/^\d+$/.test(idOrSlug)) {
    return db.prepare("SELECT * FROM apps WHERE id = ?").get(Number(idOrSlug));
  }
  return db.prepare("SELECT * FROM apps WHERE slug = ?").get(idOrSlug);
}

function uniqueSlug(base) {
  let slug = slugify(base, { lower: true, strict: true }) || "app";
  let n = 1;
  while (db.prepare("SELECT 1 FROM apps WHERE slug = ?").get(slug)) {
    n += 1;
    slug = `${slugify(base, { lower: true, strict: true })}-${n}`;
  }
  return slug;
}

// ---- Public: list apps ----
router.get("/", (req, res) => {
  const isAuthed = !!req.headers.authorization;
  const { category, platform, search, status } = req.query;

  let rows = db.prepare("SELECT * FROM apps ORDER BY sort_order, created_at DESC").all();

  if (!isAuthed) {
    rows = rows.filter((r) => r.status === "published");
  } else if (status && status !== "all") {
    rows = rows.filter((r) => r.status === status);
  }

  let apps = rows.map(getFullApp);

  if (category) apps = apps.filter((a) => a.category === category);
  if (platform) apps = apps.filter((a) => a.platform.includes(platform));
  if (search) {
    const q = String(search).toLowerCase();
    apps = apps.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        a.description.toLowerCase().includes(q) ||
        a.technologies.some((t) => t.toLowerCase().includes(q))
    );
  }

  res.json({ apps });
});

// ---- Public: get one app by slug or id ----
router.get("/:idOrSlug", (req, res) => {
  const row = findAppRow(req.params.idOrSlug);
  if (!row) return res.status(404).json({ error: "App not found." });
  if (row.status !== "published" && !req.headers.authorization) {
    return res.status(404).json({ error: "App not found." });
  }
  res.json({ app: getFullApp(row) });
});

// ---- Admin: create app ----
router.post("/", requireAuth, (req, res) => {
  const b = req.body || {};
  if (!b.name) return res.status(400).json({ error: "Name is required." });

  const slug = b.slug ? slugify(b.slug, { lower: true, strict: true }) : uniqueSlug(b.name);
  if (db.prepare("SELECT 1 FROM apps WHERE slug = ?").get(slug)) {
    return res.status(409).json({ error: `Slug "${slug}" is already in use.` });
  }

  const info = db
    .prepare(
      `INSERT INTO apps
        (slug, name, short_description, long_description, version, category, developer,
         size_label, release_date, updated_date, github_url, website_url, featured, status)
       VALUES (@slug, @name, @short_description, @long_description, @version, @category, @developer,
         @size_label, @release_date, @updated_date, @github_url, @website_url, @featured, @status)`
    )
    .run({
      slug,
      name: b.name,
      short_description: b.description || "",
      long_description: b.longDescription || "",
      version: b.version || "0.1.0",
      category: b.category || "Other",
      developer: b.developer || "",
      size_label: b.size || null,
      release_date: b.releaseDate || null,
      updated_date: b.updatedDate || null,
      github_url: b.githubUrl || null,
      website_url: b.websiteUrl || null,
      featured: b.featured ? 1 : 0,
      status: b.status || "draft",
    });

  const appId = info.lastInsertRowid;

  (b.platform || []).forEach((p) =>
    db.prepare("INSERT INTO app_platforms (app_id, platform) VALUES (?, ?)").run(appId, p)
  );
  (b.technologies || []).forEach((t) =>
    db.prepare("INSERT INTO app_technologies (app_id, technology) VALUES (?, ?)").run(appId, t)
  );
  (b.features || []).forEach((f, i) =>
    db
      .prepare("INSERT INTO app_features (app_id, title, description, sort_order) VALUES (?, ?, ?, ?)")
      .run(appId, f.title, f.description || "", i)
  );

  const row = db.prepare("SELECT * FROM apps WHERE id = ?").get(appId);
  res.status(201).json({ app: getFullApp(row) });
});

// ---- Admin: update app ----
router.put("/:id", requireAuth, (req, res) => {
  const row = db.prepare("SELECT * FROM apps WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "App not found." });

  const b = req.body || {};
  const merged = {
    slug: b.slug ? slugify(b.slug, { lower: true, strict: true }) : row.slug,
    name: b.name ?? row.name,
    short_description: b.description ?? row.short_description,
    long_description: b.longDescription ?? row.long_description,
    version: b.version ?? row.version,
    category: b.category ?? row.category,
    developer: b.developer ?? row.developer,
    size_label: b.size ?? row.size_label,
    release_date: b.releaseDate ?? row.release_date,
    updated_date: b.updatedDate ?? row.updated_date,
    github_url: b.githubUrl ?? row.github_url,
    website_url: b.websiteUrl ?? row.website_url,
    featured: b.featured !== undefined ? (b.featured ? 1 : 0) : row.featured,
    status: b.status ?? row.status,
  };

  if (merged.slug !== row.slug && db.prepare("SELECT 1 FROM apps WHERE slug = ? AND id != ?").get(merged.slug, row.id)) {
    return res.status(409).json({ error: `Slug "${merged.slug}" is already in use.` });
  }

  db.prepare(
    `UPDATE apps SET slug=@slug, name=@name, short_description=@short_description,
       long_description=@long_description, version=@version, category=@category, developer=@developer,
       size_label=@size_label, release_date=@release_date, updated_date=@updated_date,
       github_url=@github_url, website_url=@website_url, featured=@featured, status=@status,
       updated_at=datetime('now')
     WHERE id=@id`
  ).run({ ...merged, id: row.id });

  if (b.platform) {
    db.prepare("DELETE FROM app_platforms WHERE app_id = ?").run(row.id);
    b.platform.forEach((p) =>
      db.prepare("INSERT INTO app_platforms (app_id, platform) VALUES (?, ?)").run(row.id, p)
    );
  }
  if (b.technologies) {
    db.prepare("DELETE FROM app_technologies WHERE app_id = ?").run(row.id);
    b.technologies.forEach((t) =>
      db.prepare("INSERT INTO app_technologies (app_id, technology) VALUES (?, ?)").run(row.id, t)
    );
  }
  if (b.features) {
    db.prepare("DELETE FROM app_features WHERE app_id = ?").run(row.id);
    b.features.forEach((f, i) =>
      db
        .prepare("INSERT INTO app_features (app_id, title, description, sort_order) VALUES (?, ?, ?, ?)")
        .run(row.id, f.title, f.description || "", i)
    );
  }

  const updated = db.prepare("SELECT * FROM apps WHERE id = ?").get(row.id);
  res.json({ app: getFullApp(updated) });
});

// ---- Admin: delete app ----
router.delete("/:id", requireAuth, (req, res) => {
  const row = db.prepare("SELECT * FROM apps WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "App not found." });

  // Clean up files on disk for downloads, icon, and screenshots.
  const downloads = db.prepare("SELECT path FROM app_downloads WHERE app_id = ?").all(row.id);
  downloads.forEach((d) => d.path && fs.existsSync(d.path) && fs.unlinkSync(d.path));
  const screenshots = db.prepare("SELECT path FROM app_screenshots WHERE app_id = ?").all(row.id);
  screenshots.forEach((s) => {
    const p = path.join(__dirname, "..", "..", s.path.replace(/^\/uploads\//, "uploads/"));
    if (fs.existsSync(p)) fs.unlinkSync(p);
  });

  db.prepare("DELETE FROM apps WHERE id = ?").run(row.id);
  res.json({ success: true });
});

// ---- Admin: publish / unpublish ----
router.post("/:id/publish", requireAuth, (req, res) => {
  db.prepare("UPDATE apps SET status='published', updated_at=datetime('now') WHERE id = ?").run(req.params.id);
  const row = db.prepare("SELECT * FROM apps WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "App not found." });
  res.json({ app: getFullApp(row) });
});

router.post("/:id/unpublish", requireAuth, (req, res) => {
  db.prepare("UPDATE apps SET status='unpublished', updated_at=datetime('now') WHERE id = ?").run(req.params.id);
  const row = db.prepare("SELECT * FROM apps WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "App not found." });
  res.json({ app: getFullApp(row) });
});

// ---- Admin: upload icon ----
router.post("/:id/icon", requireAuth, uploadIcon.single("icon"), (req, res) => {
  const row = db.prepare("SELECT * FROM apps WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "App not found." });
  if (!req.file) return res.status(400).json({ error: "No file uploaded." });

  const publicPath = `/uploads/icons/${req.file.filename}`;
  db.prepare("UPDATE apps SET icon_path = ?, updated_at=datetime('now') WHERE id = ?").run(publicPath, row.id);
  res.json({ icon: publicPath });
});

// ---- Admin: upload screenshots (multiple) ----
router.post("/:id/screenshots", requireAuth, uploadScreenshots.array("screenshots", 20), (req, res) => {
  const row = db.prepare("SELECT * FROM apps WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "App not found." });
  if (!req.files || req.files.length === 0) {
    return res.status(400).json({ error: "No files uploaded." });
  }

  const maxOrder = db
    .prepare("SELECT COALESCE(MAX(sort_order), -1) as m FROM app_screenshots WHERE app_id = ?")
    .get(row.id).m;

  const inserted = req.files.map((file, i) => {
    const publicPath = `/uploads/screenshots/${file.filename}`;
    const info = db
      .prepare("INSERT INTO app_screenshots (app_id, path, sort_order) VALUES (?, ?, ?)")
      .run(row.id, publicPath, maxOrder + 1 + i);
    return { id: info.lastInsertRowid, path: publicPath, sort_order: maxOrder + 1 + i };
  });

  res.status(201).json({ screenshots: inserted });
});

// ---- Admin: delete a screenshot ----
router.delete("/:id/screenshots/:screenshotId", requireAuth, (req, res) => {
  const shot = db
    .prepare("SELECT * FROM app_screenshots WHERE id = ? AND app_id = ?")
    .get(req.params.screenshotId, req.params.id);
  if (!shot) return res.status(404).json({ error: "Screenshot not found." });

  const filePath = path.join(__dirname, "..", "..", shot.path.replace(/^\/uploads\//, "uploads/"));
  if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

  db.prepare("DELETE FROM app_screenshots WHERE id = ?").run(shot.id);
  res.json({ success: true });
});

// ---- Admin: reorder screenshots ----
router.put("/:id/screenshots/reorder", requireAuth, (req, res) => {
  const order = req.body?.order; // [{ id, sortOrder }]
  if (!Array.isArray(order)) return res.status(400).json({ error: "Body must include an `order` array." });

  const tx = db.transaction((items) => {
    for (const item of items) {
      db.prepare("UPDATE app_screenshots SET sort_order = ? WHERE id = ? AND app_id = ?").run(
        item.sortOrder,
        item.id,
        req.params.id
      );
    }
  });
  tx(order);

  const screenshots = db
    .prepare("SELECT id, path, sort_order FROM app_screenshots WHERE app_id = ? ORDER BY sort_order")
    .all(req.params.id);
  res.json({ screenshots });
});

// ---- Admin: add a platform download (file upload OR external URL) ----
router.post("/:id/downloads", requireAuth, uploadAppFile.single("file"), (req, res) => {
  const row = db.prepare("SELECT * FROM apps WHERE id = ?").get(req.params.id);
  if (!row) return res.status(404).json({ error: "App not found." });

  const { platform, version, externalUrl, releaseDate } = req.body;
  if (!platform) return res.status(400).json({ error: "Platform is required." });
  if (!req.file && !externalUrl) {
    return res.status(400).json({ error: "Provide either a file upload or an externalUrl." });
  }

  const info = db
    .prepare(
      `INSERT INTO app_downloads (app_id, platform, version, filename, path, external_url, size_bytes, release_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      row.id,
      platform,
      version || row.version,
      req.file ? req.file.originalname : null,
      req.file ? path.join(__dirname, "..", "..", "uploads", "files", req.file.filename) : null,
      req.file ? null : externalUrl,
      req.file ? req.file.size : null,
      releaseDate || null
    );

  const download = db.prepare("SELECT * FROM app_downloads WHERE id = ?").get(info.lastInsertRowid);
  res.status(201).json({
    download: {
      ...download,
      url: download.external_url || `/api/apps/${row.id}/downloads/${download.id}/file`,
    },
  });
});

// ---- Admin: remove a platform download ----
router.delete("/:id/downloads/:downloadId", requireAuth, (req, res) => {
  const dl = db
    .prepare("SELECT * FROM app_downloads WHERE id = ? AND app_id = ?")
    .get(req.params.downloadId, req.params.id);
  if (!dl) return res.status(404).json({ error: "Download not found." });

  if (dl.path && fs.existsSync(dl.path)) fs.unlinkSync(dl.path);
  db.prepare("DELETE FROM app_downloads WHERE id = ?").run(dl.id);
  res.json({ success: true });
});

// ---- Public: stream/redirect a download and log stats ----
router.get("/:id/downloads/:downloadId/file", (req, res) => {
  const dl = db
    .prepare("SELECT * FROM app_downloads WHERE id = ? AND app_id = ?")
    .get(req.params.downloadId, req.params.id);
  if (!dl) return res.status(404).json({ error: "Download not found." });

  db.prepare("UPDATE app_downloads SET download_count = download_count + 1 WHERE id = ?").run(dl.id);
  db.prepare("INSERT INTO download_logs (app_download_id, app_id, platform) VALUES (?, ?, ?)").run(
    dl.id,
    dl.app_id,
    dl.platform
  );

  if (dl.external_url) return res.redirect(dl.external_url);
  if (dl.path && fs.existsSync(dl.path)) {
    return res.download(dl.path, dl.filename || path.basename(dl.path));
  }
  res.status(404).json({ error: "File is not available." });
});

module.exports = router;
