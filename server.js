/* Node.js (Express) + Supabase (Postgres + Storage) port of the PHP/MySQL CMS API. Node 18+. */
import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { fileTypeFromBuffer } from 'file-type';
const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, JWT_SECRET, CORS_ORIGIN, PORT = 3000 } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !JWT_SECRET) {
  console.error('Missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY or JWT_SECRET in environment.');
  process.exit(1);
}

// Service-role key bypasses RLS. It must only ever live on this server.
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/* ------------------------------------------------------------------ helpers */
class HttpError extends Error {
  constructor(status, message, code) {
    super(message);
    this.status = status;
    this.code = code;
  }
}
const fail = (status, message, code) => { throw new HttpError(status, message, code); };
const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const must = ({ data, error }) => { if (error) throw error; return data; };
const slug = (s) =>
  String(s ?? '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'item';
const blank = (v) => (v === undefined || v === null || v === '' ? null : v);
const asArray = (v) => (Array.isArray(v) ? v : []);
const mb = (bytes) => `${Math.round((bytes / (1024 * 1024)) * 100) / 100}MB`;

async function count(table, filter) {
  let q = supabase.from(table).select('*', { count: 'exact', head: true });
  if (filter) q = filter(q);
  const { count: c, error } = await q;
  if (error) throw error;
  return c ?? 0;
}

/* --------------------------------------------------------------------- auth */
const bearer = (req) => (/^Bearer\s+(.+)$/i.exec(req.headers.authorization || '') || [])[1] || null;

function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET, { algorithms: ['HS256'] });
  } catch (e) {
    if (e.name === 'TokenExpiredError') fail(401, 'Session expired. Please log in again.', 'TOKEN_EXPIRED');
    fail(401, 'Invalid session token. Check that JWT_SECRET has not changed since login.', 'TOKEN_INVALID');
  }
}
function needAuth(req, _res, next) {
  const t = bearer(req);
  if (!t) return next(new HttpError(401, 'Missing or invalid Authorization header.', 'AUTH_HEADER_MISSING'));
  try { req.user = verifyToken(t); next(); } catch (e) { next(e); }
}
// Unlike the PHP version (which only checked that *some* Bearer string existed),
// this actually verifies the token before revealing drafts.
function optAuth(req, _res, next) {
  req.isAdmin = false;
  const t = bearer(req);
  if (t) {
    try { req.user = verifyToken(t); req.isAdmin = true; } catch { /* treat as anonymous */ }
  }
  next();
}

/* ------------------------------------------------------------------ storage */
const IMAGE_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif']);
const DOWNLOAD_EXT = new Set(['.apk', '.aab', '.zip', '.exe', '.msi', '.dmg', '.pkg', '.deb', '.appimage', '.ipa', '.7z']);
const BUCKETS = {
  icons: { public: true, fileSizeLimit: 5 * 1024 * 1024 },
  screenshots: { public: true, fileSizeLimit: 10 * 1024 * 1024 },
  projects: { public: true, fileSizeLimit: 10 * 1024 * 1024 },
  downloads: { public: true, fileSizeLimit: 50 * 1024 * 1024 }, // private: served via short-lived signed URLs
};

async function ensureBuckets() {
  for (const [name, opts] of Object.entries(BUCKETS)) {
    const { error } = await supabase.storage.createBucket(name, opts);
    if (error && !/already exists|duplicate/i.test(error.message)) console.warn(`Bucket "${name}":`, error.message);
  }
}
// DB stores "bucket/object-name"; split it back for the storage API.
const splitPath = (p) => { const i = p.indexOf('/'); return [p.slice(0, i), p.slice(i + 1)]; };
function publicUrl(p) {
  if (!p) return null;
  if (/^https?:\/\//i.test(p)) return p;
  const [bucket, obj] = splitPath(p);
  if (!BUCKETS[bucket]?.public) return null;
  return supabase.storage.from(bucket).getPublicUrl(obj).data.publicUrl;
}
async function putFile(bucket, file, contentType) {
  const ext = path.extname(file.originalname).toLowerCase();
  const name = `${slug(path.basename(file.originalname, ext))}-${crypto.randomBytes(5).toString('hex')}${ext}`;
  const { error } = await supabase.storage.from(bucket).upload(name, file.buffer, {
    contentType: contentType || file.mimetype || 'application/octet-stream',
    upsert: false,
  });
  if (error) throw error;
  return { path: `${bucket}/${name}`, name };
}
async function removeFiles(paths) {
  const byBucket = {};
  for (const p of paths.filter((x) => x && !/^https?:\/\//i.test(x))) {
    const [b, o] = splitPath(p);
    (byBucket[b] ||= []).push(o);
  }
  for (const [b, objs] of Object.entries(byBucket)) {
    const { error } = await supabase.storage.from(b).remove(objs);
    if (error) console.warn(`Could not remove from "${b}":`, error.message);
  }
}
const upload = (max) => multer({ storage: multer.memoryStorage(), limits: { fileSize: max } });

/* --------------------------------------------------------------- serializers */
const bySort = (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0);

const APP_SELECT = `*,
  app_platforms(platform),
  app_technologies(technology),
  app_features(id,title,description,sort_order),
  app_screenshots(id,path,sort_order),
  app_downloads(id,platform,version,filename,path,external_url,size_bytes,release_date,download_count,architecture)`;

function fullApp(r) {
  const shots = [...(r.app_screenshots || [])].sort(bySort)
    .map((s) => ({ id: s.id, path: publicUrl(s.path), sort_order: s.sort_order }));
  return {
    id: r.id, slug: r.slug, name: r.name,
    description: r.short_description, longDescription: r.long_description,
    icon: publicUrl(r.icon_path), version: r.version, category: r.category, developer: r.developer,
    size: r.size_label, releaseDate: r.release_date, updatedDate: r.updated_date,
    githubUrl: r.github_url, websiteUrl: r.website_url, featured: !!r.featured, status: r.status,
    platform: (r.app_platforms || []).map((x) => x.platform),
    technologies: (r.app_technologies || []).map((x) => x.technology),
    features: [...(r.app_features || [])].sort(bySort),
    screenshots: shots.map((s) => s.path),
    screenshotRecords: shots,
    downloads: (r.app_downloads || []).map((d) => ({
      ...d,
      url: d.external_url || (d.path ? `/api/apps/${r.id}/downloads/${d.id}/file` : null),
      architecture: d.architecture || null,
    })),
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

const PROJECT_SELECT = '*, project_technologies(technology), project_features(feature,sort_order)';
function fullProject(r) {
  return {
    id: r.id, slug: r.slug, name: r.name, description: r.description,
    image: publicUrl(r.image_path), status: r.status, publishStatus: r.publish_status,
    githubUrl: r.github_url, liveUrl: r.live_url, featured: !!r.featured,
    technologies: (r.project_technologies || []).map((x) => x.technology),
    features: [...(r.project_features || [])].sort(bySort).map((x) => x.feature),
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

const getApp = async (id) => must(await supabase.from('apps').select(APP_SELECT).eq('id', id).maybeSingle());
const getProject = async (id) => must(await supabase.from('projects').select(PROJECT_SELECT).eq('id', id).maybeSingle());

async function uniqueSlug(table, base) {
  let s = base, n = 2;
  for (; ;) {
    const row = must(await supabase.from(table).select('id').eq('slug', s).maybeSingle());
    if (!row) return s;
    s = `${base}-${n++}`;
  }
}

/* --------------------------------------------------------------------- app */
const app = express();
app.use(cors({ origin: CORS_ORIGIN || '*', allowedHeaders: ['Content-Type', 'Authorization'], methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] }));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

app.get('/api/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

app.get('/api/db', h(async (_req, res) => {
  const { error } = await supabase.from('site_settings').select('key').limit(1);
  if (error) {
    console.error(error);
    return res.status(500).json({ success: false, message: 'Database connection failed.' });
  }
  res.json({ success: true, message: 'Database connection successful!', test: 1 });
}));

/* ---- auth */
app.post('/api/auth/login', h(async (req, res) => {
  const { email = '', password = '' } = req.body || {};
  const u = must(await supabase.from('users').select('*').eq('email', String(email)).maybeSingle());
  // bcryptjs understands PHP's $2y$ hashes, so existing admin passwords keep working.
  if (!u || !(await bcrypt.compare(String(password), u.password_hash))) fail(401, 'Invalid email or password.');
  const token = jwt.sign({ email: u.email }, JWT_SECRET, { algorithm: 'HS256', subject: String(u.id), expiresIn: '7d' });
  res.json({ token, user: { id: u.id, email: u.email } });
}));
app.get('/api/auth/me', needAuth, (req, res) => res.json({ user: { id: Number(req.user.sub), email: req.user.email || '' } }));

/* ---- profile */
app.get('/api/profile', h(async (_req, res) => {
  const [settingsRows, cats, featured, timeline, wib, social] = await Promise.all([
    supabase.from('site_settings').select('key,value'),
    supabase.from('skill_categories').select('id,category,sort_order,skills(name,sort_order)').order('sort_order'),
    supabase.from('skills').select('name').eq('featured', true).order('sort_order'),
    supabase.from('timeline_entries').select('id,year,title,description').order('sort_order'),
    supabase.from('what_i_build').select('label').order('sort_order'),
    supabase.from('social_links').select('id,platform,url').order('sort_order'),
  ]);
  const settings = {};
  for (const x of must(settingsRows)) settings[x.key] = x.value;
  res.json({
    settings,
    skillCategories: must(cats).map((c) => ({
      id: c.id, category: c.category, sort_order: c.sort_order,
      skills: [...c.skills].sort(bySort).map((s) => s.name),
    })),
    featuredSkills: must(featured).map((x) => x.name),
    timeline: must(timeline),
    whatIBuild: must(wib).map((x) => x.label),
    socialLinks: must(social),
  });
}));

app.put('/api/profile/settings', needAuth, h(async (req, res) => {
  const rows = Object.entries(req.body || {}).map(([key, v]) => ({
    key, value: v !== null && typeof v === 'object' ? JSON.stringify(v) : String(v),
  }));
  if (rows.length) must(await supabase.from('site_settings').upsert(rows, { onConflict: 'key' }));
  const settings = {};
  for (const x of must(await supabase.from('site_settings').select('key,value'))) settings[x.key] = x.value;
  res.json({ settings });
}));

app.put('/api/profile/skills', needAuth, h(async (req, res) => {
  const cats = req.body?.categories;
  if (!Array.isArray(cats)) fail(400, 'Body must include a `categories` array.');
  must(await supabase.rpc('replace_skills', { p: cats })); // atomic, see schema.sql
  const [c, f] = await Promise.all([
    supabase.from('skill_categories').select('*').order('sort_order'),
    supabase.from('skills').select('name').eq('featured', true).order('sort_order'),
  ]);
  res.json({ skillCategories: must(c), featuredSkills: must(f).map((x) => x.name) });
}));

app.put('/api/profile/timeline', needAuth, h(async (req, res) => {
  const entries = req.body?.entries;
  if (!Array.isArray(entries)) fail(400, 'Body must include an `entries` array.');
  must(await supabase.from('timeline_entries').delete().gte('id', 0));
  if (entries.length) {
    must(await supabase.from('timeline_entries').insert(entries.map((e, i) => ({
      year: e.year ?? '', title: e.title ?? '', description: e.description ?? '', sort_order: i,
    }))));
  }
  res.json({ timeline: must(await supabase.from('timeline_entries').select('id,year,title,description').order('sort_order')) });
}));

app.put('/api/profile/what-i-build', needAuth, h(async (req, res) => {
  const items = req.body?.items;
  if (!Array.isArray(items)) fail(400, 'Body must include an `items` array.');
  must(await supabase.from('what_i_build').delete().gte('id', 0));
  if (items.length) must(await supabase.from('what_i_build').insert(items.map((label, i) => ({ label, sort_order: i }))));
  res.json({ whatIBuild: must(await supabase.from('what_i_build').select('label').order('sort_order')).map((x) => x.label) });
}));

app.put('/api/profile/social-links', needAuth, h(async (req, res) => {
  const links = req.body?.links;
  if (!Array.isArray(links)) fail(400, 'Body must include a `links` array.');
  must(await supabase.from('social_links').delete().gte('id', 0));
  if (links.length) {
    must(await supabase.from('social_links').insert(links.map((l, i) => ({ platform: l.platform ?? '', url: l.url ?? '', sort_order: i }))));
  }
  res.json({ socialLinks: must(await supabase.from('social_links').select('id,platform,url').order('sort_order')) });
}));

/* ---- contact messages */
app.post('/api/messages', h(async (req, res) => {
  const b = req.body || {};
  for (const k of ['name', 'email', 'subject', 'message']) {
    if (!b[k]) fail(400, 'Name, email, subject, and message are all required.');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(b.email).trim())) fail(400, 'Please provide a valid email address.');
  const row = must(await supabase.from('contact_messages').insert({
    name: String(b.name).trim(), email: String(b.email).trim(),
    subject: String(b.subject).trim(), message: String(b.message).trim(),
  }).select('id').single());
  res.status(201).json({ id: row.id, success: true });
}));

app.get('/api/messages', needAuth, h(async (req, res) => {
  let q = supabase.from('contact_messages').select('*').order('created_at', { ascending: false });
  if (req.query.status && req.query.status !== 'all') q = q.eq('status', req.query.status);
  res.json({ messages: must(await q) });
}));

app.patch('/api/messages/:id(\\d+)', needAuth, h(async (req, res) => {
  const status = req.body?.status;
  if (!['read', 'unread'].includes(status)) fail(400, "status must be 'read' or 'unread'.");
  const row = must(await supabase.from('contact_messages').update({ status }).eq('id', req.params.id).select().maybeSingle());
  if (!row) fail(404, 'Message not found.');
  res.json({ message: row });
}));

app.delete('/api/messages/:id(\\d+)', needAuth, h(async (req, res) => {
  must(await supabase.from('contact_messages').delete().eq('id', req.params.id));
  res.json({ success: true });
}));

/* ---- stats */
app.post('/api/stats/view', h(async (req, res) => {
  must(await supabase.from('site_views').insert({ path: String(req.body?.path || '/') }));
  res.status(204).end();
}));

app.get('/api/stats/dashboard', needAuth, h(async (_req, res) => {
  const since = new Date(Date.now() - 14 * 86400000).toISOString();
  const [totalApps, publishedApps, totalProjects, unreadMessages, websiteViews, dl, recentApps, recentLogs, recentMsgs, dayLogs] =
    await Promise.all([
      count('apps'),
      count('apps', (q) => q.eq('status', 'published')),
      count('projects'),
      count('contact_messages', (q) => q.eq('status', 'unread')),
      count('site_views'),
      supabase.from('app_downloads').select('download_count'),
      supabase.from('apps').select('id,name,version,status,app_platforms(platform)').order('updated_at', { ascending: false }).limit(5),
      supabase.from('download_logs').select('downloaded_at,platform,apps(name),app_downloads(version)').order('downloaded_at', { ascending: false }).limit(10),
      supabase.from('contact_messages').select('id,name,subject,created_at,status').order('created_at', { ascending: false }).limit(10),
      supabase.from('download_logs').select('downloaded_at').gte('downloaded_at', since),
    ]);
  const perDay = {};
  for (const l of must(dayLogs)) {
    const d = l.downloaded_at.slice(0, 10);
    perDay[d] = (perDay[d] || 0) + 1;
  }
  res.json({
    totals: {
      totalApps, publishedApps, totalProjects,
      totalDownloads: must(dl).reduce((n, r) => n + (r.download_count || 0), 0),
      unreadMessages, websiteViews,
    },
    recentApps: must(recentApps).map((a) => ({ id: a.id, name: a.name, version: a.version, status: a.status, platform: a.app_platforms?.[0]?.platform ?? null })),
    recentDownloads: must(recentLogs).map((l) => ({ date: l.downloaded_at, platform: l.platform, application: l.apps?.name ?? null, version: l.app_downloads?.version ?? null })),
    recentMessages: must(recentMsgs).map((m) => ({ id: m.id, name: m.name, subject: m.subject, date: m.created_at, status: m.status })),
    downloadsByDay: Object.keys(perDay).sort().map((day) => ({ day, count: perDay[day] })),
  });
}));

app.get('/api/stats/downloads', needAuth, h(async (_req, res) => {
  const rows = must(await supabase.from('app_downloads').select('app_id,platform,version,download_count,apps(name)').order('download_count', { ascending: false }));
  res.json({ perApp: rows.map((r) => ({ appId: r.app_id, name: r.apps?.name ?? null, platform: r.platform, version: r.version, download_count: r.download_count })) });
}));

/* ---- apps */
app.get('/api/apps', optAuth, h(async (req, res) => {
  let q = supabase.from('apps').select(APP_SELECT).order('sort_order').order('created_at', { ascending: false });
  if (!req.isAdmin) q = q.eq('status', 'published');
  else if (req.query.status && req.query.status !== 'all') q = q.eq('status', req.query.status);
  if (req.query.category) q = q.eq('category', req.query.category);
  let apps = must(await q).map(fullApp);
  if (req.query.platform) apps = apps.filter((a) => a.platform.includes(req.query.platform));
  if (req.query.search) {
    const s = String(req.query.search).toLowerCase();
    apps = apps.filter((a) => `${a.name} ${a.description} ${a.technologies.join(' ')}`.toLowerCase().includes(s));
  }
  res.json({ apps });
}));

app.get('/api/apps/:id', optAuth, h(async (req, res) => {
  const col = /^\d+$/.test(req.params.id) ? 'id' : 'slug';
  const r = must(await supabase.from('apps').select(APP_SELECT).eq(col, req.params.id).maybeSingle());
  if (!r || (r.status !== 'published' && !req.isAdmin)) fail(404, 'App not found.');
  res.json({ app: fullApp(r) });
}));

app.post('/api/apps', needAuth, h(async (req, res) => {
  const b = req.body || {};
  if (!b.name) fail(400, 'Name is required.');
  const s = await uniqueSlug('apps', slug(b.slug ?? b.name));
  const row = must(await supabase.from('apps').insert({
    slug: s, name: b.name, short_description: b.description ?? '', long_description: b.longDescription ?? '',
    version: b.version ?? '0.1.0', category: b.category ?? 'Other', developer: b.developer ?? '',
    size_label: blank(b.size), release_date: new Date().toISOString().slice(0, 10), updated_date: blank(b.updatedDate),
    github_url: blank(b.githubUrl), website_url: blank(b.websiteUrl), featured: !!b.featured, status: b.status ?? 'draft',
  }).select('id').single());
  const id = row.id;
  const plats = asArray(b.platform).map((platform) => ({ app_id: id, platform }));
  const techs = asArray(b.technologies).map((technology) => ({ app_id: id, technology }));
  const feats = asArray(b.features).map((x, i) => ({ app_id: id, title: x.title, description: x.description ?? '', sort_order: i }));
  if (plats.length) must(await supabase.from('app_platforms').insert(plats));
  if (techs.length) must(await supabase.from('app_technologies').insert(techs));
  if (feats.length) must(await supabase.from('app_features').insert(feats));
  res.status(201).json({ app: fullApp(await getApp(id)) });
}));

app.post('/api/apps/:id(\\d+)/:action(publish|unpublish)', needAuth, h(async (req, res) => {
  const { id, action } = req.params;
  if (!(await getApp(id))) fail(404, 'App not found.');
  must(await supabase.from('apps').update({ status: action === 'publish' ? 'published' : 'unpublished', updated_at: new Date().toISOString() }).eq('id', id));
  res.json({ app: fullApp(await getApp(id)) });
}));

app.post('/api/apps/:id(\\d+)/icon', needAuth, upload(5 * 1024 * 1024).single('icon'), h(async (req, res) => {
  const id = req.params.id;
  const existing = must(await supabase.from('apps').select('id,icon_path').eq('id', id).maybeSingle());
  if (!existing) fail(404, 'App not found.');
  if (!req.file) fail(400, 'No file uploaded.');
  if (!IMAGE_TYPES.has(req.file.mimetype)) fail(400, 'Only image files are allowed.');
  const f = await putFile('icons', req.file);
  must(await supabase.from('apps').update({ icon_path: f.path, updated_at: new Date().toISOString() }).eq('id', id));
  await removeFiles([existing.icon_path]);
  res.json({ icon: publicUrl(f.path) });
}));

app.post('/api/apps/:id(\\d+)/screenshots',
  needAuth,
  upload(10 * 1024 * 1024).array('screenshots', 20),
  h(async (req, res) => {

    const appId = Number(req.params.id);

    if (!(await getApp(appId))) fail(404, 'App not found.');

    const files = req.files || [];

    if (!files.length) fail(400, 'No files uploaded.');

    const last = must(
      await supabase
        .from('app_screenshots')
        .select('sort_order')
        .eq('app_id', appId)
        .order('sort_order', { ascending: false })
        .limit(1)
    );

    let max = last[0]?.sort_order ?? -1;

    const inserted = [];
    const errors = [];

    for (const file of files) {
      let stored;

      try {
        // Detect actual file type using its binary contents
        const detectedType = await fileTypeFromBuffer(file.buffer);

        console.log({
          filename: file.originalname,
          declaredMime: file.mimetype,
          detectedMime: detectedType?.mime,
          size: file.size
        });

        // Validate actual image format
        if (!detectedType || !IMAGE_TYPES.has(detectedType.mime)) {
          errors.push(
            `${file.originalname}: Unsupported or invalid image format.`
          );
          continue;
        }

        // Use the verified MIME type
        file.mimetype = detectedType.mime;

        // Upload file
        stored = await putFile('screenshots', file);

        const sort_order = ++max;

        const row = must(
          await supabase
            .from('app_screenshots')
            .insert({
              app_id: appId,
              path: stored.path,
              sort_order
            })
            .select('id')
            .single()
        );

        inserted.push({
          id: row.id,
          path: publicUrl(stored.path),
          sort_order
        });

      } catch (e) {
        console.error(e);

        if (stored) {
          await removeFiles([stored.path]);
        }

        errors.push(
          `${file.originalname}: Could not save or validate file.`
        );
      }
    }

    res.status(inserted.length ? 201 : 400).json({
      screenshots: inserted,
      errors
    });

  })
);

app.put('/api/apps/:id(\\d+)/screenshots/reorder', needAuth, h(async (req, res) => {
  const order = asArray(req.body?.order);
  await Promise.all(order.map((sid, i) => supabase.from('app_screenshots').update({ sort_order: i }).eq('id', sid).eq('app_id', req.params.id)));
  res.json({ success: true });
}));

app.delete('/api/apps/:id(\\d+)/screenshots/:sid(\\d+)', needAuth, h(async (req, res) => {
  const shot = must(await supabase.from('app_screenshots').select('*').eq('id', req.params.sid).eq('app_id', req.params.id).maybeSingle());
  if (!shot) fail(404, 'Screenshot not found.');
  await removeFiles([shot.path]);
  must(await supabase.from('app_screenshots').delete().eq('id', shot.id));
  res.json({ success: true });
}));

// Create or replace the download for an app + platform.
app.post('/api/apps/:id(\\d+)/downloads', needAuth, upload(100 * 1024 * 1024).single('file'), h(async (req, res) => {
  const appId = Number(req.params.id);
  if (!(await getApp(appId))) fail(404, 'App not found.');
  const platform = String(req.body?.platform ?? '').trim();
  const architecture = String(req.body?.architecture ?? '').trim();
  if (!platform) fail(400, 'Platform is required.');
  if (!architecture) fail(400, 'Architecture is required.');
  const version = blank(req.body?.version), releaseDate = blank(req.body?.releaseDate), externalUrl = blank(req.body?.externalUrl);

  const file = req.file;
  if (file && !DOWNLOAD_EXT.has(path.extname(file.originalname).toLowerCase())) fail(400, 'Unsupported download file.');
  if (!file && !externalUrl) fail(400, 'A file or external URL is required.');

  // Upload the new file first so a failed upload never destroys the existing one.
  const stored = file ? await putFile('downloads', file, 'application/octet-stream') : null;
  const existing = must(await supabase.from('app_downloads').select('*').eq('app_id', appId).eq('platform', platform).eq('architecture', architecture).limit(1).maybeSingle());
  const fields = {
    version, filename: stored?.name ?? null, path: stored?.path ?? null, external_url: externalUrl,
    size_bytes: file ? file.size : null, release_date: releaseDate, architecture:architecture
  };

  let downloadId;
  try {
    if (existing) {
      must(await supabase.from('app_downloads').update(fields).eq('id', existing.id));
      downloadId = existing.id;
    } else {
      downloadId = must(await supabase.from('app_downloads').insert({ app_id: appId, platform, architecture, ...fields }).select('id').single()).id;
    }
  } catch (e) {
    if (stored) await removeFiles([stored.path]);
    throw e;
  }
  if (existing?.path) await removeFiles([existing.path]);
  if (file) must(await supabase.from('apps').update({ size_label: mb(file.size) }).eq('id', appId));

  res.status(existing ? 200 : 201).json({
    message: 'Download saved successfully.',
    download: {
      id: downloadId, platform, architecture, version, filename: stored?.name ?? null, external_url: externalUrl,
      size_bytes: file ? file.size : null, release_date: releaseDate,
      download_count: existing?.download_count ?? 0,
      url: stored ? `/api/apps/${appId}/downloads/${downloadId}/file` : externalUrl,
    },
  });
}));

// Counts the download, then redirects to a 60-second signed URL (files never stream through Node).
app.get('/api/apps/:id(\\d+)/downloads/:did(\\d+)/file', h(async (req, res) => {
  const d = must(await supabase.from('app_downloads').select('*').eq('id', req.params.did).eq('app_id', req.params.id).maybeSingle());
  if (!d) fail(404, 'Download not found.');
  if (d.external_url) return res.redirect(302, d.external_url);
  if (!d.path) fail(404, 'File not found.');
  const [bucket, obj] = splitPath(d.path);
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(obj, 600, { download: d.filename || true });console.log(data.signedUrl);
  if (error || !data?.signedUrl) fail(404, 'File not found.');
  must(await supabase.rpc('increment_download_count', { p_id: d.id }));
  must(await supabase.from('download_logs').insert({ app_download_id: d.id, app_id: d.app_id, platform: d.platform }));
  
 // res.redirect(302, data.signedUrl);
}));

app.delete('/api/apps/:id(\\d+)/downloads/:did(\\d+)', needAuth, h(async (req, res) => {
  const d = must(await supabase.from('app_downloads').select('*').eq('id', req.params.did).eq('app_id', req.params.id).maybeSingle());
  if (!d) fail(404, 'Download not found.');
  await removeFiles([d.path]);
  must(await supabase.from('app_downloads').delete().eq('id', d.id));
  res.json({ success: true });
}));

app.delete('/api/apps/:id(\\d+)', needAuth, h(async (req, res) => {
  const r = await getApp(req.params.id);
  if (r) await removeFiles([r.icon_path, ...r.app_screenshots.map((s) => s.path), ...r.app_downloads.map((d) => d.path)]);
  must(await supabase.from('apps').delete().eq('id', req.params.id)); // children cascade
  res.json({ success: true });
}));

/* ---- projects */
app.get('/api/projects', optAuth, h(async (req, res) => {
  let q = supabase.from('projects').select(PROJECT_SELECT).order('sort_order').order('created_at', { ascending: false });
  if (!req.isAdmin) q = q.eq('publish_status', 'published');
  res.json({ projects: must(await q).map(fullProject) });
}));

app.get('/api/projects/:id', optAuth, h(async (req, res) => {
  const col = /^\d+$/.test(req.params.id) ? 'id' : 'slug';
  const r = must(await supabase.from('projects').select(PROJECT_SELECT).eq(col, req.params.id).maybeSingle());
  if (!r || (r.publish_status !== 'published' && !req.isAdmin)) fail(404, 'Project not found.');
  res.json({ project: fullProject(r) });
}));

app.post('/api/projects', needAuth, h(async (req, res) => {
  const b = req.body || {};
  if (!b.name) fail(400, 'Name is required.');
  const s = await uniqueSlug('projects', slug(b.slug ?? b.name));
  const row = must(await supabase.from('projects').insert({
    slug: s, name: b.name, description: b.description ?? '', status: b.status ?? 'Completed',
    publish_status: b.publishStatus ?? 'draft', github_url: blank(b.githubUrl), live_url: blank(b.liveUrl), featured: !!b.featured,
  }).select('id').single());
  const techs = asArray(b.technologies).map((technology) => ({ project_id: row.id, technology }));
  const feats = asArray(b.features).map((feature, i) => ({ project_id: row.id, feature, sort_order: i }));
  if (techs.length) must(await supabase.from('project_technologies').insert(techs));
  if (feats.length) must(await supabase.from('project_features').insert(feats));
  res.status(201).json({ project: fullProject(await getProject(row.id)) });
}));

app.put('/api/projects/:id(\\d+)', needAuth, h(async (req, res) => {
  const id = req.params.id, b = req.body || {};
  const r = await getProject(id);
  if (!r) fail(404, 'Project not found.');
  must(await supabase.from('projects').update({
    slug: b.slug != null ? slug(b.slug) : r.slug,
    name: b.name ?? r.name, description: b.description ?? r.description, status: b.status ?? r.status,
    publish_status: b.publishStatus ?? r.publish_status, github_url: b.githubUrl ?? r.github_url,
    live_url: b.liveUrl ?? r.live_url, featured: b.featured != null ? !!b.featured : r.featured,
    updated_at: new Date().toISOString(),
  }).eq('id', id));
  if (b.technologies != null) {
    must(await supabase.from('project_technologies').delete().eq('project_id', id));
    const rows = asArray(b.technologies).map((technology) => ({ project_id: Number(id), technology }));
    if (rows.length) must(await supabase.from('project_technologies').insert(rows));
  }
  if (b.features != null) {
    must(await supabase.from('project_features').delete().eq('project_id', id));
    const rows = asArray(b.features).map((feature, i) => ({ project_id: Number(id), feature, sort_order: i }));
    if (rows.length) must(await supabase.from('project_features').insert(rows));
  }
  res.json({ project: fullProject(await getProject(id)) });
}));

app.post('/api/projects/:id(\\d+)/:action(publish|unpublish)', needAuth, h(async (req, res) => {
  const { id, action } = req.params;
  if (!(await getProject(id))) fail(404, 'Project not found.');
  must(await supabase.from('projects').update({ publish_status: action === 'publish' ? 'published' : 'unpublished', updated_at: new Date().toISOString() }).eq('id', id));
  res.json({ project: fullProject(await getProject(id)) });
}));

app.post('/api/projects/:id(\\d+)/image', needAuth, upload(10 * 1024 * 1024).single('image'), h(async (req, res) => {
  const id = req.params.id;
  const existing = must(await supabase.from('projects').select('id,image_path').eq('id', id).maybeSingle());
  if (!existing) fail(404, 'Project not found.');
  if (!req.file) fail(400, 'No file uploaded.');
  if (!IMAGE_TYPES.has(req.file.mimetype)) fail(400, 'Only image files are allowed.');
  const f = await putFile('projects', req.file);
  must(await supabase.from('projects').update({ image_path: f.path, updated_at: new Date().toISOString() }).eq('id', id));
  await removeFiles([existing.image_path]);
  res.json({ image: publicUrl(f.path) });
}));

app.delete('/api/projects/:id(\\d+)', needAuth, h(async (req, res) => {
  const r = must(await supabase.from('projects').select('image_path').eq('id', req.params.id).maybeSingle());
  if (r) await removeFiles([r.image_path]);
  must(await supabase.from('projects').delete().eq('id', req.params.id));
  res.json({ success: true });
}));

/* ------------------------------------------------------------ fallbacks */
app.use((_req, res) => res.status(404).json({ error: 'Not found.' }));
app.use((err, _req, res, _next) => {
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, ...(err.code && { code: err.code }) });
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'Uploaded file is too large.' : err.message });
  }
  if (err?.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid JSON body.' });
  console.error(err);
  res.status(500).json({ error: 'Server error.' });
});

await ensureBuckets();
app.listen(PORT, () => console.log(`API listening on :${PORT}`));
