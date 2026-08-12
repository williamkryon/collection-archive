const fs = require("fs");
const path = require("path");
const sharp = require("sharp");

const DEFAULT_CUTOUT_SETTINGS = Object.freeze({
  method: "flat",
  sensitivity: 55,
  edgeSoftness: 0.8,
  maxMaskSide: 1800
});

const OBJECT_MODEL_SIZE = 1024;
let objectCutoutSessionPromise = null;
let objectCutoutSessionPath = "";

function clamp(value, minimum, maximum, fallback) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.min(maximum, Math.max(minimum, numeric)) : fallback;
}

function normalizeCutoutSettings(settings = {}) {
  return {
    method: settings.method === "object" ? "object" : "flat",
    sensitivity: clamp(settings.sensitivity, 20, 90, DEFAULT_CUTOUT_SETTINGS.sensitivity),
    edgeSoftness: clamp(settings.edgeSoftness, 0, 4, DEFAULT_CUTOUT_SETTINGS.edgeSoftness),
    maxMaskSide: Math.round(clamp(settings.maxMaskSide, 640, 2600, DEFAULT_CUTOUT_SETTINGS.maxMaskSide))
  };
}

function bundledObjectModelPath() {
  const candidates = [];
  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, "app.asar.unpacked", "electron", "models", "isnet-general-use-q8.onnx"));
    candidates.push(path.join(process.resourcesPath, "electron", "models", "isnet-general-use-q8.onnx"));
  }
  candidates.push(path.join(__dirname, "models", "isnet-general-use-q8.onnx"));
  return candidates.find((candidate) => fs.existsSync(candidate)) || candidates[candidates.length - 1];
}

async function loadObjectCutoutSession(modelPath = bundledObjectModelPath()) {
  const resolvedModelPath = path.resolve(modelPath);
  if (!fs.existsSync(resolvedModelPath)) {
    throw new Error("The local object cutout model is missing");
  }
  if (!objectCutoutSessionPromise || objectCutoutSessionPath !== resolvedModelPath) {
    objectCutoutSessionPath = resolvedModelPath;
    objectCutoutSessionPromise = Promise.resolve().then(async () => {
      // Loaded only for object cutout so ONNX Runtime does not affect normal startup.
      const ort = require("onnxruntime-node");
      const session = await ort.InferenceSession.create(resolvedModelPath, {
        executionProviders: ["cpu"],
        graphOptimizationLevel: "all",
        logSeverityLevel: 3
      });
      return { ort, session };
    }).catch((error) => {
      objectCutoutSessionPromise = null;
      objectCutoutSessionPath = "";
      throw error;
    });
  }
  return objectCutoutSessionPromise;
}

function smoothstep(edge0, edge1, value) {
  const span = Math.max(0.000001, edge1 - edge0);
  const normalized = Math.max(0, Math.min(1, (value - edge0) / span));
  return normalized * normalized * (3 - 2 * normalized);
}

async function objectForegroundMask(sourcePath, settings, modelPath) {
  const { ort, session } = await loadObjectCutoutSession(modelPath);
  const input = await sharp(sourcePath, { failOn: "none" })
    .rotate()
    .removeAlpha()
    .resize(OBJECT_MODEL_SIZE, OBJECT_MODEL_SIZE, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const planeSize = OBJECT_MODEL_SIZE * OBJECT_MODEL_SIZE;
  const tensorData = new Float32Array(planeSize * 3);
  for (let pixel = 0; pixel < planeSize; pixel += 1) {
    const sourceIndex = pixel * input.info.channels;
    for (let channel = 0; channel < 3; channel += 1) {
      tensorData[channel * planeSize + pixel] = input.data[sourceIndex + channel] / 255 - 0.5;
    }
  }

  const results = await session.run({
    [session.inputNames[0]]: new ort.Tensor("float32", tensorData, [1, 3, OBJECT_MODEL_SIZE, OBJECT_MODEL_SIZE])
  });
  const output = results[session.outputNames[0]];
  if (!output?.data || output.data.length < planeSize) {
    throw new Error("The local object cutout model returned an invalid mask");
  }

  let minimum = Number.POSITIVE_INFINITY;
  let maximum = Number.NEGATIVE_INFINITY;
  for (let index = 0; index < planeSize; index += 1) {
    const value = Number(output.data[index]);
    if (value < minimum) minimum = value;
    if (value > maximum) maximum = value;
  }
  const outputIsProbability = minimum >= 0 && maximum <= 1;
  const outputRange = Math.max(0.000001, maximum - minimum);
  if (process.env.ARCHIVE_CUTOUT_DEBUG === "1") {
    console.log("[images:cutout] object model output", {
      type: output.type,
      dimensions: output.dims,
      dataType: output.data?.constructor?.name,
      minimum,
      maximum
    });
  }

  const sensitivityProgress = (settings.sensitivity - 20) / 70;
  const transparentEdge = 0.12 + sensitivityProgress * 0.26;
  const opaqueEdge = 0.68 + sensitivityProgress * 0.22;
  const foreground = Buffer.allocUnsafe(planeSize);
  let alphaTotal = 0;
  for (let index = 0; index < planeSize; index += 1) {
    const value = Number(output.data[index]);
    const probability = outputIsProbability ? value : (value - minimum) / outputRange;
    const alpha = Math.round(smoothstep(transparentEdge, opaqueEdge, probability) * 255);
    foreground[index] = alpha;
    alphaTotal += alpha;
  }

  return {
    foreground,
    width: OBJECT_MODEL_SIZE,
    height: OBJECT_MODEL_SIZE,
    removedRatio: 1 - alphaTotal / (planeSize * 255)
  };
}

function orientedDimensions(metadata = {}) {
  const orientation = Number(metadata.orientation || 1);
  const swap = orientation >= 5 && orientation <= 8;
  return {
    width: Number(swap ? metadata.height : metadata.width) || 0,
    height: Number(swap ? metadata.width : metadata.height) || 0
  };
}

function paletteFromBorder(data, width, height, channels) {
  const bins = new Map();
  const borderDepth = Math.max(1, Math.min(5, Math.round(Math.min(width, height) * 0.004)));
  const stride = Math.max(1, Math.floor(Math.max(width, height) / 1200));

  function sample(x, y) {
    const index = (y * width + x) * channels;
    const alpha = channels > 3 ? data[index + 3] : 255;
    if (alpha < 16) return;
    const r = data[index];
    const g = data[index + 1];
    const b = data[index + 2];
    const key = `${r >> 4}:${g >> 4}:${b >> 4}`;
    const bin = bins.get(key) || { count: 0, r: 0, g: 0, b: 0 };
    bin.count += 1;
    bin.r += r;
    bin.g += g;
    bin.b += b;
    bins.set(key, bin);
  }

  for (let depth = 0; depth < borderDepth; depth += 1) {
    for (let x = 0; x < width; x += stride) {
      sample(x, depth);
      sample(x, height - 1 - depth);
    }
    for (let y = 0; y < height; y += stride) {
      sample(depth, y);
      sample(width - 1 - depth, y);
    }
  }

  const ranked = [...bins.values()].sort((a, b) => b.count - a.count);
  const total = ranked.reduce((sum, bin) => sum + bin.count, 0);
  const minimumCount = Math.max(2, Math.floor(total * 0.008));
  const palette = ranked
    .filter((bin, index) => index === 0 || bin.count >= minimumCount)
    .slice(0, 12)
    .map((bin) => ({
      r: bin.r / bin.count,
      g: bin.g / bin.count,
      b: bin.b / bin.count
    }));

  if (!palette.length) throw new Error("The image border could not be sampled");
  return palette;
}

function connectedBackgroundMask(data, width, height, channels, sensitivity) {
  const palette = paletteFromBorder(data, width, height, channels);
  const threshold = 16 + sensitivity * 0.72;
  const thresholdSquared = threshold * threshold;
  const pixelCount = width * height;
  const state = new Uint8Array(pixelCount);
  const queue = new Int32Array(pixelCount);
  let head = 0;
  let tail = 0;
  let backgroundPixels = 0;

  function matchesBackground(pixelIndex) {
    const dataIndex = pixelIndex * channels;
    if (channels > 3 && data[dataIndex + 3] < 16) return true;
    const r = data[dataIndex];
    const g = data[dataIndex + 1];
    const b = data[dataIndex + 2];
    for (const color of palette) {
      const dr = r - color.r;
      const dg = g - color.g;
      const db = b - color.b;
      if (dr * dr + dg * dg + db * db <= thresholdSquared) return true;
    }
    return false;
  }

  function visit(pixelIndex) {
    if (state[pixelIndex]) return;
    if (!matchesBackground(pixelIndex)) {
      state[pixelIndex] = 2;
      return;
    }
    state[pixelIndex] = 1;
    queue[tail++] = pixelIndex;
    backgroundPixels += 1;
  }

  for (let x = 0; x < width; x += 1) {
    visit(x);
    visit((height - 1) * width + x);
  }
  for (let y = 1; y < height - 1; y += 1) {
    visit(y * width);
    visit(y * width + width - 1);
  }

  while (head < tail) {
    const pixelIndex = queue[head++];
    const x = pixelIndex % width;
    const y = Math.floor(pixelIndex / width);
    if (x > 0) visit(pixelIndex - 1);
    if (x + 1 < width) visit(pixelIndex + 1);
    if (y > 0) visit(pixelIndex - width);
    if (y + 1 < height) visit(pixelIndex + width);
  }

  const foreground = Buffer.allocUnsafe(pixelCount);
  for (let index = 0; index < pixelCount; index += 1) {
    foreground[index] = state[index] === 1 ? 0 : 255;
  }
  return { foreground, removedRatio: backgroundPixels / pixelCount };
}

function temporaryPngPath(finalPath) {
  const parsed = path.parse(finalPath);
  return path.join(parsed.dir, `${parsed.name}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.png`);
}

function replaceGeneratedFile(tempPath, finalPath) {
  fs.mkdirSync(path.dirname(finalPath), { recursive: true });
  if (fs.existsSync(finalPath)) fs.unlinkSync(finalPath);
  fs.renameSync(tempPath, finalPath);
}

async function generateCutoutFiles(options = {}) {
  const sourcePath = path.resolve(String(options.sourcePath || ""));
  const outputPath = path.resolve(String(options.outputPath || ""));
  const maskPath = path.resolve(String(options.maskPath || ""));
  const thumbnailPath = path.resolve(String(options.thumbnailPath || ""));
  const settings = normalizeCutoutSettings(options.settings);

  if (!sourcePath || !fs.existsSync(sourcePath)) throw new Error("Source image file is missing");
  if (!outputPath || !maskPath || !thumbnailPath) throw new Error("Cutout output paths are required");
  if (sourcePath === outputPath || sourcePath === maskPath) throw new Error("Cutout cannot overwrite the original image");

  const metadata = await sharp(sourcePath, { failOn: "none" }).metadata();
  const fullSize = orientedDimensions(metadata);
  if (!fullSize.width || !fullSize.height) throw new Error("Source image dimensions could not be read");

  let mask;
  if (settings.method === "object") {
    mask = await objectForegroundMask(sourcePath, settings, options.modelPath);
  } else {
    const resized = await sharp(sourcePath, { failOn: "none" })
      .rotate()
      .resize({
        width: settings.maxMaskSide,
        height: settings.maxMaskSide,
        fit: "inside",
        withoutEnlargement: true
      })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const connectedMask = connectedBackgroundMask(
      resized.data,
      resized.info.width,
      resized.info.height,
      resized.info.channels,
      settings.sensitivity
    );
    mask = { ...connectedMask, width: resized.info.width, height: resized.info.height };
  }

  if (mask.removedRatio < 0.002) {
    throw new Error("No connected background was found. Try a higher sensitivity or a cleaner background.");
  }
  if (mask.removedRatio > 0.985) {
    throw new Error("The cutout would remove almost the entire image. Try a lower sensitivity.");
  }

  const tempMask = temporaryPngPath(maskPath);
  const tempOutput = temporaryPngPath(outputPath);
  const tempThumbnail = temporaryPngPath(thumbnailPath);
  const tempFiles = [tempMask, tempOutput, tempThumbnail];

  try {
    let maskPipeline = sharp(mask.foreground, {
      raw: { width: mask.width, height: mask.height, channels: 1 }
    }).resize(fullSize.width, fullSize.height, { fit: "fill", kernel: sharp.kernel.lanczos3 });
    if (settings.edgeSoftness >= 0.3) maskPipeline = maskPipeline.blur(settings.edgeSoftness);
    await maskPipeline.png({ compressionLevel: 9 }).toFile(tempMask);

    const alphaMask = await sharp({
      create: {
        width: fullSize.width,
        height: fullSize.height,
        channels: 3,
        background: { r: 255, g: 255, b: 255 }
      }
    })
      .joinChannel(tempMask)
      .png()
      .toBuffer();

    await sharp(sourcePath, { failOn: "none" })
      .rotate()
      .ensureAlpha()
      .composite([{ input: alphaMask, blend: "dest-in" }])
      .png({ compressionLevel: 9 })
      .toFile(tempOutput);

    await sharp(tempOutput, { failOn: "none" })
      .resize({ width: 460, height: 460, fit: "inside", withoutEnlargement: true })
      .png({ compressionLevel: 9 })
      .toFile(tempThumbnail);

    replaceGeneratedFile(tempMask, maskPath);
    replaceGeneratedFile(tempOutput, outputPath);
    replaceGeneratedFile(tempThumbnail, thumbnailPath);
  } catch (error) {
    for (const filePath of tempFiles) {
      try {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      } catch {}
    }
    throw error;
  }

  return {
    width: fullSize.width,
    height: fullSize.height,
    removedRatio: mask.removedRatio,
    settings,
    outputPath,
    maskPath,
    thumbnailPath
  };
}

module.exports = {
  DEFAULT_CUTOUT_SETTINGS,
  bundledObjectModelPath,
  connectedBackgroundMask,
  generateCutoutFiles,
  loadObjectCutoutSession,
  normalizeCutoutSettings,
  objectForegroundMask
};
