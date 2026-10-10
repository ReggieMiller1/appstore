const { db } = require("../db");

function getFullApp(appRow) {
  const platforms = db
    .prepare("SELECT platform FROM app_platforms WHERE app_id = ?")
    .all(appRow.id)
    .map((r) => r.platform);
  const technologies = db
    .prepare("SELECT technology FROM app_technologies WHERE app_id = ?")
    .all(appRow.id)
    .map((r) => r.technology);
  const features = db
    .prepare("SELECT id, title, description, sort_order FROM app_features WHERE app_id = ? ORDER BY sort_order")
    .all(appRow.id);
  const screenshots = db
    .prepare("SELECT id, path, sort_order FROM app_screenshots WHERE app_id = ? ORDER BY sort_order")
    .all(appRow.id);
  const downloads = db
    .prepare(
      "SELECT id, platform, version, filename, path, external_url, size_bytes, release_date, download_count FROM app_downloads WHERE app_id = ?"
    )
    .all(appRow.id)
    .map((d) => ({
      ...d,
      url: d.external_url || (d.path ? `/api/apps/${appRow.id}/downloads/${d.id}/file` : null),
    }));

  return {
    id: appRow.id,
    slug: appRow.slug,
    name: appRow.name,
    description: appRow.short_description,
    longDescription: appRow.long_description,
    icon: appRow.icon_path,
    version: appRow.version,
    category: appRow.category,
    developer: appRow.developer,
    size: appRow.size_label,
    releaseDate: appRow.release_date,
    updatedDate: appRow.updated_date,
    githubUrl: appRow.github_url,
    websiteUrl: appRow.website_url,
    featured: !!appRow.featured,
    status: appRow.status,
    platform: platforms,
    technologies,
    features,
    screenshots: screenshots.map((s) => s.path),
    screenshotRecords: screenshots,
    downloads,
    createdAt: appRow.created_at,
    updatedAt: appRow.updated_at,
  };
}

function getFullProject(projectRow) {
  const technologies = db
    .prepare("SELECT technology FROM project_technologies WHERE project_id = ?")
    .all(projectRow.id)
    .map((r) => r.technology);
  const features = db
    .prepare("SELECT feature FROM project_features WHERE project_id = ? ORDER BY sort_order")
    .all(projectRow.id)
    .map((r) => r.feature);

  return {
    id: projectRow.id,
    slug: projectRow.slug,
    name: projectRow.name,
    description: projectRow.description,
    image: projectRow.image_path,
    status: projectRow.status,
    publishStatus: projectRow.publish_status,
    githubUrl: projectRow.github_url,
    liveUrl: projectRow.live_url,
    featured: !!projectRow.featured,
    technologies,
    features,
    createdAt: projectRow.created_at,
    updatedAt: projectRow.updated_at,
  };
}

module.exports = { getFullApp, getFullProject };
