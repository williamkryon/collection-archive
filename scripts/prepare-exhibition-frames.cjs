const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const root = path.resolve(__dirname, "..");
const frameDir = path.join(root, "src", "assets", "exhibition", "victorian-cabinet-hall", "frames", "realistic");

const sources = [
  ["ornate-gold-source.png", "ornate-gold-9slice.webp"],
  ["carved-dark-wood-source.png", "carved-dark-wood-9slice.webp"],
  ["black-gallery-source.png", "black-gallery-9slice.webp"],
  ["warm-white-mat-source.png", "warm-white-mat-9slice.webp"]
];

function greenAlpha(red, green, blue, originalAlpha) {
  if (originalAlpha < 8) return 0;
  const greenDominance = green - Math.max(red, blue);
  if (green > 150 && greenDominance > 55) {
    const keyStrength = Math.max(0, Math.min(1, (greenDominance - 55) / 80));
    return Math.round(originalAlpha * (1 - keyStrength));
  }
  return originalAlpha;
}

async function prepare(sourceName, outputName) {
  const sourcePath = path.join(frameDir, sourceName);
  const outputPath = path.join(frameDir, outputName);
  if (!fs.existsSync(sourcePath)) throw new Error(`Missing frame source: ${sourcePath}`);

  const { data, info } = await sharp(sourcePath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  for (let offset = 0; offset < data.length; offset += 4) {
    data[offset + 3] = greenAlpha(data[offset], data[offset + 1], data[offset + 2], data[offset + 3]);
  }

  await sharp(data, { raw: info })
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 }, threshold: 2 })
    .resize(1200, 1200, { fit: "fill", kernel: sharp.kernel.lanczos3 })
    .webp({ quality: 95, alphaQuality: 100, smartSubsample: true })
    .toFile(outputPath);

  const metadata = await sharp(outputPath).metadata();
  return { file: outputName, width: metadata.width, height: metadata.height, bytes: fs.statSync(outputPath).size };
}

(async () => {
  const results = [];
  for (const [source, output] of sources) results.push(await prepare(source, output));
  process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
