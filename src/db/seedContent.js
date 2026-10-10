/**
 * One-time migration: copies the content that already exists in the
 * Next.js site's static data files (src/lib/apps.ts, projects.ts, profile.ts)
 * into the CMS database, so nothing you already wrote has to be re-entered.
 *
 * Run with: npm run seed:content
 */
require("dotenv").config();
const { db, seedAdmin, seedSettings } = require("./index");

seedAdmin();
seedSettings();

const insertApp = db.prepare(`
  INSERT INTO apps
    (slug, name, short_description, long_description, icon_path, version, category,
     developer, size_label, release_date, updated_date, github_url, website_url, featured, status)
  VALUES (@slug, @name, @short_description, @long_description, @icon_path, @version, @category,
     @developer, @size_label, @release_date, @updated_date, @github_url, @website_url, @featured, @status)
`);
const insertAppPlatform = db.prepare(
  "INSERT INTO app_platforms (app_id, platform) VALUES (?, ?)"
);
const insertAppTech = db.prepare(
  "INSERT INTO app_technologies (app_id, technology) VALUES (?, ?)"
);
const insertAppFeature = db.prepare(
  "INSERT INTO app_features (app_id, title, description, sort_order) VALUES (?, ?, ?, ?)"
);
const insertAppScreenshot = db.prepare(
  "INSERT INTO app_screenshots (app_id, path, sort_order) VALUES (?, ?, ?)"
);
const insertAppDownload = db.prepare(`
  INSERT INTO app_downloads (app_id, platform, version, filename, external_url, release_date)
  VALUES (?, ?, ?, ?, ?, ?)
`);

const existingApps = [
  {
    slug: "classpulse",
    name: "ClassPulse",
    short_description: "A smart, offline-first student timetable and lecture reminder app.",
    long_description:
      "ClassPulse is a production-quality Flutter app built to help university and college students stay on top of their schedules without ever needing an internet connection.\n\nIt manages a weekly recurring timetable, fires configurable reminders before each lecture, and keeps working reliably even after the app is closed or the device restarts. A live dashboard shows the current and next lecture with a countdown, flags timetable conflicts and free periods, and now includes a full Tests & Exams module with staged reminders (5 days, 3 days, 1 day, and day-of) and a preparation-checklist mode.\n\nModules and rooms are managed as reusable, linked records — so a lecturer or room only needs to be entered once and can be reused across lectures and exams — with dependency warnings before anything is deleted.",
    icon_path: "/uploads/icons/classpulse.svg",
    version: "1.4.0",
    category: "Education",
    developer: "[YOUR NAME]",
    size_label: "18 MB",
    release_date: "2025-11-02",
    updated_date: "2026-09-10",
    github_url: "#",
    website_url: null,
    featured: 1,
    status: "published",
    platforms: ["Android"],
    technologies: ["Flutter", "Dart", "GetX", "Hive", "Local Notifications"],
    features: [
      ["Fully offline", "No backend, no account — every feature works without a network connection."],
      ["Smart reminders", "Lecture reminders default to 15 minutes ahead and survive reboots and app closures."],
      ["Tests & exams tracking", "Staged reminders, countdowns, checklists, and conflict detection against lectures."],
      ["Reusable modules & rooms", "Lecturers, modules, and rooms are stored once and linked, not duplicated."],
      ["Live dashboard", "See your current and next lecture with a real-time countdown at a glance."],
      ["Backup & restore", "Import and export your entire timetable and settings as JSON."],
    ],
    screenshots: [
      "/uploads/screenshots/classpulse-1.svg",
      "/uploads/screenshots/classpulse-2.svg",
      "/uploads/screenshots/classpulse-3.svg",
    ],
    downloads: [{ platform: "Android", version: "1.4.0", filename: null, external_url: "#", release_date: "2026-09-10" }],
  },
  {
    slug: "school-management-system",
    name: "School Management System",
    short_description: "A complete platform for managing students, teachers, classes, and timetables.",
    long_description:
      "A school management platform designed for administrators, teachers, and students to manage day-to-day academic operations from one place.\n\nIt covers student and teacher records, class and subject organization, timetable generation, and the everyday workflows a school office needs — built to be extended as new modules become necessary.",
    icon_path: "/uploads/icons/school-management.svg",
    version: "0.9.0",
    category: "Education",
    developer: "[YOUR NAME]",
    size_label: null,
    release_date: "2025-06-15",
    updated_date: "2026-04-20",
    github_url: "#",
    website_url: null,
    featured: 1,
    status: "published",
    platforms: ["Web"],
    technologies: ["Node.js", "MySQL", "JavaScript", "Socket.IO"],
    features: [
      ["Student & teacher records", "Centralized profiles for every student and staff member."],
      ["Class & subject management", "Organize classes, subjects, and assignments in one structure."],
      ["Timetable generation", "Build and adjust school-wide timetables without conflicts."],
      ["Real-time updates", "Socket.IO keeps schedules and notices in sync across devices."],
    ],
    screenshots: [
      "/uploads/screenshots/sms-1.svg",
      "/uploads/screenshots/sms-2.svg",
      "/uploads/screenshots/sms-3.svg",
    ],
    downloads: [{ platform: "Web", version: "0.9.0", filename: null, external_url: "#", release_date: "2026-04-20" }],
  },
  {
    slug: "hashtag",
    name: "Hashtag",
    short_description: "A social application with posts, friends, chat, and real-time notifications.",
    long_description:
      "Hashtag is a social networking application covering the core loop of a modern social app: posting, following friends, real-time chat, and notifications.\n\nIt's built around a real-time backend so new posts, messages, and notifications appear instantly for connected users.",
    icon_path: "/uploads/icons/hashtag.svg",
    version: "0.6.0",
    category: "Social",
    developer: "[YOUR NAME]",
    size_label: null,
    release_date: "2025-02-10",
    updated_date: "2026-01-05",
    github_url: "#",
    website_url: null,
    featured: 1,
    status: "published",
    platforms: ["Web", "Android"],
    technologies: ["Node.js", "Socket.IO", "MariaDB", "Elasticsearch", "JavaScript"],
    features: [
      ["Posts & feed", "Share posts and browse a personalized, searchable feed."],
      ["Friends & follows", "Connect with other users and build a social graph."],
      ["Real-time chat", "Instant messaging powered by Socket.IO."],
      ["Search", "Elasticsearch-backed search across posts and users."],
    ],
    screenshots: [
      "/uploads/screenshots/hashtag-1.svg",
      "/uploads/screenshots/hashtag-2.svg",
      "/uploads/screenshots/hashtag-3.svg",
    ],
    downloads: [{ platform: "Web", version: "0.6.0", filename: null, external_url: "#", release_date: "2026-01-05" }],
  },
];

const existingProjects = [
  {
    slug: "classpulse",
    name: "ClassPulse",
    description: "Offline-first Flutter timetable and lecture reminder app for students.",
    image_path: "/uploads/screenshots/classpulse-1.svg",
    status: "Maintained",
    github_url: "#",
    live_url: null,
    featured: 1,
    technologies: ["Flutter", "Dart", "GetX", "Hive"],
    features: [
      "Weekly recurring timetable with conflict detection",
      "Configurable lecture reminders, survives reboot",
      "Tests & exams module with staged reminders",
      "JSON backup and restore",
    ],
  },
  {
    slug: "school-management-system",
    name: "School Management System",
    description: "Web platform for managing students, teachers, classes, and timetables.",
    image_path: "/uploads/screenshots/sms-1.svg",
    status: "In Progress",
    github_url: "#",
    live_url: null,
    featured: 1,
    technologies: ["Node.js", "MySQL", "JavaScript", "Socket.IO"],
    features: [
      "Student and teacher record management",
      "Class and subject organization",
      "Automated timetable generation",
    ],
  },
  {
    slug: "hashtag",
    name: "Hashtag",
    description: "Real-time social app with posts, friends, chat, and notifications.",
    image_path: "/uploads/screenshots/hashtag-1.svg",
    status: "In Progress",
    github_url: "#",
    live_url: null,
    featured: 1,
    technologies: ["Node.js", "Socket.IO", "MariaDB", "Elasticsearch"],
    features: [
      "Real-time posts, chat, and notifications",
      "Elasticsearch-powered search",
      "Friends and social graph",
    ],
  },
  {
    slug: "maplotini-platform",
    name: "Maplotini Cooperative Platform",
    description:
      "Digital platform for an agricultural farming cooperative, supporting member and operations management.",
    image_path: "/uploads/screenshots/maplotini-1.svg",
    status: "In Progress",
    github_url: null,
    live_url: null,
    featured: 1,
    technologies: ["Node.js", "MySQL", "JavaScript"],
    features: [
      "Cooperative member and operations management",
      "Built for a real agricultural cooperative in Eswatini",
    ],
  },
];

const insertProject = db.prepare(`
  INSERT INTO projects (slug, name, description, image_path, status, publish_status, github_url, live_url, featured)
  VALUES (@slug, @name, @description, @image_path, @status, 'published', @github_url, @live_url, @featured)
`);
const insertProjectTech = db.prepare(
  "INSERT INTO project_technologies (project_id, technology) VALUES (?, ?)"
);
const insertProjectFeature = db.prepare(
  "INSERT INTO project_features (project_id, feature, sort_order) VALUES (?, ?, ?)"
);

const insertSkillCategory = db.prepare(
  "INSERT INTO skill_categories (category, sort_order) VALUES (?, ?)"
);
const insertSkill = db.prepare(
  "INSERT INTO skills (category_id, name, sort_order, featured) VALUES (?, ?, ?, ?)"
);
const insertTimeline = db.prepare(
  "INSERT INTO timeline_entries (year, title, description, sort_order) VALUES (?, ?, ?, ?)"
);
const insertWhatIBuild = db.prepare(
  "INSERT INTO what_i_build (label, sort_order) VALUES (?, ?)"
);

const skillCategories = [
  { category: "Frontend", skills: ["Flutter", "HTML", "CSS", "JavaScript"] },
  { category: "Backend", skills: ["Node.js", "Socket.IO", "REST APIs"] },
  { category: "Database", skills: ["MySQL", "MariaDB", "Supabase", "Elasticsearch"] },
  { category: "Tools", skills: ["Git", "Docker", "VS Code"] },
  { category: "Design", skills: ["Photoshop", "Illustrator"] },
];
const featuredSkills = [
  "Flutter", "Dart", "Node.js", "JavaScript", "MySQL", "MariaDB",
  "Supabase", "Elasticsearch", "Socket.IO", "Git", "Docker", "Photoshop", "Illustrator",
];

const timeline = [
  ["Today", "Building production apps & platforms", "Developing full-stack platforms and offline-first mobile apps end to end — architecture, backend, UI, and delivery."],
  ["", "Expanded into real-time & backend systems", "Worked with Socket.IO, Elasticsearch, and relational databases to build real-time, searchable applications."],
  ["", "Started building mobile apps", "Focused on Flutter and Dart to build offline-first, reliable mobile experiences."],
  ["", "Began learning web development", "Started with HTML, CSS, and JavaScript, then moved into full application development."],
];

const whatIBuild = [
  "Mobile applications", "Desktop applications", "Web applications", "Backend systems",
  "School / education systems", "Business management systems", "Real-time applications",
];

function run() {
  const appCount = db.prepare("SELECT COUNT(*) as c FROM apps").get().c;
  if (appCount === 0) {
    const tx = db.transaction(() => {
      for (const app of existingApps) {
        const info = insertApp.run(app);
        const appId = info.lastInsertRowid;
        app.platforms.forEach((p) => insertAppPlatform.run(appId, p));
        app.technologies.forEach((t) => insertAppTech.run(appId, t));
        app.features.forEach(([title, description], i) =>
          insertAppFeature.run(appId, title, description, i)
        );
        app.screenshots.forEach((path, i) => insertAppScreenshot.run(appId, path, i));
        app.downloads.forEach((d) =>
          insertAppDownload.run(appId, d.platform, d.version, d.filename, d.external_url, d.release_date)
        );
      }
    });
    tx();
    console.log(`[seed] Inserted ${existingApps.length} apps`);
  } else {
    console.log("[seed] Apps already present, skipping");
  }

  const projectCount = db.prepare("SELECT COUNT(*) as c FROM projects").get().c;
  if (projectCount === 0) {
    const tx = db.transaction(() => {
      for (const project of existingProjects) {
        const info = insertProject.run(project);
        const projectId = info.lastInsertRowid;
        project.technologies.forEach((t) => insertProjectTech.run(projectId, t));
        project.features.forEach((f, i) => insertProjectFeature.run(projectId, f, i));
      }
    });
    tx();
    console.log(`[seed] Inserted ${existingProjects.length} projects`);
  } else {
    console.log("[seed] Projects already present, skipping");
  }

  const skillCatCount = db.prepare("SELECT COUNT(*) as c FROM skill_categories").get().c;
  if (skillCatCount === 0) {
    const tx = db.transaction(() => {
      skillCategories.forEach((cat, i) => {
        const info = insertSkillCategory.run(cat.category, i);
        const catId = info.lastInsertRowid;
        cat.skills.forEach((s, j) =>
          insertSkill.run(catId, s, j, featuredSkills.includes(s) ? 1 : 0)
        );
      });
      timeline.forEach(([year, title, description], i) =>
        insertTimeline.run(year, title, description, i)
      );
      whatIBuild.forEach((label, i) => insertWhatIBuild.run(label, i));
    });
    tx();
    console.log("[seed] Inserted skills, timeline, and what-I-build content");
  } else {
    console.log("[seed] Skills already present, skipping");
  }
}

run();
console.log("[seed] Done.");
