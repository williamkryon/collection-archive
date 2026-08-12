const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { createRequire } = require("module");

const requireFromRoot = createRequire(path.join(process.cwd(), "package.json"));
const initSqlJs = requireFromRoot("sql.js");

const root = process.cwd();
const tempRoot = path.join(root, `.tmp-exhibition-smoke-${Date.now()}`);
const appData = path.join(tempRoot, "appdata");
const userData = path.join(tempRoot, "user-data");
const archiveData = path.join(tempRoot, "collection-archive-data");
const exportPath = path.join(tempRoot, "exhibition-segment.png");
const whiteFrameExportPath = path.join(tempRoot, "exhibition-white-mat.png");
const ornateFrameExportPath = path.join(tempRoot, "exhibition-ornate-gold.png");
const port = 10120 + Math.floor(Math.random() * 250);
let activeChild = null;

const pngBytes = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/l7+PfwAAAABJRU5ErkJggg==",
  "base64"
);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runStatement(db, sql, params = []) {
  const statement = db.prepare(sql);
  try {
    statement.bind(params);
    statement.step();
  } finally {
    statement.free();
  }
}

function findFile(folder, filename) {
  if (!fs.existsSync(folder)) return null;
  for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
    const fullPath = path.join(folder, entry.name);
    if (entry.isDirectory()) {
      const nested = findFile(fullPath, filename);
      if (nested) return nested;
    } else if (entry.name === filename) {
      return fullPath;
    }
  }
  return null;
}

async function waitForFile(folder, filename, timeoutMs = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const found = findFile(folder, filename);
    if (found) return found;
    await sleep(100);
  }
  return null;
}

function pngDimensions(filePath) {
  const header = fs.readFileSync(filePath).subarray(0, 24);
  return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
}

function launchElectron(debugPort) {
  const electronExe = path.join(root, "node_modules", "electron", "dist", "electron.exe");
  const child = spawn(electronExe, [`--remote-debugging-port=${debugPort}`, `--user-data-dir=${userData}`, ".", "--disable-gpu"], {
    cwd: root,
    env: {
      ...process.env,
      APPDATA: appData,
      COLLECTION_ARCHIVE_DATA_DIR: archiveData,
      COLLECTION_ARCHIVE_ALLOW_EXPORT_PATH: "1",
      COLLECTION_ARCHIVE_EXHIBITION_EXPORT_PATH: exportPath,
      ELECTRON_ENABLE_LOGGING: "1"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout.on("data", (chunk) => process.stdout.write(`[electron] ${chunk}`));
  child.stderr.on("data", (chunk) => process.stderr.write(`[electron] ${chunk}`));
  activeChild = child;
  return child;
}

async function getWebSocketUrl(debugPort) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json/list`);
      const targets = await response.json();
      const page = targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      await sleep(250);
    }
  }
  throw new Error("Timed out waiting for Electron DevTools target");
}

class CdpClient {
  constructor(wsUrl) {
    this.nextId = 1;
    this.pending = new Map();
    this.runtimeExceptions = [];
    this.opened = new Promise((resolve, reject) => {
      this.socket = new WebSocket(wsUrl);
      this.socket.addEventListener("open", resolve);
      this.socket.addEventListener("error", reject);
      this.socket.addEventListener("close", () => {
        for (const [id, pending] of this.pending) {
          clearTimeout(pending.timeout);
          pending.reject(new Error(`${pending.method} failed: DevTools socket closed`));
          this.pending.delete(id);
        }
      });
      this.socket.addEventListener("message", (event) => {
        const message = JSON.parse(event.data);
        if (message.method === "Runtime.exceptionThrown") {
          this.runtimeExceptions.push(message.params?.exceptionDetails?.exception?.description || message.params?.exceptionDetails?.text || "Runtime exception");
        }
        if (message.id && this.pending.has(message.id)) {
          const pending = this.pending.get(message.id);
          clearTimeout(pending.timeout);
          this.pending.delete(message.id);
          if (message.error) pending.reject(new Error(`${pending.method} failed: ${message.error.message}`));
          else pending.resolve(message.result);
        }
      });
    });
  }

  async send(method, params = {}, timeoutMs = 60000) {
    await this.opened;
    const id = this.nextId++;
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out${params.expression ? `\n${params.expression}` : ""}`));
      }, timeoutMs);
      this.pending.set(id, { resolve, reject, method, timeout });
    });
  }

  close() {
    this.socket.close();
  }
}

async function connect(debugPort) {
  const client = new CdpClient(await getWebSocketUrl(debugPort));
  await client.send("Runtime.enable");
  return client;
}

async function evaluate(client, expression) {
  const result = await client.send("Runtime.evaluate", {
    expression: `(async () => {
      const value = await (${expression});
      return JSON.stringify(value === undefined ? null : value);
    })()`,
    awaitPromise: true,
    returnByValue: true
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Runtime evaluation failed");
  return JSON.parse(result.result.value);
}

async function clickAt(client, x, y) {
  await client.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 });
  await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 });
}

async function dragAt(client, start, end) {
  await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: start.x, y: start.y });
  await client.send("Input.dispatchMouseEvent", { type: "mousePressed", x: start.x, y: start.y, button: "left", clickCount: 1 });
  await client.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: end.x, y: end.y, button: "left" });
  await client.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: end.x, y: end.y, button: "left", clickCount: 1 });
}

async function waitFor(client, expression, message, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate(client, `Boolean(${expression})`)) return;
    await sleep(200);
  }
  const state = await evaluate(client, `(() => ({
    view: document.querySelector('.sidebar nav button.active')?.textContent?.trim() || '',
    title: document.querySelector('.exhibition-more-menu input')?.value || '',
    segment: document.querySelector('.exhibition-segment-nav select')?.value || '',
    placements: document.querySelectorAll('.exhibition-placement').length,
    modal: document.querySelector('.modal[role="dialog"]')?.getAttribute('aria-label') || '',
    bodyText: document.body.innerText.slice(0, 800)
  }))()`);
  throw new Error(`${message}: ${JSON.stringify(state)}`);
}

async function stop(child) {
  if (!child || child.killed || child.exitCode !== null || child.signalCode !== null) return;
  child.kill();
  await new Promise((resolve) => child.once("exit", resolve));
  if (activeChild === child) activeChild = null;
}

async function seedDatabase(dbPath) {
  const SQL = await initSqlJs({ locateFile: (file) => path.join(root, "node_modules", "sql.js", "dist", file) });
  const db = new SQL.Database(fs.readFileSync(dbPath));
  db.exec("PRAGMA foreign_keys = ON;");
  const imagesFolder = path.join(path.dirname(dbPath), "images");
  const thumbnailsFolder = path.join(path.dirname(dbPath), "thumbnails");
  fs.mkdirSync(imagesFolder, { recursive: true });
  fs.mkdirSync(thumbnailsFolder, { recursive: true });
  const now = new Date().toISOString();
  const firstPath = path.join(imagesFolder, "exhibition-front.png");
  const secondPath = path.join(imagesFolder, "exhibition-back.png");
  const firstThumb = path.join(thumbnailsFolder, "exhibition-front.png");
  const secondThumb = path.join(thumbnailsFolder, "exhibition-back.png");
  [firstPath, secondPath, firstThumb, secondThumb].forEach((filePath) => fs.writeFileSync(filePath, pngBytes));
  runStatement(db, "INSERT INTO countries (id, name, sort_key, sort_order, notes, created_at) VALUES (?, ?, ?, ?, ?, ?)", ["country-exhibition", "Exhibition Entity", "Exhibition Entity", 0, "", now]);
  runStatement(db, "INSERT INTO collection_types (id, name, sort_key, sort_order, description, custom_fields_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", ["type-exhibition", "Stamp", "Stamp", 0, "", "{}", now]);
  runStatement(db, "INSERT INTO items (id, title, country_id, type_id, year, description, condition, purchase_price, source, tags_json, custom_fields_json, favorite, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", ["item-exhibition", "Exhibition Smoke Item", "country-exhibition", "type-exhibition", "1912", "A two-image exhibit used by the hall smoke test.", "Fine", "", "Smoke source", "[]", "{}", 0, now, now]);
  runStatement(db, "INSERT INTO images (id, item_id, original_filename, stored_filename, image_path, thumbnail_path, width, height, aspect_ratio, size_bytes, mime_type, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", ["image-exhibition-front", "item-exhibition", "exhibition-front.png", "exhibition-front.png", firstPath, firstThumb, 600, 800, 0.75, pngBytes.length, "image/png", 0, now]);
  runStatement(db, "INSERT INTO images (id, item_id, original_filename, stored_filename, image_path, thumbnail_path, width, height, aspect_ratio, size_bytes, mime_type, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", ["image-exhibition-back", "item-exhibition", "exhibition-back.png", "exhibition-back.png", secondPath, secondThumb, 600, 800, 0.75, pngBytes.length, "image/png", 1, now]);
  fs.writeFileSync(dbPath, Buffer.from(db.export()));
  db.close();
}

async function main() {
  fs.mkdirSync(appData, { recursive: true });

  let child = launchElectron(port);
  let client = await connect(port);
  await waitFor(client, "window.archiveAPI && document.querySelector('.app')", "App did not initialize");
  const dbPath = await waitForFile(archiveData, "archive.sqlite");
  assert(dbPath, "Temporary archive database was not created");
  await stop(child);
  client.close();

  await seedDatabase(dbPath);

  child = launchElectron(port + 1);
  client = await connect(port + 1);
  await waitFor(client, "window.archiveAPI && document.querySelector('.app')", "Seeded app did not render");

  const setup = await evaluate(client, `(async () => {
    const created = await window.archiveAPI.createExhibition({ title: 'Long Hall Smoke', description: 'Curated smoke exhibition' });
    const first = created.exhibition.segments[0];
    await window.archiveAPI.updateExhibitionSegment({
      id: first.id,
      title: 'Entrance Gallery',
      style: { wallColor: '#d5c5a8', wallTexture: 'plain', trimStyle: 'dark-wood', wainscoting: 'panel', floorStyle: 'parquet', ceilingStyle: 'crown', lightingStyle: 'sconces', lightWarmth: 62, lightBrightness: 88, decorationDensity: 'minimal', decorations: [{ type: 'plant-stand', size: 'large', position: 'left', visible: true }] }
    });
    const second = await window.archiveAPI.createExhibitionSegment({
      exhibitionId: created.exhibition.id,
      title: 'Second Gallery',
      style: { wallColor: '#bfc9bd', wallTexture: 'wallpaper', trimStyle: 'white', wainscoting: 'wood', floorStyle: 'herringbone', ceilingStyle: 'coffered', lightingStyle: 'gallery', lightWarmth: 45, lightBrightness: 92 }
    });
    return { exhibitionId: created.exhibition.id, firstSegmentId: first.id, secondSegmentId: second.selectedSegmentId };
  })()`);

  await evaluate(client, "(() => { window.location.reload(); return true; })()");
  await waitFor(client, "document.querySelector('.app') && !document.querySelector('.startup-screen')", "App did not return after reload");
  await evaluate(client, `(() => {
    const standaloneWorkshop = [...document.querySelectorAll('.sidebar nav button')].find((entry) => entry.textContent.trim() === 'Asset Workshop');
    if (standaloneWorkshop) throw new Error('Asset Workshop still appears in main navigation');
    [...document.querySelectorAll('.sidebar nav button')].find((entry) => entry.textContent.trim() === 'Exhibition').click();
    return true;
  })()`);
  await waitFor(client, "document.querySelector('.exhibition-shell')", "Exhibition view did not open before Asset Workshop");
  await evaluate(client, `(() => { [...document.querySelectorAll('.exhibition-list > button')].find((entry) => entry.textContent.includes('Long Hall Smoke')).click(); return true; })()`);
  await waitFor(client, `document.querySelector('[data-exhibition-segment="${setup.firstSegmentId}"]')`, "First hall segment did not load before Asset Workshop");
  await evaluate(client, `(() => { document.querySelector('[data-manage-assets]').click(); return true; })()`);
  await waitFor(client, "document.querySelector('.asset-workshop-modal [data-asset-workshop]')", "Asset Workshop modal did not open from Exhibition");
  await evaluate(client, `(() => {
    [...document.querySelectorAll('.asset-workshop-list button')].find((button) => button.textContent.includes('New asset')).click();
    return true;
  })()`);
  await waitFor(client, "document.querySelector('.exhibition-picker')", "New asset did not open the source picker directly");
  await evaluate(client, `(() => { document.querySelector('.exhibition-picker footer .secondary').click(); return true; })()`);
  await waitFor(client, "!document.querySelector('.exhibition-picker')", "Asset Workshop source picker did not close after direct-new check");
  await evaluate(client, `(() => {
    const input = document.querySelector('.asset-workshop-controls > label input');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, 'Smoke Wallpaper');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    [...document.querySelectorAll('.asset-workshop-controls button')].find((button) => button.textContent.includes('Choose source image')).click();
    return true;
  })()`);
  await waitFor(client, "document.querySelector('.exhibition-picker')", "Asset Workshop source picker did not open");
  await waitFor(client, "[...document.querySelectorAll('.exhibition-picker-list button')].some((button) => button.textContent.includes('Exhibition Smoke Item'))", "Asset Workshop source item did not load");
  await evaluate(client, `(() => {
    [...document.querySelectorAll('.exhibition-picker-list button')].find((button) => button.textContent.includes('Exhibition Smoke Item')).click();
    return true;
  })()`);
  await waitFor(client, "document.querySelector('.exhibition-picker-images [data-image-id=\"image-exhibition-front\"]')", "Asset Workshop source images did not load");
  await evaluate(client, `(() => {
    document.querySelector('.exhibition-picker-images [data-image-id="image-exhibition-front"]').click();
    document.querySelector('.exhibition-picker footer .primary').click();
    return true;
  })()`);
  await waitFor(client, "document.querySelector('.asset-source-name')?.textContent.includes('Exhibition Smoke Item')", "Asset Workshop did not retain the chosen source image");
  await evaluate(client, `(() => {
    [...document.querySelectorAll('.asset-workshop-controls header button')].find((button) => button.textContent.includes('Save asset')).click();
    return true;
  })()`);
  await waitFor(client, "[...document.querySelectorAll('.asset-workshop-list > div > button')].some((button) => button.textContent.includes('Smoke Wallpaper'))", "User wallpaper asset did not save");
  await waitFor(client, "[...document.querySelectorAll('.exhibition-background-controls option')].some((option) => option.textContent.includes('Smoke Wallpaper'))", "New Workshop asset did not appear immediately in Exhibition selectors");
  const workshopAsset = await evaluate(client, `(async () => (await window.archiveAPI.listUserAssets()).find((asset) => asset.name === 'Smoke Wallpaper'))()`);
  assert(workshopAsset?.source_item_id === "item-exhibition" && workshopAsset?.source_image_id === "image-exhibition-front" && workshopAsset?.config?.mode === "tile", `Workshop asset did not preserve its source/configuration: ${JSON.stringify(workshopAsset)}`);
  const workshopPresentationAssets = await evaluate(client, `(async () => {
    const frame = await window.archiveAPI.createUserAsset({
      name: 'Smoke Frame', assetType: 'frame', itemId: 'item-exhibition', imageId: 'image-exhibition-front',
      config: { sliceTop: 18, sliceRight: 17, sliceBottom: 19, sliceLeft: 16, openingInset: 1.2, borderWidth: 1.4 }
    });
    const wainscot = await window.archiveAPI.createUserAsset({
      name: 'Smoke Wainscot', assetType: 'strip', itemId: 'item-exhibition', imageId: 'image-exhibition-back',
      config: { role: 'wainscoting', target: 'wainscoting', cropLeft: 7, cropRight: 9, cropTop: 11, cropBottom: 13, fixedLeft: 14, fixedRight: 18, centerMode: 'repeat' }
    });
    return { frameId: frame.assetId, wainscotId: wainscot.assetId };
  })()`);
  await evaluate(client, "(() => { window.location.reload(); return true; })()");
  await waitFor(client, "document.querySelector('.app') && !document.querySelector('.startup-screen')", "App did not reload for Workshop presentation checks");
  await evaluate(client, `(() => { [...document.querySelectorAll('.sidebar nav button')].find((entry) => entry.textContent.trim() === 'Exhibition').click(); return true; })()`);
  await waitFor(client, "document.querySelector('.exhibition-shell')", "Exhibition did not reopen for Workshop presentation checks");
  await evaluate(client, `(() => { [...document.querySelectorAll('.exhibition-list > button')].find((entry) => entry.textContent.includes('Long Hall Smoke')).click(); return true; })()`);
  await waitFor(client, `document.querySelector('[data-exhibition-segment="${setup.firstSegmentId}"]')`, "Exhibition segment did not reopen before Workshop presentation checks");
  await sleep(350);
  const reopenedWorkshopReturnState = await evaluate(client, `(() => ({ segment: document.querySelector('.exhibition-segment-nav select').value, zoom: document.querySelector('.exhibition-scene-wrap').dataset.zoom }))()`);
  await evaluate(client, `(() => { document.querySelector('[data-manage-assets]').click(); return true; })()`);
  await waitFor(client, "document.querySelector('.asset-workshop-modal [data-asset-workshop]')", "Asset Workshop modal did not reopen");
  await evaluate(client, `(() => { [...document.querySelectorAll('.asset-workshop-list > div > button')].find((button) => button.textContent.includes('Smoke Frame')).click(); return true; })()`);
  await waitFor(client, "document.querySelectorAll('.asset-frame-sample [data-frame-opening=\"transparent\"]').length === 3", "Workshop user frame previews did not expose transparent openings");
  const workshopFrameState = await evaluate(client, `(() => {
    const samples = [...document.querySelectorAll('.asset-frame-sample')];
    const outer = samples[0].querySelector('.exhibition-frame-outer');
    const sourceButton = [...document.querySelectorAll('.asset-workshop-controls button')].find((button) => button.textContent.includes('Choose source image'));
    const frameTypeOption = [...document.querySelectorAll('.asset-workshop-controls option')].find((option) => option.value === 'frame');
    return {
      shapes: samples.map((sample) => sample.dataset.frameShape),
      sizes: samples.map((sample) => sample.dataset.frameSize),
      canonicalSizes: samples.map((sample) => [Number(sample.dataset.canonicalWidth), Number(sample.dataset.canonicalHeight)]),
      thicknesses: samples.map((sample) => {
        const frameOuter = sample.querySelector('.exhibition-frame-outer');
        const border = parseFloat(getComputedStyle(frameOuter).borderTopWidth);
        return { border, ratio: border / Math.min(sample.offsetWidth, sample.offsetHeight) };
      }),
      allSharedLayers: samples.every((sample) => sample.querySelector('.exhibition-frame-recess') && sample.querySelector('.exhibition-frame-mat') && sample.querySelector('.exhibition-frame-image')),
      sampleImage: samples.every((sample) => sample.querySelector('.frame-sample-exhibit')),
      borderImageSlice: getComputedStyle(outer).borderImageSlice,
      outerClass: outer.className,
      sourcePrimary: sourceButton.classList.contains('primary'),
      frameLabel: frameTypeOption?.textContent.trim(),
      hasAdvanced: Boolean(document.querySelector('.asset-advanced-controls summary')),
      hasDefaultHeight: [...document.querySelectorAll('.asset-workshop-controls label')].some((label) => label.textContent.includes('Default height')),
      hasStretchCenter: [...document.querySelectorAll('.asset-workshop-controls option')].some((option) => option.textContent.includes('Stretch'))
    };
  })()`);
  assert(workshopFrameState.shapes.join(',') === 'portrait,square,landscape' && workshopFrameState.sizes.join(',') === 'small,medium,large' && workshopFrameState.allSharedLayers && workshopFrameState.sampleImage, `Workshop frame previews did not cover realistic small/medium/large target geometry with the shared Exhibition renderer: ${JSON.stringify(workshopFrameState)}`);
  assert(workshopFrameState.canonicalSizes.map((size) => size.join('x')).join(',') === '150x200,230x230,360x240', `Workshop frame previews did not use canonical target dimensions: ${JSON.stringify(workshopFrameState)}`);
  assert(workshopFrameState.thicknesses.every((entry) => entry.border > 0 && Math.abs(entry.ratio - workshopFrameState.thicknesses[0].ratio) < 0.012), `User frame thickness was not proportional to each sample's shorter side: ${JSON.stringify(workshopFrameState.thicknesses)}`);
  assert(!workshopFrameState.borderImageSlice.includes('fill') && workshopFrameState.outerClass.includes('user-nine-slice'), `User frame center was still painted over its opening: ${JSON.stringify(workshopFrameState)}`);
  assert(workshopFrameState.sourcePrimary, `Select source image was not styled as a primary action: ${JSON.stringify(workshopFrameState)}`);
  assert(workshopFrameState.frameLabel === 'Frame' && workshopFrameState.hasAdvanced && !workshopFrameState.hasDefaultHeight && !workshopFrameState.hasStretchCenter, `Workshop frame/strip UI was not simplified: ${JSON.stringify(workshopFrameState)}`);
  await evaluate(client, `(() => {
    const top = [...document.querySelectorAll('.asset-workshop-controls input[type="number"]')].find((input) => input.parentElement.textContent.includes('Top guide'));
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(top, '60');
    top.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await waitFor(client, "document.querySelector('.asset-config-warning') && document.querySelector('.asset-workshop-controls header .primary')?.disabled", "Invalid 9-slice guides did not show a warning and block save");
  await evaluate(client, `(() => {
    const actual = [...document.querySelectorAll('.smooth-canvas-controls button')].find((button) => button.textContent.trim() === '100%');
    actual.click();
    const zoomIn = [...document.querySelectorAll('.smooth-canvas-controls button')].find((button) => button.textContent.trim() === '+');
    for (let index = 0; index < 6; index += 1) zoomIn.click();
    return true;
  })()`);
  await waitFor(client, "(() => { const node = document.querySelector('.smooth-canvas-viewport'); return Number(document.querySelector('[data-smooth-canvas]')?.dataset.zoom) > 1 && node && (node.scrollWidth > node.clientWidth || node.scrollHeight > node.clientHeight); })()", "Asset Workshop zoom controls did not create a scrollable preview");
  const workshopPoints = await evaluate(client, `(() => {
    const viewport = document.querySelector('.smooth-canvas-viewport');
    const rect = viewport.getBoundingClientRect();
    return { x: rect.left + rect.width * .5, y: rect.top + rect.height * .5 };
  })()`);
  const zoomedFrameThickness = await evaluate(client, "parseFloat(getComputedStyle(document.querySelector('.asset-frame-sample .exhibition-frame-outer')).borderTopWidth)");
  assert(Math.abs(zoomedFrameThickness - workshopFrameState.thicknesses[0].border) < 0.5, `Workshop editor zoom changed canonical frame geometry: ${JSON.stringify({ before: workshopFrameState.thicknesses[0].border, after: zoomedFrameThickness })}`);
  const panBefore = await evaluate(client, "(() => { const node = document.querySelector('.smooth-canvas-viewport'); node.scrollLeft = 0; node.scrollTop = 0; return { left: node.scrollLeft, top: node.scrollTop, maxLeft: node.scrollWidth - node.clientWidth, maxTop: node.scrollHeight - node.clientHeight }; })()");
  await evaluate(client, `(() => {
    const viewport = document.querySelector('.smooth-canvas-viewport');
    viewport.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button: 0, clientX: ${workshopPoints.x}, clientY: ${workshopPoints.y} }));
    window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: ${workshopPoints.x - 70}, clientY: ${workshopPoints.y - 45} }));
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: ${workshopPoints.x - 70}, clientY: ${workshopPoints.y - 45} }));
    return true;
  })()`);
  const panAfter = await evaluate(client, "(() => { const node = document.querySelector('.smooth-canvas-viewport'); return { left: node.scrollLeft, top: node.scrollTop }; })()");
  assert(panAfter.left !== panBefore.left || panAfter.top !== panBefore.top, `Asset Workshop pan did not move the zoomed viewport: ${JSON.stringify({ panBefore, panAfter })}`);
  await evaluate(client, `(() => { [...document.querySelectorAll('.asset-workshop-list > div > button')].find((button) => button.textContent.includes('Smoke Wainscot')).click(); return true; })()`);
  await waitFor(client, "document.querySelector('.asset-strip-preview .user-asset-strip')?.dataset.stripCrop === '7,9,11,13'", "Saved non-default architectural strip crop did not reach the Workshop renderer");
  const stripCropBefore = await evaluate(client, "getComputedStyle(document.querySelector('.asset-strip-preview .strip-left')).backgroundPosition");
  await evaluate(client, `(() => {
    const input = [...document.querySelectorAll('.asset-workshop-controls input[type="number"]')].find((entry) => entry.parentElement.textContent.trim().startsWith('Left'));
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '19');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  })()`);
  await waitFor(client, "document.querySelector('.asset-strip-preview .user-asset-strip')?.dataset.stripCrop?.startsWith('19,')", "Architectural strip crop did not update immediately in Workshop");
  const stripCropAfter = await evaluate(client, "getComputedStyle(document.querySelector('.asset-strip-preview .strip-left')).backgroundPosition");
  assert(stripCropAfter !== stripCropBefore, `Architectural strip crop did not alter rendered source coordinates: ${JSON.stringify({ stripCropBefore, stripCropAfter })}`);
  await evaluate(client, `(() => { [...document.querySelectorAll('.asset-workshop-list > div > button')].find((button) => button.textContent.includes('Smoke Wallpaper')).click(); return true; })()`);
  await waitFor(client, "document.querySelector('.asset-workshop-controls > label input')?.value === 'Smoke Wallpaper' && document.querySelector('.asset-wall-preview .exhibition-user-wallpaper')", "Saved Workshop asset did not reopen with its preview");
  await evaluate(client, `(() => { document.querySelector('[data-close-asset-workshop]').click(); return true; })()`);
  await waitFor(client, "!document.querySelector('.asset-workshop-modal')", "Asset Workshop modal did not close");
  await waitFor(client, `document.querySelector('[data-exhibition-segment="${setup.firstSegmentId}"]')`, "First hall segment did not load");
  await waitFor(client, "document.querySelector('.exhibition-scene-wrap')?.dataset.layoutReady === 'true'", "Exhibition scene was exposed before its initial Fit layout completed");
  const returnedFromWorkshop = await evaluate(client, `(() => ({ segment: document.querySelector('.exhibition-segment-nav select').value, zoom: document.querySelector('.exhibition-scene-wrap').dataset.zoom }))()`);
  assert(returnedFromWorkshop.segment === reopenedWorkshopReturnState.segment && Number(returnedFromWorkshop.zoom) > 0, `Closing Asset Workshop did not preserve the Exhibition segment or left an invalid zoom: ${JSON.stringify({ reopenedWorkshopReturnState, returnedFromWorkshop })}`);

  const initialState = await evaluate(client, `(() => ({
    segmentCount: document.querySelectorAll('.exhibition-segment-nav option').length,
    wallClass: document.querySelector('.exhibition-hall-scene').className,
    hasInspector: Boolean(document.querySelector('.exhibition-inspector')),
    hasFloorElement: Boolean(document.querySelector('.exhibition-floor')),
    hasFloorControl: Boolean(document.querySelector('.exhibition-inspector option[value="parquet"]')),
    assetPack: document.querySelector('.exhibition-hall-scene')?.dataset.exhibitionAssetPack,
    sceneSize: [document.querySelector('.exhibition-hall-scene')?.dataset.sceneWidth, document.querySelector('.exhibition-hall-scene')?.dataset.sceneHeight],
    assetLayers: ['.exhibition-asset-wall', '.exhibition-asset-crown', '.exhibition-asset-wainscot', '.exhibition-asset-chair-rail', '.exhibition-asset-light-wash'].every((selector) => Boolean(document.querySelector(selector))),
    integratedWallAssembly: document.querySelector('.exhibition-wall-assembly')?.dataset.wallAssembly || '',
    integratedWallParts: ['.exhibition-asset-wall', '.exhibition-asset-crown', '.exhibition-asset-wainscot', '.exhibition-asset-chair-rail', '.exhibition-wall-cohesion'].every((selector) => Boolean(document.querySelector('.exhibition-wall-assembly > ' + selector))),
    removedDecorationLayers: ['.exhibition-asset-sconces', '.exhibition-template-architecture', '.exhibition-section-plaque', '.exhibition-decor-piece', '.exhibition-picture-suspension'].every((selector) => !document.querySelector(selector)),
    paintedWallColor: getComputedStyle(document.querySelector('.exhibition-asset-wall')).backgroundColor,
    hasPlainOption: Boolean(document.querySelector('.exhibition-inspector option[value="plain"]')),
    segmentTemplate: document.querySelector('.exhibition-hall-scene')?.dataset.segmentTemplate,
    templateOptions: [...document.querySelectorAll('.exhibition-template-select option')].map((option) => option.value),
    zoomMode: document.querySelector('.exhibition-scene-wrap')?.dataset.zoomMode,
    overflow: document.body.scrollWidth > document.body.clientWidth,
    globalRailWidth: Math.round(document.querySelector('.sidebar').getBoundingClientRect().width),
    listRailWidth: Math.round(document.querySelector('.exhibition-list').getBoundingClientRect().width),
    hasBackToList: Boolean(document.querySelector('.exhibition-list .back-to-list')),
    inspectorTabs: [...document.querySelectorAll('.exhibition-inspector-tabs button')].map((button) => button.textContent.trim()),
    inspectorCollapseButtons: document.querySelectorAll('.exhibition-toolbar .inspector-toggle').length,
    inspectorHeaderCloseButtons: document.querySelectorAll('.exhibition-inspector-header button[aria-label*="Collapse"]').length,
    rawEscapesVisible: /\\\\u2190|\\\\u00d7/.test(document.body.textContent || ''),
    toolbarText: document.querySelector('.exhibition-toolbar').textContent
  }))()`);
  assert(initialState.segmentCount === 2, `Expected two hall segments: ${JSON.stringify(initialState)}`);
  assert(initialState.wallClass.includes("wall-plain"), `Plain painted wall was not rendered: ${JSON.stringify(initialState)}`);
  assert(initialState.hasPlainOption && initialState.paintedWallColor === "rgb(213, 197, 168)", `Plain wall did not expose the selected wall color: ${JSON.stringify(initialState)}`);
  assert(!initialState.hasFloorElement && !initialState.hasFloorControl && !initialState.wallClass.includes("floor-"), `Legacy floor data was not ignored: ${JSON.stringify(initialState)}`);
  assert(initialState.assetPack === "victorian-cabinet-hall" && initialState.sceneSize.join("x") === "1920x1080", `Victorian asset pack or canonical scene size was missing: ${JSON.stringify(initialState)}`);
  assert(initialState.segmentTemplate === "horizontal" && initialState.templateOptions.join(",") === "horizontal,vertical,square,monumental", `Legacy segment did not fall back to the supported template set: ${JSON.stringify(initialState)}`);
  assert(initialState.assetLayers && initialState.removedDecorationLayers, `Focused wall layers were incomplete or removed decorations still rendered: ${JSON.stringify(initialState)}`);
  assert(initialState.hasInspector, `Edit mode inspector was missing: ${JSON.stringify(initialState)}`);
  assert(!initialState.overflow, `Exhibition view caused horizontal overflow: ${JSON.stringify(initialState)}`);
  assert(initialState.globalRailWidth <= 64 && initialState.listRailWidth <= 72 && initialState.hasBackToList, `Focused Exhibition rails were not compact: ${JSON.stringify(initialState)}`);
  assert(initialState.inspectorTabs.join(',') === 'Wall,Exhibit,Segments,Export', `Context inspector tabs were incomplete: ${JSON.stringify(initialState)}`);
  assert(initialState.inspectorCollapseButtons === 1 && initialState.inspectorHeaderCloseButtons === 0, `Exhibition inspector has duplicate collapse controls: ${JSON.stringify(initialState)}`);
  assert(!initialState.rawEscapesVisible, `Raw escaped Unicode text is visible in Exhibition: ${JSON.stringify(initialState)}`);
  assert(!/Manage assets|Add segment|Delete segment|Export segment|Export scale/.test(initialState.toolbarText), `Low-frequency actions leaked into the Exhibition toolbar: ${JSON.stringify(initialState)}`);
  const expandedRails = await evaluate(client, `(async () => {
    document.querySelector('.sidebar-rail-toggle').click();
    document.querySelector('.exhibition-list .rail-toggle').click();
    await new Promise((resolve) => setTimeout(resolve, 50));
    return {
      global: Math.round(document.querySelector('.sidebar').getBoundingClientRect().width),
      secondary: Math.round(document.querySelector('.exhibition-list').getBoundingClientRect().width),
      globalStored: sessionStorage.getItem('archive.workspaceNavExpanded'),
      secondaryStored: sessionStorage.getItem('archive.exhibitionListExpanded')
    };
  })()`);
  assert(expandedRails.global > initialState.globalRailWidth && expandedRails.secondary > initialState.listRailWidth && expandedRails.globalStored === '1' && expandedRails.secondaryStored === '1', `Exhibition rail expansion did not persist for the session: ${JSON.stringify(expandedRails)}`);
  await evaluate(client, `(() => { document.querySelector('.sidebar-rail-toggle').click(); document.querySelector('.exhibition-list .rail-toggle').click(); return true; })()`);
  await evaluate(client, `(() => {
    const select = [...document.querySelectorAll('.exhibition-background-controls select')].find((entry) => [...entry.options].some((option) => option.textContent.includes('Smoke Wallpaper')));
    const option = [...select.options].find((entry) => entry.textContent.includes('Smoke Wallpaper'));
    select.value = option.value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return option.value;
  })()`);
  await waitFor(client, "document.querySelector('.exhibition-hall-scene')?.classList.contains('wall-user-asset') && document.querySelector('.exhibition-user-wallpaper')", "Workshop wallpaper was not applied to the active Exhibition draft");
  await evaluate(client, `(() => { [...document.querySelectorAll('.exhibition-toolbar-actions button')].find((button) => button.textContent.includes('Save')).click(); return true; })()`);
  await sleep(350);
  const persistedWorkshopWallpaper = await evaluate(client, `(async () => (await window.archiveAPI.getExhibition(${JSON.stringify(setup.exhibitionId)})).segments.find((segment) => segment.id === ${JSON.stringify(setup.firstSegmentId)})?.style?.userWallpaperAssetId)()`);
  assert(persistedWorkshopWallpaper === workshopAsset.id, `Workshop wallpaper selection did not persist on the segment: ${persistedWorkshopWallpaper}`);
  await evaluate(client, `(() => { const select = document.querySelector('.exhibition-inspector select'); const wall = [...document.querySelectorAll('.exhibition-inspector select')].find((entry) => [...entry.options].some((option) => option.value === 'plain')); wall.value = 'plain'; wall.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await waitFor(client, "document.querySelector('.exhibition-hall-scene')?.classList.contains('wall-plain')", "Exhibition did not return to the plain wall after Workshop asset verification");
  await evaluate(client, `(() => {
    const select = [...document.querySelectorAll('.exhibition-lower-wall-controls select')].find((entry) => entry.querySelector('option[value="user:${workshopPresentationAssets.wainscotId}"]'));
    select.value = 'user:${workshopPresentationAssets.wainscotId}';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await waitFor(client, "document.querySelector('.exhibition-asset-wainscot [data-asset-role=\"wainscoting\"]') && Number(document.querySelector('.exhibition-asset-wainscot')?.dataset.userWainscotHeight) >= 29", "User wainscoting did not fill its configured lower-wall height");
  const stripSizing = await evaluate(client, `(() => {
    const strip = document.querySelector('.exhibition-asset-wainscot .user-asset-strip');
    const left = strip?.querySelector('.strip-left');
    const center = strip?.querySelector('.strip-center');
    const container = strip?.getBoundingClientRect();
    const leftRect = left?.getBoundingClientRect();
    const centerStyle = center ? getComputedStyle(center) : null;
    return {
      role: strip?.dataset.assetRole,
      leftWidth: leftRect?.width || 0,
      stripHeight: container?.height || 0,
      leftAspect: getComputedStyle(strip).getPropertyValue('--strip-left-aspect').trim(),
      crop: strip?.dataset.stripCrop,
      tileCount: Number(strip?.dataset.stripTiles || 0),
      centerOverflow: centerStyle?.overflow,
      centerTiles: center?.querySelectorAll('.strip-center-tile').length || 0,
      firstTileSize: center?.querySelector('.strip-center-tile') ? getComputedStyle(center.querySelector('.strip-center-tile')).backgroundSize : ''
    };
  })()`);
  assert(stripSizing.role === 'wainscoting' && stripSizing.crop === '7,9,11,13' && stripSizing.leftWidth > 0 && stripSizing.stripHeight > 0 && stripSizing.leftWidth < stripSizing.stripHeight * 2 && stripSizing.centerOverflow === 'hidden' && stripSizing.tileCount === stripSizing.centerTiles && stripSizing.tileCount > 1 && stripSizing.firstTileSize, `User architectural strip crop/caps/natural repeated center were not rendered intact: ${JSON.stringify(stripSizing)}`);
  await evaluate(client, `(() => {
    const select = [...document.querySelectorAll('.exhibition-inspector select')].find((entry) => ['low','medium','high'].every((value) => entry.querySelector('option[value="' + value + '"]')));
    select.value = 'high';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await waitFor(client, "Number(document.querySelector('.exhibition-asset-wainscot')?.dataset.userWainscotHeight) > 30", "High wainscoting setting did not increase the user asset lower-wall height");
  await evaluate(client, `(() => { const select = document.querySelector('.exhibition-export-controls select'); select.value = '1'; select.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);

  await evaluate(client, `(() => { document.querySelector('[data-canvas-action="actual"]').click(); return true; })()`);
  await waitFor(client, "document.querySelector('.exhibition-scene-wrap')?.dataset.zoomMode === 'actual' && Number(document.querySelector('.exhibition-scene-wrap')?.dataset.zoom) === 1", "Exhibition 100% canvas control did not set one-to-one zoom");
  await evaluate(client, `(() => { document.querySelector('[data-canvas-action="zoom-in"]').click(); return true; })()`);
  await waitFor(client, "Number(document.querySelector('.exhibition-scene-wrap')?.dataset.zoom) > 1", "Exhibition Zoom + did not enlarge the hall canvas");
  await evaluate(client, `(() => { document.querySelector('[data-canvas-action="zoom-out"]').click(); document.querySelector('[data-canvas-action="fit"]').click(); return true; })()`);
  await waitFor(client, "document.querySelector('.exhibition-scene-wrap')?.dataset.zoomMode === 'fit' && Number(document.querySelector('.exhibition-scene-wrap')?.dataset.zoom) < 1", "Exhibition Fit did not restore a stable fitted scale");
  await evaluate(client, `(() => {
    const select = document.querySelector('.exhibition-template-select');
    select.value = 'square';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await waitFor(client, "document.querySelector('.exhibition-hall-scene')?.dataset.segmentTemplate === 'square' && document.querySelector('.exhibition-hall-scene')?.dataset.sceneWidth === '1400' && document.querySelector('.exhibition-hall-scene')?.dataset.sceneHeight === '1400'", "Square segment template did not update canonical geometry");
  await evaluate(client, `(() => { document.querySelector('[data-canvas-action="actual"]').click(); document.querySelector('[data-canvas-action="zoom-in"]').click(); return true; })()`);
  await waitFor(client, "Number(document.querySelector('.exhibition-scene-wrap')?.dataset.zoom) > 1", "Canvas did not zoom for pan verification");
  const panPoints = await evaluate(client, `(() => {
    const viewport = document.querySelector('.exhibition-scene-wrap');
    viewport.scrollLeft = Math.max(80, (viewport.scrollWidth - viewport.clientWidth) / 2);
    viewport.scrollTop = Math.max(80, (viewport.scrollHeight - viewport.clientHeight) / 2);
    const rect = viewport.getBoundingClientRect();
    return { before: { left: viewport.scrollLeft, top: viewport.scrollTop }, start: { x: rect.left + rect.width * .82, y: rect.top + rect.height * .82 }, end: { x: rect.left + rect.width * .68, y: rect.top + rect.height * .68 } };
  })()`);
  await dragAt(client, panPoints.start, panPoints.end);
  const panResult = await evaluate(client, `(() => { const viewport = document.querySelector('.exhibition-scene-wrap'); return { left: viewport.scrollLeft, top: viewport.scrollTop }; })()`);
  assert(Math.abs(panResult.left - panPoints.before.left) > 2 || Math.abs(panResult.top - panPoints.before.top) > 2, `Click-drag panning did not move the zoomed hall canvas: ${JSON.stringify({ panPoints, panResult })}`);
  await waitFor(client, "document.querySelector('.exhibition-scene-wrap')?.dataset.wheelListener === 'ready'", "Exhibition wheel listener was not attached");
  const wheelAnchorBefore = await evaluate(client, `(() => {
    const viewport = document.querySelector('.exhibition-scene-wrap');
    const scene = document.querySelector('.exhibition-hall-scene');
    const rect = viewport.getBoundingClientRect();
    const sceneRect = scene.getBoundingClientRect();
    const clientX = rect.left + rect.width * .62;
    const clientY = rect.top + rect.height * .57;
    const before = Number(viewport.dataset.zoom);
    window.__wheelAnchor = { clientX, clientY, logicalX: (clientX - sceneRect.left) / before, logicalY: (clientY - sceneRect.top) / before };
    viewport.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY: -120, clientX, clientY }));
    return { before, ...window.__wheelAnchor };
  })()`);
  await waitFor(client, `Number(document.querySelector('.exhibition-scene-wrap')?.dataset.zoom) > ${wheelAnchorBefore.before + 0.01}`, "Ctrl + mouse wheel did not zoom the Exhibition canvas");
  await waitFor(client, "document.querySelector('.exhibition-scene-wrap')?.dataset.zoomAnchorApplied === document.querySelector('.exhibition-scene-wrap')?.dataset.zoom", "Cursor-anchor scroll adjustment did not settle after wheel zoom");
  const wheelAnchorAfter = await evaluate(client, `(() => {
    const viewport = document.querySelector('.exhibition-scene-wrap');
    const sceneRect = document.querySelector('.exhibition-hall-scene').getBoundingClientRect();
    const anchor = window.__wheelAnchor;
    const zoom = Number(viewport.dataset.zoom);
    return { zoom, logicalX: (anchor.clientX - sceneRect.left) / zoom, logicalY: (anchor.clientY - sceneRect.top) / zoom };
  })()`);
  assert(Math.abs(wheelAnchorBefore.logicalX - wheelAnchorAfter.logicalX) < 2 && Math.abs(wheelAnchorBefore.logicalY - wheelAnchorAfter.logicalY) < 2, `Wheel zoom did not keep the cursor anchor stable: ${JSON.stringify({ wheelAnchorBefore, wheelAnchorAfter })}`);
  await evaluate(client, `(() => { document.querySelector('[data-canvas-action="fit"]').click(); return true; })()`);

  const wallSystemOptions = await evaluate(client, `(() => {
    const options = [...document.querySelectorAll('.exhibition-inspector option')];
    const values = options.map((option) => option.value);
    const classicalLabels = options
      .filter((option) => ['classical-tuscan','classical-doric','classical-ionic','classical-corinthian','classical-composite'].includes(option.value))
      .map((option) => option.textContent.trim());
    return {
      hasWallSystem: Boolean(document.querySelector('[data-wall-system]')),
      wallSourceCount: ['plain','plaster','linen','wallpaper','collection'].filter((value) => values.includes(value)).length,
      mouldingCount: ['none','simple-white','dark-walnut','carved-mahogany','brass'].filter((value) => values.includes(value)).length,
      wainscotCount: ['none','low-wood','walnut-square','carved-mahogany','green-fabric','burgundy-fabric','white-classical','black-museum'].filter((value) => values.includes(value)).length,
      upperStripCount: ['none','simple-crown','gilded-classical','dark-wood','classical-tuscan','classical-doric','classical-ionic','classical-corinthian','classical-composite'].filter((value) => values.includes(value)).length,
      classicalLabels,
      customWallpaperVisible: options.some((option) => option.textContent.includes('Smoke Wallpaper')),
      customWainscotVisible: options.some((option) => option.value === 'user:${workshopPresentationAssets.wainscotId}'),
      removedOptions: ['arch','gilded-age','upper-left','double-cord','small-plant','tall-palm','wooden-bench'].filter((value) => values.includes(value)),
      duplicateBackgroundButtons: [...document.querySelectorAll('.exhibition-background-controls button')].filter((button) => button.textContent.includes('Choose background from collection')).length
    };
  })()`);
  assert(wallSystemOptions.hasWallSystem && wallSystemOptions.wallSourceCount === 5 && wallSystemOptions.mouldingCount === 5 && wallSystemOptions.wainscotCount === 8 && wallSystemOptions.upperStripCount === 9, `Grouped top/middle/lower wall controls were incomplete: ${JSON.stringify(wallSystemOptions)}`);
  assert(wallSystemOptions.classicalLabels.length === 5 && wallSystemOptions.classicalLabels.every((label) => /entablature/i.test(label) && !/cornice/i.test(label)), `Classical upper-strip labels regressed: ${JSON.stringify(wallSystemOptions.classicalLabels)}`);
  assert(wallSystemOptions.customWallpaperVisible && wallSystemOptions.customWainscotVisible && wallSystemOptions.removedOptions.length === 0 && wallSystemOptions.duplicateBackgroundButtons === 0, `Custom materials or removed legacy controls were wrong: ${JSON.stringify(wallSystemOptions)}`);
  await evaluate(client, `(() => {
    const controls = document.querySelector('.exhibition-upper-strip-controls');
    controls.open = true;
    const select = controls.querySelector('select');
    select.value = 'classical-doric';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    const range = controls.querySelector('input[type="range"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(range, '15');
    range.dispatchEvent(new Event('input', { bubbles: true }));
    range.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await waitFor(client, "document.querySelector('.exhibition-hall-scene')?.classList.contains('ceiling-classical-doric') && document.querySelector('.exhibition-hall-scene')?.style.getPropertyValue('--upper-trim-height') === '15%'", "Adjustable upper strip did not update the active scene");

  const inspectorScroll = await evaluate(client, `(() => {
    const inspector = document.querySelector('.exhibition-inspector-scroll');
    document.querySelector('.exhibition-ambient-light-controls').open = true;
    const brightness = document.querySelector('.exhibition-brightness-control');
    brightness.scrollIntoView({ block: 'end' });
    const inspectorRect = inspector.getBoundingClientRect();
    const brightnessRect = brightness.getBoundingClientRect();
    return {
      clientHeight: inspector.clientHeight,
      scrollHeight: inspector.scrollHeight,
      scrollTop: inspector.scrollTop,
      brightnessReachable: brightnessRect.top >= inspectorRect.top && brightnessRect.bottom <= inspectorRect.bottom + 1
    };
  })()`);
  assert(inspectorScroll.brightnessReachable, `Lighting brightness could not be reached in the inspector: ${JSON.stringify(inspectorScroll)}`);

  await evaluate(client, `(() => {
    const color = document.querySelector('.exhibition-inspector input[type="color"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(color, '#76523a');
    color.dispatchEvent(new Event('input', { bubbles: true }));
    color.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await waitFor(client, "document.querySelector('.exhibition-hall-scene')?.style.getPropertyValue('--hall-wall') === '#76523a'", "First segment draft color did not update");
  for (let cycle = 0; cycle < 3; cycle += 1) {
    await evaluate(client, `(() => { document.querySelector('button[aria-label="Next segment"]').click(); return true; })()`);
    await waitFor(client, `document.querySelector('[data-exhibition-segment="${setup.secondSegmentId}"]') && document.querySelector('.exhibition-hall-scene').style.getPropertyValue('--hall-wall') === '#bfc9bd'`, `Second segment leaked first style on cycle ${cycle + 1}`);
    const secondClass = await evaluate(client, "(() => document.querySelector('.exhibition-hall-scene').className)()");
    assert(secondClass.includes("wall-wallpaper") && secondClass.includes("trim-simple-white"), `Second segment style changed on cycle ${cycle + 1}: ${secondClass}`);
    await evaluate(client, `(() => { document.querySelector('button[aria-label="Previous segment"]').click(); return true; })()`);
    await waitFor(client, `document.querySelector('[data-exhibition-segment="${setup.firstSegmentId}"]') && document.querySelector('.exhibition-hall-scene').style.getPropertyValue('--hall-wall') === '#76523a'`, `First segment leaked second style on cycle ${cycle + 1}`);
  }

  await evaluate(client, `(() => {
    const select = [...document.querySelectorAll('.exhibition-inspector select')].find((entry) => entry.querySelector('option[value="collection"]'));
    select.value = 'collection';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await waitFor(client, "document.querySelector('.exhibition-picker')?.textContent.includes('Choose background from collection')", "Collection background picker did not open");
  await waitFor(client, "[...document.querySelectorAll('.exhibition-picker-list button')].some((button) => button.textContent.includes('Exhibition Smoke Item'))", "Background item did not appear in picker");
  await evaluate(client, `(() => {
    [...document.querySelectorAll('.exhibition-picker-list button')].find((button) => button.textContent.includes('Exhibition Smoke Item')).click();
    return true;
  })()`);
  await waitFor(client, "document.querySelectorAll('.exhibition-picker-images button').length === 2", "Background item images did not load");
  await evaluate(client, `(() => {
    document.querySelector('.exhibition-picker-images button[data-image-id="image-exhibition-back"]').click();
    return true;
  })()`);
  await waitFor(client, "document.querySelector('.exhibition-picker-images button[data-image-id=\"image-exhibition-back\"]')?.classList.contains('active')", "Exact background image was not selected");
  await evaluate(client, "(() => { document.querySelector('.exhibition-picker footer .primary').click(); return true; })()");
  await waitFor(client, "document.querySelector('.exhibition-custom-wallpaper.wallpaper-tile') && document.querySelector('.exhibition-wallpaper-preload')?.src.includes('exhibition-back.png') && document.querySelector('.exhibition-hall-scene')?.classList.contains('trim-dark-walnut') && document.querySelector('.exhibition-hall-scene')?.classList.contains('ceiling-classical-doric') && !document.querySelector('.exhibition-decor-piece')", "Selected collection image did not render while preserving the other wall layers");
  const inspectMaterialSet = async (controlSelector, values, selector, classPrefix) => {
    const results = [];
    for (const value of values) {
      await evaluate(client, `(() => {
        const select = document.querySelector('${controlSelector}');
        select.value = '${value}';
        select.dispatchEvent(new Event('change', { bubbles: true }));
        return true;
      })()`);
      await waitFor(client, `document.querySelector('.exhibition-hall-scene')?.classList.contains('${classPrefix}${value}') && document.querySelector('${selector}')`, `${value} material did not render`);
      results.push(await evaluate(client, `(() => {
        const style = getComputedStyle(document.querySelector('${selector}'));
        return { value: '${value}', opacity: style.opacity, backgroundColor: style.backgroundColor, mixBlendMode: style.mixBlendMode, filter: style.filter };
      })()`));
    }
    return results;
  };
  const materialOpacity = {
    wainscoting: await inspectMaterialSet('[data-wainscoting-style]', ['low-wood','walnut-square','carved-mahogany','green-fabric','burgundy-fabric','white-classical','black-museum'], '.exhibition-asset-wainscot', 'wainscot-'),
    rails: await inspectMaterialSet('[data-wall-moulding-style]', ['simple-white','dark-walnut','carved-mahogany','brass'], '.exhibition-asset-chair-rail', 'trim-'),
    upperStrips: await inspectMaterialSet('[data-upper-strip-style]', ['simple-crown','gilded-classical','dark-wood','classical-tuscan','classical-doric','classical-ionic','classical-corinthian','classical-composite'], '.exhibition-asset-crown', 'ceiling-')
  };
  for (const [controlSelector, value, classPrefix] of [['[data-wainscoting-style]', 'burgundy-fabric', 'wainscot-'], ['[data-wall-moulding-style]', 'dark-walnut', 'trim-'], ['[data-upper-strip-style]', 'simple-crown', 'ceiling-']]) {
    await evaluate(client, `(() => { const select = document.querySelector('${controlSelector}'); select.value = '${value}'; select.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    await waitFor(client, `document.querySelector('.exhibition-hall-scene')?.classList.contains('${classPrefix}${value}')`, `${value} material did not settle`);
  }
  const materialFailures = [...materialOpacity.wainscoting, ...materialOpacity.rails, ...materialOpacity.upperStrips].filter((entry) => entry.opacity !== '1' || entry.backgroundColor === 'rgba(0, 0, 0, 0)' || entry.backgroundColor === 'transparent' || entry.mixBlendMode !== 'normal' || entry.filter.includes('opacity'));
  assert(materialFailures.length === 0, `Architectural material allowed wallpaper bleed-through: ${JSON.stringify(materialFailures)}`);
  const classicalEntablatureAssets = [];
  for (const value of ['classical-tuscan', 'classical-doric', 'classical-ionic', 'classical-corinthian', 'classical-composite']) {
    await evaluate(client, `(() => { const select = document.querySelector('[data-upper-strip-style]'); select.value = '${value}'; select.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    await waitFor(client, `document.querySelector('.classical-entablature')?.dataset.classicalEntablature === '${value.replace('classical-', '')}'`, `${value} did not render its classical entablature asset`);
    const structure = await evaluate(client, `(() => {
      const crown = document.querySelector('.exhibition-asset-crown');
      const profile = crown.querySelector('.classical-entablature');
      const computed = getComputedStyle(profile);
      return {
        renderer: profile.dataset.entablatureRenderer,
        parts: profile.dataset.entablatureParts,
        assetGeneration: profile.dataset.assetGeneration,
        backgroundImage: computed.backgroundImage,
        backgroundRepeat: computed.backgroundRepeat,
        backgroundSize: computed.backgroundSize,
        heightRatio: crown.getBoundingClientRect().height / document.querySelector('.exhibition-hall-scene').getBoundingClientRect().height,
        hasDepthShadow: getComputedStyle(crown).filter.includes('drop-shadow') && computed.filter.includes('drop-shadow'),
        preloadedAssetCount: [...document.querySelectorAll('.exhibition-export-asset-preloads img')].filter((image) => image.src.includes('entablature') && image.complete && image.naturalWidth > 0).length
      };
    })()`);
    assert(structure.renderer === 'architectural-texture' && structure.parts === 'cornice frieze architrave' && structure.assetGeneration === 'continuous-v3' && structure.backgroundImage.includes('entablature') && structure.backgroundRepeat === 'repeat-x' && structure.backgroundSize === 'auto 100%' && structure.heightRatio >= 0.13 && structure.hasDepthShadow && structure.preloadedAssetCount > 0, `${value} entablature asset rendering was incorrect: ${JSON.stringify(structure)}`);
    classicalEntablatureAssets.push(structure.backgroundImage);
  }
  assert(new Set(classicalEntablatureAssets).size === 5, `Classical orders did not use five distinct entablature assets: ${classicalEntablatureAssets.length}`);
  await evaluate(client, `(() => { const select = document.querySelector('[data-upper-strip-style]'); select.value = 'simple-crown'; select.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await waitFor(client, "document.querySelector('.exhibition-hall-scene')?.classList.contains('ceiling-simple-crown')", "Continuous built-in architecture did not settle");
  const architectureContinuity = await evaluate(client, `(() => {
    const read = (selector) => {
      const element = document.querySelector(selector);
      const style = getComputedStyle(element);
      return {
        mode: element.dataset.architectureContinuity,
        backgroundRepeat: style.backgroundRepeat,
        backgroundSize: style.backgroundSize,
        backgroundPosition: style.backgroundPosition
      };
    };
    return {
      upper: read('.exhibition-asset-crown'),
      rail: read('.exhibition-asset-chair-rail'),
      wainscot: read('.exhibition-asset-wainscot')
    };
  })()`);
  assert(architectureContinuity.upper.mode === 'seamless-modules' && architectureContinuity.upper.backgroundRepeat === 'repeat-x' && architectureContinuity.upper.backgroundSize === 'auto 100%', `Built-in upper strip did not use its seamless architectural module: ${JSON.stringify(architectureContinuity)}`);
  assert(architectureContinuity.rail.mode === 'seamless-modules' && architectureContinuity.rail.backgroundRepeat === 'repeat-x' && architectureContinuity.rail.backgroundSize === 'auto 100%', `Built-in wall moulding did not use its seamless architectural module: ${JSON.stringify(architectureContinuity)}`);
  assert(architectureContinuity.wainscot.mode === 'complete-panels' && architectureContinuity.wainscot.backgroundRepeat.includes('round') && architectureContinuity.wainscot.backgroundSize === 'auto 100%', `Built-in wainscoting did not finish on complete panel modules: ${JSON.stringify(architectureContinuity)}`);
  assert(initialState.integratedWallAssembly === 'integrated-v1' && initialState.integratedWallParts, `Upper strip, wall surface, moulding, and wainscoting were not rendered as one integrated wall assembly: ${JSON.stringify(initialState)}`);
  const wallCohesion = await evaluate(client, `(() => {
    const layer = document.querySelector('.exhibition-wall-cohesion');
    const crown = document.querySelector('.exhibition-asset-crown');
    const wainscot = document.querySelector('.exhibition-asset-wainscot');
    return {
      lighting: layer?.dataset.wallLighting || '',
      overlay: getComputedStyle(layer).backgroundImage,
      upperTransition: getComputedStyle(crown, '::before').backgroundImage,
      lowerTransitionHeight: getComputedStyle(wainscot, '::before').height
    };
  })()`);
  assert(wallCohesion.lighting === 'shared' && wallCohesion.overlay !== 'none' && wallCohesion.upperTransition !== 'none' && parseFloat(wallCohesion.lowerTransitionHeight) > 0, `Integrated wall transitions were missing: ${JSON.stringify(wallCohesion)}`);
  await waitFor(client, "document.querySelector('.exhibition-hall-scene')?.classList.contains('ceiling-simple-crown')", "Cornice test did not restore the restrained hall style");
  await evaluate(client, `(() => {
    const scale = document.querySelector('.exhibition-tile-controls input[type="range"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(scale, '55');
    scale.dispatchEvent(new Event('input', { bubbles: true }));
    scale.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await waitFor(client, "document.querySelector('.exhibition-hall-scene')?.style.getPropertyValue('--wallpaper-scale') === '55%'", "Tile pattern scale did not update the hall preview");
  await evaluate(client, `(() => {
    [...document.querySelectorAll('.exhibition-toolbar-actions button')].find((button) => button.textContent.includes('Save')).click();
    return true;
  })()`);
  await waitFor(client, "document.querySelector('.exhibition-custom-wallpaper.wallpaper-tile')", "Custom wallpaper disappeared after saving the segment");

  await evaluate(client, `(() => {
    const add = [...document.querySelectorAll('.exhibition-toolbar button')].find((button) => button.textContent.includes('Add exhibit'));
    add.click();
    return true;
  })()`);
  await waitFor(client, "document.querySelector('.exhibition-picker input')", "Exhibit picker did not open");
  await waitFor(client, "[...document.querySelectorAll('.exhibition-picker-list button')].some((button) => button.textContent.includes('Exhibition Smoke Item'))", "Seed item did not appear in picker");
  await evaluate(client, `(() => {
    const item = [...document.querySelectorAll('.exhibition-picker-list button')].find((button) => button.textContent.includes('Exhibition Smoke Item'));
    item.click();
    return true;
  })()`);
  await waitFor(client, "document.querySelectorAll('.exhibition-picker-images button').length === 2", "Item images did not load in picker");
  await evaluate(client, `(() => {
    const images = [...document.querySelectorAll('.exhibition-picker-images button')];
    images[1].click();
    return true;
  })()`);
  await waitFor(client, "document.querySelectorAll('.exhibition-picker-images button')[1]?.classList.contains('active')", "Second item image was not selected");
  await evaluate(client, "(() => { document.querySelector('.exhibition-picker footer .primary').click(); return true; })()");
  await waitFor(client, "document.querySelectorAll('.exhibition-placement').length === 1 && document.querySelector('.exhibition-inspector select option[value=" + JSON.stringify("ornate-gold") + "]')", "Exhibit was not added and selected");
  const exhibitPresentation = await evaluate(client, `(() => ({
    captionClass: document.querySelector('.exhibition-wall-label')?.className || '',
    frameStyle: document.querySelector('.exhibition-placement')?.dataset.frameStyle || '',
    decorCount: document.querySelectorAll('.exhibition-decor-piece').length,
    oldLayerCount: document.querySelectorAll('.exhibition-section-plaque, .exhibition-picture-suspension, .exhibition-asset-sconces').length
  }))()`);
  assert(exhibitPresentation.captionClass.includes('caption-white-museum') && exhibitPresentation.captionClass.includes('caption-position-below'), `Caption did not use the focused below-exhibit presentation: ${JSON.stringify(exhibitPresentation)}`);
  assert(exhibitPresentation.decorCount === 0 && exhibitPresentation.oldLayerCount === 0, `Removed hall decoration layers returned behind the exhibit: ${JSON.stringify(exhibitPresentation)}`);

  const sceneEmptyPoint = await evaluate(client, `(() => {
    const rect = document.querySelector('.exhibition-hall-scene').getBoundingClientRect();
    return { x: rect.left + rect.width * 0.9, y: rect.top + rect.height * 0.72 };
  })()`);
  await clickAt(client, sceneEmptyPoint.x, sceneEmptyPoint.y);
  await waitFor(client, "!document.querySelector('.exhibition-placement.selected')", "Clicking empty wall did not clear exhibit selection");
  await evaluate(client, `(() => {
    const select = document.querySelector('.exhibition-template-select');
    select.value = 'horizontal';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await waitFor(client, "document.querySelector('.exhibition-hall-scene')?.dataset.segmentTemplate === 'horizontal' && document.querySelectorAll('.exhibition-placement').length === 1", "Existing exhibit did not survive the Horizontal template");
  await evaluate(client, `(() => {
    const select = document.querySelector('.exhibition-template-select');
    select.value = 'square';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await waitFor(client, "document.querySelector('.exhibition-hall-scene')?.dataset.segmentTemplate === 'square' && document.querySelectorAll('.exhibition-placement').length === 1", "Existing exhibit did not survive returning to the Square template");
  const placementHit = await evaluate(client, `(() => {
    const placement = document.querySelector('.exhibition-placement');
    const rect = placement.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const hit = document.elementFromPoint(x, y);
    return { x, y, hitClass: hit?.className || '', placementReceivesPointer: hit === placement || placement.contains(hit) };
  })()`);
  assert(placementHit.placementReceivesPointer, `Hall overlays blocked exhibit pointer events: ${JSON.stringify(placementHit)}`);
  await clickAt(client, placementHit.x, placementHit.y);
  await waitFor(client, "document.querySelector('.exhibition-placement')?.classList.contains('selected') && document.querySelector('[data-exhibit-controls]')", "Real pointer click did not select the exhibit");
  const selectedBeforeWorkshop = await evaluate(client, `(() => ({ placement: document.querySelector('.exhibition-placement.selected')?.dataset.exhibitionPlacement, segment: document.querySelector('.exhibition-segment-nav select').value, zoom: document.querySelector('.exhibition-scene-wrap').dataset.zoom }))()`);
  await evaluate(client, `(() => { document.querySelector('[data-manage-assets]').click(); return true; })()`);
  await waitFor(client, "document.querySelector('.asset-workshop-modal [data-asset-workshop]')", "Asset Workshop modal did not open with a selected exhibit");
  await evaluate(client, `(() => { document.querySelector('[data-close-asset-workshop]').click(); return true; })()`);
  await waitFor(client, "!document.querySelector('.asset-workshop-modal')", "Asset Workshop modal did not close with a selected exhibit");
  const selectedAfterWorkshop = await evaluate(client, `(() => ({ placement: document.querySelector('.exhibition-placement.selected')?.dataset.exhibitionPlacement, segment: document.querySelector('.exhibition-segment-nav select').value, zoom: document.querySelector('.exhibition-scene-wrap').dataset.zoom }))()`);
  assert(JSON.stringify(selectedAfterWorkshop) === JSON.stringify(selectedBeforeWorkshop), `Asset Workshop modal did not preserve selected exhibit/segment/zoom: ${JSON.stringify({ selectedBeforeWorkshop, selectedAfterWorkshop })}`);

  await evaluate(client, `(() => {
    const select = [...document.querySelectorAll('.exhibition-frame-controls select')].find((entry) => entry.querySelector('option[value="user:${workshopPresentationAssets.frameId}"]'));
    select.value = 'user:${workshopPresentationAssets.frameId}';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await waitFor(client, `document.querySelector('.exhibition-placement')?.dataset.frameStyle === 'user:${workshopPresentationAssets.frameId}' && document.querySelector('.exhibition-placement [data-frame-opening="transparent"]')`, "Exhibition did not use the shared transparent user-frame renderer");
  const exhibitionUserFrame = await evaluate(client, `(() => {
    const outer = document.querySelector('.exhibition-placement .exhibition-frame-outer');
    const placement = document.querySelector('.exhibition-placement');
    const originalWidth = placement.style.width;
    const originalHeight = placement.style.height;
    placement.style.width = '230px';
    placement.style.height = '230px';
    const style = getComputedStyle(outer);
    const result = {
      className: outer.className,
      borderImageSlice: style.borderImageSlice,
      border: parseFloat(style.borderTopWidth),
      ratio: parseFloat(style.borderTopWidth) / Math.min(placement.offsetWidth, placement.offsetHeight),
      thickness: placement.querySelector('.exhibition-art-mat').dataset.frameThickness
    };
    placement.style.width = originalWidth;
    placement.style.height = originalHeight;
    return result;
  })()`);
  assert(exhibitionUserFrame.className.includes('user-nine-slice') && !exhibitionUserFrame.borderImageSlice.includes('fill'), `Exhibition user frame painted its source center: ${JSON.stringify(exhibitionUserFrame)}`);
  assert(Math.abs(exhibitionUserFrame.border - workshopFrameState.thicknesses[1].border) < 0.75 && Math.abs(exhibitionUserFrame.ratio - workshopFrameState.thicknesses[1].ratio) < 0.008, `Equal canonical Workshop/Exhibition frame geometry diverged: ${JSON.stringify({ workshop: workshopFrameState.thicknesses[1], exhibition: exhibitionUserFrame })}`);

  const builtInFrameDefaults = { 'black-gallery': 5.5, 'dark-wood': 7, 'white-mat': 4.5, 'ornate-gold': 8.5 };
  for (const [frameStyle, expectedThickness] of Object.entries(builtInFrameDefaults)) {
    await evaluate(client, `(() => { const select = document.querySelector('.exhibition-inspector option[value="${frameStyle}"]').parentElement; select.value = '${frameStyle}'; select.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    await waitFor(client, `document.querySelector('.exhibition-placement')?.dataset.frameStyle === '${frameStyle}'`, `Built-in frame ${frameStyle} did not render`);
    const builtInState = await evaluate(client, `(() => { const placement = document.querySelector('.exhibition-placement'); const mat = placement.querySelector('.exhibition-art-mat'); const outer = placement.querySelector('.exhibition-frame-outer'); const border = parseFloat(getComputedStyle(outer).borderTopWidth); return { thickness: Number(mat.dataset.frameThickness), ratio: border / Math.min(placement.offsetWidth, placement.offsetHeight), generation: mat.dataset.frameGeneration, image: getComputedStyle(outer).borderImageSource }; })()`);
    assert(Math.abs(builtInState.thickness - expectedThickness) < .05 && Math.abs(builtInState.ratio - expectedThickness / 100) < .012 && builtInState.generation === 'realistic-v2' && builtInState.image.includes('.webp'), `Built-in frame ${frameStyle} lost its intended realistic presentation: ${JSON.stringify(builtInState)}`);
  }
  await evaluate(client, `(() => { const select = document.querySelector('.exhibition-inspector select[data-frame-style]'); select.value = 'none'; select.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await waitFor(client, "document.querySelector('.exhibition-art-mat.frame-none') && getComputedStyle(document.querySelector('.exhibition-art-mat.frame-none .exhibition-frame-outer')).display === 'none' && getComputedStyle(document.querySelector('.exhibition-art-mat.frame-none .exhibition-frame-wall-shadow')).display === 'none' && getComputedStyle(document.querySelector('.exhibition-art-mat.frame-none .exhibition-frame-image')).backgroundColor === 'rgba(0, 0, 0, 0)' && !document.querySelector('[data-placement-frame-thickness]')", "No-frame exhibit option left a presentation layer or gray backing visible");
  await evaluate(client, `(() => { const select = document.querySelector('.exhibition-inspector select[data-frame-style]'); select.value = 'white-mat'; select.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await waitFor(client, "document.querySelector('[data-placement-frame-thickness]')", "Frame controls did not return after leaving the no-frame option");

  await evaluate(client, `(() => { const select = document.querySelector('[data-display-support-control]'); select.value = 'walnut-wall-shelf'; select.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await waitFor(client, "document.querySelector('.exhibition-placement[data-support-style=\"walnut-wall-shelf\"] .exhibition-display-support img')", "Walnut display furniture did not render with the selected exhibit");
  await evaluate(client, `(() => { const select = document.querySelector('[data-support-scale-control]'); select.value = 'large'; select.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await sleep(500);
  const displaySupportState = await evaluate(client, `(() => ({
    control: document.querySelector('[data-support-scale-control]')?.value || '',
    placement: document.querySelector('.exhibition-placement')?.dataset.supportStyle || '',
    rendered: Number(document.querySelector('.exhibition-display-support')?.dataset.supportScale || 0),
    source: document.querySelector('.exhibition-display-support img')?.getAttribute('src') || ''
  }))()`);
  assert(displaySupportState.control === "large" && displaySupportState.placement === "walnut-wall-shelf" && Math.abs(displaySupportState.rendered - 1.22) < .01 && displaySupportState.source.includes("walnut-wall-shelf"), `Display furniture size did not update: ${JSON.stringify(displaySupportState)}`);
  await evaluate(client, `(() => { const button = document.querySelector('.exhibition-nudge-pad .nudge-down'); button.click(); button.click(); return true; })()`);
  await waitFor(client, "document.querySelector('.exhibition-object-layer')?.dataset.exhibitOffset === '0,4'", "Exhibit-only nudge did not move the exhibit layer independently");
  const furnitureNudgeState = await evaluate(client, `(() => ({ objectTransform: getComputedStyle(document.querySelector('.exhibition-object-layer')).transform, supportTransform: getComputedStyle(document.querySelector('.exhibition-display-support')).transform }))()`);
  assert(furnitureNudgeState.objectTransform !== 'none' && furnitureNudgeState.supportTransform.includes('matrix'), `Exhibit/furniture transform layers were not independent: ${JSON.stringify(furnitureNudgeState)}`);

  for (const [size, expectedThickness] of Object.entries({ small: 4.5, medium: 7, large: 10.5 })) {
    await evaluate(client, `(() => { const select = document.querySelector('[data-placement-frame-thickness]'); select.value = '${size}'; select.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    await waitFor(client, `document.querySelector('[data-placement-frame-thickness]')?.value === '${size}' && Math.abs(Number(document.querySelector('.exhibition-art-mat')?.dataset.frameThickness) - ${expectedThickness}) < .05`, `Frame thickness ${size} did not apply`);
    const thicknessState = await evaluate(client, `(() => { const placement = document.querySelector('.exhibition-placement'); const border = parseFloat(getComputedStyle(placement.querySelector('.exhibition-frame-outer')).borderTopWidth); return border / Math.min(placement.offsetWidth, placement.offsetHeight); })()`);
    assert(Math.abs(thicknessState - expectedThickness / 100) < .012, `Frame thickness ${size} was not proportional: ${thicknessState}`);
  }
  const resizedThicknessRatios = await evaluate(client, `(() => {
    const placement = document.querySelector('.exhibition-placement');
    const outer = placement.querySelector('.exhibition-frame-outer');
    const originalWidth = placement.style.width;
    const originalHeight = placement.style.height;
    placement.style.width = '180px'; placement.style.height = '240px';
    const small = parseFloat(getComputedStyle(outer).borderTopWidth) / 180;
    placement.style.width = '360px'; placement.style.height = '480px';
    const large = parseFloat(getComputedStyle(outer).borderTopWidth) / 360;
    placement.style.width = originalWidth;
    placement.style.height = originalHeight;
    return { small, large };
  })()`);
  assert(Math.abs(resizedThicknessRatios.small - resizedThicknessRatios.large) < .01, `Placement resize changed proportional frame thickness: ${JSON.stringify(resizedThicknessRatios)}`);

  for (const [size, expectedPixels] of Object.entries({ small: 14, medium: 18, large: 24 })) {
    await evaluate(client, `(() => { const select = document.querySelector('[data-caption-size]'); select.value = '${size}'; select.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
    await waitFor(client, `document.querySelector('[data-caption-size]')?.value === '${size}' && document.querySelector('.exhibition-wall-label')?.classList.contains('caption-size-${size}')`, `Caption size ${size} did not apply`);
    const captionPixels = await evaluate(client, "parseFloat(getComputedStyle(document.querySelector('.exhibition-wall-label')).fontSize)");
    assert(Math.abs(captionPixels - expectedPixels) < .6, `Caption size ${size} was not readable at its canonical default: ${captionPixels}`);
  }

  await evaluate(client, `(() => {
    const frameSelect = document.querySelector('.exhibition-inspector option[value="white-mat"]').parentElement;
    frameSelect.value = 'white-mat';
    frameSelect.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await waitFor(client, "document.querySelector('.exhibition-placement')?.classList.contains('exhibition-frame-white-mat')", "White mat frame selection did not update the exhibit");
  const frameState = await evaluate(client, `(() => {
    const placement = document.querySelector('.exhibition-placement');
    const outer = document.querySelector('.exhibition-frame-outer');
    const style = getComputedStyle(outer);
    const clone = placement.cloneNode(true);
    const cloneOuter = clone.querySelector('.exhibition-frame-outer');
    return {
      hasLayeredFrame: Boolean(outer && document.querySelector('.exhibition-frame-recess') && document.querySelector('.exhibition-frame-mat') && document.querySelector('.exhibition-frame-glass')),
      borderImageSource: style.borderImageSource,
      clonedFrameAsset: clone.querySelector('.exhibition-art-mat').style.getPropertyValue('--frame-asset'),
      currentFrameAsset: document.querySelector('.exhibition-art-mat').style.getPropertyValue('--frame-asset'),
      generation: document.querySelector('.exhibition-art-mat').dataset.frameGeneration,
      cloneHasFrameLayer: Boolean(cloneOuter),
      matColor: getComputedStyle(document.querySelector('.exhibition-frame-mat')).backgroundColor,
      pointerEvents: style.pointerEvents
    };
  })()`);
  assert(frameState.hasLayeredFrame && frameState.generation === 'realistic-v2' && frameState.borderImageSource.includes('warm-white-mat-9slice') && frameState.borderImageSource.includes('.webp'), `White mat frame did not use the realistic local 9-slice asset: ${JSON.stringify(frameState)}`);
  assert(frameState.cloneHasFrameLayer && frameState.currentFrameAsset === frameState.clonedFrameAsset, `Preview/export clone did not share the current frame mapping: ${JSON.stringify(frameState)}`);
  assert(frameState.matColor === "rgb(251, 250, 244)", `White mat frame did not use a warm-white mat: ${JSON.stringify(frameState)}`);
  assert(frameState.pointerEvents === "none", `Frame artwork intercepted exhibit interaction: ${JSON.stringify(frameState)}`);

  await evaluate(client, `(() => { const select = document.querySelector('.exhibition-export-controls select'); select.value = '2'; select.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await waitFor(client, "document.querySelector('.exhibition-export-controls')?.textContent.includes('2800')", "2x export dimensions were not shown");

  await evaluate(client, `(() => {
    window.__lastExhibitionExportResult = null;
    [...document.querySelectorAll('.exhibition-export-controls button')].find((entry) => entry.textContent.includes('Export segment')).click();
    return true;
  })()`);
  assert(await waitForFile(tempRoot, path.basename(exportPath), 30000), "White mat frame export was not created");
  assert(JSON.stringify(pngDimensions(exportPath)) === JSON.stringify({ width: 2800, height: 2800 }), `Square template 2x export dimensions were wrong: ${JSON.stringify(pngDimensions(exportPath))}`);
  await waitFor(client, "window.__lastExhibitionExportResult?.diagnostics?.exhibitionFrames?.[0]?.matches === true", "White mat export frame audit did not pass");
  const whiteDiagnostics = await evaluate(client, "(() => window.__lastExhibitionExportResult.diagnostics)()");
  assert(whiteDiagnostics.cssAssetCount > 0 && whiteDiagnostics.exhibitionFrames[0].frameStyle === "white-mat", `White mat export diagnostics were incomplete: ${JSON.stringify(whiteDiagnostics)}`);
  assert(whiteDiagnostics.exhibitionPlaqueCount === 0 && whiteDiagnostics.exhibitionDecorCount === 0 && whiteDiagnostics.exhibitionSuspensionCount === 0, `Export reintroduced removed hall decoration layers: ${JSON.stringify(whiteDiagnostics)}`);
  assert(whiteDiagnostics.exhibitionArchitecture?.length === 3 && whiteDiagnostics.exhibitionArchitecture.every((entry) => entry.opaqueBase && entry.mixBlendMode === 'normal' && !entry.filter.includes('opacity')), `Export architectural materials were not opaque: ${JSON.stringify(whiteDiagnostics.exhibitionArchitecture)}`);
  fs.copyFileSync(exportPath, whiteFrameExportPath);

  await evaluate(client, `(() => { const select = document.querySelector('.exhibition-export-controls select'); select.value = '1'; select.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);

  await evaluate(client, `(() => {
    const frameSelect = document.querySelector('.exhibition-inspector option[value="ornate-gold"]').parentElement;
    frameSelect.value = 'ornate-gold';
    frameSelect.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await waitFor(client, "document.querySelector('.exhibition-placement')?.dataset.frameStyle === 'ornate-gold'", "Ornate frame did not become the current placement frame");
  fs.rmSync(exportPath, { force: true });
  await evaluate(client, `(() => {
    window.__lastExhibitionExportResult = null;
    [...document.querySelectorAll('.exhibition-export-controls button')].find((entry) => entry.textContent.includes('Export segment')).click();
    return true;
  })()`);
  assert(await waitForFile(tempRoot, path.basename(exportPath), 30000), "Ornate frame export was not created");
  await waitFor(client, "window.__lastExhibitionExportResult?.diagnostics?.exhibitionFrames?.[0]?.matches === true", "Ornate export frame audit did not pass");
  const ornateDiagnostics = await evaluate(client, "(() => window.__lastExhibitionExportResult.diagnostics)()");
  assert(ornateDiagnostics.exhibitionFrames[0].frameStyle === "ornate-gold", `Ornate export used the wrong frame: ${JSON.stringify(ornateDiagnostics)}`);
  fs.copyFileSync(exportPath, ornateFrameExportPath);
  assert(!fs.readFileSync(whiteFrameExportPath).equals(fs.readFileSync(ornateFrameExportPath)), "White mat and ornate frame exports were pixel-identical");

  await evaluate(client, `(() => {
    const frameSelect = document.querySelector('.exhibition-inspector option[value="white-mat"]').parentElement;
    frameSelect.value = 'white-mat';
    frameSelect.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await waitFor(client, "document.querySelector('.exhibition-placement')?.dataset.frameStyle === 'white-mat'", "White mat frame was not restored after two-frame export test");

  const beforeTransform = await evaluate(client, `(() => {
    const placement = document.querySelector('.exhibition-placement');
    return { left: placement.style.left, width: placement.style.width };
  })()`);
  const movePoints = await evaluate(client, `(() => {
    const placement = document.querySelector('.exhibition-placement');
    const rect = placement.getBoundingClientRect();
    return { start: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }, end: { x: rect.left + rect.width / 2 + 36, y: rect.top + rect.height / 2 + 12 } };
  })()`);
  await dragAt(client, movePoints.start, movePoints.end);
  await waitFor(client, `document.querySelector('.exhibition-placement')?.style.left !== ${JSON.stringify(beforeTransform.left)}`, "Dragging did not move the exhibit");
  const resizePoints = await evaluate(client, `(() => {
    const handle = document.querySelector('.exhibition-resize-handle');
    const rect = handle.getBoundingClientRect();
    return { start: { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }, end: { x: rect.left + rect.width / 2 + 30, y: rect.top + rect.height / 2 + 14 } };
  })()`);
  await dragAt(client, resizePoints.start, resizePoints.end);
  await waitFor(client, `document.querySelector('.exhibition-placement')?.style.width !== ${JSON.stringify(beforeTransform.width)}`, "Resizing did not resize the exhibit");

  await evaluate(client, `(() => { document.querySelector('.exhibition-scene-wrap').click(); return true; })()`);
  await waitFor(client, "document.querySelector('.exhibition-template-select')", "Segment template settings did not return after clearing exhibit selection");
  await evaluate(client, `(() => {
    const select = document.querySelector('.exhibition-template-select');
    select.value = 'monumental';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await waitFor(client, "document.querySelector('.exhibition-hall-scene')?.dataset.segmentTemplate === 'monumental' && !document.querySelector('.exhibition-template-architecture') && document.querySelectorAll('.exhibition-placement').length === 1", "Monumental template did not render with the existing exhibit or the removed Arch layer returned");
  await evaluate(client, `(() => { [...document.querySelectorAll('.exhibition-toolbar-actions button')].find((button) => button.textContent.includes('Save')).click(); return true; })()`);
  await waitFor(client, "document.querySelector('.exhibition-hall-scene')?.dataset.sceneWidth === '2400' && document.querySelector('.exhibition-hall-scene')?.dataset.sceneHeight === '1080'", "Monumental template canonical scene dimensions were not retained after save");

  await evaluate(client, `(() => {
    document.querySelector('.exhibition-scene-wrap').click();
    document.querySelector('button[aria-label="Next segment"]').click();
    return true;
  })()`);
  await waitFor(client, `document.querySelector('[data-exhibition-segment="${setup.secondSegmentId}"]')`, "Next segment navigation failed");
  const secondState = await evaluate(client, "(() => document.querySelector('.exhibition-hall-scene').className)()");
  assert(secondState.includes("wall-wallpaper") && secondState.includes("trim-simple-white") && !secondState.includes("floor-"), `Second segment style was not rendered independently: ${secondState}`);

  await evaluate(client, `(() => { document.querySelector('button[aria-label="Previous segment"]').click(); return true; })()`);
  await waitFor(client, `document.querySelector('[data-exhibition-segment="${setup.firstSegmentId}"]')`, "Previous segment navigation failed");
  await evaluate(client, `(() => {
    const view = document.querySelector('.exhibition-toolbar .mode-toggle button:last-child');
    view.click();
    return true;
  })()`);
  await waitFor(client, "document.querySelector('.exhibition-hall-scene.is-viewing') && document.querySelector('.exhibition-inspector [data-inspector-panel=\"export\"]:not([hidden])')", "View mode did not open the focused Export inspector");
  const visitZoomState = await evaluate(client, `(async () => {
    const viewport = document.querySelector('.exhibition-scene-wrap');
    const scene = document.querySelector('.exhibition-hall-scene');
    const before = Number(viewport.dataset.zoom);
    const rect = scene.getBoundingClientRect();
    const clientX = rect.left + rect.width * 0.45;
    const clientY = rect.top + rect.height * 0.45;
    const allowed = viewport.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY: -160, clientX, clientY }));
    await new Promise((resolve) => setTimeout(resolve, 220));
    return {
      allowed,
      before,
      after: Number(viewport.dataset.zoom),
      editZoomControlsVisible: Boolean(document.querySelector('.exhibition-canvas-controls'))
    };
  })()`);
  assert(!visitZoomState.allowed && visitZoomState.after > visitZoomState.before && !visitZoomState.editZoomControlsVisible, `Visit mode Ctrl+wheel zoom failed or exposed edit zoom controls: ${JSON.stringify(visitZoomState)}`);
  const visitPoint = await evaluate(client, `(() => {
    const rect = document.querySelector('.exhibition-placement').getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  await clickAt(client, visitPoint.x, visitPoint.y);
  await waitFor(client, "document.querySelector('.viewer-backdrop .viewer .zoom-canvas[data-mode=\"fit\"]')", "Shared Gallery Viewer did not open in Fit mode");
  const inspectState = await evaluate(client, `(() => {
    const image = document.querySelector('.viewer .zoom-canvas img');
    const imageRect = image.getBoundingClientRect();
    const canvasRect = document.querySelector('.viewer .zoom-canvas').getBoundingClientRect();
    return {
      title: document.querySelector('.viewer h2')?.textContent,
      counter: document.querySelector('.viewer-counter')?.textContent,
      src: image.currentSrc || image.src,
      wholeImageVisible: imageRect.left >= canvasRect.left - 1 && imageRect.right <= canvasRect.right + 1 && imageRect.top >= canvasRect.top - 1 && imageRect.bottom <= canvasRect.bottom + 1,
      controls: [...document.querySelectorAll('.viewer .zoom-controls button')].map((button) => button.textContent.trim()),
      previousDisabled: document.querySelector('.viewer-actions button:first-child')?.disabled,
      nextDisabled: document.querySelector('.viewer-actions button:nth-child(2)')?.disabled
    };
  })()`);
  assert(inspectState.title.includes("Exhibition Smoke Item") && inspectState.counter === "2 of 2", `Shared Viewer metadata/counter was incomplete: ${JSON.stringify(inspectState)}`);
  assert(inspectState.src.includes("exhibition-back.png") && inspectState.wholeImageVisible, `Viewer did not start on the exact placement image in Fit mode: ${JSON.stringify(inspectState)}`);
  assert(["+", "−", "Reset", "Fit", "100%"].every((label) => inspectState.controls.includes(label)), `Shared Viewer controls were incomplete: ${JSON.stringify(inspectState)}`);
  assert(!inspectState.previousDisabled && inspectState.nextDisabled, `Viewer navigation state was wrong for image 2: ${JSON.stringify(inspectState)}`);

  await evaluate(client, `(() => {
    const previous = document.querySelector('.viewer-actions button:first-child');
    previous.click();
    return true;
  })()`);
  await waitFor(client, "document.querySelector('.viewer-counter')?.textContent === '1 of 2' && document.querySelector('.viewer .zoom-canvas img')?.src.includes('exhibition-front.png')", "Viewer Previous did not browse the item's first image");
  await evaluate(client, "(() => { document.querySelector('.viewer-actions button:nth-child(2)').click(); return true; })()");
  await waitFor(client, "document.querySelector('.viewer-counter')?.textContent === '2 of 2' && document.querySelector('.viewer .zoom-canvas img')?.src.includes('exhibition-back.png')", "Viewer Next did not return to the placement image");

  await evaluate(client, `(() => {
    const zoomIn = [...document.querySelectorAll('.viewer .zoom-controls button')].find((button) => button.textContent.trim() === '+');
    zoomIn.click(); zoomIn.click(); zoomIn.click(); zoomIn.click();
    return true;
  })()`);
  await waitFor(client, "document.querySelector('.viewer .zoom-canvas')?.dataset.mode === 'zoom' && document.querySelector('.viewer .zoom-canvas')?.dataset.canDrag === 'true'", "Viewer zoom did not enable panning");
  const panState = await evaluate(client, `(() => {
    const canvas = document.querySelector('.viewer .zoom-canvas');
    const image = canvas.querySelector('img');
    const rect = canvas.getBoundingClientRect();
    return { before: image.style.transform, start: { x: rect.left + rect.width * .55, y: rect.top + rect.height * .55 }, end: { x: rect.left + rect.width * .45, y: rect.top + rect.height * .45 } };
  })()`);
  await dragAt(client, panState.start, panState.end);
  await waitFor(client, `document.querySelector('.viewer .zoom-canvas img')?.style.transform !== ${JSON.stringify(panState.before)}`, "Viewer click-drag panning did not update the image transform");
  const wheelState = await evaluate(client, `(() => {
    const canvas = document.querySelector('.viewer .zoom-canvas');
    const image = canvas.querySelector('img');
    const rect = canvas.getBoundingClientRect();
    const before = image.style.transform;
    canvas.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: -120, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 }));
    return { before };
  })()`);
  await waitFor(client, `document.querySelector('.viewer .zoom-canvas img')?.style.transform !== ${JSON.stringify(wheelState.before)}`, "Viewer mouse-wheel zoom did not update the image transform");
  await evaluate(client, `(() => {
    [...document.querySelectorAll('.viewer .zoom-controls button')].find((button) => button.textContent === '100%').click();
    [...document.querySelectorAll('.viewer .zoom-controls button')].find((button) => button.textContent === 'Fit').click();
    return true;
  })()`);
  await waitFor(client, "document.querySelector('.viewer .zoom-canvas')?.dataset.mode === 'fit'", "Viewer Fit did not restore fit mode");
  await evaluate(client, "(() => { document.querySelector('.viewer-close').click(); return true; })()");
  await waitFor(client, "!document.querySelector('.viewer-backdrop')", "Shared Viewer did not close");

  fs.rmSync(exportPath, { force: true });
  await evaluate(client, `(() => { const select = document.querySelector('.exhibition-export-controls select'); select.value = '4'; select.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
  await waitFor(client, "document.querySelector('.exhibition-export-controls')?.textContent.includes('9600') && document.querySelector('.exhibition-export-controls')?.textContent.includes('4320')", "4x export dimensions were not shown");
  await evaluate(client, `(() => {
    window.__lastExhibitionExportResult = null;
    const button = [...document.querySelectorAll('.exhibition-export-controls button')].find((entry) => entry.textContent.includes('Export segment'));
    button.click();
    return true;
  })()`);
  assert(await waitForFile(tempRoot, path.basename(exportPath), 90000), "Real 4x Export segment button did not create a PNG");
  await waitFor(client, "window.__lastExhibitionExportResult?.diagnostics?.exhibitionFrames?.[0]?.matches === true", "Final real export frame audit did not pass");
  assert(fs.statSync(exportPath).size > 100, `Exported segment PNG was empty: ${exportPath}`);
  const dimensions = pngDimensions(exportPath);
  assert(dimensions.width === 9600 && dimensions.height === 4320, `Monumental template 4x export dimensions were wrong: ${JSON.stringify(dimensions)}`);

  await evaluate(client, "(() => { window.location.reload(); return true; })()");
  await waitFor(client, "document.querySelector('.app') && !document.querySelector('.startup-screen')", "App did not reopen for persistence check");
  const persisted = await evaluate(client, `(async () => {
    const value = await window.archiveAPI.getExhibition(${JSON.stringify(setup.exhibitionId)});
    const placement = value.segments[0].placements[0];
    return {
      segmentCount: value.segments.length,
      segmentNumbers: value.segments.map((segment) => segment.segment_number),
      placementCount: value.segments[0].placements.length,
      itemId: placement?.item_id,
      imageId: placement?.image_id,
      frameStyle: placement?.frame_style,
      frameThickness: placement?.frame_thickness,
      captionSize: placement?.caption_size,
      supportStyle: placement?.support_style,
      supportScale: placement?.support_scale,
      exhibitOffsetX: placement?.exhibit_offset_x,
      exhibitOffsetY: placement?.exhibit_offset_y,
      x: placement?.x,
      width: placement?.width,
      backgroundImageId: value.segments[0].background?.image?.id,
      backgroundMissing: value.segments[0].background?.missing,
      firstStyle: value.segments[0].style,
      secondStyle: value.segments[1].style
    };
  })()`);
  assert(persisted.segmentCount === 2 && persisted.segmentNumbers.join(",") === "1,2", `Segment order did not persist: ${JSON.stringify(persisted)}`);
  assert(persisted.placementCount === 1, `Placement did not persist: ${JSON.stringify(persisted)}`);
  assert(persisted.itemId === "item-exhibition" && persisted.imageId === "image-exhibition-back", `Item/image references changed: ${JSON.stringify(persisted)}`);
  assert(persisted.frameStyle === "white-mat", `White mat frame style did not persist: ${JSON.stringify(persisted)}`);
  assert(Number(persisted.frameThickness) === 10.5 && persisted.captionSize === "large", `Per-exhibit frame/caption sizing did not persist: ${JSON.stringify(persisted)}`);
  assert(persisted.supportStyle === "walnut-wall-shelf" && Math.abs(Number(persisted.supportScale) - 1.22) < .01, `Display furniture did not persist with the exhibit: ${JSON.stringify(persisted)}`);
  assert(Number(persisted.exhibitOffsetX) === 0 && Number(persisted.exhibitOffsetY) === 4, `Exhibit-only furniture alignment did not persist: ${JSON.stringify(persisted)}`);
  assert(persisted.x > 8 && persisted.width > 19, `Exhibit move/resize did not persist: ${JSON.stringify(persisted)}`);
  assert(persisted.firstStyle.wallTexture === "custom" && persisted.firstStyle.wallColor === "#76523a", `First segment custom wall draft did not persist independently: ${JSON.stringify(persisted)}`);
  assert(persisted.firstStyle.segmentTemplate === "monumental" && (!persisted.secondStyle.segmentTemplate || persisted.secondStyle.segmentTemplate === "horizontal"), `Segment template persistence or legacy fallback was wrong: ${JSON.stringify(persisted)}`);
  assert(persisted.firstStyle.backgroundItemId === "item-exhibition" && persisted.firstStyle.backgroundImageId === "image-exhibition-back", `Exact collection background references did not persist: ${JSON.stringify(persisted)}`);
  assert(persisted.firstStyle.backgroundMode === "tile" && Number(persisted.firstStyle.backgroundScale) === 55, `Custom wallpaper tile settings did not persist: ${JSON.stringify(persisted)}`);
  assert(persisted.firstStyle.trimStyle === "dark-walnut" && persisted.firstStyle.wainscoting === "burgundy-fabric" && persisted.firstStyle.ceilingStyle === "simple-crown" && Number(persisted.firstStyle.upperTrimHeight) === 7.5, `Top/middle/lower wall structure did not persist: ${JSON.stringify(persisted.firstStyle)}`);
  assert(persisted.firstStyle.captionStyle === "white-museum", `Focused exhibit-label presentation did not persist: ${JSON.stringify(persisted.firstStyle)}`);
  assert(persisted.backgroundImageId === "image-exhibition-back" && !persisted.backgroundMissing, `Persisted collection background did not resolve its exact image: ${JSON.stringify(persisted)}`);
  assert(persisted.secondStyle.wallTexture === "wallpaper" && persisted.secondStyle.wallColor === "#bfc9bd", `Second segment style did not persist independently: ${JSON.stringify(persisted)}`);

  await evaluate(client, `(() => {
    const nav = [...document.querySelectorAll('.sidebar nav button')].find((entry) => entry.textContent.trim() === 'Exhibition');
    nav.click();
    return true;
  })()`);
  await waitFor(client, "document.querySelector('.exhibition-shell')", "Exhibition view did not reopen for deletion checks");
  await evaluate(client, `(() => {
    const button = [...document.querySelectorAll('.exhibition-list > button')].find((entry) => entry.textContent.includes('Long Hall Smoke'));
    button.click();
    return true;
  })()`);
  await waitFor(client, "document.querySelectorAll('.exhibition-placement').length === 1 && document.querySelector('.exhibition-custom-wallpaper.wallpaper-tile')", "Persisted exhibit/background did not reopen");
  await evaluate(client, `(() => { document.querySelector('[data-canvas-action="fit"]').click(); return true; })()`);
  await waitFor(client, "document.querySelector('.exhibition-scene-wrap')?.dataset.zoomMode === 'fit'", "Reopened hall did not fit before exhibit selection");
  const reopenedPoint = await evaluate(client, `(() => {
    const rect = document.querySelector('.exhibition-placement').getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
  await clickAt(client, reopenedPoint.x, reopenedPoint.y);
  await waitFor(client, "document.querySelector('.exhibition-placement.selected')", "Reopened exhibit could not be selected");
  await evaluate(client, `(() => {
    const duplicate = [...document.querySelectorAll('.exhibition-inspector-actions button')].find((button) => button.textContent.includes('Duplicate exhibit'));
    duplicate.click();
    return true;
  })()`);
  await waitFor(client, "document.querySelectorAll('.exhibition-placement').length === 2 && document.querySelector('.exhibition-placement.selected')", "Duplicate exhibit action failed");
  await evaluate(client, `(() => {
    window.confirm = () => true;
    const remove = [...document.querySelectorAll('.exhibition-inspector-actions button')].find((button) => button.textContent.includes('Delete exhibit'));
    remove.click();
    return true;
  })()`);
  await waitFor(client, "document.querySelectorAll('.exhibition-placement').length === 1 && !document.querySelector('.exhibition-placement.selected')", "Delete exhibit action failed");
  const afterExhibitDelete = await evaluate(client, `(async () => {
    const hall = await window.archiveAPI.getExhibition(${JSON.stringify(setup.exhibitionId)});
    const item = await window.archiveAPI.getItem('item-exhibition');
    return { placementCount: hall.segments[0].placements.length, itemId: item?.id, imageCount: item?.images?.length || 0 };
  })()`);
  assert(afterExhibitDelete.placementCount === 1 && afterExhibitDelete.itemId === "item-exhibition" && afterExhibitDelete.imageCount === 2, `Deleting an exhibit affected its item/images: ${JSON.stringify(afterExhibitDelete)}`);

  await evaluate(client, "(() => { document.querySelector('.exhibition-list header .primary').click(); return true; })()");
  await waitFor(client, "document.querySelector('.exhibition-more-menu input')?.value === 'New exhibition'", "Surviving exhibition was not created");
  const survivorId = await evaluate(client, `(async () => {
    const library = await window.archiveAPI.getLibrary();
    return library.exhibitions.find((entry) => entry.title === 'New exhibition')?.id || null;
  })()`);
  assert(survivorId, "Could not identify the surviving exhibition");
  await evaluate(client, `(() => {
    const original = [...document.querySelectorAll('.exhibition-list > button')].find((entry) => entry.textContent.includes('Long Hall Smoke'));
    original.click();
    return true;
  })()`);
  await waitFor(client, "document.querySelector('.exhibition-more-menu input')?.value === 'Long Hall Smoke'", "Original exhibition did not reopen before deletion");
  await evaluate(client, "(() => { document.querySelector('.exhibition-more-menu button.danger').click(); return true; })()");
  await waitFor(client, "document.querySelector('.exhibition-more-menu input')?.value === 'New exhibition' && ![...document.querySelectorAll('.exhibition-list > button')].some((button) => button.textContent.includes('Long Hall Smoke'))", "Delete exhibition did not select the remaining exhibition");
  const deletionState = await evaluate(client, `(async () => ({
    deleted: await window.archiveAPI.getExhibition(${JSON.stringify(setup.exhibitionId)}),
    survivor: await window.archiveAPI.getExhibition(${JSON.stringify(survivorId)}),
    item: await window.archiveAPI.getItem('item-exhibition')
  }))()`);
  assert(deletionState.deleted === null, `Deleted exhibition still exists: ${JSON.stringify(deletionState.deleted)}`);
  assert(deletionState.survivor?.id === survivorId, `Remaining exhibition was damaged: ${JSON.stringify(deletionState.survivor)}`);
  assert(deletionState.item?.id === "item-exhibition" && deletionState.item.images?.length === 2, "Deleting an exhibition affected collection item data");
  assert(!client.runtimeExceptions.some((message) => /ReferenceError|TypeError/.test(message)), `Renderer raised a runtime exception: ${JSON.stringify(client.runtimeExceptions)}`);

  console.log(`Exhibition smoke passed: ${exportPath}`);
  client.close();
  await stop(child);
}

let failed = false;

main()
  .catch(async (error) => {
    failed = true;
    console.error(error);
    if (activeChild) await stop(activeChild);
  })
  .finally(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    if (failed) process.exitCode = 1;
  });
