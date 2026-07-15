const fs = require("fs");
const path = require("path");

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function mediaFileState(folder, rawPath) {
  if (!folder || !rawPath) return { filePath: null, exists: false, version: 0 };
  const raw = String(rawPath);
  let resolved = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(folder, path.basename(raw));
  if (!isInside(folder, resolved)) {
    resolved = path.resolve(folder, path.basename(raw));
  }
  if (!isInside(folder, resolved)) return { filePath: null, exists: false, version: 0 };
  const exists = fs.existsSync(resolved);
  return {
    filePath: resolved,
    exists,
    version: exists ? Math.round(fs.statSync(resolved).mtimeMs) : 0
  };
}

function archiveMediaUrl(kind, filePath, version) {
  if (!filePath) return null;
  const suffix = version ? `?v=${version}` : "";
  return `archive://local/${kind}/${encodeURIComponent(path.basename(filePath))}${suffix}`;
}

function imageDisplayUrls(row, paths) {
  const image = mediaFileState(paths.images, row?.image_path);
  const thumbnail = mediaFileState(paths.thumbs, row?.thumbnail_path);
  const imageUrl = image.exists ? archiveMediaUrl("images", image.filePath, image.version) : null;
  const thumbnailUrl = thumbnail.exists
    ? archiveMediaUrl("thumbnails", thumbnail.filePath, thumbnail.version)
    : imageUrl;
  return {
    url: imageUrl,
    thumbnailUrl,
    thumbnailMissing: Boolean(row?.thumbnail_path && !thumbnail.exists && image.exists),
    imageMissing: Boolean(row?.image_path && !image.exists)
  };
}

module.exports = {
  imageDisplayUrls,
  mediaFileState
};
