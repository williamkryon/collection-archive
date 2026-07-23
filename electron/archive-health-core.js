const fs = require("fs");
const path = require("path");

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
    const entryPath = path.join(folder, entry.name);
    if (entry.isDirectory()) {
      const child = folderUsage(entryPath);
      usage.bytes += child.bytes;
      usage.files += child.files;
    } else if (entry.isFile()) {
      const childStat = safeStat(entryPath);
      if (childStat) {
        usage.bytes += childStat.size;
        usage.files += 1;
      }
    }
  }
  return usage;
}

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function keyPath(filePath) {
  return path.resolve(filePath).toLowerCase();
}

function rows(db, query, params = []) {
  const stmt = db.prepare(query);
  const result = [];
  try {
    stmt.bind(params);
    while (stmt.step()) result.push(stmt.getAsObject());
  } finally {
    stmt.free();
  }
  return result;
}

function tableExists(db, name) {
  try {
    return Boolean(rows(db, "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?", [name])[0]);
  } catch {
    return false;
  }
}

function resolveMediaPath(rawPath, folder) {
  if (!rawPath) return null;
  const raw = String(rawPath);
  const candidate = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(folder, path.basename(raw));
  if (isInside(folder, candidate)) return candidate;
  const basenameFallback = path.resolve(folder, path.basename(raw));
  return isInside(folder, basenameFallback) ? basenameFallback : null;
}

function rawPathPointsInside(rawPath, folder) {
  if (!rawPath || !path.isAbsolute(String(rawPath))) return false;
  return isInside(folder, path.resolve(String(rawPath)));
}

function listFiles(folder) {
  const stat = safeStat(folder);
  if (!stat?.isDirectory()) return [];
  const found = [];
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    const entryPath = path.join(folder, entry.name);
    if (entry.isDirectory()) {
      found.push(...listFiles(entryPath));
    } else if (entry.isFile()) {
      const entryStat = safeStat(entryPath);
      if (entryStat) found.push({ path: entryPath, bytes: entryStat.size });
    }
  }
  return found;
}

function inspectDatabase(SQL, dbPath) {
  const db = new SQL.Database(fs.readFileSync(dbPath));
  try {
    const integrityMessages = rows(db, "PRAGMA integrity_check")
      .map((row) => String(row.integrity_check || Object.values(row)[0] || ""));
    const integrityOk = integrityMessages.length > 0 && integrityMessages.every((message) => message.toLowerCase() === "ok");
    const foreignKeyWarnings = rows(db, "PRAGMA foreign_key_check").map((row) => ({
      table: row.table || "",
      rowid: row.rowid ?? "",
      parent: row.parent || "",
      fkid: row.fkid ?? ""
    }));
    return { db, integrityOk, integrityMessages, foreignKeyWarnings };
  } catch (error) {
    db.close();
    throw error;
  }
}

function getImageRows(db) {
  if (!tableExists(db, "images")) return [];
  return rows(db, "SELECT id, item_id, original_filename, stored_filename, image_path, thumbnail_path, deleted_at FROM images");
}

function getAttachmentRows(db) {
  if (!tableExists(db, "item_attachments")) return [];
  return rows(db, `
    SELECT id, item_id, title, original_filename, stored_filename, relative_path, attachment_kind, file_type, mime_type
    FROM item_attachments
  `);
}

function getUserAssetRows(db) {
  if (!tableExists(db, "user_assets")) return [];
  return rows(db, "SELECT id, name, asset_type, source_item_id, source_image_id FROM user_assets");
}

function addMissingFile(list, record) {
  list.push({
    kind: record.kind,
    id: record.id || "",
    itemId: record.itemId || "",
    label: record.label || "",
    expectedPath: record.expectedPath || "",
    reason: record.reason || "missing"
  });
}

function scanArchiveHealth({ SQL, paths }) {
  const generatedAt = new Date().toISOString();
  const missingFiles = [];
  const orphanFiles = [];
  const warnings = [];
  const referenced = {
    images: new Set(),
    attachments: new Set(),
    captures: new Set()
  };
  const checks = [];
  let databaseInfo = null;
  let imageRows = [];
  let attachmentRows = [];
  let userAssetRows = [];

  if (!fs.existsSync(paths.db)) {
    missingFiles.push({ kind: "database", expectedPath: paths.db, reason: "archive.sqlite missing" });
    checks.push({ key: "sqliteIntegrity", status: "error", label: "SQLite integrity_check", detail: "archive.sqlite missing" });
  } else {
    const opened = inspectDatabase(SQL, paths.db);
    const db = opened.db;
    try {
      databaseInfo = opened;
      checks.push({
        key: "sqliteIntegrity",
        status: opened.integrityOk ? "ok" : "error",
        label: "SQLite integrity_check",
        detail: opened.integrityMessages.join("; ") || "-"
      });
      if (opened.foreignKeyWarnings.length) {
        warnings.push(...opened.foreignKeyWarnings.map((warning) => ({
          kind: "foreign_key",
          message: `${warning.table || "-"} row ${warning.rowid || "-"} references ${warning.parent || "-"}`,
          ...warning
        })));
      }
      checks.push({
        key: "foreignKeys",
        status: opened.foreignKeyWarnings.length ? "warning" : "ok",
        label: "SQLite foreign_key_check",
        detail: opened.foreignKeyWarnings.length ? `${opened.foreignKeyWarnings.length} warning(s)` : "OK"
      });

      imageRows = getImageRows(db);
      attachmentRows = getAttachmentRows(db);
      userAssetRows = getUserAssetRows(db);
    } finally {
      db.close();
    }
  }

  imageRows.forEach((image) => {
    const imagePath = resolveMediaPath(image.image_path, paths.images);
    const thumbPath = resolveMediaPath(image.thumbnail_path, paths.thumbs);
    if (imagePath) referenced.images.add(keyPath(imagePath));
    if (thumbPath) referenced.thumbnails = referenced.thumbnails || new Set();
    if (thumbPath) referenced.thumbnails.add(keyPath(thumbPath));
    if (!imagePath) {
      addMissingFile(missingFiles, { kind: "image", id: image.id, itemId: image.item_id, label: image.original_filename || image.stored_filename, expectedPath: image.image_path, reason: "invalid image path" });
    } else if (!safeStat(imagePath)?.isFile()) {
      addMissingFile(missingFiles, { kind: "image", id: image.id, itemId: image.item_id, label: image.original_filename || image.stored_filename, expectedPath: imagePath });
    }
  });

  const imagesById = new Map(imageRows.map((image) => [image.id, image]));
  userAssetRows.forEach((asset) => {
    const source = imagesById.get(asset.source_image_id);
    const sourcePath = source ? resolveMediaPath(source.image_path, paths.images) : null;
    if (!source || source.item_id !== asset.source_item_id || !sourcePath || !safeStat(sourcePath)?.isFile()) {
      addMissingFile(missingFiles, {
        kind: "user_asset_source",
        id: asset.id,
        itemId: asset.source_item_id,
        label: asset.name || asset.asset_type,
        expectedPath: sourcePath || asset.source_image_id,
        reason: source ? "user asset source file missing" : "user asset source image record missing"
      });
    }
  });

  attachmentRows.forEach((attachment) => {
    const raw = attachment.relative_path || attachment.stored_filename;
    if (!raw) return;
    const attachmentPath = resolveMediaPath(raw, paths.attachments);
    const capturePath = rawPathPointsInside(raw, paths.captures) ? resolveMediaPath(raw, paths.captures) : null;
    const isCapture = attachment.attachment_kind === "webpage_pdf";
    const expectedPath = capturePath || attachmentPath;
    if (attachmentPath) referenced.attachments.add(keyPath(attachmentPath));
    if (capturePath) referenced.captures.add(keyPath(capturePath));
    if (!expectedPath) {
      addMissingFile(missingFiles, { kind: isCapture ? "capture" : "attachment", id: attachment.id, itemId: attachment.item_id, label: attachment.title || attachment.original_filename, expectedPath: raw, reason: "invalid attachment path" });
    } else if (!safeStat(expectedPath)?.isFile()) {
      addMissingFile(missingFiles, { kind: isCapture ? "capture" : "attachment", id: attachment.id, itemId: attachment.item_id, label: attachment.title || attachment.original_filename, expectedPath });
    }
  });

  for (const file of listFiles(paths.images)) {
    if (!referenced.images.has(keyPath(file.path))) {
      orphanFiles.push({ kind: "image", path: file.path, bytes: file.bytes });
    }
  }
  for (const file of listFiles(paths.attachments)) {
    if (!referenced.attachments.has(keyPath(file.path))) {
      orphanFiles.push({ kind: "attachment", path: file.path, bytes: file.bytes });
    }
  }
  for (const file of listFiles(paths.captures)) {
    if (!referenced.captures.has(keyPath(file.path))) {
      orphanFiles.push({ kind: "capture", path: file.path, bytes: file.bytes });
    }
  }

  const thumbnailUsage = folderUsage(paths.thumbs);
  const sourceImagesAvailable = imageRows.filter((image) => {
    const imagePath = resolveMediaPath(image.image_path, paths.images);
    return imagePath && safeStat(imagePath)?.isFile();
  }).length;
  const canRegenerateThumbnails = sourceImagesAvailable > 0 && sourceImagesAvailable === imageRows.length;

  checks.push({
    key: "missingFiles",
    status: missingFiles.length ? "error" : "ok",
    label: "Missing media files",
    detail: missingFiles.length ? `${missingFiles.length} missing` : "OK"
  });
  checks.push({
    key: "orphanFiles",
    status: orphanFiles.length ? "warning" : "ok",
    label: "Orphan media files",
    detail: orphanFiles.length ? `${orphanFiles.length} orphan file(s)` : "OK"
  });
  checks.push({
    key: "thumbnails",
    status: imageRows.length && !canRegenerateThumbnails ? "warning" : "ok",
    label: "Thumbnail cache",
    detail: `${thumbnailUsage.files} file(s), ${thumbnailUsage.bytes} bytes, ${sourceImagesAvailable}/${imageRows.length} source image(s) available`
  });

  const affectedBytes = orphanFiles.reduce((sum, file) => sum + Number(file.bytes || 0), 0);
  const okItems = checks.filter((check) => check.status === "ok").length;
  const warningCount = warnings.length + checks.filter((check) => check.status === "warning").length;

  return {
    generatedAt,
    dataFolder: paths.base,
    summary: {
      okItems,
      warnings: warningCount,
      missingFiles: missingFiles.length,
      orphanFiles: orphanFiles.length,
      affectedBytes
    },
    checks,
    warnings,
    missingFiles,
    orphanFiles,
    thumbnail: {
      ...thumbnailUsage,
      canRegenerate: canRegenerateThumbnails,
      sourceImagesAvailable,
      imageRecords: imageRows.length
    },
    userAssets: { definitions: userAssetRows.length },
    database: {
      integrityOk: Boolean(databaseInfo?.integrityOk),
      integrityMessages: databaseInfo?.integrityMessages || [],
      foreignKeyWarnings: databaseInfo?.foreignKeyWarnings || []
    }
  };
}

module.exports = {
  folderUsage,
  scanArchiveHealth
};
