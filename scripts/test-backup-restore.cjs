const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const initSqlJs = require("sql.js");
const { applyBackupRestore, inspectBackupFolder } = require("../electron/backup-restore-core");

const repoRoot = path.resolve(__dirname, "..");

function ensureDir(folder) {
  fs.mkdirSync(folder, { recursive: true });
}

function writeFile(filePath, text) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, text);
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

function writeManifest(folder, kind) {
  fs.writeFileSync(path.join(folder, "backup-manifest.json"), JSON.stringify({
    app: "Collection Archive",
    version: "0.1.0-test",
    kind,
    created_at: "2026-06-25T00:00:00.000Z",
    includes: kind === "full"
      ? ["archive.sqlite", "images", "attachments", "captures", "backup-manifest.json"]
      : ["archive.sqlite", "backup-manifest.json"]
  }, null, 2));
}

function createArchiveDb(SQL, filePath, prefix, counts = { items: 1, images: 1, albums: 1 }) {
  const db = new SQL.Database();
  db.run(`
    CREATE TABLE items (id TEXT PRIMARY KEY, title TEXT);
    CREATE TABLE images (id TEXT PRIMARY KEY, item_id TEXT, stored_filename TEXT);
    CREATE TABLE albums (id TEXT PRIMARY KEY, title TEXT);
  `);
  for (let index = 0; index < counts.items; index += 1) {
    db.run("INSERT INTO items (id, title) VALUES (?, ?)", [`${prefix}-item-${index}`, `${prefix} item ${index}`]);
  }
  for (let index = 0; index < counts.images; index += 1) {
    db.run("INSERT INTO images (id, item_id, stored_filename) VALUES (?, ?, ?)", [`${prefix}-image-${index}`, `${prefix}-item-0`, `${prefix}-${index}.jpg`]);
  }
  for (let index = 0; index < counts.albums; index += 1) {
    db.run("INSERT INTO albums (id, title) VALUES (?, ?)", [`${prefix}-album-${index}`, `${prefix} album ${index}`]);
  }
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, Buffer.from(db.export()));
  db.close();
}

function countTable(SQL, dbPath, table) {
  const db = new SQL.Database(fs.readFileSync(dbPath));
  try {
    const stmt = db.prepare(`SELECT COUNT(*) AS count FROM ${table}`);
    try {
      stmt.step();
      return Number(stmt.getAsObject().count || 0);
    } finally {
      stmt.free();
    }
  } finally {
    db.close();
  }
}

function makeCurrentArchive(SQL, root, prefix = "current") {
  const paths = pathsFor(path.join(root, "collection-archive-data"));
  ensureDir(paths.base);
  createArchiveDb(SQL, paths.db, prefix, { items: 1, images: 1, albums: 1 });
  writeFile(path.join(paths.images, `${prefix}.jpg`), `${prefix}-image`);
  writeFile(path.join(paths.attachments, `${prefix}.pdf`), `${prefix}-attachment`);
  writeFile(path.join(paths.captures, `${prefix}.pdf`), `${prefix}-capture`);
  ensureDir(paths.thumbs);
  ensureDir(paths.phoneUploads);
  return paths;
}

function makeBackup(SQL, root, kind, prefix = "backup") {
  const folder = path.join(root, `${kind}-backup`);
  ensureDir(folder);
  createArchiveDb(SQL, path.join(folder, "archive.sqlite"), prefix, { items: 2, images: 3, albums: 1 });
  writeManifest(folder, kind);
  if (kind === "full") {
    writeFile(path.join(folder, "images", `${prefix}.jpg`), `${prefix}-image`);
    writeFile(path.join(folder, "attachments", `${prefix}.pdf`), `${prefix}-attachment`);
    writeFile(path.join(folder, "captures", `${prefix}.pdf`), `${prefix}-capture`);
  }
  return folder;
}

function apply(SQL, paths, folder, extra = {}) {
  let saved = false;
  let reloaded = false;
  const result = applyBackupRestore({
    folder,
    SQL,
    paths,
    saveDb: () => { saved = true; },
    reloadDatabaseFromDisk: () => { reloaded = true; },
    ...extra
  });
  return { result, saved, reloaded };
}

(async () => {
  const SQL = await initSqlJs({
    locateFile: (file) => path.join(repoRoot, "node_modules", "sql.js", "dist", file)
  });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "collection-restore-test-"));
  try {
    {
      const paths = makeCurrentArchive(SQL, path.join(root, "metadata-case"));
      const backup = makeBackup(SQL, path.join(root, "metadata-case"), "metadata-only", "metadata");
      const preview = inspectBackupFolder({ folder: backup, SQL, paths });
      assert.strictEqual(preview.valid, true);
      assert.strictEqual(preview.currentReplacement.categories.images, undefined, "metadata preview should not include media replacement size");
      const { result, saved, reloaded } = apply(SQL, paths, backup);
      assert.strictEqual(result.strategy, "metadata-copy");
      assert.strictEqual(saved, true);
      assert.strictEqual(reloaded, true);
      assert.strictEqual(countTable(SQL, paths.db, "items"), 2);
      assert.strictEqual(fs.existsSync(path.join(paths.images, "current.jpg")), true, "metadata restore must not move images");
      assert.strictEqual(fs.existsSync(path.join(result.preRestoreBackupFolder, "archive.sqlite")), true);
      assert.strictEqual(fs.existsSync(path.join(result.preRestoreBackupFolder, "images")), false, "metadata pre-restore backup must not copy images");
    }

    {
      const paths = makeCurrentArchive(SQL, path.join(root, "full-case"));
      const backup = makeBackup(SQL, path.join(root, "full-case"), "full", "full");
      const { result } = apply(SQL, paths, backup);
      assert.strictEqual(result.strategy, "full-rename-rollback");
      assert.strictEqual(countTable(SQL, paths.db, "images"), 3);
      assert.strictEqual(fs.readFileSync(path.join(paths.images, "full.jpg"), "utf8"), "full-image");
      assert.strictEqual(fs.existsSync(path.join(paths.images, "current.jpg")), false);
      assert.strictEqual(fs.readFileSync(path.join(result.preRestoreBackupFolder, "images", "current.jpg"), "utf8"), "current-image");
      assert.strictEqual(fs.readFileSync(path.join(paths.attachments, "full.pdf"), "utf8"), "full-attachment");
      assert.strictEqual(fs.readFileSync(path.join(paths.captures, "full.pdf"), "utf8"), "full-capture");
    }

    {
      const paths = makeCurrentArchive(SQL, path.join(root, "invalid-case"));
      const backup = makeBackup(SQL, path.join(root, "invalid-case"), "metadata-only", "invalid");
      fs.writeFileSync(path.join(backup, "backup-manifest.json"), JSON.stringify({ app: "Other App", kind: "metadata-only" }));
      const preview = inspectBackupFolder({ folder: backup, SQL, paths });
      assert.strictEqual(preview.valid, false);
      assert.throws(() => apply(SQL, paths, backup), /not for Collection Archive/);
    }

    {
      const paths = makeCurrentArchive(SQL, path.join(root, "rollback-case"));
      const backup = makeBackup(SQL, path.join(root, "rollback-case"), "full", "rollback");
      assert.throws(() => apply(SQL, paths, backup, { simulateFailureAfterMove: true }), /Simulated restore failure/);
      assert.strictEqual(countTable(SQL, paths.db, "items"), 1, "rollback should restore original database");
      assert.strictEqual(fs.readFileSync(path.join(paths.images, "current.jpg"), "utf8"), "current-image");
      assert.strictEqual(fs.readFileSync(path.join(paths.attachments, "current.pdf"), "utf8"), "current-attachment");
      assert.strictEqual(fs.readFileSync(path.join(paths.captures, "current.pdf"), "utf8"), "current-capture");
    }

    console.log("backup restore tests passed");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
