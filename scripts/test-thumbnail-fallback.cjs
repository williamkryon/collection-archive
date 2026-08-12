const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { imageDisplayUrls } = require("../electron/thumbnail-fallback-core");

function ensureDir(folder) {
  fs.mkdirSync(folder, { recursive: true });
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), "collection-thumb-fallback-"));
try {
  const paths = {
    images: path.join(root, "images"),
    thumbs: path.join(root, "thumbnails")
  };
  ensureDir(paths.images);
  ensureDir(paths.thumbs);
  const imagePath = path.join(paths.images, "item-front.jpg");
  const thumbPath = path.join(paths.thumbs, "item-front.png");
  fs.writeFileSync(imagePath, "image-bytes");

  const missingThumb = imageDisplayUrls({
    image_path: imagePath,
    thumbnail_path: thumbPath
  }, paths);
  assert(missingThumb.url.includes("/images/item-front.jpg"), `Full image URL not returned: ${JSON.stringify(missingThumb)}`);
  assert.strictEqual(missingThumb.thumbnailUrl, missingThumb.url, "Missing thumbnail should fall back to original image URL");
  assert.strictEqual(missingThumb.thumbnailMissing, true, "Missing thumbnail should be marked for lazy regeneration");

  fs.writeFileSync(thumbPath, "thumb-bytes");
  const existingThumb = imageDisplayUrls({
    image_path: imagePath,
    thumbnail_path: thumbPath
  }, paths);
  assert(existingThumb.thumbnailUrl.includes("/thumbnails/item-front.png"), `Thumbnail URL not returned: ${JSON.stringify(existingThumb)}`);
  assert.notStrictEqual(existingThumb.thumbnailUrl, existingThumb.url, "Existing thumbnail should be preferred over original image");
  assert.strictEqual(existingThumb.thumbnailMissing, false, "Existing thumbnail should not be marked missing");

  const requestCache = new Map();
  const originalStatSync = fs.statSync;
  let statCalls = 0;
  fs.statSync = (...args) => {
    statCalls += 1;
    return originalStatSync(...args);
  };
  try {
    imageDisplayUrls({ image_path: imagePath, thumbnail_path: thumbPath }, paths, requestCache);
    const firstPassCalls = statCalls;
    imageDisplayUrls({ image_path: imagePath, thumbnail_path: thumbPath }, paths, requestCache);
    assert.strictEqual(firstPassCalls, 2, "First cached lookup should stat the image and thumbnail once each");
    assert.strictEqual(statCalls, firstPassCalls, "Repeated paths in one query should reuse cached file state");
  } finally {
    fs.statSync = originalStatSync;
  }

  fs.rmSync(imagePath);
  const missingImage = imageDisplayUrls({
    image_path: imagePath,
    thumbnail_path: thumbPath
  }, paths);
  assert.strictEqual(missingImage.url, null, "Missing original image should not produce a full image URL");
  assert.strictEqual(missingImage.thumbnailMissing, false, "Missing original image should not enqueue thumbnail regeneration");
  assert.strictEqual(missingImage.imageMissing, true, "Missing original image should be marked");

  console.log("thumbnail fallback tests passed");
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
