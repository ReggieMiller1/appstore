# Portfolio CMS Backend

A self-hosted Node.js/Express + SQLite REST API that powers the developer
portfolio website and the Flutter Windows CMS. Handles apps, projects, site
content (about/skills/timeline), contact messages, file uploads (icons,
screenshots, and application binaries), download tracking, and auth.

## Setup

```bash
npm install
cp .env.example .env
# edit .env — set a real JWT_SECRET and your own ADMIN_EMAIL / ADMIN_PASSWORD

npm run seed:content   # creates the admin user + imports the site's existing
                        # apps/projects/skills so you don't re-enter them
npm run start           # http://localhost:4000
# or: npm run dev        # auto-restarts on file changes
```

On first run, `seed:content` (or just starting the server) creates the admin
user from `ADMIN_EMAIL` / `ADMIN_PASSWORD` in `.env`. Change the password
immediately in production — there's no self-service reset flow yet.

The SQLite database lives at `data/cms.sqlite3` (created automatically).
Uploaded files live under `uploads/` (`icons/`, `screenshots/`, `files/`,
`projects/`) and are served at `http://localhost:4000/uploads/...`.

## Connecting the website

The Next.js site (`portfolio-site/`) reads `API_URL` / `NEXT_PUBLIC_API_URL`
to know where this backend is. See its `.env.local.example`. In development
both run side by side:

```bash
# terminal 1
cd backend && npm run start        # :4000

# terminal 2
cd portfolio-site && npm run dev   # :3000
```

Every content page on the site (`/`, `/apps`, `/apps/[slug]`, `/projects`,
`/about`, `/contact`) fetches from this API on every request — there's no
rebuild step. Editing an app through this API (or later, through the Flutter
CMS) is visible on the website immediately.

## Authentication

`POST /api/auth/login` with `{ email, password }` returns a JWT. Send it as
`Authorization: Bearer <token>` on every admin request. Tokens expire per
`JWT_EXPIRES_IN` (default 7 days, in `.env`).

## API reference

All admin (write) routes require the `Authorization` header. Public GET
routes only ever return `published` apps/projects unless a token is sent
(sending any token flips list/detail endpoints into "admin view", which
includes drafts and unpublished items — useful for CMS preview screens).

### Auth
- `POST /api/auth/login` — `{ email, password }` → `{ token, user }`
- `GET /api/auth/me` (auth) → current user

### Apps
- `GET /api/apps` — query: `category`, `platform`, `search`, `status` (admin only)
- `GET /api/apps/:idOrSlug`
- `POST /api/apps` (auth) — create
- `PUT /api/apps/:id` (auth) — update any subset of fields
- `DELETE /api/apps/:id` (auth)
- `POST /api/apps/:id/publish` / `POST /api/apps/:id/unpublish` (auth)
- `POST /api/apps/:id/icon` (auth, multipart, field `icon`)
- `POST /api/apps/:id/screenshots` (auth, multipart, field `screenshots`, multiple)
- `DELETE /api/apps/:id/screenshots/:screenshotId` (auth)
- `PUT /api/apps/:id/screenshots/reorder` (auth) — `{ order: [{ id, sortOrder }] }`
- `POST /api/apps/:id/downloads` (auth, multipart, field `file`, plus `platform`,
  `version`, or `externalUrl` instead of a file) — add a platform build
- `DELETE /api/apps/:id/downloads/:downloadId` (auth)
- `GET /api/apps/:id/downloads/:downloadId/file` (public) — streams the file
  (or redirects to `externalUrl`) and increments the download counter

### Projects
Same shape as Apps: `GET/POST /api/projects`, `GET/PUT/DELETE /api/projects/:id`,
`POST /api/projects/:id/publish|unpublish`, `POST /api/projects/:id/image`.

### Profile / site content
- `GET /api/profile` (public) — settings, skill categories, timeline, "what I
  build", social links, all in one bundle
- `PUT /api/profile/settings` (auth) — merge key/value site settings (name,
  tagline, email, github, linkedin, about_intro, ...)
- `PUT /api/profile/skills` (auth) — `{ categories: [{ category, skills }] }`
- `PUT /api/profile/timeline` (auth) — `{ entries: [{ year, title, description }] }`
- `PUT /api/profile/what-i-build` (auth) — `{ items: ["..."] }`
- `PUT /api/profile/social-links` (auth) — `{ links: [{ platform, url }] }`

### Messages
- `POST /api/messages` (public) — from the website's contact form
- `GET /api/messages` (auth) — query: `status` (`unread`/`read`/`all`)
- `PATCH /api/messages/:id` (auth) — `{ status: "read" | "unread" }`
- `DELETE /api/messages/:id` (auth)

### Stats
- `POST /api/stats/view` (public) — `{ path }`, called by the website for a
  simple view counter
- `GET /api/stats/dashboard` (auth) — totals, recent apps/downloads/messages,
  and a 14-day downloads chart series
- `GET /api/stats/downloads` (auth) — per-app/platform download counts

## Notes for the Flutter CMS

- All list/detail/mutation endpoints above are what the CMS talks to.
- File uploads are standard `multipart/form-data` — Dio's `FormData` and
  `MultipartFile.fromFile(...)` work directly against these routes, with
  `onSendProgress` for upload progress bars.
- There's no refresh-token flow yet — a `401` with `code: "TOKEN_EXPIRED"`
  means the CMS should send the user back to the login screen.
