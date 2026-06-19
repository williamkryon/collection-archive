const { app, BrowserWindow, dialog, ipcMain, nativeImage, net, protocol, shell } = require("electron");
const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const crypto = require("crypto");
const initSqlJs = require("sql.js");

let db;
let SQL;
let paths;

const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();
const perfTraceOn = () => process.env.ARCHIVE_PERF_TRACE === "1";

function perfTrace(event, data = {}) {
  if (!perfTraceOn()) return;
  console.log(`[perf-main] ${JSON.stringify({
    event,
    t: Math.round(performance.now() * 10) / 10,
    ...data
  })}`);
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: "archive",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true
    }
  }
]);

function ensureDir(folder) {
  fs.mkdirSync(folder, { recursive: true });
}

function getPaths() {
  const base = process.env.COLLECTION_ARCHIVE_DATA_DIR || path.join(app.getPath("userData"), "collection-archive-data");
  return {
    base,
    db: path.join(base, "archive.sqlite"),
    images: path.join(base, "images"),
    thumbs: path.join(base, "thumbnails")
  };
}

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function mediaUrl(kind, filePath) {
  if (!filePath) return null;
  if (String(filePath).startsWith("archive://")) return filePath;

  const folder = kind === "thumbnails" ? paths.thumbs : paths.images;
  const rawPath = String(filePath);
  let resolved = path.isAbsolute(rawPath) ? path.resolve(rawPath) : path.resolve(folder, path.basename(rawPath));

  if (!isInside(folder, resolved) || !fs.existsSync(resolved)) {
    const basenameFallback = path.resolve(folder, path.basename(rawPath));
    if (isInside(folder, basenameFallback) && fs.existsSync(basenameFallback)) {
      resolved = basenameFallback;
    } else {
      console.warn("[media] refused or missing path outside data folder", { kind, filePath, resolved });
      return null;
    }
  }

  const version = fs.existsSync(resolved) ? Math.round(fs.statSync(resolved).mtimeMs) : Date.now();
  return `archive://local/${kind}/${encodeURIComponent(path.basename(resolved))}?v=${version}`;
}

function mediaFileForRequest(requestUrl) {
  const url = new URL(requestUrl);

  if (url.protocol !== "archive:" || url.hostname !== "local") {
    throw new Error(`Unsupported archive media URL: ${requestUrl}`);
  }

  const segments = url.pathname.split("/").filter(Boolean);
  if (segments.length !== 2) {
    throw new Error(`Invalid archive media URL: ${requestUrl}`);
  }

  const [kind, encodedFilename] = segments;
  const filename = path.basename(decodeURIComponent(encodedFilename));
  const folder = kind === "images" ? paths.images : kind === "thumbnails" ? paths.thumbs : null;

  if (!folder) {
    throw new Error(`Unsupported archive media kind: ${kind}`);
  }

  const filePath = path.resolve(folder, filename);
  if (!isInside(folder, filePath) || !fs.existsSync(filePath)) {
    throw new Error(`Archive media file not found or blocked: ${requestUrl}`);
  }

  return filePath;
}

function registerMediaProtocol() {
  protocol.handle("archive", async (request) => {
    try {
      const filePath = mediaFileForRequest(request.url);
      return net.fetch(pathToFileURL(filePath).toString());
    } catch (error) {
      console.error("[media] protocol error", { url: request.url, message: error.message });
      return new Response("Not found", { status: 404 });
    }
  });
}

function sqlJsWasmPath(file) {
  const devPath = path.join(app.getAppPath(), "node_modules", "sql.js", "dist", file);
  if (fs.existsSync(devPath)) {
    return devPath;
  }
  return path.join(process.resourcesPath, "app.asar.unpacked", "node_modules", "sql.js", "dist", file);
}

function bindAndStep(query, params = []) {
  const stmt = db.prepare(query);
  try {
    stmt.bind(params);
    stmt.step();
  } finally {
    stmt.free();
  }
}

function run(query, params = []) {
  bindAndStep(query, params);
  saveDb();
}

function all(query, params = []) {
  const stmt = db.prepare(query);
  const rows = [];
  try {
    stmt.bind(params);
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
  } finally {
    stmt.free();
  }
  return rows;
}

function get(query, params = []) {
  return all(query, params)[0] ?? null;
}

function saveDb() {
  fs.writeFileSync(paths.db, Buffer.from(db.export()));
}

function execSchema() {
  db.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS countries (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      sort_key TEXT DEFAULT '',
      sort_order INTEGER DEFAULT 0,
      notes TEXT DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS collection_types (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      sort_key TEXT DEFAULT '',
      sort_order INTEGER DEFAULT 0,
      description TEXT DEFAULT '',
      custom_fields_json TEXT DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS entity_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      kind TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS entity_group_memberships (
      entity_id TEXT NOT NULL,
      group_id INTEGER NOT NULL,
      PRIMARY KEY (entity_id, group_id),
      FOREIGN KEY (entity_id) REFERENCES countries(id) ON DELETE CASCADE,
      FOREIGN KEY (group_id) REFERENCES entity_groups(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS items (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      country_id TEXT,
      type_id TEXT,
      year TEXT DEFAULT '',
      description TEXT DEFAULT '',
      condition TEXT DEFAULT '',
      purchase_price TEXT DEFAULT '',
      source TEXT DEFAULT '',
      tags_json TEXT DEFAULT '[]',
      custom_fields_json TEXT DEFAULT '{}',
      favorite INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (country_id) REFERENCES countries(id) ON DELETE SET NULL,
      FOREIGN KEY (type_id) REFERENCES collection_types(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS images (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL,
      original_filename TEXT NOT NULL,
      stored_filename TEXT NOT NULL,
      image_path TEXT NOT NULL,
      thumbnail_path TEXT NOT NULL,
      width INTEGER NOT NULL,
      height INTEGER NOT NULL,
      aspect_ratio REAL NOT NULL,
      size_bytes INTEGER NOT NULL,
      mime_type TEXT NOT NULL,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS albums (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS album_pages (
      id TEXT PRIMARY KEY,
      album_id TEXT NOT NULL,
      title TEXT NOT NULL,
      page_number INTEGER NOT NULL,
      notes TEXT DEFAULT '',
      column_count INTEGER DEFAULT 3,
      page_width INTEGER DEFAULT 1000,
      page_height INTEGER DEFAULT 1400,
      orientation TEXT DEFAULT 'portrait',
      background TEXT DEFAULT 'white',
      custom_background TEXT DEFAULT '#ffffff',
      paper_preset TEXT DEFAULT 'custom',
      background_image_id TEXT,
      background_image_enabled INTEGER DEFAULT 0,
      background_opacity REAL DEFAULT 1,
      background_fit TEXT DEFAULT 'contain',
      show_guides INTEGER DEFAULT 1,
      snap_to_grid INTEGER DEFAULT 1,
      grid_size INTEGER DEFAULT 25,
      template_name TEXT DEFAULT 'blank',
      layout_version INTEGER DEFAULT 2,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (album_id) REFERENCES albums(id) ON DELETE CASCADE,
      FOREIGN KEY (background_image_id) REFERENCES images(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS album_page_items (
      id TEXT PRIMARY KEY,
      page_id TEXT NOT NULL,
      item_id TEXT NOT NULL,
      image_id TEXT,
      x REAL DEFAULT 0,
      y REAL DEFAULT 0,
      width REAL DEFAULT 1,
      height REAL DEFAULT 1,
      rotation REAL DEFAULT 0,
      z_index INTEGER DEFAULT 0,
      caption TEXT DEFAULT '',
      show_caption INTEGER DEFAULT 1,
      show_title INTEGER DEFAULT 1,
      show_metadata INTEGER DEFAULT 1,
      locked INTEGER DEFAULT 1,
      frame_style TEXT DEFAULT 'none',
      border_color TEXT DEFAULT '#b8c8c4',
      background_color TEXT DEFAULT '#ffffff',
      background_opacity REAL DEFAULT 0,
      padding REAL DEFAULT 4,
      border_radius REAL DEFAULT 2,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (page_id) REFERENCES album_pages(id) ON DELETE CASCADE,
      FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE,
      FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS album_text_items (
      id TEXT PRIMARY KEY,
      page_id TEXT NOT NULL,
      x REAL DEFAULT 0,
      y REAL DEFAULT 0,
      width REAL DEFAULT 260,
      height REAL DEFAULT 120,
      rotation REAL DEFAULT 0,
      z_index INTEGER DEFAULT 0,
      text_content TEXT DEFAULT '',
      font_size INTEGER DEFAULT 24,
      bold INTEGER DEFAULT 0,
      italic INTEGER DEFAULT 0,
      text_align TEXT DEFAULT 'center',
      text_color TEXT DEFAULT '#202629',
      background TEXT DEFAULT 'transparent',
      locked INTEGER DEFAULT 0,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (page_id) REFERENCES album_pages(id) ON DELETE CASCADE
    );
  `);
  const countryColumns = all("PRAGMA table_info(countries)").map((column) => column.name);
  if (!countryColumns.includes("sort_key")) {
    db.exec("ALTER TABLE countries ADD COLUMN sort_key TEXT DEFAULT ''");
  }
  if (!countryColumns.includes("sort_order")) {
    db.exec("ALTER TABLE countries ADD COLUMN sort_order INTEGER DEFAULT 0");
  }
  if (!countryColumns.includes("notes")) {
    db.exec("ALTER TABLE countries ADD COLUMN notes TEXT DEFAULT ''");
  }
  const pageColumns = all("PRAGMA table_info(album_pages)").map((column) => column.name);
  if (!pageColumns.includes("column_count")) {
    db.exec("ALTER TABLE album_pages ADD COLUMN column_count INTEGER DEFAULT 3");
  }
  [
    ["page_width", "INTEGER DEFAULT 1000"],
    ["page_height", "INTEGER DEFAULT 1400"],
    ["orientation", "TEXT DEFAULT 'portrait'"],
    ["background", "TEXT DEFAULT 'white'"],
    ["custom_background", "TEXT DEFAULT '#ffffff'"],
    ["paper_preset", "TEXT DEFAULT 'custom'"],
    ["background_image_id", "TEXT"],
    ["background_image_enabled", "INTEGER DEFAULT 0"],
    ["background_opacity", "REAL DEFAULT 1"],
    ["background_fit", "TEXT DEFAULT 'contain'"],
    ["show_guides", "INTEGER DEFAULT 1"],
    ["snap_to_grid", "INTEGER DEFAULT 1"],
    ["grid_size", "INTEGER DEFAULT 25"],
    ["template_name", "TEXT DEFAULT 'blank'"]
  ].forEach(([name, definition]) => {
    if (!pageColumns.includes(name)) {
      db.exec(`ALTER TABLE album_pages ADD COLUMN ${name} ${definition}`);
    }
  });
  if (!pageColumns.includes("layout_version")) {
    db.exec("ALTER TABLE album_pages ADD COLUMN layout_version INTEGER DEFAULT 1");
  }
  const typeColumns = all("PRAGMA table_info(collection_types)").map((column) => column.name);
  if (!typeColumns.includes("sort_key")) {
    db.exec("ALTER TABLE collection_types ADD COLUMN sort_key TEXT DEFAULT ''");
  }
  if (!typeColumns.includes("sort_order")) {
    db.exec("ALTER TABLE collection_types ADD COLUMN sort_order INTEGER DEFAULT 0");
  }
  if (!typeColumns.includes("custom_fields_json")) {
    db.exec("ALTER TABLE collection_types ADD COLUMN custom_fields_json TEXT DEFAULT '{}'");
  }
  const pageItemColumns = all("PRAGMA table_info(album_page_items)").map((column) => column.name);
  if (!pageItemColumns.includes("image_id")) {
    db.exec("ALTER TABLE album_page_items ADD COLUMN image_id TEXT");
  }
  [
    ["rotation", "REAL DEFAULT 0"],
    ["z_index", "INTEGER DEFAULT 0"],
    ["show_caption", "INTEGER DEFAULT 1"],
    ["show_title", "INTEGER DEFAULT 1"],
    ["show_metadata", "INTEGER DEFAULT 1"],
    ["locked", "INTEGER DEFAULT 1"],
    ["frame_style", "TEXT DEFAULT 'none'"],
    ["border_color", "TEXT DEFAULT '#b8c8c4'"],
    ["background_color", "TEXT DEFAULT '#ffffff'"],
    ["background_opacity", "REAL DEFAULT 0"],
    ["padding", "REAL DEFAULT 4"],
    ["border_radius", "REAL DEFAULT 2"]
  ].forEach(([name, definition]) => {
    if (!pageItemColumns.includes(name)) {
      db.exec(`ALTER TABLE album_page_items ADD COLUMN ${name} ${definition}`);
    }
  });
  normalizeSortOrder("countries");
  normalizeSortOrder("collection_types");
  normalizeSortOrder("entity_groups");
  migrateAlbumLayouts();
  createIndexes();
  saveDb();
}

function createIndexes() {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_items_country_id ON items(country_id);
    CREATE INDEX IF NOT EXISTS idx_items_type_id ON items(type_id);
    CREATE INDEX IF NOT EXISTS idx_items_year ON items(year);
    CREATE INDEX IF NOT EXISTS idx_items_favorite ON items(favorite);
    CREATE INDEX IF NOT EXISTS idx_items_updated_at ON items(updated_at);
    CREATE INDEX IF NOT EXISTS idx_items_title ON items(title COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_items_tags_json ON items(tags_json);
    CREATE INDEX IF NOT EXISTS idx_images_item_id ON images(item_id);
    CREATE INDEX IF NOT EXISTS idx_images_item_sort ON images(item_id, sort_order, created_at);
    CREATE INDEX IF NOT EXISTS idx_album_page_items_page_id ON album_page_items(page_id);
    CREATE INDEX IF NOT EXISTS idx_album_page_items_item_id ON album_page_items(item_id);
    CREATE INDEX IF NOT EXISTS idx_album_page_items_image_id ON album_page_items(image_id);
    CREATE INDEX IF NOT EXISTS idx_album_page_items_page_sort ON album_page_items(page_id, sort_order, created_at);
    CREATE INDEX IF NOT EXISTS idx_album_text_items_page_sort ON album_text_items(page_id, sort_order, created_at);
    CREATE INDEX IF NOT EXISTS idx_album_pages_background_image_id ON album_pages(background_image_id);
    CREATE INDEX IF NOT EXISTS idx_countries_sort_order ON countries(sort_order);
    CREATE INDEX IF NOT EXISTS idx_collection_types_sort_order ON collection_types(sort_order);
    CREATE INDEX IF NOT EXISTS idx_entity_groups_sort_order ON entity_groups(sort_order);
    CREATE INDEX IF NOT EXISTS idx_entity_group_memberships_entity ON entity_group_memberships(entity_id);
    CREATE INDEX IF NOT EXISTS idx_entity_group_memberships_group ON entity_group_memberships(group_id);
  `);
}

async function initDatabase() {
  paths = getPaths();
  ensureDir(paths.base);
  ensureDir(paths.images);
  ensureDir(paths.thumbs);

  SQL = await initSqlJs({
    locateFile: sqlJsWasmPath
  });

  if (fs.existsSync(paths.db)) {
    db = new SQL.Database(fs.readFileSync(paths.db));
  } else {
    db = new SQL.Database();
  }

  execSchema();
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(value || "");
  } catch {
    return fallback;
  }
}

function mapImage(row) {
  return {
    ...row,
    url: mediaUrl("images", row.image_path),
    thumbnailUrl: mediaUrl("thumbnails", row.thumbnail_path)
  };
}

function mapItem(row) {
  const cover = row.cover_thumbnail_path
    ? {
        id: row.cover_id,
        url: mediaUrl("images", row.cover_image_path),
        thumbnailUrl: mediaUrl("thumbnails", row.cover_thumbnail_path),
        width: row.cover_width,
        height: row.cover_height,
        aspect_ratio: row.cover_aspect_ratio
      }
    : null;

  return {
    ...row,
    favorite: Boolean(row.favorite),
    tags: parseJson(row.tags_json, []),
    customFields: parseJson(row.custom_fields_json, {}),
    imageCount: Number(row.image_count ?? 0),
    cover
  };
}

function itemQueryWhere(options = {}, galleryOnly = false) {
  const clauses = [];
  const params = [];
  const search = String(options.search || "").trim();
  const searchText = String(options.searchText || "").trim();
  const year = String(options.year || "").trim();
  const tagTerms = String(options.tag || "")
    .split(/[;,]/)
    .map((tag) => tag.trim())
    .filter(Boolean);

  if (searchText) {
    const like = `%${searchText}%`;
    clauses.push(`(
      items.title LIKE ? COLLATE NOCASE OR
      items.description LIKE ? COLLATE NOCASE OR
      items.source LIKE ? COLLATE NOCASE OR
      items.condition LIKE ? COLLATE NOCASE OR
      items.custom_fields_json LIKE ? COLLATE NOCASE
    )`);
    params.push(like, like, like, like, like);
  }
  if (search) {
    clauses.push("items.title LIKE ? COLLATE NOCASE");
    params.push(`%${search}%`);
  }
  if (options.countryId) {
    clauses.push("items.country_id = ?");
    params.push(options.countryId);
  }
  if (options.entityGroupId) {
    clauses.push("EXISTS (SELECT 1 FROM entity_group_memberships WHERE entity_group_memberships.entity_id = items.country_id AND entity_group_memberships.group_id = ?)");
    params.push(options.entityGroupId);
  }
  if (options.typeId) {
    clauses.push("items.type_id = ?");
    params.push(options.typeId);
  }
  if (year) {
    clauses.push("items.year LIKE ?");
    params.push(`%${year}%`);
  }
  for (const tag of tagTerms) {
    clauses.push("items.tags_json LIKE ? COLLATE NOCASE");
    params.push(`%${tag}%`);
  }
  if (options.favorite) {
    clauses.push("items.favorite = 1");
  }
  if (galleryOnly) {
    clauses.push("EXISTS (SELECT 1 FROM images WHERE images.item_id = items.id)");
  }

  return {
    where: clauses.length ? `WHERE ${clauses.join(" AND ")}` : "",
    params
  };
}

function itemOrder(sort) {
  if (sort === "title_asc") return "items.title COLLATE NOCASE ASC, items.updated_at DESC";
  if (sort === "title_desc") return "items.title COLLATE NOCASE DESC, items.updated_at DESC";
  if (sort === "year_asc") return "items.year ASC, items.updated_at DESC";
  if (sort === "year_desc") return "items.year DESC, items.updated_at DESC";
  return "items.updated_at DESC";
}

function itemPage(options = {}, galleryOnly = false) {
  const limit = Math.min(500, Math.max(1, Number(options.limit || 240)));
  const offset = Math.max(0, Number(options.offset || 0));
  const traceId = options._traceId || "";
  const traceSource = options._traceSource || (galleryOnly ? "gallery" : "items");
  const started = performance.now();
  perfTrace("db.itemPage.start", {
    traceId,
    traceSource,
    galleryOnly,
    filters: {
      search: options.search || "",
      searchText: options.searchText || "",
      countryId: options.countryId || "",
      entityGroupId: options.entityGroupId || "",
      typeId: options.typeId || "",
      year: options.year || "",
      tag: options.tag || "",
      favorite: Boolean(options.favorite),
      limit,
      offset,
      sort: options.sort || ""
    }
  });
  const { where, params } = itemQueryWhere(options, galleryOnly);
  const countStarted = performance.now();
  const total = countItems(options, galleryOnly);
  perfTrace("db.itemPage.count.end", {
    traceId,
    traceSource,
    ms: Math.round((performance.now() - countStarted) * 10) / 10,
    total
  });
  const rowsStarted = performance.now();
  const items = all(
    `
      SELECT
        items.*,
        countries.name AS country_name,
        collection_types.name AS type_name,
        (
          SELECT GROUP_CONCAT(entity_groups.name, ', ')
          FROM entity_group_memberships
          JOIN entity_groups ON entity_groups.id = entity_group_memberships.group_id
          WHERE entity_group_memberships.entity_id = items.country_id
          ORDER BY entity_groups.sort_order ASC, entity_groups.name ASC
        ) AS entity_group_names,
        (SELECT COUNT(*) FROM images WHERE images.item_id = items.id) AS image_count,
        cover.id AS cover_id,
        cover.image_path AS cover_image_path,
        cover.thumbnail_path AS cover_thumbnail_path,
        cover.width AS cover_width,
        cover.height AS cover_height,
        cover.aspect_ratio AS cover_aspect_ratio
      FROM items
      LEFT JOIN countries ON countries.id = items.country_id
      LEFT JOIN collection_types ON collection_types.id = items.type_id
      LEFT JOIN images AS cover ON cover.id = (
        SELECT id FROM images
        WHERE images.item_id = items.id
        ORDER BY sort_order ASC, created_at ASC
        LIMIT 1
      )
      ${where}
      ORDER BY ${itemOrder(options.sort)}
      LIMIT ? OFFSET ?
    `,
    [...params, limit, offset]
  );
  perfTrace("db.itemPage.rows.end", {
    traceId,
    traceSource,
    ms: Math.round((performance.now() - rowsStarted) * 10) / 10,
    rows: items.length
  });
  const mapped = items.map(mapItem);
  perfTrace("db.itemPage.end", {
    traceId,
    traceSource,
    ms: Math.round((performance.now() - started) * 10) / 10,
    rows: mapped.length,
    total
  });

  return { items: mapped, total, limit, offset };
}

function countItems(options = {}, galleryOnly = false) {
  const started = performance.now();
  const { where, params } = itemQueryWhere(options, galleryOnly);
  const count = Number(get(`SELECT COUNT(*) AS count FROM items ${where}`, params)?.count ?? 0);
  perfTrace("db.countItems.end", {
    traceId: options._traceId || "",
    traceSource: options._traceSource || (galleryOnly ? "gallery" : "items"),
    ms: Math.round((performance.now() - started) * 10) / 10,
    count,
    galleryOnly
  });
  return count;
}

function albumList() {
  return all(
    `
      SELECT albums.*, COUNT(album_pages.id) AS page_count
      FROM albums
      LEFT JOIN album_pages ON album_pages.album_id = albums.id
      GROUP BY albums.id
      ORDER BY albums.updated_at DESC
    `
  );
}

function normalizeSortOrder(table) {
  const rows = all(`SELECT id FROM ${table} ORDER BY sort_order ASC, created_at ASC, name ASC`);
  rows.forEach((row, index) => {
    run(`UPDATE ${table} SET sort_order = ? WHERE id = ?`, [index, row.id]);
  });
}

function nextSortOrder(table) {
  const row = get(`SELECT MAX(sort_order) AS max_order FROM ${table}`);
  return Number(row?.max_order ?? -1) + 1;
}

function manualRows(table) {
  return all(`SELECT * FROM ${table} ORDER BY sort_order ASC, created_at ASC, name ASC`);
}

function reorderRows(table, ids) {
  const rows = manualRows(table);
  const normalizedIds = ids.map((rowId) => String(rowId));
  const known = new Set(rows.map((row) => String(row.id)));
  const rowIdByString = new Map(rows.map((row) => [String(row.id), row.id]));
  const orderedIds = [
    ...normalizedIds.filter((rowId) => known.has(rowId)).map((rowId) => rowIdByString.get(rowId)),
    ...rows.map((row) => row.id).filter((rowId) => !normalizedIds.includes(String(rowId)))
  ];
  db.exec("BEGIN TRANSACTION");
  try {
    orderedIds.forEach((rowId, index) => {
      bindAndStep(`UPDATE ${table} SET sort_order = ? WHERE id = ?`, [index, rowId]);
    });
    db.exec("COMMIT");
    saveDb();
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function migrateAlbumLayouts() {
  const pages = all("SELECT * FROM album_pages WHERE COALESCE(layout_version, 1) < 2");
  pages.forEach((page) => {
    const pageWidth = Number(page.page_width || 1000);
    const pageHeight = Number(page.page_height || 1400);
    const columns = Math.max(1, Number(page.column_count || 3));
    const gap = 32;
    const margin = 70;
    const titleSpace = 120;
    const slotWidth = Math.max(120, (pageWidth - margin * 2 - gap * (columns - 1)) / columns);
    const slotHeight = Math.max(170, Math.min(300, slotWidth * 1.18));
    const rowStep = slotHeight + 86;
    const placements = all("SELECT id FROM album_page_items WHERE page_id = ? ORDER BY sort_order ASC, created_at ASC", [page.id]);

    placements.forEach((placement, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      run(
        `
          UPDATE album_page_items
          SET x = ?, y = ?, width = ?, height = ?, rotation = 0, z_index = ?, show_caption = 1,
              show_title = 1, show_metadata = 1, locked = 1, sort_order = ?
          WHERE id = ?
        `,
        [
          margin + column * (slotWidth + gap),
          titleSpace + row * rowStep,
          slotWidth,
          slotHeight,
          index,
          index,
          placement.id
        ]
      );
    });

    run(
      `
        UPDATE album_pages
        SET page_width = ?, page_height = ?, orientation = ?, background = COALESCE(background, 'white'),
            custom_background = COALESCE(custom_background, '#ffffff'), show_guides = COALESCE(show_guides, 1),
            snap_to_grid = COALESCE(snap_to_grid, 1), grid_size = COALESCE(grid_size, 25),
            template_name = COALESCE(template_name, 'blank'), layout_version = 2
        WHERE id = ?
      `,
      [pageWidth, pageHeight, pageWidth >= pageHeight ? "landscape" : "portrait", page.id]
    );
  });
}

function getLibrary() {
  return {
    countries: manualRows("countries"),
    entityGroups: manualRows("entity_groups"),
    entityMemberships: all("SELECT entity_id, group_id FROM entity_group_memberships"),
    types: manualRows("collection_types"),
    albums: albumList(),
    dataFolder: paths.base
  };
}

function normalizeTags(tags) {
  if (Array.isArray(tags)) {
    return tags.map((tag) => String(tag).trim()).filter(Boolean);
  }
  return String(tags || "")
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function normalizeCustomFields(customFields) {
  if (customFields && typeof customFields === "object" && !Array.isArray(customFields)) {
    return customFields;
  }
  return {};
}

function linkedItemsFor(column, idValue) {
  return all(
    `
      SELECT id, title
      FROM items
      WHERE ${column} = ?
      ORDER BY title ASC
    `,
    [idValue]
  );
}

function imageFilesForItem(itemId) {
  return all("SELECT image_path, thumbnail_path FROM images WHERE item_id = ?", [itemId]);
}

function cleanupItemImages(images) {
  images.forEach((image) => cleanupImageFiles(image));
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 980,
    minHeight: 680,
    backgroundColor: "#f5f1ea",
    title: "Collection Archive",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.webContents.session.clearCache().catch((error) => {
    console.warn("[app] failed to clear renderer cache", error);
  });

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(app.getAppPath(), "dist", "index.html"));
  }
}

function imageMime(extension) {
  const ext = extension.toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  if (ext === ".tif" || ext === ".tiff") return "image/tiff";
  return "application/octet-stream";
}

function createThumbnail(sourceImage, thumbPath, width, height) {
  const maxSide = 460;
  const options = width >= height ? { width: maxSide } : { height: maxSide };
  const thumbnail = sourceImage.resize(options);
  fs.writeFileSync(thumbPath, thumbnail.toPNG());
}

function deleteFileIfUnreferenced(filePath, column) {
  if (!filePath) return false;

  const folder = column === "thumbnail_path" ? paths.thumbs : paths.images;
  const resolved = path.resolve(filePath);
  if (!isInside(folder, resolved)) {
    console.warn("[images:cleanup] refused path outside media folder", { column, filePath });
    return false;
  }

  const references = Number(get(`SELECT COUNT(*) AS count FROM images WHERE ${column} = ?`, [filePath])?.count ?? 0);
  if (references > 0 || !fs.existsSync(resolved)) {
    return false;
  }

  fs.unlinkSync(resolved);
  console.log("[images:cleanup] deleted unreferenced file", { column, path: resolved });
  return true;
}

function cleanupImageFiles(image) {
  return {
    imageDeleted: deleteFileIfUnreferenced(image.image_path, "image_path"),
    thumbnailDeleted: deleteFileIfUnreferenced(image.thumbnail_path, "thumbnail_path")
  };
}

async function pickSingleImage(title) {
  const result = await dialog.showOpenDialog({
    title,
    properties: ["openFile"],
    filters: [
      {
        name: "Images",
        extensions: ["jpg", "jpeg", "png", "webp", "gif", "tif", "tiff"]
      }
    ]
  });

  return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0];
}

async function addImages(itemId) {
  const item = get("SELECT id FROM items WHERE id = ?", [itemId]);
  if (!item) {
    throw new Error("Item not found");
  }

  const result = await dialog.showOpenDialog({
    title: "Add item images",
    properties: ["openFile", "multiSelections"],
    filters: [
      {
        name: "Images",
        extensions: ["jpg", "jpeg", "png", "webp", "gif", "tif", "tiff"]
      }
    ]
  });

  if (result.canceled || result.filePaths.length === 0) {
    return [];
  }

  const existingCount = get("SELECT COUNT(*) AS count FROM images WHERE item_id = ?", [itemId]).count;
  const inserted = [];

  result.filePaths.forEach((filePath, index) => {
    console.log("[images:add] selected file", { path: filePath });
    const image = nativeImage.createFromPath(filePath);
    const size = image.getSize();
    if (!size.width || !size.height) {
      console.warn("[images:add] skipped unreadable image", { path: filePath });
      return;
    }

    const imageId = id();
    const extension = path.extname(filePath) || ".img";
    const storedFilename = `${imageId}${extension.toLowerCase()}`;
    const thumbFilename = `${imageId}.png`;
    const destination = path.join(paths.images, storedFilename);
    const thumbnailPath = path.join(paths.thumbs, thumbFilename);
    const stats = fs.statSync(filePath);

    fs.copyFileSync(filePath, destination);
    createThumbnail(image, thumbnailPath, size.width, size.height);

    console.log("[images:add] copied image", {
      originalPath: filePath,
      copiedImagePath: destination,
      thumbnailPath,
      width: size.width,
      height: size.height
    });

    run(
      `
        INSERT INTO images (
          id, item_id, original_filename, stored_filename, image_path,
          thumbnail_path, width, height, aspect_ratio, size_bytes,
          mime_type, sort_order, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        imageId,
        itemId,
        path.basename(filePath),
        storedFilename,
        destination,
        thumbnailPath,
        size.width,
        size.height,
        size.width / size.height,
        stats.size,
        imageMime(extension),
        existingCount + index,
        now()
      ]
    );

    const insertedImage = mapImage(get("SELECT * FROM images WHERE id = ?", [imageId]));
    console.log("[images:add] renderer media urls", {
      imageSrc: insertedImage.url,
      thumbnailSrc: insertedImage.thumbnailUrl
    });
    inserted.push(insertedImage);
  });

  run("UPDATE items SET updated_at = ? WHERE id = ?", [now(), itemId]);
  return inserted;
}

function handlePerfIpc(channel, handler) {
  ipcMain.handle(channel, (event, payload) => {
    const started = performance.now();
    const traceId = payload?._traceId || "";
    perfTrace("ipc.start", { channel, traceId });
    try {
      const result = handler(event, payload);
      perfTrace("ipc.end", {
        channel,
        traceId,
        ms: Math.round((performance.now() - started) * 10) / 10,
        rows: Array.isArray(result?.items) ? result.items.length : undefined,
        total: result?.total
      });
      return result;
    } catch (error) {
      perfTrace("ipc.error", {
        channel,
        traceId,
        ms: Math.round((performance.now() - started) * 10) / 10,
        message: error.message
      });
      throw error;
    }
  });
}

ipcMain.handle("library:get", () => getLibrary());
handlePerfIpc("items:query", (_event, payload) => itemPage(payload || {}, false));
handlePerfIpc("items:count", (_event, payload) => countItems(payload || {}, false));
handlePerfIpc("gallery:query", (_event, payload) => itemPage(payload || {}, true));
handlePerfIpc("items:recent", (_event, payload) => itemPage({ ...(payload || {}), sort: "updated_desc" }, false));
handlePerfIpc("items:favorites", (_event, payload) => itemPage({ ...(payload || {}), favorite: true }, false));

ipcMain.handle("country:create", (_event, payload) => {
  const rowId = id();
  const name = String(payload.name || "").trim();
  if (!name) return getLibrary();
  run("INSERT OR IGNORE INTO countries (id, name, sort_key, sort_order, notes, created_at) VALUES (?, ?, ?, ?, ?, ?)", [
    rowId,
    name,
    String(payload.sort_key || ""),
    nextSortOrder("countries"),
    String(payload.notes || ""),
    now()
  ]);
  return getLibrary();
});

ipcMain.handle("country:update", (_event, payload) => {
  const name = String(payload.name || "").trim();
  if (!payload.id || !name) return getLibrary();
  run("UPDATE countries SET name = ?, notes = ? WHERE id = ?", [
    name,
    String(payload.notes || ""),
    payload.id
  ]);
  return getLibrary();
});

ipcMain.handle("country:reorder", (_event, ids) => {
  reorderRows("countries", Array.isArray(ids) ? ids : []);
  return getLibrary();
});

ipcMain.handle("country:delete", (_event, payload) => {
  const countryId = typeof payload === "string" ? payload : payload.id;
  const action = typeof payload === "string" ? "check" : payload.action || "check";
  const replacementId = typeof payload === "string" ? null : payload.replacementId || null;
  const linkedItems = linkedItemsFor("country_id", countryId);

  if (linkedItems.length > 0 && action === "check") {
    return { blocked: true, linkedItems, count: linkedItems.length };
  }

  if (linkedItems.length > 0 && action === "reassign") {
    if (!replacementId || replacementId === countryId) {
      return { blocked: true, error: "Choose a different issuing entity to reassign linked items." };
    }
    run("UPDATE items SET country_id = ?, updated_at = ? WHERE country_id = ?", [replacementId, now(), countryId]);
  }

  if (linkedItems.length > 0 && action === "clear") {
    run("UPDATE items SET country_id = NULL, updated_at = ? WHERE country_id = ?", [now(), countryId]);
  }

  if (linkedItems.length > 0 && action !== "reassign" && action !== "clear") {
    return { blocked: true, linkedItems, count: linkedItems.length };
  }

  run("DELETE FROM countries WHERE id = ?", [countryId]);
  normalizeSortOrder("countries");
  return { deleted: true };
});

ipcMain.handle("country:reassign", (_event, payload) => {
  run("UPDATE items SET country_id = ?, updated_at = ? WHERE country_id = ?", [
    payload.toCountryId || null,
    now(),
    payload.fromCountryId
  ]);
  return getLibrary();
});

ipcMain.handle("entity-group:create", (_event, payload) => {
  const name = String(payload.name || "").trim();
  if (!name) return getLibrary();
  run("INSERT OR IGNORE INTO entity_groups (name, kind, notes, sort_order, created_at) VALUES (?, ?, ?, ?, ?)", [
    name,
    String(payload.kind || ""),
    String(payload.notes || ""),
    nextSortOrder("entity_groups"),
    now()
  ]);
  return getLibrary();
});

ipcMain.handle("entity-group:update", (_event, payload) => {
  const name = String(payload.name || "").trim();
  if (!payload.id || !name) return getLibrary();
  run("UPDATE entity_groups SET name = ?, kind = ?, notes = ? WHERE id = ?", [
    name,
    String(payload.kind || ""),
    String(payload.notes || ""),
    Number(payload.id)
  ]);
  return getLibrary();
});

ipcMain.handle("entity-group:reorder", (_event, ids) => {
  reorderRows("entity_groups", Array.isArray(ids) ? ids : []);
  return getLibrary();
});

ipcMain.handle("entity-group:delete", (_event, groupId) => {
  run("DELETE FROM entity_groups WHERE id = ?", [Number(groupId)]);
  normalizeSortOrder("entity_groups");
  return getLibrary();
});

ipcMain.handle("entity-memberships:set", (_event, payload) => {
  const entityId = payload?.entityId || "";
  const groupIds = Array.isArray(payload?.groupIds) ? payload.groupIds.map((entry) => Number(entry)).filter(Boolean) : [];
  if (!entityId) return getLibrary();
  db.exec("BEGIN TRANSACTION");
  try {
    bindAndStep("DELETE FROM entity_group_memberships WHERE entity_id = ?", [entityId]);
    groupIds.forEach((groupId) => {
      bindAndStep("INSERT OR IGNORE INTO entity_group_memberships (entity_id, group_id) VALUES (?, ?)", [entityId, groupId]);
    });
    db.exec("COMMIT");
    saveDb();
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return getLibrary();
});

ipcMain.handle("type:create", (_event, payload) => {
  const rowId = id();
  const name = String(payload.name || "").trim();
  if (!name) return getLibrary();
  run("INSERT OR IGNORE INTO collection_types (id, name, sort_key, sort_order, description, custom_fields_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", [
    rowId,
    name,
    String(payload.sort_key || ""),
    nextSortOrder("collection_types"),
    String(payload.description || ""),
    JSON.stringify(normalizeCustomFields(payload.customFields)),
    now()
  ]);
  return getLibrary();
});

ipcMain.handle("type:update", (_event, payload) => {
  const name = String(payload.name || "").trim();
  if (!payload.id || !name) return getLibrary();
  run("UPDATE collection_types SET name = ?, description = ?, custom_fields_json = ? WHERE id = ?", [
    name,
    String(payload.description || ""),
    JSON.stringify(normalizeCustomFields(payload.customFields)),
    payload.id
  ]);
  return getLibrary();
});

ipcMain.handle("type:reorder", (_event, ids) => {
  reorderRows("collection_types", Array.isArray(ids) ? ids : []);
  return getLibrary();
});

ipcMain.handle("type:delete", (_event, payload) => {
  const typeId = typeof payload === "string" ? payload : payload.id;
  const action = typeof payload === "string" ? "check" : payload.action || "check";
  const replacementId = typeof payload === "string" ? null : payload.replacementId || null;
  const linkedItems = linkedItemsFor("type_id", typeId);

  if (linkedItems.length > 0 && action === "check") {
    return { blocked: true, linkedItems, count: linkedItems.length };
  }

  if (linkedItems.length > 0 && action === "reassign") {
    if (!replacementId || replacementId === typeId) {
      return { blocked: true, error: "Choose a different collection type to reassign linked items." };
    }
    run("UPDATE items SET type_id = ?, updated_at = ? WHERE type_id = ?", [replacementId, now(), typeId]);
  }

  if (linkedItems.length > 0 && action === "clear") {
    run("UPDATE items SET type_id = NULL, updated_at = ? WHERE type_id = ?", [now(), typeId]);
  }

  if (linkedItems.length > 0 && action !== "reassign" && action !== "clear") {
    return { blocked: true, linkedItems, count: linkedItems.length };
  }

  run("DELETE FROM collection_types WHERE id = ?", [typeId]);
  normalizeSortOrder("collection_types");
  return { deleted: true };
});

ipcMain.handle("type:reassign", (_event, payload) => {
  run("UPDATE items SET type_id = ?, updated_at = ? WHERE type_id = ?", [
    payload.toTypeId || null,
    now(),
    payload.fromTypeId
  ]);
  return getLibrary();
});

ipcMain.handle("item:create", (_event, payload) => {
  const rowId = id();
  const timestamp = now();
  run(
    `
      INSERT INTO items (
        id, title, country_id, type_id, year, description, condition,
        purchase_price, source, tags_json, custom_fields_json, favorite,
        created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      rowId,
      String(payload.title || "").trim(),
      payload.country_id || null,
      payload.type_id || null,
      String(payload.year || ""),
      String(payload.description || ""),
      String(payload.condition || ""),
      String(payload.purchase_price || ""),
      String(payload.source || ""),
      JSON.stringify(normalizeTags(payload.tags)),
      JSON.stringify(normalizeCustomFields(payload.customFields)),
      payload.favorite ? 1 : 0,
      timestamp,
      timestamp
    ]
  );
  return get("SELECT id FROM items WHERE id = ?", [rowId]);
});

ipcMain.handle("item:update", (_event, payload) => {
  run(
    `
      UPDATE items
      SET title = ?, country_id = ?, type_id = ?, year = ?, description = ?,
          condition = ?, purchase_price = ?, source = ?, tags_json = ?,
          custom_fields_json = ?, favorite = ?, updated_at = ?
      WHERE id = ?
    `,
    [
      String(payload.title || "").trim(),
      payload.country_id || null,
      payload.type_id || null,
      String(payload.year || ""),
      String(payload.description || ""),
      String(payload.condition || ""),
      String(payload.purchase_price || ""),
      String(payload.source || ""),
      JSON.stringify(normalizeTags(payload.tags)),
      JSON.stringify(normalizeCustomFields(payload.customFields)),
      payload.favorite ? 1 : 0,
      now(),
      payload.id
    ]
  );
  return getLibrary();
});

ipcMain.handle("item:get", (_event, itemId) => {
  const item = get(
    `
      SELECT
        items.*,
        countries.name AS country_name,
        collection_types.name AS type_name,
        (
          SELECT GROUP_CONCAT(entity_groups.name, ', ')
          FROM entity_group_memberships
          JOIN entity_groups ON entity_groups.id = entity_group_memberships.group_id
          WHERE entity_group_memberships.entity_id = items.country_id
          ORDER BY entity_groups.sort_order ASC, entity_groups.name ASC
        ) AS entity_group_names
      FROM items
      LEFT JOIN countries ON countries.id = items.country_id
      LEFT JOIN collection_types ON collection_types.id = items.type_id
      WHERE items.id = ?
    `,
    [itemId]
  );
  if (!item) {
    return null;
  }
  return {
    ...mapItem(item),
    images: all("SELECT * FROM images WHERE item_id = ? ORDER BY sort_order ASC, created_at ASC", [itemId]).map(mapImage)
  };
});

ipcMain.handle("item:delete", (_event, itemId) => {
  const images = imageFilesForItem(itemId);
  run("DELETE FROM album_page_items WHERE item_id = ?", [itemId]);
  run("DELETE FROM images WHERE item_id = ?", [itemId]);
  run("DELETE FROM items WHERE id = ?", [itemId]);
  cleanupItemImages(images);
  return getLibrary();
});

ipcMain.handle("item:favorite", (_event, itemId) => {
  run(
    "UPDATE items SET favorite = CASE favorite WHEN 1 THEN 0 ELSE 1 END, updated_at = ? WHERE id = ?",
    [now(), itemId]
  );
  return getLibrary();
});

ipcMain.handle("images:add", (_event, itemId) => addImages(itemId));

ipcMain.handle("images:remove", (_event, imageId) => {
  const image = get("SELECT * FROM images WHERE id = ?", [imageId]);
  if (!image) {
    return { removed: false };
  }

  run("DELETE FROM images WHERE id = ?", [imageId]);
  const cleanup = cleanupImageFiles(image);
  run("UPDATE items SET updated_at = ? WHERE id = ?", [now(), image.item_id]);

  console.log("[images:remove] removed image", {
    imageId,
    itemId: image.item_id,
    imagePath: image.image_path,
    thumbnailPath: image.thumbnail_path,
    cleanup
  });

  return { removed: true, itemId: image.item_id, cleanup };
});

ipcMain.handle("images:replace", async (_event, imageId) => {
  const existing = get("SELECT * FROM images WHERE id = ?", [imageId]);
  if (!existing) {
    throw new Error("Image not found");
  }

  const selectedPath = await pickSingleImage("Replace image");
  if (!selectedPath) {
    return null;
  }

  console.log("[images:replace] selected file", { path: selectedPath });

  const image = nativeImage.createFromPath(selectedPath);
  const size = image.getSize();
  if (!size.width || !size.height) {
    throw new Error("Selected file could not be read as an image");
  }

  const extension = (path.extname(selectedPath) || ".img").toLowerCase();
  const storedFilename = `${existing.id}${extension}`;
  const destination = path.join(paths.images, storedFilename);
  const thumbnailPath = path.join(paths.thumbs, `${existing.id}.png`);
  const stats = fs.statSync(selectedPath);

  if (path.resolve(selectedPath) !== path.resolve(destination)) {
    fs.copyFileSync(selectedPath, destination);
  }
  createThumbnail(image, thumbnailPath, size.width, size.height);

  console.log("[images:replace] copied replacement", {
    originalPath: selectedPath,
    copiedImagePath: destination,
    thumbnailPath,
    width: size.width,
    height: size.height
  });

  run(
    `
      UPDATE images
      SET original_filename = ?, stored_filename = ?, image_path = ?, thumbnail_path = ?,
          width = ?, height = ?, aspect_ratio = ?, size_bytes = ?, mime_type = ?
      WHERE id = ?
    `,
    [
      path.basename(selectedPath),
      storedFilename,
      destination,
      thumbnailPath,
      size.width,
      size.height,
      size.width / size.height,
      stats.size,
      imageMime(extension),
      imageId
    ]
  );

  cleanupImageFiles(existing);
  run("UPDATE items SET updated_at = ? WHERE id = ?", [now(), existing.item_id]);

  const replacedImage = mapImage(get("SELECT * FROM images WHERE id = ?", [imageId]));
  console.log("[images:replace] renderer media urls", {
    imageSrc: replacedImage.url,
    thumbnailSrc: replacedImage.thumbnailUrl
  });

  return replacedImage;
});

ipcMain.handle("album:create", (_event, payload) => {
  const rowId = id();
  const timestamp = now();
  run("INSERT INTO albums (id, title, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)", [
    rowId,
    String(payload.title || "").trim(),
    String(payload.description || ""),
    timestamp,
    timestamp
  ]);
  return getLibrary();
});

ipcMain.handle("album:update", (_event, payload) => {
  if (!payload.id) return getLibrary();
  run("UPDATE albums SET title = ?, description = ?, updated_at = ? WHERE id = ?", [
    String(payload.title || "").trim(),
    String(payload.description || ""),
    now(),
    payload.id
  ]);
  return getAlbum(payload.id);
});

ipcMain.handle("album:delete", (_event, albumId) => {
  run(
    `
      DELETE FROM album_page_items
      WHERE page_id IN (SELECT id FROM album_pages WHERE album_id = ?)
    `,
    [albumId]
  );
  run(
    `
      DELETE FROM album_text_items
      WHERE page_id IN (SELECT id FROM album_pages WHERE album_id = ?)
    `,
    [albumId]
  );
  run("DELETE FROM album_pages WHERE album_id = ?", [albumId]);
  run("DELETE FROM albums WHERE id = ?", [albumId]);
  return getLibrary();
});

ipcMain.handle("album-page:create", (_event, payload) => {
  const rowId = id();
  const pageNumber =
    payload.page_number ||
    Number(get("SELECT COUNT(*) AS count FROM album_pages WHERE album_id = ?", [payload.album_id]).count) + 1;
  const timestamp = now();
  const orientation = payload.orientation === "landscape" ? "landscape" : "portrait";
  const pageWidth = Number(payload.page_width || (orientation === "landscape" ? 1400 : 1000));
  const pageHeight = Number(payload.page_height || (orientation === "landscape" ? 1000 : 1400));
  run(
    `
      INSERT INTO album_pages (
        id, album_id, title, page_number, notes, column_count, page_width, page_height,
        orientation, background, custom_background, paper_preset, background_image_id, background_image_enabled,
        background_opacity, background_fit, show_guides, snap_to_grid, grid_size,
        template_name, layout_version, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      rowId,
      payload.album_id,
      String(payload.title || `Page ${pageNumber}`),
      pageNumber,
      String(payload.notes || ""),
      Number(payload.column_count || 3),
      pageWidth,
      pageHeight,
      orientation,
      String(payload.background || "white"),
      String(payload.custom_background || "#ffffff"),
      String(payload.paper_preset || "custom"),
      payload.background_image_id || null,
      payload.background_image_enabled ? 1 : 0,
      Number(payload.background_opacity ?? 1),
      String(payload.background_fit || "contain"),
      payload.show_guides === false ? 0 : 1,
      payload.snap_to_grid === false ? 0 : 1,
      Number(payload.grid_size || 25),
      String(payload.template_name || "blank"),
      2,
      timestamp,
      timestamp
    ]
  );
  run("UPDATE albums SET updated_at = ? WHERE id = ?", [timestamp, payload.album_id]);
  return getAlbum(payload.album_id);
});

ipcMain.handle("album-page:update", (_event, payload) => {
  const page = get("SELECT album_id FROM album_pages WHERE id = ?", [payload.id]);
  if (!page) return null;
  const orientation = payload.orientation === "landscape" ? "landscape" : "portrait";
  const pageWidth = Number(payload.page_width || (orientation === "landscape" ? 1400 : 1000));
  const pageHeight = Number(payload.page_height || (orientation === "landscape" ? 1000 : 1400));
  run(
    `
      UPDATE album_pages
      SET title = ?, notes = ?, column_count = ?, page_width = ?, page_height = ?, orientation = ?,
          background = ?, custom_background = ?, paper_preset = ?, background_image_id = ?,
          background_image_enabled = ?, background_opacity = ?, background_fit = ?,
          show_guides = ?, snap_to_grid = ?, grid_size = ?,
          template_name = ?, updated_at = ?
      WHERE id = ?
    `,
    [
      String(payload.title || ""),
      String(payload.notes || ""),
      Number(payload.column_count || 3),
      pageWidth,
      pageHeight,
      orientation,
      String(payload.background || "white"),
      String(payload.custom_background || "#ffffff"),
      String(payload.paper_preset || "custom"),
      payload.background_image_id || null,
      payload.background_image_enabled ? 1 : 0,
      Number(payload.background_opacity ?? 1),
      String(payload.background_fit || "contain"),
      payload.show_guides ? 1 : 0,
      payload.snap_to_grid ? 1 : 0,
      Number(payload.grid_size || 25),
      String(payload.template_name || "blank"),
      now(),
      payload.id
    ]
  );
  run("UPDATE albums SET updated_at = ? WHERE id = ?", [now(), page.album_id]);
  return getAlbum(page.album_id);
});

ipcMain.handle("album-page:delete", (_event, pageId) => {
  const page = get("SELECT album_id FROM album_pages WHERE id = ?", [pageId]);
  if (!page) return null;
  run("DELETE FROM album_page_items WHERE page_id = ?", [pageId]);
  run("DELETE FROM album_text_items WHERE page_id = ?", [pageId]);
  run("DELETE FROM album_pages WHERE id = ?", [pageId]);
  const pages = all("SELECT id FROM album_pages WHERE album_id = ? ORDER BY page_number ASC", [page.album_id]);
  pages.forEach((entry, index) => {
    run("UPDATE album_pages SET page_number = ? WHERE id = ?", [index + 1, entry.id]);
  });
  run("UPDATE albums SET updated_at = ? WHERE id = ?", [now(), page.album_id]);
  return getAlbum(page.album_id);
});

function getAlbum(albumId) {
  const album = get("SELECT * FROM albums WHERE id = ?", [albumId]);
  if (!album) return null;

  const pages = all("SELECT * FROM album_pages WHERE album_id = ? ORDER BY page_number ASC", [albumId]).map((page) => {
    const pageItems = all(
      `
        SELECT
          album_page_items.*,
          items.title,
          items.year,
          countries.name AS country_name,
          collection_types.name AS type_name,
          display_image.id AS display_image_id,
          display_image.thumbnail_path AS cover_thumbnail_path,
          display_image.image_path AS cover_image_path,
          display_image.width AS cover_width,
          display_image.height AS cover_height,
          display_image.aspect_ratio AS cover_aspect_ratio
        FROM album_page_items
        JOIN items ON items.id = album_page_items.item_id
        LEFT JOIN countries ON countries.id = items.country_id
        LEFT JOIN collection_types ON collection_types.id = items.type_id
        LEFT JOIN images AS display_image ON display_image.id = COALESCE(
          (
            SELECT id FROM images
            WHERE images.id = album_page_items.image_id
              AND images.item_id = items.id
            LIMIT 1
          ),
          (
            SELECT id FROM images
            WHERE images.item_id = items.id
            ORDER BY sort_order ASC, created_at ASC
            LIMIT 1
          )
        )
        WHERE album_page_items.page_id = ?
        ORDER BY album_page_items.sort_order ASC, album_page_items.created_at ASC
      `,
      [page.id]
    ).map((row) => {
      const selectedImageId = row.image_id === row.display_image_id ? row.image_id : null;
      return {
        ...row,
        element_type: "image",
        image_id: selectedImageId,
        x: Number(row.x || 0),
        y: Number(row.y || 0),
        width: Number(row.width || 1),
        height: Number(row.height || 1),
        rotation: Number(row.rotation || 0),
        z_index: Number(row.z_index || 0),
        show_caption: Boolean(row.show_caption),
        show_title: Boolean(row.show_title),
        show_metadata: Boolean(row.show_metadata),
        locked: Boolean(row.locked),
        frame_style: row.frame_style || "none",
        border_color: row.border_color || "#b8c8c4",
        background_color: row.background_color || "#ffffff",
        background_opacity: Number(row.background_opacity ?? 0),
        padding: Number(row.padding ?? 4),
        border_radius: Number(row.border_radius ?? 2),
        images: all("SELECT * FROM images WHERE item_id = ? ORDER BY sort_order ASC, created_at ASC", [row.item_id]).map(mapImage),
        cover: row.cover_thumbnail_path
          ? {
              id: row.display_image_id,
              thumbnailUrl: mediaUrl("thumbnails", row.cover_thumbnail_path),
              url: mediaUrl("images", row.cover_image_path),
              width: row.cover_width,
              height: row.cover_height,
              aspect_ratio: row.cover_aspect_ratio
            }
          : null
      };
    });

    const textItems = all(
      `
        SELECT *
        FROM album_text_items
        WHERE page_id = ?
        ORDER BY sort_order ASC, created_at ASC
      `,
      [page.id]
    ).map((row) => ({
      ...row,
      element_type: "text",
      x: Number(row.x || 0),
      y: Number(row.y || 0),
      width: Number(row.width || 260),
      height: Number(row.height || 120),
      rotation: Number(row.rotation || 0),
      z_index: Number(row.z_index || 0),
      font_size: Number(row.font_size || 24),
      bold: Boolean(row.bold),
      italic: Boolean(row.italic),
      locked: Boolean(row.locked),
      show_caption: false,
      show_title: false,
      show_metadata: false,
      title: "Text box"
    }));

    const backgroundImage = page.background_image_id
      ? get("SELECT * FROM images WHERE id = ?", [page.background_image_id])
      : null;

    return {
      ...page,
      show_guides: Boolean(page.show_guides),
      snap_to_grid: Boolean(page.snap_to_grid),
      background_image_enabled: Boolean(page.background_image_enabled),
      background_opacity: Number(page.background_opacity ?? 1),
      background_image: backgroundImage ? mapImage(backgroundImage) : null,
      items: [...pageItems, ...textItems].sort((a, b) => Number(a.z_index || 0) - Number(b.z_index || 0) || Number(a.sort_order || 0) - Number(b.sort_order || 0))
    };
  });

  return {
    ...album,
    pages
  };
}

ipcMain.handle("album:get", (_event, albumId) => getAlbum(albumId));

ipcMain.handle("album-page-item:add", (_event, payload) => {
  const rowId = id();
  const sortOrder =
    payload.sort_order ||
    Number(get("SELECT COUNT(*) AS count FROM album_page_items WHERE page_id = ?", [payload.page_id]).count);
  const page = get("SELECT * FROM album_pages WHERE id = ?", [payload.page_id]);
  const selectedImage = payload.image_id
    ? get("SELECT id FROM images WHERE id = ? AND item_id = ?", [payload.image_id, payload.item_id])
    : null;
  const fallbackImage = get("SELECT * FROM images WHERE item_id = ? ORDER BY sort_order ASC, created_at ASC LIMIT 1", [payload.item_id]);
  const displayImage = selectedImage ? get("SELECT * FROM images WHERE id = ?", [selectedImage.id]) : fallbackImage;
  const pageWidth = Number(page?.page_width || 1000);
  const grid = Number(page?.grid_size || 25);
  const aspectRatio = Number(displayImage?.aspect_ratio || 1);
  const defaultWidth = Math.min(260, Math.max(140, pageWidth * 0.22));
  const defaultHeight = Math.max(170, defaultWidth / Math.max(0.2, aspectRatio) + 56);
  const defaultX = 70 + (sortOrder % 3) * (defaultWidth + 24);
  const defaultY = 120 + Math.floor(sortOrder / 3) * (defaultHeight + 40);
  const maxZ = Number(get("SELECT MAX(z_index) AS max_z FROM album_page_items WHERE page_id = ?", [payload.page_id])?.max_z ?? -1);
  run(
    `
      INSERT INTO album_page_items (
        id, page_id, item_id, image_id, x, y, width, height, rotation, z_index, caption,
        show_caption, show_title, show_metadata, locked, frame_style, border_color, background_color,
        background_opacity, padding, border_radius, sort_order, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      rowId,
      payload.page_id,
      payload.item_id,
      selectedImage?.id || null,
      payload.x ?? Math.round(defaultX / grid) * grid,
      payload.y ?? Math.round(defaultY / grid) * grid,
      payload.width ?? defaultWidth,
      payload.height ?? defaultHeight,
      Number(payload.rotation || 0),
      payload.z_index ?? maxZ + 1,
      String(payload.caption || ""),
      payload.show_caption === false ? 0 : 1,
      payload.show_title === false ? 0 : 1,
      payload.show_metadata === false ? 0 : 1,
      payload.locked === false ? 0 : 1,
      ["none", "thin", "light", "shadow"].includes(payload.frame_style) ? payload.frame_style : "none",
      String(payload.border_color || "#b8c8c4"),
      String(payload.background_color || "#ffffff"),
      Number(payload.background_opacity ?? 0),
      Number(payload.padding ?? 4),
      Number(payload.border_radius ?? 2),
      sortOrder,
      now()
    ]
  );
  run("UPDATE albums SET updated_at = ? WHERE id = ?", [now(), page.album_id]);
  return getAlbum(page.album_id);
});

ipcMain.handle("album-page-item:update", (_event, payload) => {
  if (payload.element_type === "text") {
    const row = get(
      `
        SELECT album_pages.album_id
        FROM album_text_items
        JOIN album_pages ON album_pages.id = album_text_items.page_id
        WHERE album_text_items.id = ?
      `,
      [payload.id]
    );
    if (!row) return null;
    run(
      `
        UPDATE album_text_items
        SET x = ?, y = ?, width = ?, height = ?, rotation = ?, z_index = ?,
            text_content = ?, font_size = ?, bold = ?, italic = ?, text_align = ?,
            text_color = ?, background = ?, locked = ?, sort_order = ?
        WHERE id = ?
      `,
      [
        Number(payload.x || 0),
        Number(payload.y || 0),
        Number(payload.width || 1),
        Number(payload.height || 1),
        Number(payload.rotation || 0),
        Number(payload.z_index || 0),
        String(payload.text_content || ""),
        Number(payload.font_size || 24),
        payload.bold ? 1 : 0,
        payload.italic ? 1 : 0,
        ["left", "center", "right"].includes(payload.text_align) ? payload.text_align : "center",
        String(payload.text_color || "#202629"),
        String(payload.background || "transparent"),
        payload.locked ? 1 : 0,
        Number(payload.sort_order || 0),
        payload.id
      ]
    );
    run("UPDATE albums SET updated_at = ? WHERE id = ?", [now(), row.album_id]);
    return getAlbum(row.album_id);
  }

  const row = get(
    `
      SELECT album_pages.album_id, album_page_items.item_id
      FROM album_page_items
      JOIN album_pages ON album_pages.id = album_page_items.page_id
      WHERE album_page_items.id = ?
    `,
    [payload.id]
  );
  if (!row) return null;

  const selectedImage = payload.image_id
    ? get("SELECT id FROM images WHERE id = ? AND item_id = ?", [payload.image_id, row.item_id])
    : null;

  run(
    `
      UPDATE album_page_items
      SET image_id = ?, x = ?, y = ?, width = ?, height = ?, rotation = ?, z_index = ?,
          caption = ?, show_caption = ?, show_title = ?, show_metadata = ?, locked = ?,
          frame_style = ?, border_color = ?, background_color = ?, background_opacity = ?,
          padding = ?, border_radius = ?, sort_order = ?
      WHERE id = ?
    `,
    [
      selectedImage?.id || null,
      Number(payload.x || 0),
      Number(payload.y || 0),
      Number(payload.width || 1),
      Number(payload.height || 1),
      Number(payload.rotation || 0),
      Number(payload.z_index || 0),
      String(payload.caption || ""),
      payload.show_caption === false || payload.show_caption === 0 ? 0 : 1,
      payload.show_title === false || payload.show_title === 0 ? 0 : 1,
      payload.show_metadata === false || payload.show_metadata === 0 ? 0 : 1,
      payload.locked === false || payload.locked === 0 ? 0 : 1,
      ["none", "thin", "light", "shadow"].includes(payload.frame_style) ? payload.frame_style : "none",
      String(payload.border_color || "#b8c8c4"),
      String(payload.background_color || "#ffffff"),
      Number(payload.background_opacity ?? 0),
      Number(payload.padding ?? 4),
      Number(payload.border_radius ?? 2),
      Number(payload.sort_order || 0),
      payload.id
    ]
  );
  run("UPDATE albums SET updated_at = ? WHERE id = ?", [now(), row.album_id]);
  return getAlbum(row.album_id);
});

ipcMain.handle("album-text:add", (_event, payload) => {
  const rowId = id();
  const page = get("SELECT * FROM album_pages WHERE id = ?", [payload.page_id]);
  if (!page) return null;
  const sortOrder =
    payload.sort_order ||
    Number(get("SELECT COUNT(*) AS count FROM album_text_items WHERE page_id = ?", [payload.page_id]).count);
  const maxZ = Math.max(
    Number(get("SELECT MAX(z_index) AS max_z FROM album_page_items WHERE page_id = ?", [payload.page_id])?.max_z ?? -1),
    Number(get("SELECT MAX(z_index) AS max_z FROM album_text_items WHERE page_id = ?", [payload.page_id])?.max_z ?? -1)
  );
  run(
    `
      INSERT INTO album_text_items (
        id, page_id, x, y, width, height, rotation, z_index, text_content, font_size,
        bold, italic, text_align, text_color, background, locked, sort_order, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      rowId,
      payload.page_id,
      Number(payload.x ?? 90),
      Number(payload.y ?? 90),
      Number(payload.width ?? 320),
      Number(payload.height ?? 120),
      Number(payload.rotation || 0),
      Number(payload.z_index ?? maxZ + 1),
      String(payload.text_content || "Album text"),
      Number(payload.font_size || 24),
      payload.bold ? 1 : 0,
      payload.italic ? 1 : 0,
      ["left", "center", "right"].includes(payload.text_align) ? payload.text_align : "center",
      String(payload.text_color || "#202629"),
      String(payload.background || "transparent"),
      payload.locked ? 1 : 0,
      sortOrder,
      now()
    ]
  );
  run("UPDATE albums SET updated_at = ? WHERE id = ?", [now(), page.album_id]);
  return getAlbum(page.album_id);
});

ipcMain.handle("album-page-item:remove", (_event, pageItemId) => {
  let page = get(
    `
      SELECT album_pages.album_id
      FROM album_page_items
      JOIN album_pages ON album_pages.id = album_page_items.page_id
      WHERE album_page_items.id = ?
    `,
    [pageItemId]
  );
  if (page) {
    run("DELETE FROM album_page_items WHERE id = ?", [pageItemId]);
  } else {
    page = get(
      `
        SELECT album_pages.album_id
        FROM album_text_items
        JOIN album_pages ON album_pages.id = album_text_items.page_id
        WHERE album_text_items.id = ?
      `,
      [pageItemId]
    );
    run("DELETE FROM album_text_items WHERE id = ?", [pageItemId]);
  }
  return page ? getAlbum(page.album_id) : null;
});

ipcMain.handle("app:reveal-data-folder", () => {
  shell.openPath(paths.base);
  return paths.base;
});

app.whenReady().then(async () => {
  await initDatabase();
  registerMediaProtocol();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
