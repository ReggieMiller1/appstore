const express = require("express");
const { db } = require("../db");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

// ---- Public: submit a contact message ----
router.post("/", (req, res) => {
  const { name, email, subject, message } = req.body || {};
  if (!name || !email || !subject || !message) {
    return res.status(400).json({ error: "Name, email, subject, and message are all required." });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "Please provide a valid email address." });
  }

  const info = db
    .prepare("INSERT INTO contact_messages (name, email, subject, message) VALUES (?, ?, ?, ?)")
    .run(name.trim(), email.trim(), subject.trim(), message.trim());

  res.status(201).json({ id: info.lastInsertRowid, success: true });
});

// ---- Admin: list messages ----
router.get("/", requireAuth, (req, res) => {
  const { status } = req.query;
  let rows = db.prepare("SELECT * FROM contact_messages ORDER BY created_at DESC").all();
  if (status && status !== "all") rows = rows.filter((m) => m.status === status);
  res.json({ messages: rows });
});

// ---- Admin: mark read/unread ----
router.patch("/:id", requireAuth, (req, res) => {
  const { status } = req.body || {};
  if (!["read", "unread"].includes(status)) {
    return res.status(400).json({ error: "status must be 'read' or 'unread'." });
  }
  const info = db.prepare("UPDATE contact_messages SET status = ? WHERE id = ?").run(status, req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: "Message not found." });
  res.json({ message: db.prepare("SELECT * FROM contact_messages WHERE id = ?").get(req.params.id) });
});

// ---- Admin: delete a message ----
router.delete("/:id", requireAuth, (req, res) => {
  const info = db.prepare("DELETE FROM contact_messages WHERE id = ?").run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: "Message not found." });
  res.json({ success: true });
});

module.exports = router;
