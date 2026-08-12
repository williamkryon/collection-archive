const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const sharp = require("sharp");
const { generateCutoutFiles } = require("../electron/image-cutout-core");
const { imageDisplayUrls } = require("../electron/thumbnail-fallback-core");

function hashFile(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "collection-archive-cutout-"));
  const images = path.join(root, "images");
  const thumbs = path.join(root, "thumbnails");
  fs.mkdirSync(images, { recursive: true });
  fs.mkdirSync(thumbs, { recursive: true });

  const sourcePath = path.join(images, "source.png");
  const outputPath = path.join(images, "source-cutout.png");
  const maskPath = path.join(images, "source-cutout-mask.png");
  const thumbnailPath = path.join(thumbs, "source-cutout.png");
  const objectOutputPath = path.join(images, "source-object-cutout.png");
  const objectMaskPath = path.join(images, "source-object-cutout-mask.png");
  const objectThumbnailPath = path.join(thumbs, "source-object-cutout.png");
  const fixture = Buffer.from(`
    <svg width="480" height="360" viewBox="0 0 480 360" xmlns="http://www.w3.org/2000/svg">
      <rect width="480" height="360" fill="#d9d1bd"/>
      <path d="M240 45 L365 118 L333 285 L240 322 L142 284 L112 118 Z" fill="#174f79"/>
      <circle cx="240" cy="178" r="62" fill="#d6a84b"/>
      <path d="M202 178 L240 112 L278 178 L240 248 Z" fill="#9b3039"/>
    </svg>
  `);
  await sharp(fixture).png().toFile(sourcePath);
  const sourceHash = hashFile(sourcePath);

  try {
    const result = await generateCutoutFiles({
      sourcePath,
      outputPath,
      maskPath,
      thumbnailPath,
      settings: { sensitivity: 52, edgeSoftness: 0.6, maxMaskSide: 900 }
    });

    assert.strictEqual(hashFile(sourcePath), sourceHash, "cutout must not modify the source image");
    assert.ok(fs.statSync(outputPath).size > 0, "transparent derivative should be created");
    assert.ok(fs.statSync(maskPath).size > 0, "standalone mask should be created");
    assert.ok(fs.statSync(thumbnailPath).size > 0, "cutout thumbnail should be created");
    assert.strictEqual(result.width, 480);
    assert.strictEqual(result.height, 360);
    assert.ok(result.removedRatio > 0.45 && result.removedRatio < 0.85, `unexpected removed ratio ${result.removedRatio}`);

    const rendered = await sharp(outputPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const alphaAt = (x, y) => rendered.data[(y * rendered.info.width + x) * rendered.info.channels + 3];
    assert.ok(alphaAt(4, 4) < 10, "connected photo background should be transparent");
    assert.ok(alphaAt(240, 178) > 245, "collectible center should remain opaque");

    const objectResult = await generateCutoutFiles({
      sourcePath,
      outputPath: objectOutputPath,
      maskPath: objectMaskPath,
      thumbnailPath: objectThumbnailPath,
      settings: { method: "object", sensitivity: 55, edgeSoftness: 0.6 }
    });
    assert.strictEqual(objectResult.settings.method, "object", "object method should persist in normalized settings");
    assert.strictEqual(objectResult.width, 480, "object cutout should preserve portrait/landscape mapping width");
    assert.strictEqual(objectResult.height, 360, "object cutout should preserve portrait/landscape mapping height");
    const objectRendered = await sharp(objectOutputPath).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const objectAlphaAt = (x, y) => objectRendered.data[(y * objectRendered.info.width + x) * objectRendered.info.channels + 3];
    assert.ok(objectAlphaAt(4, 4) < 20, "object model should remove the outer background");
    assert.ok(objectAlphaAt(240, 178) > 230, "object model should preserve the subject interior");

    const urls = imageDisplayUrls({
      image_path: sourcePath,
      thumbnail_path: path.join(thumbs, "missing-original-thumb.png"),
      cutout_image_path: outputPath,
      cutout_thumbnail_path: thumbnailPath,
      cutout_enabled: 1
    }, { images, thumbs });
    assert.strictEqual(urls.cutoutEnabled, true);
    assert.ok(urls.url.includes("source-cutout.png"), "active display URL should use cutout derivative");
    assert.ok(urls.thumbnailUrl.includes("source-cutout.png"), "active thumbnail URL should use cutout thumbnail");

    console.log("image cutout test passed", {
      dimensions: `${result.width}x${result.height}`,
      removedPercent: Math.round(result.removedRatio * 100),
      objectRemovedPercent: Math.round(objectResult.removedRatio * 100),
      sourceUnchanged: true
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
