const fs = require("fs");
const path = require("path");

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return Boolean(relative) && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function mediaFileState(folder, rawPath, stateCache = null) {
  if (!folder || !rawPath) return { filePath: null, exists: false, version: 0 };
  const raw = String(rawPath);
  let resolved = path.isAbsolute(raw) ? path.resolve(raw) : path.resolve(folder, path.basename(raw));
  if (!isInside(folder, resolved)) {
    resolved = path.resolve(folder, path.basename(raw));
  }
  if (!isInside(folder, resolved)) return { filePath: null, exists: false, version: 0 };
  const cacheKey = resolved.toLowerCase();
  if (stateCache instanceof Map && stateCache.has(cacheKey)) {
    return stateCache.get(cacheKey);
  }
  let stat = null;
  try {
    stat = fs.statSync(resolved);
  } catch {
    stat = null;
  }
  const exists = Boolean(stat?.isFile());
  const state = {
    filePath: resolved,
    exists,
    version: exists ? Math.round(stat.mtimeMs) : 0
  };
  if (stateCache instanceof Map) stateCache.set(cacheKey, state);
  return state;
}

function archiveMediaUrl(kind, filePath, version) {
  if (!filePath) return null;
  const suffix = version ? `?v=${version}` : "";
  return `archive://local/${kind}/${encodeURIComponent(path.basename(filePath))}${suffix}`;
}

function imageDisplayUrls(row, paths, stateCache = null) {
  const image = mediaFileState(paths.images, row?.image_path, stateCache);
  const thumbnail = mediaFileState(paths.thumbs, row?.thumbnail_path, stateCache);
  const cutout = mediaFileState(paths.images, row?.cutout_image_path, stateCache);
  const cutoutThumbnail = mediaFileState(paths.thumbs, row?.cutout_thumbnail_path, stateCache);
  const originalUrl = image.exists ? archiveMediaUrl("images", image.filePath, image.version) : null;
  const originalThumbnailUrl = thumbnail.exists
    ? archiveMediaUrl("thumbnails", thumbnail.filePath, thumbnail.version)
    : originalUrl;
  const cutoutUrl = cutout.exists ? archiveMediaUrl("images", cutout.filePath, cutout.version) : null;
  const cutoutThumbnailUrl = cutoutThumbnail.exists
    ? archiveMediaUrl("thumbnails", cutoutThumbnail.filePath, cutoutThumbnail.version)
    : cutoutUrl;
  const cutoutEnabled = Boolean(Number(row?.cutout_enabled || 0)) && Boolean(cutoutUrl);
  return {
    url: cutoutEnabled ? cutoutUrl : originalUrl,
    thumbnailUrl: cutoutEnabled ? (cutoutThumbnailUrl || originalThumbnailUrl) : originalThumbnailUrl,
    originalUrl,
    originalThumbnailUrl,
    cutoutUrl,
    cutoutThumbnailUrl,
    cutoutAvailable: Boolean(cutoutUrl),
    cutoutEnabled,
    thumbnailMissing: Boolean(row?.thumbnail_path && !thumbnail.exists && image.exists),
    cutoutThumbnailMissing: Boolean(row?.cutout_thumbnail_path && !cutoutThumbnail.exists && cutout.exists),
    cutoutMissing: Boolean(row?.cutout_image_path && !cutout.exists),
    imageMissing: Boolean(row?.image_path && !image.exists)
  };
}

module.exports = {
  imageDisplayUrls,
  mediaFileState
};
