const multer = require("multer");
const path = require("path");
const fs = require("fs");

const UPLOAD_ROOT = path.join(__dirname, "..", "..", "uploads");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function makeStorage(subdir) {
  const dir = path.join(UPLOAD_ROOT, subdir);
  ensureDir(dir);
  return multer.diskStorage({
    destination: (req, file, cb) => cb(null, dir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname);
      const base = path
        .basename(file.originalname, ext)
        .replace(/[^a-z0-9-_]/gi, "-")
        .toLowerCase();
      const unique = `${base}-${Date.now()}${ext}`;
      cb(null, unique);
    },
  });
}

const imageFilter = (req, file, cb) => {
  if (/^image\//.test(file.mimetype)) cb(null, true);
  else cb(new Error("Only image files are allowed."));
};

const uploadIcon = multer({
  storage: makeStorage("icons"),
  fileFilter: imageFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

const uploadScreenshots = multer({
  storage: makeStorage("screenshots"),
  fileFilter: imageFilter,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB each
});

// Application binaries: apk / exe / zip / tar.gz — large, no mimetype filtering
// since Windows/browsers report these inconsistently.
const uploadAppFile = multer({
  storage: makeStorage("files"),
  limits: { fileSize: 2 * 1024 * 1024 * 1024 }, // 2GB
});

const uploadProjectImage = multer({
  storage: makeStorage("projects"),
  fileFilter: imageFilter,
  limits: { fileSize: 10 * 1024 * 1024 },
});

module.exports = { uploadIcon, uploadScreenshots, uploadAppFile, uploadProjectImage, UPLOAD_ROOT };
