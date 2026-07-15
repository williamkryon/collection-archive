const fs = require("fs");
const path = require("path");

function ensureDir(folder) {
  fs.mkdirSync(folder, { recursive: true });
}

function safeStat(filePath) {
  try {
    return fs.statSync(filePath);
  } catch {
    return null;
  }
}

function folderUsage(folder) {
  const usage = { bytes: 0, files: 0 };
  const stat = safeStat(folder);
  if (!stat) return usage;
  if (stat.isFile()) return { bytes: stat.size, files: 1 };
  if (!stat.isDirectory()) return usage;
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    const childPath = path.join(folder, entry.name);
    if (entry.isDirectory()) {
      const child = folderUsage(childPath);
      usage.bytes += child.bytes;
      usage.files += child.files;
    } else if (entry.isFile()) {
      const childStat = safeStat(childPath);
      if (childStat) {
        usage.bytes += childStat.size;
        usage.files += 1;
      }
    }
  }
  return usage;
}

function sanitizeFolderName(name) {
  return String(name || "backup")
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || "backup";
}

function backupTimestamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, "-");
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function writeBackupManifest(folder, payload, paths) {
  fs.writeFileSync(path.join(folder, "backup-manifest.json"), JSON.stringify({
    app: "Collection Archive",
    version: "0.1.0",
    created_at: new Date().toISOString(),
    data_folder: paths.base,
    ...payload
  }, null, 2));
}

function tempDbRows(tempDb, query, params = []) {
  const stmt = tempDb.prepare(query);
  const rows = [];
  try {
    stmt.bind(params);
    while (stmt.step()) rows.push(stmt.getAsObject());
  } finally {
    stmt.free();
  }
  return rows;
}

function tempDbTableExists(tempDb, name) {
  try {
    return Boolean(tempDbRows(tempDb, "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", [name])[0]);
  } catch {
    return false;
  }
}

function tempDbCount(tempDb, tableName) {
  if (!tempDbTableExists(tempDb, tableName)) return 0;
  try {
    const row = tempDbRows(tempDb, `SELECT COUNT(*) AS count FROM ${tableName}`)[0];
    return Number(row?.count || 0);
  } catch {
    return 0;
  }
}

function backupFolderMediaStatus(folder) {
  return {
    images: fs.existsSync(path.join(folder, "images")),
    attachments: fs.existsSync(path.join(folder, "attachments")),
    captures: fs.existsSync(path.join(folder, "captures"))
  };
}

function inspectBackupDatabase(SQL, dbPath) {
  const tempDb = new SQL.Database(fs.readFileSync(dbPath));
  try {
    const integrityRows = tempDbRows(tempDb, "PRAGMA integrity_check");
    const integrityMessages = integrityRows.map((row) => String(row.integrity_check || Object.values(row)[0] || ""));
    const integrityOk = integrityMessages.length > 0 && integrityMessages.every((message) => message.toLowerCase() === "ok");
    const foreignKeyWarnings = tempDbRows(tempDb, "PRAGMA foreign_key_check").map((row) => ({
      table: row.table || "",
      rowid: row.rowid ?? "",
      parent: row.parent || "",
      fkid: row.fkid ?? ""
    }));
    return {
      integrityOk,
      integrityMessages,
      foreignKeyWarnings,
      counts: {
        items: tempDbCount(tempDb, "items"),
        images: tempDbCount(tempDb, "images"),
        albums: tempDbCount(tempDb, "albums")
      }
    };
  } finally {
    tempDb.close();
  }
}

function currentReplacementUsage(paths, kind) {
  const database = folderUsage(paths.db);
  const images = folderUsage(paths.images);
  const attachments = folderUsage(paths.attachments);
  const captures = folderUsage(paths.captures);
  const categories = kind === "metadata-only"
    ? { database }
    : { database, images, attachments, captures };
  const totalBytes = Object.values(categories).reduce((sum, entry) => sum + entry.bytes, 0);
  return { totalBytes, categories };
}

function inspectBackupFolder({ folder, SQL, paths }) {
  const resolvedFolder = path.resolve(folder || "");
  const manifestPath = path.join(resolvedFolder, "backup-manifest.json");
  const dbPath = path.join(resolvedFolder, "archive.sqlite");
  const errors = [];
  let manifest = null;
  let databaseInfo = null;

  try {
    manifest = readJsonFile(manifestPath);
  } catch (error) {
    errors.push(`backup-manifest.json could not be read: ${error.message}`);
  }

  if (manifest) {
    if (manifest.app !== "Collection Archive") errors.push("Backup manifest is not for Collection Archive.");
    if (!["metadata-only", "full"].includes(manifest.kind)) errors.push("Backup type must be metadata-only or full.");
  }

  if (!fs.existsSync(dbPath)) {
    errors.push("archive.sqlite is missing.");
  } else if (SQL) {
    try {
      databaseInfo = inspectBackupDatabase(SQL, dbPath);
      if (!databaseInfo.integrityOk) {
        errors.push(`SQLite integrity_check failed: ${databaseInfo.integrityMessages.join("; ")}`);
      }
    } catch (error) {
      errors.push(`archive.sqlite could not be opened: ${error.message}`);
    }
  } else {
    errors.push("SQLite engine is not ready.");
  }

  const kind = manifest?.kind || "";
  const media = backupFolderMediaStatus(resolvedFolder);
  return {
    valid: errors.length === 0,
    errors,
    folder: resolvedFolder,
    manifest: manifest ? {
      app: manifest.app || "",
      kind,
      version: manifest.version || "",
      created_at: manifest.created_at || "",
      includes: Array.isArray(manifest.includes) ? manifest.includes : [],
      excludes: Array.isArray(manifest.excludes) ? manifest.excludes : [],
      note: manifest.note || ""
    } : null,
    counts: databaseInfo?.counts || { items: 0, images: 0, albums: 0 },
    integrity: {
      ok: Boolean(databaseInfo?.integrityOk),
      messages: databaseInfo?.integrityMessages || []
    },
    foreignKeyWarnings: databaseInfo?.foreignKeyWarnings || [],
    media,
    currentReplacement: paths ? currentReplacementUsage(paths, kind) : { totalBytes: 0, categories: {} }
  };
}

function copyIfExists(source, destination) {
  if (!source || !fs.existsSync(source)) return false;
  ensureDir(path.dirname(destination));
  fs.cpSync(source, destination, { recursive: true, force: true });
  return true;
}

function createMetadataPreRestoreBackup(paths) {
  const backupParent = path.join(path.dirname(paths.base), "pre-restore-backups");
  ensureDir(backupParent);
  const backupFolder = path.join(backupParent, sanitizeFolderName(`Collection Archive metadata pre-restore ${backupTimestamp()}`));
  ensureDir(backupFolder);
  copyIfExists(paths.db, path.join(backupFolder, "archive.sqlite"));
  writeBackupManifest(backupFolder, {
    kind: "metadata-only",
    reason: "pre-restore",
    includes: ["archive.sqlite", "backup-manifest.json"],
    excludes: ["images", "thumbnails", "attachments", "captures", "temp/cache", "exports"],
    note: "Automatically created before metadata-only restore. Media folders were intentionally not copied."
  }, paths);
  return backupFolder;
}

function createFullRollbackFolder(paths) {
  const backupParent = path.join(path.dirname(paths.base), "pre-restore-backups");
  ensureDir(backupParent);
  const rollbackFolder = path.join(backupParent, sanitizeFolderName(`Collection Archive full pre-restore ${backupTimestamp()}`));
  ensureDir(rollbackFolder);
  return rollbackFolder;
}

function restoreMovedEntries(movedEntries) {
  for (const entry of [...movedEntries].reverse()) {
    fs.rmSync(entry.source, { recursive: true, force: true });
    ensureDir(path.dirname(entry.source));
    fs.renameSync(entry.rollbackPath, entry.source);
  }
}

function moveCurrentEntryToRollback(source, rollbackPath, movedEntries) {
  if (!fs.existsSync(source)) return;
  ensureDir(path.dirname(rollbackPath));
  fs.renameSync(source, rollbackPath);
  movedEntries.push({ source, rollbackPath });
}

function copyRestoredMediaFolder(backupFolder, folderName, destination) {
  const source = path.join(backupFolder, folderName);
  fs.rmSync(destination, { recursive: true, force: true });
  if (fs.existsSync(source)) {
    ensureDir(path.dirname(destination));
    fs.cpSync(source, destination, { recursive: true, force: true });
  } else {
    ensureDir(destination);
  }
}

function restoreMetadataOnly({ preview, paths, saveDb }) {
  if (typeof saveDb === "function") saveDb();
  const preRestoreBackupFolder = createMetadataPreRestoreBackup(paths);
  try {
    fs.copyFileSync(path.join(preview.folder, "archive.sqlite"), paths.db);
  } catch (error) {
    const rollbackDb = path.join(preRestoreBackupFolder, "archive.sqlite");
    if (fs.existsSync(rollbackDb)) fs.copyFileSync(rollbackDb, paths.db);
    throw error;
  }
  return { preRestoreBackupFolder, strategy: "metadata-copy" };
}

function restoreFullWithRollback({ preview, paths, saveDb, simulateFailureAfterMove = false }) {
  if (typeof saveDb === "function") saveDb();
  const preRestoreBackupFolder = createFullRollbackFolder(paths);
  const movedEntries = [];
  try {
    moveCurrentEntryToRollback(paths.db, path.join(preRestoreBackupFolder, "archive.sqlite"), movedEntries);
    moveCurrentEntryToRollback(paths.images, path.join(preRestoreBackupFolder, "images"), movedEntries);
    moveCurrentEntryToRollback(paths.attachments, path.join(preRestoreBackupFolder, "attachments"), movedEntries);
    moveCurrentEntryToRollback(paths.captures, path.join(preRestoreBackupFolder, "captures"), movedEntries);
    writeBackupManifest(preRestoreBackupFolder, {
      kind: "full",
      reason: "pre-restore",
      includes: ["archive.sqlite", "images", "attachments", "captures", "backup-manifest.json"],
      excludes: ["thumbnails", "temp/cache", "exports"],
      note: "Automatically created by renaming current archive data before full restore. Keep until the restored archive is verified."
    }, paths);
    if (simulateFailureAfterMove) throw new Error("Simulated restore failure after rollback snapshot.");
    fs.copyFileSync(path.join(preview.folder, "archive.sqlite"), paths.db);
    copyRestoredMediaFolder(preview.folder, "images", paths.images);
    copyRestoredMediaFolder(preview.folder, "attachments", paths.attachments);
    copyRestoredMediaFolder(preview.folder, "captures", paths.captures);
  } catch (error) {
    try {
      restoreMovedEntries(movedEntries);
    } catch (rollbackError) {
      throw new Error(`${error.message}; rollback failed: ${rollbackError.message}`);
    }
    throw error;
  }
  return { preRestoreBackupFolder, strategy: "full-rename-rollback" };
}

function clearGeneratedThumbnailCache(paths) {
  fs.rmSync(paths.thumbs, { recursive: true, force: true });
  ensureDir(paths.thumbs);
}

function applyBackupRestore({ folder, SQL, paths, saveDb, reloadDatabaseFromDisk, simulateFailureAfterMove = false }) {
  const preview = inspectBackupFolder({ folder, SQL, paths });
  if (!preview.valid) throw new Error(preview.errors.join(" "));
  const restoreResult = preview.manifest.kind === "metadata-only"
    ? restoreMetadataOnly({ preview, paths, saveDb })
    : restoreFullWithRollback({ preview, paths, saveDb, simulateFailureAfterMove });
  clearGeneratedThumbnailCache(paths);
  ensureDir(paths.phoneUploads);
  if (typeof reloadDatabaseFromDisk === "function") reloadDatabaseFromDisk();
  return { preview, ...restoreResult };
}

module.exports = {
  applyBackupRestore,
  backupFolderMediaStatus,
  backupTimestamp,
  currentReplacementUsage,
  folderUsage,
  inspectBackupFolder,
  sanitizeFolderName
};
