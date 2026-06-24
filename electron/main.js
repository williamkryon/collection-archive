const { app, BrowserWindow, dialog, ipcMain, nativeImage, net, protocol, shell } = require("electron");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");
const { pathToFileURL } = require("url");
const crypto = require("crypto");
const initSqlJs = require("sql.js");
const heicConvert = require("heic-convert");
const QRCode = require("qrcode");
const sharp = require("sharp");

let db;
let SQL;
let paths;
let databaseReady = false;
let mediaProtocolRegistered = false;
let phoneUploadSession = null;
let phoneUploadQueue = Promise.resolve();
const mainStartedAt = performance.now();
const startupTimings = [];

const now = () => new Date().toISOString();
const id = () => crypto.randomUUID();
const startupTraceOn = () => process.env.ARCHIVE_PERF_TRACE === "1" || !app.isPackaged;
const perfTraceOn = () => process.env.ARCHIVE_PERF_TRACE === "1";

function perfTrace(event, data = {}) {
  if (!perfTraceOn()) return;
  console.log(`[perf-main] ${JSON.stringify({
    event,
    t: Math.round(performance.now() * 10) / 10,
    ...data
  })}`);
}

function startupLog(event, data = {}) {
  if (!startupTraceOn()) return;
  console.log(`[startup] ${JSON.stringify({
    event,
    t: Math.round((performance.now() - mainStartedAt) * 10) / 10,
    ...data
  })}`);
}

async function measureStartup(label, fn) {
  const started = performance.now();
  startupLog(`${label}.start`);
  try {
    const result = await fn();
    const ms = Math.round((performance.now() - started) * 10) / 10;
    startupTimings.push({ label, ms });
    startupLog(`${label}.end`, { ms });
    return result;
  } catch (error) {
    const ms = Math.round((performance.now() - started) * 10) / 10;
    startupTimings.push({ label, ms, error: error.message });
    startupLog(`${label}.error`, { ms, message: error.message });
    throw error;
  }
}

function startupSummary(extra = {}) {
  startupLog("summary", {
    totalMs: Math.round((performance.now() - mainStartedAt) * 10) / 10,
    timings: startupTimings,
    ...extra
  });
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
    thumbs: path.join(base, "thumbnails"),
    phoneUploads: path.join(base, "phone-upload-temp")
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
  if (mediaProtocolRegistered) return;
  mediaProtocolRegistered = true;
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

function tableExists(name) {
  return Boolean(get("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", [name]));
}

function indexExists(name) {
  return Boolean(get("SELECT name FROM sqlite_master WHERE type = 'index' AND name = ?", [name]));
}

function execSchema(databaseWasCreated = false) {
  let dirty = databaseWasCreated;
  const expectedTables = [
    "countries",
    "collection_types",
    "entity_groups",
    "entity_group_memberships",
    "items",
    "images",
    "albums",
    "album_pages",
    "album_page_items",
    "album_text_items",
    "album_page_templates"
  ];
  if (!dirty) {
    dirty = expectedTables.some((name) => !tableExists(name));
  }

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
      deleted_at TEXT DEFAULT '',
      deleted_reason TEXT DEFAULT '',
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
      note TEXT DEFAULT '',
      sort_order INTEGER DEFAULT 0,
      deleted_at TEXT DEFAULT '',
      deleted_reason TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS albums (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      deleted_at TEXT DEFAULT '',
      deleted_reason TEXT DEFAULT '',
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
      deleted_at TEXT DEFAULT '',
      deleted_reason TEXT DEFAULT '',
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
      crop_left REAL DEFAULT 0,
      crop_right REAL DEFAULT 0,
      crop_top REAL DEFAULT 0,
      crop_bottom REAL DEFAULT 0,
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
      font_family TEXT DEFAULT 'system',
      font_size INTEGER DEFAULT 24,
      bold INTEGER DEFAULT 0,
      italic INTEGER DEFAULT 0,
      underline INTEGER DEFAULT 0,
      text_align TEXT DEFAULT 'center',
      line_height REAL DEFAULT 1.25,
      text_color TEXT DEFAULT '#202629',
      background TEXT DEFAULT 'transparent',
      background_color TEXT DEFAULT '#ffffff',
      background_opacity REAL DEFAULT 0,
      border_color TEXT DEFAULT '#202629',
      border_width REAL DEFAULT 0,
      border_radius REAL DEFAULT 0,
      padding REAL DEFAULT 8,
      locked INTEGER DEFAULT 0,
      sort_order INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (page_id) REFERENCES album_pages(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS album_page_templates (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      template_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  const countryColumns = all("PRAGMA table_info(countries)").map((column) => column.name);
  if (!countryColumns.includes("sort_key")) {
    db.exec("ALTER TABLE countries ADD COLUMN sort_key TEXT DEFAULT ''");
    dirty = true;
  }
  if (!countryColumns.includes("sort_order")) {
    db.exec("ALTER TABLE countries ADD COLUMN sort_order INTEGER DEFAULT 0");
    dirty = true;
  }
  if (!countryColumns.includes("notes")) {
    db.exec("ALTER TABLE countries ADD COLUMN notes TEXT DEFAULT ''");
    dirty = true;
  }
  const pageColumns = all("PRAGMA table_info(album_pages)").map((column) => column.name);
  if (!pageColumns.includes("column_count")) {
    db.exec("ALTER TABLE album_pages ADD COLUMN column_count INTEGER DEFAULT 3");
    dirty = true;
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
      dirty = true;
    }
  });
  if (!pageColumns.includes("layout_version")) {
    db.exec("ALTER TABLE album_pages ADD COLUMN layout_version INTEGER DEFAULT 1");
    dirty = true;
  }
  const typeColumns = all("PRAGMA table_info(collection_types)").map((column) => column.name);
  if (!typeColumns.includes("sort_key")) {
    db.exec("ALTER TABLE collection_types ADD COLUMN sort_key TEXT DEFAULT ''");
    dirty = true;
  }
  if (!typeColumns.includes("sort_order")) {
    db.exec("ALTER TABLE collection_types ADD COLUMN sort_order INTEGER DEFAULT 0");
    dirty = true;
  }
  if (!typeColumns.includes("custom_fields_json")) {
    db.exec("ALTER TABLE collection_types ADD COLUMN custom_fields_json TEXT DEFAULT '{}'");
    dirty = true;
  }
  const pageItemColumns = all("PRAGMA table_info(album_page_items)").map((column) => column.name);
  if (!pageItemColumns.includes("image_id")) {
    db.exec("ALTER TABLE album_page_items ADD COLUMN image_id TEXT");
    dirty = true;
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
    ["border_radius", "REAL DEFAULT 2"],
    ["crop_left", "REAL DEFAULT 0"],
    ["crop_right", "REAL DEFAULT 0"],
    ["crop_top", "REAL DEFAULT 0"],
    ["crop_bottom", "REAL DEFAULT 0"]
  ].forEach(([name, definition]) => {
    if (!pageItemColumns.includes(name)) {
      db.exec(`ALTER TABLE album_page_items ADD COLUMN ${name} ${definition}`);
      dirty = true;
    }
  });
  const textItemColumns = all("PRAGMA table_info(album_text_items)").map((column) => column.name);
  [
    ["font_family", "TEXT DEFAULT 'system'"],
    ["underline", "INTEGER DEFAULT 0"],
    ["line_height", "REAL DEFAULT 1.25"],
    ["background_color", "TEXT DEFAULT '#ffffff'"],
    ["background_opacity", "REAL DEFAULT 0"],
    ["border_color", "TEXT DEFAULT '#202629'"],
    ["border_width", "REAL DEFAULT 0"],
    ["border_radius", "REAL DEFAULT 0"],
    ["padding", "REAL DEFAULT 8"]
  ].forEach(([name, definition]) => {
    if (!textItemColumns.includes(name)) {
      db.exec(`ALTER TABLE album_text_items ADD COLUMN ${name} ${definition}`);
      dirty = true;
    }
  });
  [
    ["items", "deleted_at", "TEXT DEFAULT ''"],
    ["items", "deleted_reason", "TEXT DEFAULT ''"],
    ["images", "deleted_at", "TEXT DEFAULT ''"],
    ["images", "deleted_reason", "TEXT DEFAULT ''"],
    ["albums", "deleted_at", "TEXT DEFAULT ''"],
    ["albums", "deleted_reason", "TEXT DEFAULT ''"],
    ["album_pages", "deleted_at", "TEXT DEFAULT ''"],
    ["album_pages", "deleted_reason", "TEXT DEFAULT ''"]
  ].forEach(([table, name, definition]) => {
    const columns = all(`PRAGMA table_info(${table})`).map((column) => column.name);
    if (!columns.includes(name)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
      dirty = true;
    }
  });
  const imageColumns = all("PRAGMA table_info(images)").map((column) => column.name);
  if (!imageColumns.includes("note")) {
    db.exec("ALTER TABLE images ADD COLUMN note TEXT DEFAULT ''");
    dirty = true;
  }
  dirty = normalizeSortOrder("countries") || dirty;
  dirty = normalizeSortOrder("collection_types") || dirty;
  dirty = normalizeSortOrder("entity_groups") || dirty;
  dirty = migrateAlbumLayouts() || dirty;
  dirty = createIndexes() || dirty;
  if (dirty) {
    saveDb();
  }
}

function createIndexes() {
  let dirty = false;
  [
    ["idx_items_country_id", "CREATE INDEX idx_items_country_id ON items(country_id)"],
    ["idx_items_type_id", "CREATE INDEX idx_items_type_id ON items(type_id)"],
    ["idx_items_year", "CREATE INDEX idx_items_year ON items(year)"],
    ["idx_items_favorite", "CREATE INDEX idx_items_favorite ON items(favorite)"],
    ["idx_items_updated_at", "CREATE INDEX idx_items_updated_at ON items(updated_at)"],
    ["idx_items_deleted_at", "CREATE INDEX idx_items_deleted_at ON items(deleted_at)"],
    ["idx_items_title", "CREATE INDEX idx_items_title ON items(title COLLATE NOCASE)"],
    ["idx_items_tags_json", "CREATE INDEX idx_items_tags_json ON items(tags_json)"],
    ["idx_images_item_id", "CREATE INDEX idx_images_item_id ON images(item_id)"],
    ["idx_images_item_sort", "CREATE INDEX idx_images_item_sort ON images(item_id, sort_order, created_at)"],
    ["idx_images_deleted_at", "CREATE INDEX idx_images_deleted_at ON images(deleted_at)"],
    ["idx_album_page_items_page_id", "CREATE INDEX idx_album_page_items_page_id ON album_page_items(page_id)"],
    ["idx_album_page_items_item_id", "CREATE INDEX idx_album_page_items_item_id ON album_page_items(item_id)"],
    ["idx_album_page_items_image_id", "CREATE INDEX idx_album_page_items_image_id ON album_page_items(image_id)"],
    ["idx_album_page_items_page_sort", "CREATE INDEX idx_album_page_items_page_sort ON album_page_items(page_id, sort_order, created_at)"],
    ["idx_album_text_items_page_sort", "CREATE INDEX idx_album_text_items_page_sort ON album_text_items(page_id, sort_order, created_at)"],
    ["idx_album_pages_background_image_id", "CREATE INDEX idx_album_pages_background_image_id ON album_pages(background_image_id)"],
    ["idx_albums_deleted_at", "CREATE INDEX idx_albums_deleted_at ON albums(deleted_at)"],
    ["idx_album_pages_deleted_at", "CREATE INDEX idx_album_pages_deleted_at ON album_pages(deleted_at)"],
    ["idx_album_page_templates_updated_at", "CREATE INDEX idx_album_page_templates_updated_at ON album_page_templates(updated_at)"],
    ["idx_countries_sort_order", "CREATE INDEX idx_countries_sort_order ON countries(sort_order)"],
    ["idx_collection_types_sort_order", "CREATE INDEX idx_collection_types_sort_order ON collection_types(sort_order)"],
    ["idx_entity_groups_sort_order", "CREATE INDEX idx_entity_groups_sort_order ON entity_groups(sort_order)"],
    ["idx_entity_group_memberships_entity", "CREATE INDEX idx_entity_group_memberships_entity ON entity_group_memberships(entity_id)"],
    ["idx_entity_group_memberships_group", "CREATE INDEX idx_entity_group_memberships_group ON entity_group_memberships(group_id)"]
  ].forEach(([name, statement]) => {
    if (!indexExists(name)) {
      db.exec(statement);
      dirty = true;
    }
  });
  return dirty;
}

async function initDatabase() {
  const dbExistedBeforeOpen = fs.existsSync(getPaths().db);

  await measureStartup("paths.ensure", async () => {
    paths = getPaths();
    ensureDir(paths.base);
    ensureDir(paths.images);
    ensureDir(paths.thumbs);
    ensureDir(paths.phoneUploads);
  });

  SQL = await measureStartup("sqljs.init", () => initSqlJs({
    locateFile: sqlJsWasmPath
  }));

  await measureStartup("database.open", async () => {
    if (fs.existsSync(paths.db)) {
      const dbBytes = await measureStartup("database.file.read", () => fs.promises.readFile(paths.db));
      db = new SQL.Database(dbBytes);
      startupLog("database.file.loaded", { bytes: dbBytes.byteLength });
    } else {
      db = new SQL.Database();
      startupLog("database.file.created");
    }
  });

  await measureStartup("database.schema", () => execSchema(!dbExistedBeforeOpen));
  databaseReady = true;
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

const activeSql = (alias) => `COALESCE(${alias}.deleted_at, '') = ''`;

function itemQueryWhere(options = {}, galleryOnly = false) {
  const clauses = [activeSql("items")];
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
    clauses.push(`EXISTS (SELECT 1 FROM images WHERE images.item_id = items.id AND ${activeSql("images")})`);
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
        (SELECT COUNT(*) FROM images WHERE images.item_id = items.id AND COALESCE(images.deleted_at, '') = '') AS image_count,
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
          AND COALESCE(images.deleted_at, '') = ''
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
      LEFT JOIN album_pages ON album_pages.album_id = albums.id AND COALESCE(album_pages.deleted_at, '') = ''
      WHERE COALESCE(albums.deleted_at, '') = ''
      GROUP BY albums.id
      ORDER BY albums.updated_at DESC
    `
  );
}

function normalizeSortOrder(table) {
  const rows = all(`SELECT id, sort_order FROM ${table} ORDER BY sort_order ASC, created_at ASC, name ASC`);
  const changedRows = rows.filter((row, index) => Number(row.sort_order) !== index);
  if (changedRows.length === 0) return false;

  db.exec("BEGIN TRANSACTION");
  try {
    rows.forEach((row, index) => {
      if (Number(row.sort_order) !== index) {
        bindAndStep(`UPDATE ${table} SET sort_order = ? WHERE id = ?`, [index, row.id]);
      }
    });
    db.exec("COMMIT");
    return true;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
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
  if (pages.length === 0) return false;

  db.exec("BEGIN TRANSACTION");
  try {
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
      bindAndStep(
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

    bindAndStep(
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
    db.exec("COMMIT");
    return true;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
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

function createItemRecord(payload = {}) {
  const rowId = id();
  const timestamp = now();
  bindAndStep(
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
      String(payload.title || "Untitled item").trim() || "Untitled item",
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
  return rowId;
}

function linkedItemsFor(column, idValue) {
  return all(
    `
      SELECT id, title
      FROM items
      WHERE ${column} = ? AND COALESCE(deleted_at, '') = ''
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

function clampCropValue(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return 0;
  return Math.min(0.5, Math.max(0, numeric));
}

function textStylePayload(source = {}) {
  return {
    font_family: String(source.font_family || "system"),
    font_size: Number(source.font_size || 24),
    bold: source.bold ? 1 : 0,
    italic: source.italic ? 1 : 0,
    underline: source.underline ? 1 : 0,
    text_align: ["left", "center", "right"].includes(source.text_align) ? source.text_align : "center",
    line_height: Number(source.line_height || 1.25),
    text_color: String(source.text_color || "#202629"),
    background: String(source.background || "transparent"),
    background_color: String(source.background_color || "#ffffff"),
    background_opacity: Number(source.background_opacity ?? (source.background === "white" ? 1 : 0)),
    border_color: String(source.border_color || "#202629"),
    border_width: Number(source.border_width || 0),
    border_radius: Number(source.border_radius || 0),
    padding: Number(source.padding ?? 8)
  };
}

function mapTextRow(row) {
  const style = textStylePayload(row);
  return {
    ...row,
    ...style,
    element_type: "text",
    x: Number(row.x || 0),
    y: Number(row.y || 0),
    width: Number(row.width || 260),
    height: Number(row.height || 120),
    rotation: Number(row.rotation || 0),
    z_index: Number(row.z_index || 0),
    font_size: style.font_size,
    bold: Boolean(row.bold),
    italic: Boolean(row.italic),
    underline: Boolean(row.underline),
    locked: Boolean(row.locked),
    show_caption: false,
    show_title: false,
    show_metadata: false,
    title: "Text box"
  };
}

function splashHtml(status = "Loading database...") {
  const safeStatus = String(status).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Collection Archive</title>
  <style>
    :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      background: radial-gradient(circle at 50% 32%, #fffaf0 0, #f4ead7 34%, #e8eee8 100%);
      color: #202629;
    }
    .splash {
      width: min(420px, calc(100vw - 48px));
      border: 1px solid #d5ded9;
      border-radius: 10px;
      padding: 28px;
      background: rgba(255, 253, 248, 0.9);
      box-shadow: 0 22px 58px rgba(35, 32, 25, 0.16);
      text-align: center;
    }
    .mark {
      width: 44px;
      height: 54px;
      margin: 0 auto 16px;
      border: 1px solid #d7c9ae;
      border-radius: 4px;
      background: linear-gradient(180deg, #fffaf0, #f4ead7);
      box-shadow: 0 8px 18px rgba(35, 32, 25, 0.12);
    }
    h1 { margin: 0 0 8px; font-size: 22px; letter-spacing: 0; }
    p { margin: 0; color: #657375; font-size: 14px; }
    .spinner {
      width: 24px;
      height: 24px;
      margin: 20px auto 0;
      border: 3px solid #d5ded9;
      border-top-color: #1f5d57;
      border-radius: 999px;
      animation: spin 800ms linear infinite;
    }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <main class="splash" role="status" aria-live="polite">
    <div class="mark" aria-hidden="true"></div>
    <h1>Collection Archive</h1>
    <p>${safeStatus}</p>
    <div class="spinner" aria-hidden="true"></div>
  </main>
</body>
</html>`;
}

function startupErrorHtml(error) {
  const message = String(error?.message || error || "Startup failed").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
  return splashHtml(`Startup failed: ${message}`);
}

function loadHtml(win, html) {
  return win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
}

function loadApp(win) {
  if (process.env.VITE_DEV_SERVER_URL) {
    return win.loadURL(process.env.VITE_DEV_SERVER_URL);
  }
  return win.loadFile(path.join(app.getAppPath(), "dist", "index.html"));
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

  if (process.env.ARCHIVE_CLEAR_RENDERER_CACHE === "1") {
    win.webContents.session.clearCache().catch((error) => {
      console.warn("[app] failed to clear renderer cache", error);
    });
  }

  win.__archiveSplashLoaded = loadHtml(win, splashHtml("Loading database...")).catch((error) => {
    if (error?.code !== "ERR_ABORTED" && error?.errno !== -3) {
      console.warn("[startup] failed to load splash", error);
    }
  });

  return win;
}

function imageMime(extension) {
  const ext = extension.toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  if (ext === ".tif" || ext === ".tiff") return "image/tiff";
  if (ext === ".heic" || ext === ".heif") return "image/heic";
  return "application/octet-stream";
}

const imageExtensions = ["jpg", "jpeg", "png", "webp", "gif", "tif", "tiff", "heic", "heif"];
const phoneUploadMaxBytes = 60 * 1024 * 1024;
const phoneUploadMaxFiles = 250;

function imageExtension(filePathOrName) {
  return (path.extname(String(filePathOrName || "")) || "").toLowerCase();
}

function isHeicExtension(extension) {
  const ext = String(extension || "").toLowerCase();
  return ext === ".heic" || ext === ".heif";
}

function isJpegExtension(extension) {
  const ext = String(extension || "").toLowerCase();
  return ext === ".jpg" || ext === ".jpeg";
}

function isSupportedImageName(filePathOrName) {
  const ext = imageExtension(filePathOrName).replace(/^\./, "");
  return imageExtensions.includes(ext);
}

function sanitizeFilename(name) {
  const base = path.basename(String(name || "image"));
  return base.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").slice(0, 180) || "image";
}

async function normalizeToJpegBuffer(inputBuffer) {
  const { data, info } = await sharp(inputBuffer, { failOn: "none" })
    .rotate()
    .jpeg({ quality: 95 })
    .toBuffer({ resolveWithObject: true });
  const image = nativeImage.createFromBuffer(data);
  const nativeSize = image.getSize();
  const width = Number(info.width || nativeSize.width || 0);
  const height = Number(info.height || nativeSize.height || 0);
  if (!width || !height || image.isEmpty()) {
    throw new Error("Normalized image could not be read");
  }
  return {
    buffer: data,
    image,
    size: { width, height }
  };
}

async function prepareImageForImport(filePath, originalName = path.basename(filePath)) {
  const extension = imageExtension(originalName || filePath);
  if (!isSupportedImageName(originalName || filePath)) {
    throw new Error(`Unsupported image type: ${extension || "unknown"}`);
  }

  if (isHeicExtension(extension)) {
    const input = fs.readFileSync(filePath);
    const converted = Buffer.from(await heicConvert({
      buffer: input,
      format: "JPEG",
      quality: 0.93
    }));
    const normalized = await normalizeToJpegBuffer(converted);
    return {
      originalFilename: sanitizeFilename(originalName),
      storedExtension: ".jpg",
      mimeType: "image/jpeg",
      sizeBytes: normalized.buffer.length,
      image: normalized.image,
      size: normalized.size,
      buffer: normalized.buffer,
      convertedFromHeic: true
    };
  }

  if (isJpegExtension(extension)) {
    const input = fs.readFileSync(filePath);
    const normalized = await normalizeToJpegBuffer(input);
    return {
      originalFilename: sanitizeFilename(originalName),
      storedExtension: ".jpg",
      mimeType: "image/jpeg",
      sizeBytes: normalized.buffer.length,
      image: normalized.image,
      size: normalized.size,
      buffer: normalized.buffer,
      convertedFromHeic: false,
      orientationNormalized: true
    };
  }

  const image = nativeImage.createFromPath(filePath);
  const size = image.getSize();
  if (!size.width || !size.height) {
    throw new Error("Selected file could not be read as an image");
  }
  const stats = fs.statSync(filePath);
  return {
    originalFilename: sanitizeFilename(originalName),
    storedExtension: extension || ".img",
    mimeType: imageMime(extension),
    sizeBytes: stats.size,
    image,
    size,
    sourcePath: filePath,
    convertedFromHeic: false
  };
}

function createThumbnail(sourceImage, thumbPath, width, height) {
  const maxSide = 460;
  const options = width >= height ? { width: maxSide } : { height: maxSide };
  const thumbnail = sourceImage.resize(options);
  fs.writeFileSync(thumbPath, thumbnail.toPNG());
}

async function regenerateThumbnailFile(imageRow) {
  if (!imageRow?.image_path || !imageRow?.thumbnail_path) {
    throw new Error("Image record is missing file paths");
  }
  const sourcePath = path.resolve(imageRow.image_path);
  const thumbnailPath = path.resolve(imageRow.thumbnail_path);
  if (!isInside(paths.images, sourcePath) || !fs.existsSync(sourcePath)) {
    throw new Error("Source image file is missing");
  }
  if (!isInside(paths.thumbs, thumbnailPath)) {
    throw new Error("Thumbnail path is outside the data folder");
  }

  try {
    await sharp(sourcePath, { failOn: "none" })
      .rotate()
      .resize({ width: 460, height: 460, fit: "inside", withoutEnlargement: true })
      .png()
      .toFile(thumbnailPath);
  } catch (error) {
    const image = nativeImage.createFromPath(sourcePath);
    const size = image.getSize();
    if (!size.width || !size.height || image.isEmpty()) {
      throw error;
    }
    createThumbnail(image, thumbnailPath, size.width, size.height);
  }
  return mapImage(get("SELECT * FROM images WHERE id = ?", [imageRow.id]));
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

function normalizeAlbumPageNumbers(albumId) {
  const pages = all("SELECT id FROM album_pages WHERE album_id = ? AND COALESCE(deleted_at, '') = '' ORDER BY page_number ASC, created_at ASC", [albumId]);
  pages.forEach((entry, index) => {
    bindAndStep("UPDATE album_pages SET page_number = ? WHERE id = ?", [index + 1, entry.id]);
  });
}

function permanentlyDeleteItem(itemId) {
  const images = imageFilesForItem(itemId);
  run("DELETE FROM album_page_items WHERE item_id = ?", [itemId]);
  run("DELETE FROM images WHERE item_id = ?", [itemId]);
  run("DELETE FROM items WHERE id = ?", [itemId]);
  cleanupItemImages(images);
}

function permanentlyDeleteImage(imageId) {
  const image = get("SELECT * FROM images WHERE id = ?", [imageId]);
  if (!image) return;
  run("UPDATE album_page_items SET image_id = NULL WHERE image_id = ?", [imageId]);
  run("DELETE FROM images WHERE id = ?", [imageId]);
  cleanupImageFiles(image);
  run("UPDATE items SET updated_at = ? WHERE id = ?", [now(), image.item_id]);
}

function permanentlyDeleteAlbum(albumId) {
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
}

function permanentlyDeleteAlbumPage(pageId) {
  const page = get("SELECT album_id FROM album_pages WHERE id = ?", [pageId]);
  if (!page) return null;
  run("DELETE FROM album_page_items WHERE page_id = ?", [pageId]);
  run("DELETE FROM album_text_items WHERE page_id = ?", [pageId]);
  run("DELETE FROM album_pages WHERE id = ?", [pageId]);
  normalizeAlbumPageNumbers(page.album_id);
  run("UPDATE albums SET updated_at = ? WHERE id = ?", [now(), page.album_id]);
  return page.album_id;
}

async function pickSingleImage(title) {
  const result = await dialog.showOpenDialog({
    title,
    properties: ["openFile"],
    filters: [
      {
        name: "Images",
        extensions: imageExtensions
      }
    ]
  });

  return result.canceled || result.filePaths.length === 0 ? null : result.filePaths[0];
}

async function importImageFileToItem(itemId, filePath, options = {}) {
  const item = get("SELECT id FROM items WHERE id = ? AND COALESCE(deleted_at, '') = ''", [itemId]);
  if (!item) {
    throw new Error("Item not found");
  }
  const imageId = options.imageId || id();
  const originalFilename = sanitizeFilename(options.originalName || path.basename(filePath));
  const prepared = await prepareImageForImport(filePath, originalFilename);
  const storedFilename = `${imageId}${prepared.storedExtension.toLowerCase()}`;
  const thumbFilename = `${imageId}.png`;
  const destination = path.join(paths.images, storedFilename);
  const thumbnailPath = path.join(paths.thumbs, thumbFilename);

  if (prepared.buffer) {
    fs.writeFileSync(destination, prepared.buffer);
  } else if (path.resolve(filePath) !== path.resolve(destination)) {
    fs.copyFileSync(filePath, destination);
  }
  createThumbnail(prepared.image, thumbnailPath, prepared.size.width, prepared.size.height);

  const sortOrder = Number.isFinite(Number(options.sortOrder))
    ? Number(options.sortOrder)
    : Number(get("SELECT COUNT(*) AS count FROM images WHERE item_id = ? AND COALESCE(deleted_at, '') = ''", [itemId])?.count || 0);

  console.log("[images:import] stored image", {
    originalPath: filePath,
    originalFilename: prepared.originalFilename,
    copiedImagePath: destination,
    thumbnailPath,
    width: prepared.size.width,
    height: prepared.size.height,
    convertedFromHeic: prepared.convertedFromHeic,
    orientationNormalized: Boolean(prepared.orientationNormalized || prepared.convertedFromHeic)
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
      prepared.originalFilename,
      storedFilename,
      destination,
      thumbnailPath,
      prepared.size.width,
      prepared.size.height,
      prepared.size.width / prepared.size.height,
      prepared.sizeBytes,
      prepared.mimeType,
      sortOrder,
      now()
    ]
  );

  const insertedImage = mapImage(get("SELECT * FROM images WHERE id = ?", [imageId]));
  console.log("[images:import] renderer media urls", {
    imageSrc: insertedImage.url,
    thumbnailSrc: insertedImage.thumbnailUrl
  });
  return insertedImage;
}

async function addImages(itemId) {
  const item = get("SELECT id FROM items WHERE id = ? AND COALESCE(deleted_at, '') = ''", [itemId]);
  if (!item) {
    throw new Error("Item not found");
  }

  const result = await dialog.showOpenDialog({
    title: "Add item images",
    properties: ["openFile", "multiSelections"],
    filters: [
      {
        name: "Images",
        extensions: imageExtensions
      }
    ]
  });

  if (result.canceled || result.filePaths.length === 0) {
    return [];
  }

  const existingCount = get("SELECT COUNT(*) AS count FROM images WHERE item_id = ? AND COALESCE(deleted_at, '') = ''", [itemId]).count;
  const inserted = [];
  const failures = [];

  for (const filePath of result.filePaths) {
    console.log("[images:add] selected file", { path: filePath });
    try {
      inserted.push(await importImageFileToItem(itemId, filePath, {
        sortOrder: existingCount + inserted.length,
        originalName: path.basename(filePath)
      }));
    } catch (error) {
      failures.push({ filePath, message: error.message || String(error) });
      console.warn("[images:add] skipped unreadable image", { path: filePath, message: error.message });
    }
  }

  if (!inserted.length && failures.length) {
    throw new Error(`No images were imported. ${failures[0].message}`);
  }

  run("UPDATE items SET updated_at = ? WHERE id = ?", [now(), itemId]);
  return inserted;
}

function isPrivateIpv4(address) {
  if (!address || address === "127.0.0.1") return false;
  const parts = address.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return parts[0] === 10 ||
    (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) ||
    (parts[0] === 192 && parts[1] === 168);
}

function lanIpv4Addresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  Object.values(interfaces).forEach((entries = []) => {
    entries.forEach((entry) => {
      if (entry.family === "IPv4" && !entry.internal && isPrivateIpv4(entry.address)) {
        addresses.push(entry.address);
      }
    });
  });
  return [...new Set(addresses)];
}

function phoneUploadStatus() {
  if (!phoneUploadSession) {
    return { running: false };
  }
  const { server: _server, token: _token, ...safe } = phoneUploadSession;
  return {
    ...safe,
    running: true
  };
}

function stopPhoneUploadServer() {
  if (!phoneUploadSession) {
    return { running: false };
  }
  const session = phoneUploadSession;
  phoneUploadSession = null;
  try {
    session.server.close();
  } catch (error) {
    console.warn("[phone-upload] failed to close server", error);
  }
  const { server: _server, token: _token, ...safe } = session;
  return { ...safe, running: false, stopped: true, status: "stopped" };
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}

function phoneUploadPageHtml(session) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Collection Archive phone upload</title>
  <style>
    :root { color-scheme: light; font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background:#f5f1ea; color:#1f2a2a; }
    * { box-sizing: border-box; }
    body { margin:0; min-height:100vh; display:grid; place-items:center; padding:20px; background:linear-gradient(180deg,#f8f4ec,#ede6d9); }
    main { width:min(520px,100%); background:#fffdf8; border:1px solid #ded4c3; border-radius:14px; padding:22px; box-shadow:0 20px 50px rgba(31,42,42,.14); }
    h1 { margin:0 0 4px; font-size:24px; }
    p { color:#5f6a65; line-height:1.45; }
    .target { border:1px solid #e5dac9; border-radius:10px; padding:10px 12px; background:#fbf8f2; margin:14px 0; }
    input[type=file] { width:100%; padding:14px; border:1px dashed #b8aa94; border-radius:10px; background:#fff; }
    button { width:100%; margin-top:14px; min-height:44px; border:0; border-radius:10px; background:#1f5d57; color:#fff; font-weight:700; font-size:16px; }
    button:disabled { opacity:.6; }
    progress { width:100%; height:14px; margin-top:14px; }
    #status { white-space:pre-wrap; min-height:44px; }
  </style>
</head>
<body>
  <main>
    <h1>Collection Archive</h1>
    <p>Select photos from this phone. They will be added to the desktop item below.</p>
    <div class="target"><strong>${escapeHtml(session.itemTitle || "Selected item")}</strong></div>
    <input id="files" type="file" accept="image/*,.heic,.heif" multiple>
    <button id="upload" type="button">Upload selected photos</button>
    <progress id="progress" value="0" max="1" hidden></progress>
    <p id="status">Waiting for photos...</p>
  </main>
  <script>
    const token = ${JSON.stringify(session.token)};
    const files = document.getElementById("files");
    const upload = document.getElementById("upload");
    const progress = document.getElementById("progress");
    const status = document.getElementById("status");
    upload.addEventListener("click", async () => {
      const selected = Array.from(files.files || []);
      if (!selected.length) {
        status.textContent = "Choose one or more photos first.";
        return;
      }
      upload.disabled = true;
      progress.hidden = false;
      progress.max = selected.length;
      progress.value = 0;
      let ok = 0;
      try {
        for (const file of selected) {
          status.textContent = "Uploading " + file.name + "...";
          const response = await fetch("/upload?token=" + encodeURIComponent(token), {
            method: "POST",
            headers: {
              "Content-Type": file.type || "application/octet-stream",
              "X-Filename": encodeURIComponent(file.name)
            },
            body: file
          });
          const result = await response.json().catch(() => ({}));
          if (!response.ok) {
            throw new Error(result.error || "Upload failed");
          }
          ok += 1;
          progress.value = ok;
        }
        status.textContent = "Done. Uploaded " + ok + " photo" + (ok === 1 ? "." : "s.");
        files.value = "";
      } catch (error) {
        status.textContent = "Upload stopped: " + (error.message || error);
      } finally {
        upload.disabled = false;
      }
    });
  </script>
</body>
</html>`;
}

function readRequestBody(request, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    request.on("data", (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error("File is too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(payload));
}

async function startPhoneUploadServer(payload = {}) {
  const itemId = payload.itemId;
  const item = get("SELECT id, title FROM items WHERE id = ? AND COALESCE(deleted_at, '') = ''", [itemId]);
  if (!item) {
    throw new Error("Choose an item before starting phone upload");
  }
  stopPhoneUploadServer();

  const token = crypto.randomBytes(24).toString("base64url");
  const session = {
    server: null,
    id: id(),
    token,
    itemId: item.id,
    itemTitle: item.title,
    port: 0,
    urls: [],
    qrCodeDataUrl: "",
    uploadedCount: 0,
    rejectedCount: 0,
    maxFileSizeMb: Math.round(phoneUploadMaxBytes / 1024 / 1024),
    maxFiles: phoneUploadMaxFiles,
    startedAt: now(),
    status: "running",
    lastUpload: "",
    error: ""
  };

  const server = http.createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
      const requestToken = requestUrl.searchParams.get("token") || "";
      if (requestToken !== session.token) {
        if (request.method === "GET") {
          response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
          response.end("Invalid or expired upload link.");
        } else {
          sendJson(response, 403, { error: "Invalid or expired upload token" });
        }
        return;
      }

      if (request.method === "GET" && requestUrl.pathname === "/") {
        response.writeHead(200, {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store"
        });
        response.end(phoneUploadPageHtml(session));
        return;
      }

      if (request.method === "POST" && requestUrl.pathname === "/upload") {
        if (session.uploadedCount >= phoneUploadMaxFiles) {
          sendJson(response, 429, { error: "Upload session file limit reached" });
          return;
        }
        const encodedName = request.headers["x-filename"];
        const originalName = sanitizeFilename(encodedName ? decodeURIComponent(String(encodedName)) : "phone-photo.jpg");
        if (!isSupportedImageName(originalName)) {
          session.rejectedCount += 1;
          sendJson(response, 415, { error: "Unsupported image type" });
          return;
        }
        const buffer = await readRequestBody(request, phoneUploadMaxBytes);
        if (!buffer.length) {
          sendJson(response, 400, { error: "No file data received" });
          return;
        }
        const tempPath = path.join(paths.phoneUploads, `${id()}-${originalName}`);
        fs.writeFileSync(tempPath, buffer);
        try {
          const importJob = phoneUploadQueue.then(() => importImageFileToItem(session.itemId, tempPath, {
            originalName
          }));
          phoneUploadQueue = importJob.catch(() => {});
          const imported = await importJob;
          session.uploadedCount += 1;
          session.lastUpload = imported.original_filename || originalName;
          run("UPDATE items SET updated_at = ? WHERE id = ?", [now(), session.itemId]);
          sendJson(response, 200, { ok: true, image: { id: imported.id, original_filename: imported.original_filename } });
        } finally {
          fs.rmSync(tempPath, { force: true });
        }
        return;
      }

      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
    } catch (error) {
      session.error = error.message || String(error);
      console.warn("[phone-upload] request failed", error);
      if (!response.headersSent) {
        sendJson(response, 500, { error: session.error });
      } else {
        response.end();
      }
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "0.0.0.0", () => {
      server.off("error", reject);
      resolve();
    });
  });

  session.server = server;
  session.port = server.address().port;
  const addresses = lanIpv4Addresses();
  session.urls = addresses.map((address) => `http://${address}:${session.port}/?token=${encodeURIComponent(session.token)}`);
  if (!session.urls.length) {
    session.urls = [`http://localhost:${session.port}/?token=${encodeURIComponent(session.token)}`];
    session.error = "No private LAN IPv4 address was found. Check Wi-Fi/network settings.";
  }
  session.qrCodeDataUrl = await QRCode.toDataURL(session.urls[0], { margin: 1, width: 220 }).catch((error) => {
    console.warn("[phone-upload] QR generation failed", error);
    return "";
  });
  phoneUploadSession = session;
  console.log("[phone-upload] server started", {
    itemId: session.itemId,
    port: session.port,
    urls: session.urls.map((url) => url.replace(session.token, "[token]"))
  });
  return phoneUploadStatus();
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

handlePerfIpc("library:get", () => getLibrary());
ipcMain.handle("app:startup-timings", () => ({
  totalMs: Math.round((performance.now() - mainStartedAt) * 10) / 10,
  timings: startupTimings
}));
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
  if (normalizeSortOrder("countries")) saveDb();
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
  if (normalizeSortOrder("entity_groups")) saveDb();
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
  if (normalizeSortOrder("collection_types")) saveDb();
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
  const rowId = createItemRecord(payload);
  saveDb();
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

ipcMain.handle("items:bulk-update", (_event, payload = {}) => {
  const ids = Array.isArray(payload.ids) ? payload.ids.filter(Boolean) : [];
  const operations = payload.operations || {};
  if (!ids.length) return { updated: 0 };
  const timestamp = now();

  db.exec("BEGIN TRANSACTION");
  try {
    ids.forEach((itemId) => {
      const current = get("SELECT * FROM items WHERE id = ? AND COALESCE(deleted_at, '') = ''", [itemId]);
      if (!current) return;
      const updates = [];
      const params = [];
      const setField = (column, value) => {
        updates.push(`${column} = ?`);
        params.push(value);
      };
      if (operations.country_id?.mode === "replace") setField("country_id", operations.country_id.value || null);
      if (operations.type_id?.mode === "replace") setField("type_id", operations.type_id.value || null);
      if (operations.year?.mode === "replace") setField("year", String(operations.year.value || ""));
      if (operations.condition?.mode === "replace") setField("condition", String(operations.condition.value || ""));
      if (operations.source?.mode === "replace") setField("source", String(operations.source.value || ""));
      if (operations.tags?.mode && operations.tags.mode !== "unchanged") {
        const currentTags = normalizeTags(parseJson(current.tags_json, []));
        const nextTags = normalizeTags(operations.tags.value || "");
        let merged = currentTags;
        if (operations.tags.mode === "replace") merged = nextTags;
        if (operations.tags.mode === "add") merged = [...new Set([...currentTags, ...nextTags])];
        if (operations.tags.mode === "remove") {
          const removeSet = new Set(nextTags.map((tag) => tag.toLowerCase()));
          merged = currentTags.filter((tag) => !removeSet.has(tag.toLowerCase()));
        }
        setField("tags_json", JSON.stringify(merged));
      }
      if (updates.length) {
        updates.push("updated_at = ?");
        params.push(timestamp, itemId);
        bindAndStep(`UPDATE items SET ${updates.join(", ")} WHERE id = ?`, params);
      }
    });
    db.exec("COMMIT");
    saveDb();
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return { updated: ids.length };
});

ipcMain.handle("items:bulk-create-from-images", async (_event, payload = {}) => {
  const result = await dialog.showOpenDialog({
    title: "Create items from images",
    properties: ["openFile", "multiSelections"],
    filters: [{ name: "Images", extensions: imageExtensions }]
  });
  if (result.canceled || result.filePaths.length === 0) {
    return { canceled: true, created: [], failed: [] };
  }

  const created = [];
  const failed = [];
  for (const filePath of result.filePaths) {
    const baseTitle = path.basename(filePath, path.extname(filePath));
    const title = `${String(payload.titlePrefix || "")}${baseTitle}${String(payload.titleSuffix || "")}`.trim() || baseTitle;
    let itemId = null;
    try {
      itemId = createItemRecord({
        ...payload,
        title
      });
      saveDb();
      await importImageFileToItem(itemId, filePath, { originalName: path.basename(filePath), sortOrder: 0 });
      run("UPDATE items SET updated_at = ? WHERE id = ?", [now(), itemId]);
      created.push({ id: itemId, title });
    } catch (error) {
      if (itemId) {
        permanentlyDeleteItem(itemId);
      }
      failed.push({ file: path.basename(filePath), error: error.message || String(error) });
    }
  }
  return { canceled: false, created, failed };
});

function getItemForRenderer(itemId) {
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
      WHERE items.id = ? AND COALESCE(items.deleted_at, '') = ''
    `,
    [itemId]
  );
  if (!item) {
    return null;
  }
  return {
    ...mapItem(item),
    images: all("SELECT * FROM images WHERE item_id = ? AND COALESCE(deleted_at, '') = '' ORDER BY sort_order ASC, created_at ASC", [itemId]).map(mapImage)
  };
}

ipcMain.handle("item:get", (_event, itemId) => {
  return getItemForRenderer(itemId);
});

ipcMain.handle("item:delete", (_event, itemId) => {
  run("UPDATE items SET deleted_at = ?, updated_at = ? WHERE id = ?", [now(), now(), itemId]);
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
ipcMain.handle("phone-upload:start", (_event, payload) => startPhoneUploadServer(payload || {}));
ipcMain.handle("phone-upload:status", () => phoneUploadStatus());
ipcMain.handle("phone-upload:stop", () => stopPhoneUploadServer());

ipcMain.handle("images:remove", (_event, imageId) => {
  const image = get("SELECT * FROM images WHERE id = ?", [imageId]);
  if (!image) {
    return { removed: false };
  }

  run("UPDATE images SET deleted_at = ? WHERE id = ?", [now(), imageId]);
  run("UPDATE items SET updated_at = ? WHERE id = ?", [now(), image.item_id]);

  console.log("[images:remove] removed image", {
    imageId,
    itemId: image.item_id,
    imagePath: image.image_path,
    thumbnailPath: image.thumbnail_path,
    trashed: true
  });

  return { removed: true, itemId: image.item_id, trashed: true };
});

ipcMain.handle("images:regenerate-thumbnail", async (_event, imageId) => {
  const image = get("SELECT * FROM images WHERE id = ?", [imageId]);
  if (!image) {
    throw new Error("Image not found");
  }
  const regenerated = await regenerateThumbnailFile(image);
  console.log("[images:thumbnail] regenerated thumbnail", {
    imageId,
    itemId: image.item_id,
    thumbnailPath: image.thumbnail_path
  });
  return regenerated;
});

ipcMain.handle("images:regenerate-item-thumbnails", async (_event, itemId) => {
  const images = all("SELECT * FROM images WHERE item_id = ? AND COALESCE(deleted_at, '') = '' ORDER BY sort_order ASC, created_at ASC", [itemId]);
  const regenerated = [];
  for (const image of images) {
    regenerated.push(await regenerateThumbnailFile(image));
  }
  console.log("[images:thumbnail] regenerated item thumbnails", {
    itemId,
    count: regenerated.length
  });
  return getItemForRenderer(itemId);
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

  const prepared = await prepareImageForImport(selectedPath, path.basename(selectedPath));
  const storedFilename = `${existing.id}${prepared.storedExtension.toLowerCase()}`;
  const destination = path.join(paths.images, storedFilename);
  const thumbnailPath = path.join(paths.thumbs, `${existing.id}.png`);

  if (prepared.buffer) {
    fs.writeFileSync(destination, prepared.buffer);
  } else if (path.resolve(selectedPath) !== path.resolve(destination)) {
    fs.copyFileSync(selectedPath, destination);
  }
  createThumbnail(prepared.image, thumbnailPath, prepared.size.width, prepared.size.height);

  console.log("[images:replace] copied replacement", {
    originalPath: selectedPath,
    copiedImagePath: destination,
    thumbnailPath,
    width: prepared.size.width,
    height: prepared.size.height,
    convertedFromHeic: prepared.convertedFromHeic,
    orientationNormalized: Boolean(prepared.orientationNormalized || prepared.convertedFromHeic)
  });

  run(
    `
      UPDATE images
      SET original_filename = ?, stored_filename = ?, image_path = ?, thumbnail_path = ?,
          width = ?, height = ?, aspect_ratio = ?, size_bytes = ?, mime_type = ?
      WHERE id = ?
    `,
    [
      prepared.originalFilename,
      storedFilename,
      destination,
      thumbnailPath,
      prepared.size.width,
      prepared.size.height,
      prepared.size.width / prepared.size.height,
      prepared.sizeBytes,
      prepared.mimeType,
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

ipcMain.handle("images:update-note", (_event, payload = {}) => {
  const imageId = payload.imageId || payload.id;
  const note = String(payload.note || "");
  const image = get("SELECT item_id FROM images WHERE id = ? AND COALESCE(deleted_at, '') = ''", [imageId]);
  if (!image) {
    throw new Error("Image not found");
  }
  run("UPDATE images SET note = ? WHERE id = ?", [note, imageId]);
  run("UPDATE items SET updated_at = ? WHERE id = ?", [now(), image.item_id]);
  return getItemForRenderer(image.item_id);
});

ipcMain.handle("images:reorder", (_event, payload = {}) => {
  const ids = Array.isArray(payload.ids) ? payload.ids.filter(Boolean) : [];
  if (!payload.itemId || ids.length === 0) return null;
  const rows = all("SELECT id FROM images WHERE item_id = ? AND COALESCE(deleted_at, '') = '' ORDER BY sort_order ASC, created_at ASC", [payload.itemId]);
  const existingIds = new Set(rows.map((row) => row.id));
  const orderedIds = ids.filter((imageId) => existingIds.has(imageId));
  rows.forEach((row) => {
    if (!orderedIds.includes(row.id)) orderedIds.push(row.id);
  });
  db.exec("BEGIN TRANSACTION");
  try {
    orderedIds.forEach((imageId, index) => {
      bindAndStep("UPDATE images SET sort_order = ? WHERE id = ? AND item_id = ?", [index, imageId, payload.itemId]);
    });
    bindAndStep("UPDATE items SET updated_at = ? WHERE id = ?", [now(), payload.itemId]);
    db.exec("COMMIT");
    saveDb();
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return getItemForRenderer(payload.itemId);
});

ipcMain.handle("trash:list", () => {
  const items = all(
    `
      SELECT items.id, items.title AS name, items.deleted_at, 'item' AS type,
             countries.name AS subtitle
      FROM items
      LEFT JOIN countries ON countries.id = items.country_id
      WHERE COALESCE(items.deleted_at, '') <> ''
      ORDER BY items.deleted_at DESC
    `
  );
  const images = all(
    `
      SELECT images.id, images.original_filename AS name, images.deleted_at, 'image' AS type,
             items.title AS subtitle, images.item_id
      FROM images
      JOIN items ON items.id = images.item_id
      WHERE COALESCE(images.deleted_at, '') <> ''
      ORDER BY images.deleted_at DESC
    `
  );
  const albums = all(
    `
      SELECT id, title AS name, deleted_at, 'album' AS type, description AS subtitle
      FROM albums
      WHERE COALESCE(deleted_at, '') <> ''
      ORDER BY deleted_at DESC
    `
  );
  const pages = all(
    `
      SELECT album_pages.id, album_pages.title AS name, album_pages.deleted_at, 'albumPage' AS type,
             albums.title AS subtitle, album_pages.album_id
      FROM album_pages
      JOIN albums ON albums.id = album_pages.album_id
      WHERE COALESCE(album_pages.deleted_at, '') <> ''
      ORDER BY album_pages.deleted_at DESC
    `
  );
  return [...items, ...images, ...albums, ...pages].sort((a, b) => String(b.deleted_at || "").localeCompare(String(a.deleted_at || "")));
});

ipcMain.handle("trash:restore", (_event, payload = {}) => {
  const type = payload.type;
  const rowId = payload.id;
  if (!type || !rowId) return getLibrary();
  if (type === "item") {
    run("UPDATE items SET deleted_at = '', deleted_reason = '', updated_at = ? WHERE id = ?", [now(), rowId]);
  } else if (type === "image") {
    const image = get("SELECT item_id FROM images WHERE id = ?", [rowId]);
    const item = image ? get("SELECT deleted_at FROM items WHERE id = ?", [image.item_id]) : null;
    if (!image || (item && item.deleted_at)) throw new Error("Restore the parent item before restoring this image.");
    run("UPDATE images SET deleted_at = '', deleted_reason = '' WHERE id = ?", [rowId]);
  } else if (type === "album") {
    run("UPDATE albums SET deleted_at = '', deleted_reason = '', updated_at = ? WHERE id = ?", [now(), rowId]);
  } else if (type === "albumPage") {
    const page = get("SELECT album_id FROM album_pages WHERE id = ?", [rowId]);
    const album = page ? get("SELECT deleted_at FROM albums WHERE id = ?", [page.album_id]) : null;
    if (!page || (album && album.deleted_at)) throw new Error("Restore the album before restoring this page.");
    run("UPDATE album_pages SET deleted_at = '', deleted_reason = '', updated_at = ? WHERE id = ?", [now(), rowId]);
    normalizeAlbumPageNumbers(page.album_id);
  }
  return getLibrary();
});

ipcMain.handle("trash:permanent-delete", (_event, payload = {}) => {
  const type = payload.type;
  const rowId = payload.id;
  if (!type || !rowId) return getLibrary();
  if (type === "item") permanentlyDeleteItem(rowId);
  else if (type === "image") permanentlyDeleteImage(rowId);
  else if (type === "album") permanentlyDeleteAlbum(rowId);
  else if (type === "albumPage") permanentlyDeleteAlbumPage(rowId);
  return getLibrary();
});

ipcMain.handle("trash:empty", () => {
  all("SELECT id FROM images WHERE COALESCE(deleted_at, '') <> ''").forEach((row) => permanentlyDeleteImage(row.id));
  all("SELECT id FROM items WHERE COALESCE(deleted_at, '') <> ''").forEach((row) => permanentlyDeleteItem(row.id));
  all("SELECT id FROM album_pages WHERE COALESCE(deleted_at, '') <> ''").forEach((row) => permanentlyDeleteAlbumPage(row.id));
  all("SELECT id FROM albums WHERE COALESCE(deleted_at, '') <> ''").forEach((row) => permanentlyDeleteAlbum(row.id));
  return getLibrary();
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
  run("UPDATE albums SET deleted_at = ?, updated_at = ? WHERE id = ?", [now(), now(), albumId]);
  return getLibrary();
});

ipcMain.handle("album-page:create", (_event, payload) => {
  const rowId = id();
  const pageNumber =
    payload.page_number ||
    Number(get("SELECT COUNT(*) AS count FROM album_pages WHERE album_id = ? AND COALESCE(deleted_at, '') = ''", [payload.album_id]).count) + 1;
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

ipcMain.handle("album-page:reorder", (_event, payload = {}) => {
  const ids = Array.isArray(payload.ids) ? payload.ids.filter(Boolean) : [];
  if (!payload.albumId || ids.length === 0) return null;
  const pages = all("SELECT id FROM album_pages WHERE album_id = ? AND COALESCE(deleted_at, '') = '' ORDER BY page_number ASC", [payload.albumId]);
  const existingIds = new Set(pages.map((page) => page.id));
  const orderedIds = ids.filter((pageId) => existingIds.has(pageId));
  pages.forEach((page) => {
    if (!orderedIds.includes(page.id)) orderedIds.push(page.id);
  });
  db.exec("BEGIN TRANSACTION");
  try {
    orderedIds.forEach((pageId, index) => {
      bindAndStep("UPDATE album_pages SET page_number = ?, updated_at = ? WHERE id = ? AND album_id = ?", [index + 1, now(), pageId, payload.albumId]);
    });
    bindAndStep("UPDATE albums SET updated_at = ? WHERE id = ?", [now(), payload.albumId]);
    db.exec("COMMIT");
    saveDb();
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return getAlbum(payload.albumId);
});

function copyAlbumPage(sourcePageId, targetAlbumId, options = {}) {
  const source = get("SELECT * FROM album_pages WHERE id = ? AND COALESCE(deleted_at, '') = ''", [sourcePageId]);
  if (!source) throw new Error("Source album page was not found.");
  const target = get("SELECT id FROM albums WHERE id = ? AND COALESCE(deleted_at, '') = ''", [targetAlbumId]);
  if (!target) throw new Error("Target album was not found.");

  const timestamp = now();
  const newPageId = id();
  const targetPages = all("SELECT id FROM album_pages WHERE album_id = ? AND COALESCE(deleted_at, '') = '' ORDER BY page_number ASC, created_at ASC", [targetAlbumId]);
  const requestedIndex = options.insertAfterPageId
    ? targetPages.findIndex((page) => page.id === options.insertAfterPageId) + 1
    : targetPages.length;
  const insertIndex = requestedIndex > 0 ? requestedIndex : targetPages.length;
  const sourceTitle = String(source.title || "Page");
  const nextTitle = options.title || sourceTitle;

  db.exec("BEGIN TRANSACTION");
  try {
    bindAndStep(
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
        newPageId,
        targetAlbumId,
        nextTitle,
        insertIndex + 1,
        source.notes || "",
        Number(source.column_count || 3),
        Number(source.page_width || 1000),
        Number(source.page_height || 1400),
        source.orientation || "portrait",
        source.background || "white",
        source.custom_background || "#ffffff",
        source.paper_preset || "custom",
        source.background_image_id || null,
        source.background_image_enabled ? 1 : 0,
        Number(source.background_opacity ?? 1),
        source.background_fit || "contain",
        source.show_guides === 0 ? 0 : 1,
        source.snap_to_grid === 0 ? 0 : 1,
        Number(source.grid_size || 25),
        source.template_name || "blank",
        Number(source.layout_version || 2),
        timestamp,
        timestamp
      ]
    );

    const pageItems = all("SELECT * FROM album_page_items WHERE page_id = ? ORDER BY sort_order ASC, created_at ASC", [sourcePageId]);
    pageItems.forEach((entry) => {
      bindAndStep(
        `
          INSERT INTO album_page_items (
            id, page_id, item_id, image_id, x, y, width, height, rotation, z_index, caption,
            show_caption, show_title, show_metadata, locked, frame_style, border_color, background_color,
            background_opacity, padding, border_radius, crop_left, crop_right, crop_top, crop_bottom,
            sort_order, created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          id(),
          newPageId,
          entry.item_id,
          entry.image_id || null,
          Number(entry.x || 0),
          Number(entry.y || 0),
          Number(entry.width || 1),
          Number(entry.height || 1),
          Number(entry.rotation || 0),
          Number(entry.z_index || 0),
          entry.caption || "",
          entry.show_caption ? 1 : 0,
          entry.show_title ? 1 : 0,
          entry.show_metadata ? 1 : 0,
          entry.locked ? 1 : 0,
          entry.frame_style || "none",
          entry.border_color || "#b8c8c4",
          entry.background_color || "#ffffff",
          Number(entry.background_opacity ?? 0),
          Number(entry.padding ?? 4),
          Number(entry.border_radius ?? 2),
          clampCropValue(entry.crop_left),
          clampCropValue(entry.crop_right),
          clampCropValue(entry.crop_top),
          clampCropValue(entry.crop_bottom),
          Number(entry.sort_order || 0),
          timestamp
        ]
      );
    });

    const textItems = all("SELECT * FROM album_text_items WHERE page_id = ? ORDER BY sort_order ASC, created_at ASC", [sourcePageId]);
    textItems.forEach((entry) => {
      const style = textStylePayload(entry);
      bindAndStep(
        `
          INSERT INTO album_text_items (
            id, page_id, x, y, width, height, rotation, z_index, text_content,
            font_family, font_size, bold, italic, underline, text_align, line_height,
            text_color, background, background_color, background_opacity, border_color,
            border_width, border_radius, padding, locked,
            sort_order, created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        [
          id(),
          newPageId,
          Number(entry.x || 0),
          Number(entry.y || 0),
          Number(entry.width || 1),
          Number(entry.height || 1),
          Number(entry.rotation || 0),
          Number(entry.z_index || 0),
          entry.text_content || "",
          style.font_family,
          style.font_size,
          entry.bold ? 1 : 0,
          entry.italic ? 1 : 0,
          entry.underline ? 1 : 0,
          style.text_align,
          style.line_height,
          style.text_color,
          style.background,
          style.background_color,
          style.background_opacity,
          style.border_color,
          style.border_width,
          style.border_radius,
          style.padding,
          entry.locked ? 1 : 0,
          Number(entry.sort_order || 0),
          timestamp
        ]
      );
    });

    const orderedIds = targetPages.map((page) => page.id);
    orderedIds.splice(insertIndex, 0, newPageId);
    orderedIds.forEach((pageId, index) => {
      bindAndStep("UPDATE album_pages SET page_number = ?, updated_at = ? WHERE id = ? AND album_id = ?", [index + 1, timestamp, pageId, targetAlbumId]);
    });
    bindAndStep("UPDATE albums SET updated_at = ? WHERE id = ?", [timestamp, targetAlbumId]);
    db.exec("COMMIT");
    saveDb();
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return { album: getAlbum(targetAlbumId), copiedPageId: newPageId };
}

ipcMain.handle("album-page:copy", (_event, payload = {}) => {
  if (!payload.pageId || !payload.targetAlbumId) throw new Error("Page and target album are required.");
  return copyAlbumPage(payload.pageId, payload.targetAlbumId, {
    insertAfterPageId: payload.insertAfterPageId || null,
    title: payload.title || ""
  });
});

ipcMain.handle("album-page:delete", (_event, pageId) => {
  const page = get("SELECT album_id FROM album_pages WHERE id = ?", [pageId]);
  if (!page) return null;
  run("UPDATE album_pages SET deleted_at = ?, updated_at = ? WHERE id = ?", [now(), now(), pageId]);
  const pages = all("SELECT id FROM album_pages WHERE album_id = ? AND COALESCE(deleted_at, '') = '' ORDER BY page_number ASC", [page.album_id]);
  pages.forEach((entry, index) => {
    run("UPDATE album_pages SET page_number = ? WHERE id = ?", [index + 1, entry.id]);
  });
  run("UPDATE albums SET updated_at = ? WHERE id = ?", [now(), page.album_id]);
  return getAlbum(page.album_id);
});

function getAlbum(albumId) {
  const album = get("SELECT * FROM albums WHERE id = ? AND COALESCE(deleted_at, '') = ''", [albumId]);
  if (!album) return null;

  const pages = all("SELECT * FROM album_pages WHERE album_id = ? AND COALESCE(deleted_at, '') = '' ORDER BY page_number ASC", [albumId]).map((page) => {
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
        JOIN items ON items.id = album_page_items.item_id AND COALESCE(items.deleted_at, '') = ''
        LEFT JOIN countries ON countries.id = items.country_id
        LEFT JOIN collection_types ON collection_types.id = items.type_id
        LEFT JOIN images AS display_image ON display_image.id = COALESCE(
          (
            SELECT id FROM images
            WHERE images.id = album_page_items.image_id
              AND images.item_id = items.id
              AND COALESCE(images.deleted_at, '') = ''
            LIMIT 1
          ),
          (
            SELECT id FROM images
            WHERE images.item_id = items.id
              AND COALESCE(images.deleted_at, '') = ''
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
        crop_left: clampCropValue(row.crop_left),
        crop_right: clampCropValue(row.crop_right),
        crop_top: clampCropValue(row.crop_top),
        crop_bottom: clampCropValue(row.crop_bottom),
        images: all("SELECT * FROM images WHERE item_id = ? AND COALESCE(deleted_at, '') = '' ORDER BY sort_order ASC, created_at ASC", [row.item_id]).map(mapImage),
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
    ).map(mapTextRow);

    const backgroundImage = page.background_image_id
      ? get("SELECT * FROM images WHERE id = ? AND COALESCE(deleted_at, '') = ''", [page.background_image_id])
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
  const page = get("SELECT * FROM album_pages WHERE id = ? AND COALESCE(deleted_at, '') = ''", [payload.page_id]);
  const selectedImage = payload.image_id
    ? get("SELECT id FROM images WHERE id = ? AND item_id = ? AND COALESCE(deleted_at, '') = ''", [payload.image_id, payload.item_id])
    : null;
  const fallbackImage = get("SELECT * FROM images WHERE item_id = ? AND COALESCE(deleted_at, '') = '' ORDER BY sort_order ASC, created_at ASC LIMIT 1", [payload.item_id]);
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
        background_opacity, padding, border_radius, crop_left, crop_right, crop_top, crop_bottom,
        sort_order, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      clampCropValue(payload.crop_left),
      clampCropValue(payload.crop_right),
      clampCropValue(payload.crop_top),
      clampCropValue(payload.crop_bottom),
      sortOrder,
      now()
    ]
  );
  run("UPDATE albums SET updated_at = ? WHERE id = ?", [now(), page.album_id]);
  return getAlbum(page.album_id);
});

ipcMain.handle("album-page-items:bulk-add", (_event, payload = {}) => {
  const page = get("SELECT * FROM album_pages WHERE id = ? AND COALESCE(deleted_at, '') = ''", [payload.page_id]);
  if (!page) throw new Error("Album page not found");
  const itemIds = Array.isArray(payload.item_ids) ? payload.item_ids.filter(Boolean) : [];
  const mode = payload.mode === "allImages" ? "allImages" : "cover";
  const columns = Math.max(1, Math.min(8, Number(payload.columns || 3)));
  const spacing = Math.max(8, Math.min(120, Number(payload.spacing || 24)));
  const margin = Math.max(20, Math.min(160, Number(payload.margin || 70)));
  const pageWidth = Number(page.page_width || 1000);
  const pageHeight = Number(page.page_height || 1400);
  const slotWidth = Math.max(80, (pageWidth - margin * 2 - spacing * (columns - 1)) / columns);
  const rows = [];
  const skipped = [];

  itemIds.forEach((itemId) => {
    const item = get("SELECT id FROM items WHERE id = ? AND COALESCE(deleted_at, '') = ''", [itemId]);
    if (!item) {
      skipped.push({ itemId, reason: "Item not found" });
      return;
    }
    const images = mode === "allImages"
      ? all("SELECT * FROM images WHERE item_id = ? AND COALESCE(deleted_at, '') = '' ORDER BY sort_order ASC, created_at ASC", [itemId])
      : all("SELECT * FROM images WHERE item_id = ? AND COALESCE(deleted_at, '') = '' ORDER BY sort_order ASC, created_at ASC LIMIT 1", [itemId]);
    if (!images.length) {
      skipped.push({ itemId, reason: "No images" });
      return;
    }
    images.forEach((image) => rows.push({ itemId, image }));
  });

  const startOrder = Number(get("SELECT COUNT(*) AS count FROM album_page_items WHERE page_id = ?", [page.id])?.count || 0);
  const maxZ = Number(get("SELECT MAX(z_index) AS max_z FROM album_page_items WHERE page_id = ?", [page.id])?.max_z ?? -1);
  const timestamp = now();

  db.exec("BEGIN TRANSACTION");
  try {
    rows.forEach((entry, index) => {
      const ratio = Math.max(0.18, Number(entry.image.aspect_ratio || 1));
      const imageHeight = slotWidth / ratio;
      const slotHeight = Math.min(Math.max(140, imageHeight + 56), 320);
      const column = index % columns;
      const row = Math.floor(index / columns);
      const x = margin + column * (slotWidth + spacing);
      const y = Math.min(pageHeight - slotHeight - margin, margin + row * (slotHeight + spacing));
      bindAndStep(
        `
          INSERT INTO album_page_items (
            id, page_id, item_id, image_id, x, y, width, height, rotation, z_index, caption,
            show_caption, show_title, show_metadata, locked, frame_style, border_color, background_color,
            background_opacity, padding, border_radius, crop_left, crop_right, crop_top, crop_bottom,
            sort_order, created_at
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, '', 1, 1, 1, 1, 'none', '#b8c8c4', '#ffffff', 0, 4, 2, 0, 0, 0, 0, ?, ?)
        `,
        [
          id(),
          page.id,
          entry.itemId,
          entry.image.id,
          Math.round(x),
          Math.round(Math.max(margin, y)),
          Math.round(slotWidth),
          Math.round(slotHeight),
          maxZ + 1 + index,
          startOrder + index,
          timestamp
        ]
      );
    });
    bindAndStep("UPDATE albums SET updated_at = ? WHERE id = ?", [timestamp, page.album_id]);
    db.exec("COMMIT");
    saveDb();
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return { album: getAlbum(page.album_id), added: rows.length, skipped };
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
    const style = textStylePayload(payload);
    run(
      `
        UPDATE album_text_items
        SET x = ?, y = ?, width = ?, height = ?, rotation = ?, z_index = ?,
            text_content = ?, font_family = ?, font_size = ?, bold = ?, italic = ?, underline = ?,
            text_align = ?, line_height = ?, text_color = ?, background = ?, background_color = ?,
            background_opacity = ?, border_color = ?, border_width = ?, border_radius = ?,
            padding = ?, locked = ?, sort_order = ?
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
        style.font_family,
        style.font_size,
        payload.bold ? 1 : 0,
        payload.italic ? 1 : 0,
        payload.underline ? 1 : 0,
        style.text_align,
        style.line_height,
        style.text_color,
        style.background,
        style.background_color,
        style.background_opacity,
        style.border_color,
        style.border_width,
        style.border_radius,
        style.padding,
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
    ? get("SELECT id FROM images WHERE id = ? AND item_id = ? AND COALESCE(deleted_at, '') = ''", [payload.image_id, row.item_id])
    : null;

  run(
    `
      UPDATE album_page_items
      SET image_id = ?, x = ?, y = ?, width = ?, height = ?, rotation = ?, z_index = ?,
          caption = ?, show_caption = ?, show_title = ?, show_metadata = ?, locked = ?,
          frame_style = ?, border_color = ?, background_color = ?, background_opacity = ?,
          padding = ?, border_radius = ?, crop_left = ?, crop_right = ?, crop_top = ?, crop_bottom = ?,
          sort_order = ?
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
      clampCropValue(payload.crop_left),
      clampCropValue(payload.crop_right),
      clampCropValue(payload.crop_top),
      clampCropValue(payload.crop_bottom),
      Number(payload.sort_order || 0),
      payload.id
    ]
  );
  run("UPDATE albums SET updated_at = ? WHERE id = ?", [now(), row.album_id]);
  return getAlbum(row.album_id);
});

ipcMain.handle("album-text:add", (_event, payload) => {
  const rowId = id();
  const page = get("SELECT * FROM album_pages WHERE id = ? AND COALESCE(deleted_at, '') = ''", [payload.page_id]);
  if (!page) return null;
  const sortOrder =
    payload.sort_order ||
    Number(get("SELECT COUNT(*) AS count FROM album_text_items WHERE page_id = ?", [payload.page_id]).count);
  const maxZ = Math.max(
    Number(get("SELECT MAX(z_index) AS max_z FROM album_page_items WHERE page_id = ?", [payload.page_id])?.max_z ?? -1),
    Number(get("SELECT MAX(z_index) AS max_z FROM album_text_items WHERE page_id = ?", [payload.page_id])?.max_z ?? -1)
  );
  const style = textStylePayload(payload);
  run(
    `
      INSERT INTO album_text_items (
        id, page_id, x, y, width, height, rotation, z_index, text_content, font_size,
        font_family, bold, italic, underline, text_align, line_height, text_color, background,
        background_color, background_opacity, border_color, border_width, border_radius, padding,
        locked, sort_order, created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      style.font_size,
      style.font_family,
      payload.bold ? 1 : 0,
      payload.italic ? 1 : 0,
      payload.underline ? 1 : 0,
      style.text_align,
      style.line_height,
      style.text_color,
      style.background,
      style.background_color,
      style.background_opacity,
      style.border_color,
      style.border_width,
      style.border_radius,
      style.padding,
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

function sanitizeExportFilename(value, fallback) {
  const cleaned = String(value || fallback || "album-export")
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || fallback || "album-export";
}

const PDF_QUALITY_PRESETS = {
  original: { label: "Original quality", maxDimension: Infinity, jpegQuality: 100, rewriteImages: false },
  high: { label: "High", maxDimension: 2400, jpegQuality: 90, rewriteImages: true },
  medium: { label: "Medium", maxDimension: 1400, jpegQuality: 78, rewriteImages: true },
  low: { label: "Low", maxDimension: 800, jpegQuality: 58, rewriteImages: true }
};

function pdfQualityPreset(value) {
  return PDF_QUALITY_PRESETS[value] || PDF_QUALITY_PRESETS.medium;
}

function archiveUrlToFilePath(rawUrl) {
  const normalized = String(rawUrl || "").replace(/&amp;/g, "&");
  return mediaFileForRequest(normalized);
}

function imageDataUrlForPdf(filePath, preset) {
  let image = nativeImage.createFromPath(filePath);
  if (image.isEmpty() && fs.existsSync(filePath)) {
    image = nativeImage.createFromBuffer(fs.readFileSync(filePath));
  }
  if (image.isEmpty()) {
    const bytes = fs.readFileSync(filePath);
    return {
      dataUrl: `data:${imageMime(path.extname(filePath))};base64,${bytes.toString("base64")}`,
      sourceWidth: 0,
      sourceHeight: 0,
      outputWidth: 0,
      outputHeight: 0,
      outputBytes: bytes.length,
      downscaled: false,
      passthrough: true
    };
  }
  const size = image.getSize();
  const maxSide = Math.max(size.width, size.height);
  const scale = Number.isFinite(preset.maxDimension) && maxSide > preset.maxDimension
    ? preset.maxDimension / maxSide
    : 1;
  const outputWidth = Math.max(1, Math.round(size.width * scale));
  const outputHeight = Math.max(1, Math.round(size.height * scale));
  const outputImage = scale < 1
    ? image.resize({ width: outputWidth, height: outputHeight, quality: "best" })
    : image;
  const jpeg = outputImage.toJPEG(preset.jpegQuality);
  return {
    dataUrl: `data:image/jpeg;base64,${jpeg.toString("base64")}`,
    sourceWidth: size.width,
    sourceHeight: size.height,
    outputWidth,
    outputHeight,
    outputBytes: jpeg.length,
    downscaled: scale < 1
  };
}

function preparePdfHtmlForQuality(html, quality) {
  const preset = pdfQualityPreset(quality);
  const diagnostics = {
    quality: Object.entries(PDF_QUALITY_PRESETS).find(([, entry]) => entry === preset)?.[0] || "medium",
    label: preset.label,
    rewrittenImages: 0,
    downscaledImages: 0,
    skippedImages: 0,
    errors: []
  };
  if (!preset.rewriteImages) {
    return { html, diagnostics };
  }

  const cache = new Map();
  const preparedHtml = String(html || "").replace(/archive:\/\/local\/(?:images|thumbnails)\/[^"')<\s]+/g, (rawUrl) => {
    if (cache.has(rawUrl)) return cache.get(rawUrl);
    try {
      const filePath = archiveUrlToFilePath(rawUrl);
      const optimized = imageDataUrlForPdf(filePath, preset);
      if (!optimized) {
        diagnostics.skippedImages += 1;
        cache.set(rawUrl, rawUrl);
        return rawUrl;
      }
      diagnostics.rewrittenImages += 1;
      if (optimized.downscaled) diagnostics.downscaledImages += 1;
      cache.set(rawUrl, optimized.dataUrl);
      return optimized.dataUrl;
    } catch (error) {
      diagnostics.errors.push({ url: rawUrl, message: error.message });
      cache.set(rawUrl, rawUrl);
      return rawUrl;
    }
  });
  return { html: preparedHtml, diagnostics };
}

async function chooseExportPath(payload, options) {
  if (payload?.filePath && process.env.COLLECTION_ARCHIVE_ALLOW_EXPORT_PATH === "1") {
    ensureDir(path.dirname(payload.filePath));
    return payload.filePath;
  }
  const result = await dialog.showSaveDialog({
    title: options.title,
    defaultPath: sanitizeExportFilename(payload?.defaultFilename, options.defaultFilename),
    filters: options.filters
  });
  return result.canceled ? null : result.filePath;
}

async function loadExportWindow(html, width, height) {
  const safeWidth = Math.max(100, Math.ceil(Number(width || 1000)));
  const safeHeight = Math.max(100, Math.ceil(Number(height || 1400)));
  const tempFolder = fs.mkdtempSync(path.join(app.getPath("temp"), "collection-archive-export-"));
  const tempHtmlPath = path.join(tempFolder, "export.html");
  fs.writeFileSync(tempHtmlPath, String(html || ""), "utf8");
  const win = new BrowserWindow({
    show: false,
    width: safeWidth,
    height: safeHeight,
    useContentSize: true,
    backgroundColor: "#ffffff",
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  win.webContents.setZoomFactor(1);
  await win.loadFile(tempHtmlPath);
  const diagnostics = await win.webContents.executeJavaScript(`
    (async () => {
      const images = Array.from(document.images);
      const htmlImageResults = await Promise.all(images.map((image) => {
        if (image.complete && image.naturalWidth > 0) {
          return { src: image.currentSrc || image.src, ok: true, width: image.naturalWidth, height: image.naturalHeight };
        }
        return new Promise((resolve) => {
          image.addEventListener("load", () => resolve({ src: image.currentSrc || image.src, ok: true, width: image.naturalWidth, height: image.naturalHeight }), { once: true });
          image.addEventListener("error", () => resolve({ src: image.currentSrc || image.src, ok: false, width: 0, height: 0 }), { once: true });
        });
      }));
      const svgImageResults = await Promise.all(Array.from(document.querySelectorAll("svg image")).map((image) => {
        const src = image.href?.baseVal || image.getAttribute("href") || "";
        return new Promise((resolve) => {
          const probe = new Image();
          probe.onload = () => resolve({ src, ok: true, width: probe.naturalWidth, height: probe.naturalHeight });
          probe.onerror = () => resolve({ src, ok: false, width: 0, height: 0 });
          probe.src = src;
        });
      }));
      const results = [...htmlImageResults, ...svgImageResults];
      if (document.fonts && document.fonts.ready) await document.fonts.ready;
      const failed = results.filter((entry) => !entry.ok);
      if (failed.length) {
        throw new Error("Export image failed to load: " + failed.map((entry) => entry.src).join(", "));
      }
      document.documentElement.style.margin = "0";
      document.documentElement.style.overflow = "hidden";
      document.body.style.margin = "0";
      document.body.style.overflow = "hidden";
      const page = document.querySelector("[data-export-page]") || document.body;
      const rect = page.getBoundingClientRect();
      return {
        imageCount: results.length,
        pageWidth: Math.ceil(rect.width),
        pageHeight: Math.ceil(rect.height),
        scrollWidth: document.documentElement.scrollWidth,
        scrollHeight: document.documentElement.scrollHeight,
        clientWidth: document.documentElement.clientWidth,
        clientHeight: document.documentElement.clientHeight,
        hasHorizontalScrollbar: document.documentElement.scrollWidth > document.documentElement.clientWidth,
        hasVerticalScrollbar: document.documentElement.scrollHeight > document.documentElement.clientHeight
      };
    })()
  `, true);
  win.setContentSize(safeWidth, safeHeight);
  await new Promise((resolve) => setTimeout(resolve, 100));
  return { win, diagnostics, tempFolder };
}

ipcMain.handle("album-export:page-png", async (_event, payload = {}) => {
  const filePath = await chooseExportPath(payload, {
    title: "Export album page as PNG",
    defaultFilename: "album-page.png",
    filters: [{ name: "PNG image", extensions: ["png"] }]
  });
  if (!filePath) return { canceled: true };

  let win = null;
  let diagnostics = null;
  let tempFolder = null;
  try {
    const loaded = await loadExportWindow(payload.html, payload.width, payload.height);
    win = loaded.win;
    diagnostics = loaded.diagnostics;
    tempFolder = loaded.tempFolder;
    const image = await win.webContents.capturePage({
      x: 0,
      y: 0,
      width: Math.max(100, Math.ceil(Number(payload.width || 1000))),
      height: Math.max(100, Math.ceil(Number(payload.height || 1400)))
    });
    const outputWidth = Math.max(100, Math.ceil(Number(payload.width || 1000)));
    const outputHeight = Math.max(100, Math.ceil(Number(payload.height || 1400)));
    const capturedSize = image.getSize();
    const outputImage = capturedSize.width === outputWidth && capturedSize.height === outputHeight
      ? image
      : image.resize({ width: outputWidth, height: outputHeight, quality: "best" });
    fs.writeFileSync(filePath, outputImage.toPNG());
    return { canceled: false, filePath, diagnostics: { ...diagnostics, capturedSize, outputWidth, outputHeight } };
  } finally {
    if (win && !win.isDestroyed()) win.destroy();
    if (tempFolder) fs.rmSync(tempFolder, { recursive: true, force: true });
  }
});

ipcMain.handle("album-export:pdf", async (_event, payload = {}) => {
  const filePath = await chooseExportPath(payload, {
    title: "Export album as PDF",
    defaultFilename: "album.pdf",
    filters: [{ name: "PDF document", extensions: ["pdf"] }]
  });
  if (!filePath) return { canceled: true };

  let win = null;
  let diagnostics = null;
  let tempFolder = null;
  try {
    const prepared = preparePdfHtmlForQuality(payload.html, payload.quality || "medium");
    const loaded = await loadExportWindow(prepared.html, payload.width, payload.height);
    win = loaded.win;
    diagnostics = loaded.diagnostics;
    tempFolder = loaded.tempFolder;
    const data = await win.webContents.printToPDF({
      printBackground: true,
      preferCSSPageSize: true,
      margins: { marginType: "none" }
    });
    fs.writeFileSync(filePath, data);
    return { canceled: false, filePath, diagnostics: { ...diagnostics, pdfQuality: prepared.diagnostics } };
  } finally {
    if (win && !win.isDestroyed()) win.destroy();
    if (tempFolder) fs.rmSync(tempFolder, { recursive: true, force: true });
  }
});

ipcMain.handle("app:reveal-data-folder", () => {
  shell.openPath(paths.base);
  return paths.base;
});

app.whenReady().then(async () => {
  const win = createWindow();
  startupLog("main.ready", { msSinceProcessStart: Math.round((performance.now() - mainStartedAt) * 10) / 10 });

  try {
    await win.__archiveSplashLoaded;
    await initDatabase();
    registerMediaProtocol();
    await measureStartup("renderer.load", () => loadApp(win));
    startupSummary({ status: "ready" });
  } catch (error) {
    console.error("[startup] failed", error);
    startupSummary({ status: "error", message: error.message });
    if (win && !win.isDestroyed()) {
      await loadHtml(win, startupErrorHtml(error)).catch(() => {});
    }
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      const nextWin = createWindow();
      if (databaseReady) {
        loadApp(nextWin).catch((error) => {
          console.error("[startup] failed to load app window", error);
        });
      }
    }
  });
});

app.on("before-quit", () => {
  stopPhoneUploadServer();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
