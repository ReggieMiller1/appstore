const express = require("express");
const { db } = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

// ---- Public: record a page view (called by the website) ----
router.post("/view", (req, res) => {
  const { path: viewedPath } = req.body || {};
  db.prepare("INSERT INTO site_views (path) VALUES (?)").run(viewedPath || "/");
  res.status(204).end();
});

// ---- Admin: dashboard summary ----
router.get("/dashboard", requireAuth, (req, res) => {
  const totalApps = db.prepare("SELECT COUNT(*) c FROM apps").get().c;
  const publishedApps = db.prepare("SELECT COUNT(*) c FROM apps WHERE status = 'published'").get().c;
  const totalProjects = db.prepare("SELECT COUNT(*) c FROM projects").get().c;
  const totalDownloads = db.prepare("SELECT COALESCE(SUM(download_count), 0) c FROM app_downloads").get().c;
  const unreadMessages = db.prepare("SELECT COUNT(*) c FROM contact_messages WHERE status = 'unread'").get().c;
  const websiteViews = db.prepare("SELECT COUNT(*) c FROM site_views").get().c;

  const recentApps = db
    .prepare(
      `SELECT a.id, a.name, a.version, a.status,
        (SELECT platform FROM app_platforms WHERE app_id = a.id LIMIT 1) as platform
       FROM apps a ORDER BY a.updated_at DESC LIMIT 5`
    )
    .all();

  const recentDownloads = db
    .prepare(
      `SELECT dl.downloaded_at as date, dl.platform, a.name as application, ad.version
       FROM download_logs dl
       LEFT JOIN app_downloads ad ON ad.id = dl.app_download_id
       LEFT JOIN apps a ON a.id = dl.app_id
       ORDER BY dl.downloaded_at DESC LIMIT 10`
    )
    .all();

  const recentMessages = db
    .prepare("SELECT id, name, subject, created_at as date, status FROM contact_messages ORDER BY created_at DESC LIMIT 10")
    .all();

  // Downloads per day for the last 14 days (for a simple chart)
  const downloadsByDay = db
    .prepare(
      `SELECT date(downloaded_at) as day, COUNT(*) as count
       FROM download_logs
       WHERE downloaded_at >= datetime('now', '-14 days')
       GROUP BY day ORDER BY day`
    )
    .all();

  res.json({
    totals: {
      totalApps,
      publishedApps,
      totalProjects,
      totalDownloads,
      unreadMessages,
      websiteViews,
    },
    recentApps,
    recentDownloads,
    recentMessages,
    downloadsByDay,
  });
});

// ---- Admin: detailed download stats ----
router.get("/downloads", requireAuth, (req, res) => {
  const perApp = db
    .prepare(
      `SELECT a.id as appId, a.name, ad.platform, ad.version, ad.download_count
       FROM app_downloads ad JOIN apps a ON a.id = ad.app_id
       ORDER BY ad.download_count DESC`
    )
    .all();
  res.json({ perApp });
});

module.exports = router;
