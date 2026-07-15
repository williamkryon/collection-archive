const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const initSqlJs = require("sql.js");
const { scanArchiveHealth } = require("../electron/archive-health-core");

const repoRoot = path.resolve(__dirname, "..");

function ensureDir(folder) {
  fs.mkdirSync(folder, { recursive: true });
}

function writeFile(filePath, content) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content);
}

function pathsFor(base) {
  return {
    base,
    db: path.join(base, "archive.sqlite"),
    images: path.join(base, "images"),
    thumbs: path.join(base, "thumbnails"),
    attachments: path.join(base, "attachments"),
    captures: path.join(base, "captures"),
    phoneUploads: path.join(base, "phone-upload-temp")
  };
}

function createDb(SQL, paths, options = {}) {
  const db = new SQL.Database();
  db.run(`
    PRAGMA foreign_keys = OFF;
    CREATE TABLE items (id TEXT PRIMARY KEY, title TEXT);
    CREATE TABLE images (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL,
      original_filename TEXT,
      stored_filename TEXT,
      image_path TEXT,
      thumbnail_path TEXT,
      deleted_at TEXT DEFAULT '',
      FOREIGN KEY (item_id) REFERENCES items(id)
    );
    CREATE TABLE item_attachments (
      id TEXT PRIMARY KEY,
      item_id TEXT NOT NULL,
      title TEXT,
      original_filename TEXT,
      stored_filename TEXT,
      relative_path TEXT,
      attachment_kind TEXT,
      file_type TEXT,
      mime_type TEXT,
      FOREIGN KEY (item_id) REFERENCES items(id)
    );
  `);
  db.run("INSERT INTO items (id, title) VALUES ('item-1', 'Item One')");
  const itemId = options.foreignKeyWarning ? "missing-item" : "item-1";
  db.run(
    "INSERT INTO images (id, item_id, original_filename, stored_filename, image_path, thumbnail_path) VALUES (?, ?, ?, ?, ?, ?)",
    ["image-1", itemId, "front.jpg", "front.jpg", path.join(paths.images, "front.jpg"), path.join(paths.thumbs, "front.png")]
  );
  db.run(
    "INSERT INTO item_attachments (id, item_id, title, original_filename, stored_filename, relative_path, attachment_kind, file_type, mime_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ["attachment-1", "item-1", "Manual", "manual.pdf", "manual.pdf", "manual.pdf", "file", "pdf", "application/pdf"]
  );
  ensureDir(paths.base);
  fs.writeFileSync(paths.db, Buffer.from(db.export()));
  db.close();
}

function createArchive(SQL, root, options = {}) {
  const paths = pathsFor(path.join(root, "collection-archive-data"));
  ensureDir(paths.images);
  ensureDir(paths.thumbs);
  ensureDir(paths.attachments);
  ensureDir(paths.captures);
  createDb(SQL, paths, options);
  if (!options.missingImage) writeFile(path.join(paths.images, "front.jpg"), "image");
  writeFile(path.join(paths.thumbs, "front.png"), "thumbnail");
  writeFile(path.join(paths.attachments, "manual.pdf"), "attachment");
  if (options.orphanImage) writeFile(path.join(paths.images, "orphan.jpg"), "orphan");
  return paths;
}

(async () => {
  const SQL = await initSqlJs({
    locateFile: (file) => path.join(repoRoot, "node_modules", "sql.js", "dist", file)
  });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "collection-health-test-"));
  try {
    {
      const paths = createArchive(SQL, path.join(root, "healthy"));
      const health = scanArchiveHealth({ SQL, paths });
      assert.strictEqual(health.database.integrityOk, true);
      assert.strictEqual(health.summary.missingFiles, 0);
      assert.strictEqual(health.summary.orphanFiles, 0);
      assert.strictEqual(health.database.foreignKeyWarnings.length, 0);
    }

    {
      const paths = createArchive(SQL, path.join(root, "missing-image"), { missingImage: true });
      const health = scanArchiveHealth({ SQL, paths });
      assert.strictEqual(health.summary.missingFiles, 1);
      assert.strictEqual(health.missingFiles[0].kind, "image");
    }

    {
      const paths = createArchive(SQL, path.join(root, "orphan-image"), { orphanImage: true });
      const health = scanArchiveHealth({ SQL, paths });
      assert.strictEqual(health.summary.orphanFiles, 1);
      assert.strictEqual(health.orphanFiles[0].kind, "image");
      assert(health.summary.affectedBytes > 0);
    }

    {
      const paths = createArchive(SQL, path.join(root, "foreign-key"), { foreignKeyWarning: true, missingImage: false });
      const health = scanArchiveHealth({ SQL, paths });
      assert.strictEqual(health.database.integrityOk, true);
      assert(health.database.foreignKeyWarnings.length >= 1, "foreign_key_check warning should be reported");
      assert(health.summary.warnings >= 1);
    }

    console.log("archive health tests passed");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
