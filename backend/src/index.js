require("dotenv").config();
const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const path = require("path");

const { seedAdmin, seedSettings } = require("./db");

seedAdmin();
seedSettings();

const authRoutes = require("./routes/auth");
const appsRoutes = require("./routes/apps");
const projectsRoutes = require("./routes/projects");
const profileRoutes = require("./routes/profile");
const messagesRoutes = require("./routes/messages");
const statsRoutes = require("./routes/stats");

const app = express();

app.use(
  cors({
    origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(",") : "*",
  })
);
app.use(morgan("dev"));
app.use(express.json({ limit: "130mb" }));
app.use(express.urlencoded({ extended: true }));

// Serve uploaded icons/screenshots/project images directly as static files.
// (App binaries are served through the tracked /api/apps/:id/downloads/:id/file
// route instead, so downloads get counted.)
app.use("/uploads", express.static(path.join(__dirname, "..", "uploads")));

app.get("/api/health", (req, res) => res.json({ ok: true, time: new Date().toISOString() }));

app.use("/api/auth", authRoutes);
app.use("/api/apps", appsRoutes);
app.use("/api/projects", projectsRoutes);
app.use("/api/profile", profileRoutes);
app.use("/api/messages", messagesRoutes);
app.use("/api/stats", statsRoutes);

// Multer / generic error handler (keeps upload errors as clean JSON)
app.use((err, req, res, next) => {
  if (err) {
    console.error(err);
    const status = err.status || 400;
    return res.status(status).json({ error: err.message || "Something went wrong." });
  }
  next();
});

app.use((req, res) => res.status(404).json({ error: "Not found." }));

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`CMS backend listening on http://localhost:${PORT}`);
});
