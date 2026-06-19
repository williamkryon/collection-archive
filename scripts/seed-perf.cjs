const fs = require("fs");
const path = require("path");
const { createRequire } = require("module");

const requireFromRoot = createRequire(path.join(process.cwd(), "package.json"));
const initSqlJs = requireFromRoot("sql.js");

const root = process.cwd();
const pngBytes = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/l7+PfwAAAABJRU5ErkJggg==",
  "base64"
);

function argValue(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] || fallback;
}

function hasArg(name) {
  return process.argv.includes(name);
}

function ensureDir(folder) {
  fs.mkdirSync(folder, { recursive: true });
}

function run(db, sql, params = []) {
  const statement = db.prepare(sql);
  try {
    statement.bind(params);
    statement.step();
  } finally {
    statement.free();
  }
}

function makeId(prefix, index) {
  return `${prefix}-${String(index).padStart(6, "0")}`;
}

function assertSafeOutput(folder) {
  const resolved = path.resolve(folder);
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Refusing to write outside this workspace: ${resolved}`);
  }
  if (!resolved.toLowerCase().includes("perf")) {
    throw new Error(`Refusing to write to a folder that is not clearly perf data: ${resolved}`);
  }
}

function createSchema(db) {
  db.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE countries (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      sort_key TEXT DEFAULT '',
      sort_order INTEGER DEFAULT 0,
      notes TEXT DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE TABLE collection_types (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      sort_key TEXT DEFAULT '',
      sort_order INTEGER DEFAULT 0,
      description TEXT DEFAULT '',
      custom_fields_json TEXT DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE TABLE items (
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

    CREATE TABLE images (
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

    CREATE TABLE albums (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE album_pages (
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
      show_guides INTEGER DEFAULT 1,
      snap_to_grid INTEGER DEFAULT 1,
      grid_size INTEGER DEFAULT 25,
      template_name TEXT DEFAULT 'blank',
      layout_version INTEGER DEFAULT 2,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (album_id) REFERENCES albums(id) ON DELETE CASCADE
    );

    CREATE TABLE album_page_items (
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
      sort_order INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (page_id) REFERENCES album_pages(id) ON DELETE CASCADE,
      FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE,
      FOREIGN KEY (image_id) REFERENCES images(id) ON DELETE SET NULL
    );

    CREATE INDEX idx_items_country_id ON items(country_id);
    CREATE INDEX idx_items_type_id ON items(type_id);
    CREATE INDEX idx_items_year ON items(year);
    CREATE INDEX idx_items_favorite ON items(favorite);
    CREATE INDEX idx_items_updated_at ON items(updated_at);
    CREATE INDEX idx_items_title ON items(title COLLATE NOCASE);
    CREATE INDEX idx_items_tags_json ON items(tags_json);
    CREATE INDEX idx_images_item_id ON images(item_id);
    CREATE INDEX idx_images_item_sort ON images(item_id, sort_order, created_at);
    CREATE INDEX idx_album_page_items_page_id ON album_page_items(page_id);
    CREATE INDEX idx_album_page_items_item_id ON album_page_items(item_id);
    CREATE INDEX idx_album_page_items_image_id ON album_page_items(image_id);
    CREATE INDEX idx_album_page_items_page_sort ON album_page_items(page_id, sort_order, created_at);
    CREATE INDEX idx_countries_sort_order ON countries(sort_order);
    CREATE INDEX idx_collection_types_sort_order ON collection_types(sort_order);
  `);
}

async function main() {
  const itemCount = Number(argValue("--items", "10000"));
  if (![1000, 10000, 50000].includes(itemCount)) {
    throw new Error("--items must be one of 1000, 10000, or 50000");
  }

  const outDir = path.resolve(argValue("--out", path.join(root, "perf-data", "collection-archive-perf-data")));
  assertSafeOutput(outDir);
  if (fs.existsSync(outDir)) {
    if (!hasArg("--force")) {
      throw new Error(`Perf data folder already exists. Re-run with --force to replace it: ${outDir}`);
    }
    fs.rmSync(outDir, { recursive: true, force: true });
  }

  const imagesDir = path.join(outDir, "images");
  const thumbsDir = path.join(outDir, "thumbnails");
  ensureDir(imagesDir);
  ensureDir(thumbsDir);
  const imagePath = path.join(imagesDir, "perf-placeholder.png");
  const thumbPath = path.join(thumbsDir, "perf-placeholder-thumb.png");
  fs.writeFileSync(imagePath, pngBytes);
  fs.writeFileSync(thumbPath, pngBytes);

  const SQL = await initSqlJs({
    locateFile: (file) => path.join(root, "node_modules", "sql.js", "dist", file)
  });
  const db = new SQL.Database();
  createSchema(db);

  const now = new Date().toISOString();
  const countries = Array.from({ length: 80 }, (_, index) => ({
    id: makeId("country", index),
    name: `Perf Country ${String(index + 1).padStart(2, "0")}`
  }));
  const types = Array.from({ length: 24 }, (_, index) => ({
    id: makeId("type", index),
    name: `Perf Type ${String(index + 1).padStart(2, "0")}`
  }));
  const tagPool = ["classic", "modern", "mint", "used", "postal", "coin", "paper", "photo", "medal", "rare", "wide", "tall"];

  db.exec("BEGIN TRANSACTION");
  countries.forEach((country, index) => {
    run(db, "INSERT INTO countries (id, name, sort_order, notes, created_at) VALUES (?, ?, ?, ?, ?)", [
      country.id,
      country.name,
      index,
      "Perf seed country",
      now
    ]);
  });
  types.forEach((type, index) => {
    run(db, "INSERT INTO collection_types (id, name, sort_order, description, custom_fields_json, created_at) VALUES (?, ?, ?, ?, ?, ?)", [
      type.id,
      type.name,
      index,
      "Perf seed collection type",
      "{}",
      now
    ]);
  });

  for (let index = 0; index < itemCount; index += 1) {
    const itemId = makeId("item", index);
    const country = countries[index % countries.length];
    const type = types[index % types.length];
    const year = String(1850 + (index % 176));
    const tags = [tagPool[index % tagPool.length], tagPool[(index + 5) % tagPool.length], `batch-${Math.floor(index / 1000)}`];
    const timestamp = new Date(Date.UTC(2020 + (index % 6), index % 12, (index % 27) + 1)).toISOString();
    const imageId = makeId("image", index);
    const wide = index % 5 === 0;
    const tall = index % 5 === 1;
    const width = wide ? 900 : tall ? 420 : 640;
    const height = wide ? 420 : tall ? 900 : 640;

    run(
      db,
      `
        INSERT INTO items (
          id, title, country_id, type_id, year, description, condition, purchase_price, source,
          tags_json, custom_fields_json, favorite, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        itemId,
        `Perf Item ${String(index + 1).padStart(6, "0")}`,
        country.id,
        type.id,
        year,
        `Generated performance test item ${index + 1}`,
        index % 3 === 0 ? "Mint" : "Used",
        String((index % 200) + 1),
        "Perf seed",
        JSON.stringify(tags),
        JSON.stringify({ batch: Math.floor(index / 1000), shape: wide ? "wide" : tall ? "tall" : "square" }),
        index % 11 === 0 ? 1 : 0,
        timestamp,
        timestamp
      ]
    );

    run(
      db,
      `
        INSERT INTO images (
          id, item_id, original_filename, stored_filename, image_path, thumbnail_path, width, height,
          aspect_ratio, size_bytes, mime_type, sort_order, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        imageId,
        itemId,
        "perf-placeholder.png",
        "perf-placeholder.png",
        imagePath,
        thumbPath,
        width,
        height,
        width / height,
        pngBytes.length,
        "image/png",
        0,
        timestamp
      ]
    );

    if ((index + 1) % 10000 === 0) {
      console.log(`seeded ${index + 1} items`);
    }
  }

  run(db, "INSERT INTO albums (id, title, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)", [
    "perf-album",
    "Perf Album",
    "Generated performance album",
    now,
    now
  ]);
  run(
    db,
    `
      INSERT INTO album_pages (
        id, album_id, title, page_number, notes, column_count, page_width, page_height, orientation,
        background, custom_background, show_guides, snap_to_grid, grid_size, template_name, layout_version,
        created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    ["perf-page", "perf-album", "Dense generated page", 1, "", 4, 1000, 1400, "portrait", "white", "#ffffff", 1, 1, 25, "blank", 2, now, now]
  );

  const placementCount = Math.min(300, itemCount);
  for (let index = 0; index < placementCount; index += 1) {
    const column = index % 6;
    const row = Math.floor(index / 6);
    run(
      db,
      `
        INSERT INTO album_page_items (
          id, page_id, item_id, image_id, x, y, width, height, rotation, z_index, caption,
          show_caption, show_title, show_metadata, locked, sort_order, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      [
        makeId("placement", index),
        "perf-page",
        makeId("item", index),
        makeId("image", index),
        30 + column * 155,
        40 + row * 78,
        130,
        62,
        0,
        index,
        `P${index + 1}`,
        0,
        0,
        0,
        1,
        index,
        now
      ]
    );
  }

  db.exec("COMMIT");
  const dbPath = path.join(outDir, "archive.sqlite");
  fs.writeFileSync(dbPath, Buffer.from(db.export()));
  db.close();

  console.log(JSON.stringify({ items: itemCount, dataFolder: outDir, dbPath, placements: placementCount }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
