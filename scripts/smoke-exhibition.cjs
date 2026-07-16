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
    title: document.querySelector('.exhibition-meta-fields input')?.value || '',
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
    const button = [...document.querySelectorAll('.sidebar nav button')].find((entry) => entry.textContent.trim() === 'Exhibition');
    button.click();
    return true;
  })()`);
  await waitFor(client, "document.querySelector('.exhibition-shell')", "Exhibition view did not open");
  await evaluate(client, `(() => {
    const button = [...document.querySelectorAll('.exhibition-list > button')].find((entry) => entry.textContent.includes('Long Hall Smoke'));
    button.click();
    return true;
  })()`);
  await waitFor(client, `document.querySelector('[data-exhibition-segment="${setup.firstSegmentId}"]')`, "First hall segment did not load");

  const initialState = await evaluate(client, `(() => ({
    segmentCount: document.querySelectorAll('.exhibition-segment-nav option').length,
    wallClass: document.querySelector('.exhibition-hall-scene').className,
    hasInspector: Boolean(document.querySelector('.exhibition-inspector')),
    hasFloorElement: Boolean(document.querySelector('.exhibition-floor')),
    hasFloorControl: Boolean(document.querySelector('.exhibition-inspector option[value="parquet"]')),
    assetPack: document.querySelector('.exhibition-hall-scene')?.dataset.exhibitionAssetPack,
    sceneSize: [document.querySelector('.exhibition-hall-scene')?.dataset.sceneWidth, document.querySelector('.exhibition-hall-scene')?.dataset.sceneHeight],
    assetLayers: ['.exhibition-asset-wall', '.exhibition-asset-crown', '.exhibition-asset-wainscot', '.exhibition-asset-chair-rail', '.exhibition-asset-light-wash', '.exhibition-asset-sconces'].every((selector) => Boolean(document.querySelector(selector))),
    paintedWallColor: getComputedStyle(document.querySelector('.exhibition-asset-wall')).backgroundColor,
    hasPlainOption: Boolean(document.querySelector('.exhibition-inspector option[value="plain"]')),
    overflow: document.body.scrollWidth > document.body.clientWidth
  }))()`);
  assert(initialState.segmentCount === 2, `Expected two hall segments: ${JSON.stringify(initialState)}`);
  assert(initialState.wallClass.includes("wall-plain"), `Plain painted wall was not rendered: ${JSON.stringify(initialState)}`);
  assert(initialState.hasPlainOption && initialState.paintedWallColor === "rgb(213, 197, 168)", `Plain wall did not expose the selected wall color: ${JSON.stringify(initialState)}`);
  assert(!initialState.hasFloorElement && !initialState.hasFloorControl && !initialState.wallClass.includes("floor-"), `Legacy floor data was not ignored: ${JSON.stringify(initialState)}`);
  assert(initialState.assetPack === "victorian-cabinet-hall" && initialState.sceneSize.join("x") === "1920x1080", `Victorian asset pack or canonical scene size was missing: ${JSON.stringify(initialState)}`);
  assert(initialState.assetLayers, `Victorian hall asset layers were incomplete: ${JSON.stringify(initialState)}`);
  assert(initialState.hasInspector, `Edit mode inspector was missing: ${JSON.stringify(initialState)}`);
  assert(!initialState.overflow, `Exhibition view caused horizontal overflow: ${JSON.stringify(initialState)}`);

  const artDirectionOptions = await evaluate(client, `(() => {
    const values = [...document.querySelectorAll('.exhibition-inspector option')].map((option) => option.value);
    return {
      themeCount: ['victorian-cabinet','william-morris','dark-walnut','white-museum','gilded-age','east-asian'].filter((value) => values.includes(value)).length,
      railCount: ['none','simple-white','dark-walnut','carved-mahogany','black-gold','brass','art-nouveau'].filter((value) => values.includes(value)).length,
      wainscotCount: ['none','low-wood','tall-wood','walnut-square','carved-mahogany','green-fabric','burgundy-fabric','white-classical','black-museum'].filter((value) => values.includes(value)).length,
      corniceCount: ['none','simple-crown','victorian-plaster','dentil','gilded-classical','dark-wood','art-nouveau','east-asian-beam','modern-recess'].filter((value) => values.includes(value)).length,
      placeholderDecorCount: ['small-plant','tall-palm','plant-stand','wooden-bench','leather-bench','velvet-bench','rope-barrier','sculpture-pedestal'].filter((value) => values.includes(value)).length,
      renderedDecorCount: document.querySelectorAll('.exhibition-decor-piece').length
    };
  })()`);
  assert(artDirectionOptions.themeCount === 6 && artDirectionOptions.railCount === 7 && artDirectionOptions.wainscotCount === 9 && artDirectionOptions.corniceCount === 9, `Expanded architectural/theme options were incomplete: ${JSON.stringify(artDirectionOptions)}`);
  assert(artDirectionOptions.placeholderDecorCount === 0 && artDirectionOptions.renderedDecorCount === 0, `Placeholder decor leaked into the normal UI or Minimal hall: ${JSON.stringify(artDirectionOptions)}`);

  await evaluate(client, `(() => {
    const select = document.querySelector('.exhibition-inspector option[value="gilded-age"]')?.parentElement;
    select.value = 'gilded-age';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await waitFor(client, "document.querySelector('.exhibition-hall-scene')?.classList.contains('trim-black-gold') && document.querySelector('.exhibition-hall-scene')?.classList.contains('wainscot-burgundy-fabric') && document.querySelector('.exhibition-hall-scene')?.classList.contains('ceiling-gilded-classical') && document.querySelector('.exhibition-hall-scene')?.classList.contains('density-curated') && !document.querySelector('.exhibition-decor-piece')", "Restrained Gilded Age theme bundle did not apply its coordinated draft");

  await evaluate(client, `(() => {
    const plaque = [...document.querySelectorAll('.exhibition-control-section')].find((section) => section.textContent.includes('Exhibition title / section plaque'));
    plaque.querySelector('input[type="checkbox"]').click();
    return true;
  })()`);
  await waitFor(client, "[...document.querySelectorAll('.exhibition-control-section')].find((section) => section.textContent.includes('Exhibition title / section plaque'))?.querySelector('textarea')", "Plaque content controls did not open");

  await evaluate(client, `(() => {
    const sections = [...document.querySelectorAll('.exhibition-control-section')];
    const plaque = sections.find((section) => section.textContent.includes('Exhibition title / section plaque'));
    const caption = sections.find((section) => section.textContent.includes('Exhibit captions'));
    const setValue = (element, value) => {
      const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value);
      element.dispatchEvent(new Event('input', { bubbles: true }));
    };
    setValue(plaque.querySelectorAll('input:not([type="checkbox"])')[0], 'Treasures of the Long Hall');
    setValue(plaque.querySelectorAll('input:not([type="checkbox"])')[1], 'Section I');
    setValue(plaque.querySelector('textarea'), 'A concise introduction for visitors.');
    const choose = (scope, value) => {
      const select = scope.querySelector('option[value="' + value + '"]')?.parentElement;
      if (!select) throw new Error('Missing art-direction option: ' + value);
      select.value = value;
      select.dispatchEvent(new Event('change', { bubbles: true }));
    };
    choose(plaque, 'upper-left');
    choose(plaque, 'hanging');
    choose(caption, 'beside');
    choose(caption, 'brass');
    choose(caption, 'double-cord');
    return true;
  })()`);
  await waitFor(client, "document.querySelector('.exhibition-section-plaque.plaque-hanging.plaque-upper-left')?.textContent.includes('Treasures of the Long Hall') && !document.querySelector('.exhibition-decor-piece') && document.querySelector('.exhibition-decor-unavailable')?.textContent.includes('Placeholder artwork stays hidden')", "Plaque or placeholder-decor suppression did not render from the active draft");

  const inspectorScroll = await evaluate(client, `(() => {
    const inspector = document.querySelector('.exhibition-inspector');
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
    const button = [...document.querySelectorAll('.exhibition-background-controls button')].find((entry) => entry.textContent.includes('Choose background from collection'));
    button.click();
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
  await waitFor(client, "document.querySelector('.exhibition-custom-wallpaper.wallpaper-tile') && document.querySelector('.exhibition-wallpaper-preload')?.src.includes('exhibition-back.png') && document.querySelector('.exhibition-hall-scene')?.classList.contains('density-minimal') && document.querySelector('.exhibition-hall-scene')?.classList.contains('trim-dark-walnut') && document.querySelector('.exhibition-hall-scene')?.classList.contains('ceiling-simple-crown')", "Selected collection image did not render with museum-restraint defaults");
  const materialOpacity = await evaluate(client, `(async () => {
    const wainscotSelect = document.querySelector('.exhibition-inspector option[value="burgundy-fabric"]')?.parentElement;
    const railSelect = document.querySelector('.exhibition-inspector option[value="black-gold"]')?.parentElement;
    const corniceSelect = document.querySelector('.exhibition-inspector option[value="gilded-classical"]')?.parentElement;
    const nextPaint = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const inspect = async (select, values, selector) => {
      const results = [];
      for (const value of values) {
        select.value = value;
        select.dispatchEvent(new Event('change', { bubbles: true }));
        await nextPaint();
        const style = getComputedStyle(document.querySelector(selector));
        results.push({ value, opacity: style.opacity, backgroundColor: style.backgroundColor, mixBlendMode: style.mixBlendMode, filter: style.filter });
      }
      return results;
    };
    const wainscoting = await inspect(wainscotSelect, ['low-wood','tall-wood','walnut-square','carved-mahogany','green-fabric','burgundy-fabric','white-classical','black-museum'], '.exhibition-asset-wainscot');
    const rails = await inspect(railSelect, ['simple-white','dark-walnut','carved-mahogany','black-gold','brass','art-nouveau'], '.exhibition-asset-chair-rail');
    const cornices = await inspect(corniceSelect, ['simple-crown','victorian-plaster','dentil','gilded-classical','dark-wood','art-nouveau','east-asian-beam','modern-recess'], '.exhibition-asset-crown');
    wainscotSelect.value = 'burgundy-fabric'; wainscotSelect.dispatchEvent(new Event('change', { bubbles: true })); await nextPaint();
    railSelect.value = 'dark-walnut'; railSelect.dispatchEvent(new Event('change', { bubbles: true })); await nextPaint();
    corniceSelect.value = 'simple-crown'; corniceSelect.dispatchEvent(new Event('change', { bubbles: true })); await nextPaint();
    return { wainscoting, rails, cornices };
  })()`);
  const materialFailures = [...materialOpacity.wainscoting, ...materialOpacity.rails, ...materialOpacity.cornices].filter((entry) => entry.opacity !== '1' || entry.backgroundColor === 'rgba(0, 0, 0, 0)' || entry.backgroundColor === 'transparent' || entry.mixBlendMode !== 'normal' || entry.filter.includes('opacity'));
  assert(materialFailures.length === 0, `Architectural material allowed wallpaper bleed-through: ${JSON.stringify(materialFailures)}`);
  await evaluate(client, `(() => {
    const scale = document.querySelector('.exhibition-tile-controls input[type="range"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(scale, '55');
    scale.dispatchEvent(new Event('input', { bubbles: true }));
    scale.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await waitFor(client, "document.querySelector('.exhibition-hall-scene')?.style.getPropertyValue('--wallpaper-scale') === '55%'", "Tile pattern scale did not update the hall preview");
  await evaluate(client, `(() => {
    [...document.querySelectorAll('.exhibition-inspector button')].find((button) => button.textContent.includes('Save hall')).click();
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
    suspensionClass: document.querySelector('.exhibition-picture-suspension')?.className || '',
    decorCount: document.querySelectorAll('.exhibition-decor-piece').length,
    plaqueText: document.querySelector('.exhibition-section-plaque')?.textContent || ''
  }))()`);
  assert(exhibitPresentation.captionClass.includes('caption-brass') && exhibitPresentation.captionClass.includes('caption-position-beside'), `Caption presentation did not apply: ${JSON.stringify(exhibitPresentation)}`);
  assert(exhibitPresentation.suspensionClass.includes('suspension-double-cord'), `Picture-rail suspension did not apply: ${JSON.stringify(exhibitPresentation)}`);
  assert(exhibitPresentation.decorCount === 0 && exhibitPresentation.plaqueText.includes('Treasures of the Long Hall'), `Placeholder decor returned behind the exhibit: ${JSON.stringify(exhibitPresentation)}`);

  const sceneEmptyPoint = await evaluate(client, `(() => {
    const rect = document.querySelector('.exhibition-hall-scene').getBoundingClientRect();
    return { x: rect.left + rect.width * 0.9, y: rect.top + rect.height * 0.72 };
  })()`);
  await clickAt(client, sceneEmptyPoint.x, sceneEmptyPoint.y);
  await waitFor(client, "!document.querySelector('.exhibition-placement.selected')", "Clicking empty wall did not clear exhibit selection");
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
  await waitFor(client, "document.querySelector('.exhibition-placement')?.classList.contains('selected') && document.querySelector('.exhibition-inspector')?.textContent.includes('Exhibit settings')", "Real pointer click did not select the exhibit");

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
    return {
      hasLayeredFrame: Boolean(outer && document.querySelector('.exhibition-frame-recess') && document.querySelector('.exhibition-frame-mat') && document.querySelector('.exhibition-frame-glass')),
      borderImageSource: style.borderImageSource,
      clonedFrameAsset: clone.style.getPropertyValue('--frame-asset'),
      currentFrameAsset: placement.style.getPropertyValue('--frame-asset'),
      matColor: getComputedStyle(document.querySelector('.exhibition-frame-mat')).backgroundColor,
      pointerEvents: style.pointerEvents
    };
  })()`);
  assert(frameState.hasLayeredFrame && frameState.borderImageSource.includes("data:image/svg+xml;base64"), `White mat frame did not use the local 9-slice asset: ${JSON.stringify(frameState)}`);
  assert(frameState.currentFrameAsset === frameState.clonedFrameAsset, `Preview/export clone did not share the current frame mapping: ${JSON.stringify(frameState)}`);
  assert(frameState.matColor === "rgb(251, 250, 244)", `White mat frame did not use a warm-white mat: ${JSON.stringify(frameState)}`);
  assert(frameState.pointerEvents === "none", `Frame artwork intercepted exhibit interaction: ${JSON.stringify(frameState)}`);

  await evaluate(client, `(() => {
    window.__lastExhibitionExportResult = null;
    [...document.querySelectorAll('.exhibition-toolbar button')].find((entry) => entry.textContent.includes('Export segment')).click();
    return true;
  })()`);
  assert(await waitForFile(tempRoot, path.basename(exportPath), 30000), "White mat frame export was not created");
  await waitFor(client, "window.__lastExhibitionExportResult?.diagnostics?.exhibitionFrames?.[0]?.matches === true", "White mat export frame audit did not pass");
  const whiteDiagnostics = await evaluate(client, "(() => window.__lastExhibitionExportResult.diagnostics)()");
  assert(whiteDiagnostics.cssAssetCount > 0 && whiteDiagnostics.exhibitionFrames[0].frameStyle === "white-mat", `White mat export diagnostics were incomplete: ${JSON.stringify(whiteDiagnostics)}`);
  assert(whiteDiagnostics.exhibitionPlaqueCount === 1 && whiteDiagnostics.exhibitionDecorCount === 0 && whiteDiagnostics.exhibitionSuspensionCount === 1, `Export included placeholder decor or omitted curated hall layers: ${JSON.stringify(whiteDiagnostics)}`);
  assert(whiteDiagnostics.exhibitionArchitecture?.length === 3 && whiteDiagnostics.exhibitionArchitecture.every((entry) => entry.opaqueBase && entry.mixBlendMode === 'normal' && !entry.filter.includes('opacity')), `Export architectural materials were not opaque: ${JSON.stringify(whiteDiagnostics.exhibitionArchitecture)}`);
  fs.copyFileSync(exportPath, whiteFrameExportPath);

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
    [...document.querySelectorAll('.exhibition-toolbar button')].find((entry) => entry.textContent.includes('Export segment')).click();
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
    const view = document.querySelector('.exhibition-header .segmented-control button:first-child');
    view.click();
    return true;
  })()`);
  await waitFor(client, "!document.querySelector('.exhibition-inspector') && document.querySelector('.exhibition-hall-scene.is-viewing')", "View mode did not hide the editor inspector");
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
  assert(["Zoom +", "Zoom -", "Reset", "Fit", "100%"].every((label) => inspectState.controls.includes(label)), `Shared Viewer controls were incomplete: ${JSON.stringify(inspectState)}`);
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
    const zoomIn = [...document.querySelectorAll('.viewer .zoom-controls button')].find((button) => button.textContent.includes('Zoom +'));
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
  await evaluate(client, `(() => {
    window.__lastExhibitionExportResult = null;
    const button = [...document.querySelectorAll('.exhibition-toolbar button')].find((entry) => entry.textContent.includes('Export segment'));
    button.click();
    return true;
  })()`);
  assert(await waitForFile(tempRoot, path.basename(exportPath), 30000), "Real Export segment button did not create a PNG");
  await waitFor(client, "window.__lastExhibitionExportResult?.diagnostics?.exhibitionFrames?.[0]?.matches === true", "Final real export frame audit did not pass");
  assert(fs.statSync(exportPath).size > 100, `Exported segment PNG was empty: ${exportPath}`);
  const dimensions = pngDimensions(exportPath);
  assert(dimensions.width === 1920 && dimensions.height === 1080, `Exported segment dimensions were wrong: ${JSON.stringify(dimensions)}`);

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
  assert(persisted.x > 8 && persisted.width > 19, `Exhibit move/resize did not persist: ${JSON.stringify(persisted)}`);
  assert(persisted.firstStyle.wallTexture === "custom" && persisted.firstStyle.wallColor === "#76523a", `First segment custom wall draft did not persist independently: ${JSON.stringify(persisted)}`);
  assert(persisted.firstStyle.backgroundItemId === "item-exhibition" && persisted.firstStyle.backgroundImageId === "image-exhibition-back", `Exact collection background references did not persist: ${JSON.stringify(persisted)}`);
  assert(persisted.firstStyle.backgroundMode === "tile" && Number(persisted.firstStyle.backgroundScale) === 55, `Custom wallpaper tile settings did not persist: ${JSON.stringify(persisted)}`);
  assert(persisted.firstStyle.themeId === "gilded-age" && persisted.firstStyle.trimStyle === "dark-walnut" && persisted.firstStyle.wainscoting === "burgundy-fabric" && persisted.firstStyle.ceilingStyle === "simple-crown", `Wallpaper restraint did not persist over the theme architecture: ${JSON.stringify(persisted.firstStyle)}`);
  assert(persisted.firstStyle.plaqueEnabled && persisted.firstStyle.plaqueTitle === "Treasures of the Long Hall" && persisted.firstStyle.plaqueStyle === "hanging", `Exhibition plaque did not persist: ${JSON.stringify(persisted.firstStyle)}`);
  assert(persisted.firstStyle.captionPosition === "beside" && persisted.firstStyle.captionStyle === "brass" && persisted.firstStyle.suspensionStyle === "double-cord", `Caption/suspension choices did not persist: ${JSON.stringify(persisted.firstStyle)}`);
  assert(persisted.firstStyle.decorationDensity === "minimal" && persisted.firstStyle.decorations.length === 2 && persisted.firstStyle.decorations.every((decor) => decor.type === "none" && !decor.visible), `Placeholder decor or wallpaper density did not persist safely: ${JSON.stringify(persisted.firstStyle)}`);
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
  await waitFor(client, "document.querySelector('.exhibition-meta-fields input')?.value === 'New exhibition'", "Surviving exhibition was not created");
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
  await waitFor(client, "document.querySelector('.exhibition-meta-fields input')?.value === 'Long Hall Smoke'", "Original exhibition did not reopen before deletion");
  await evaluate(client, "(() => { document.querySelector('.exhibition-header-actions > button.danger').click(); return true; })()");
  await waitFor(client, "document.querySelector('.exhibition-meta-fields input')?.value === 'New exhibition' && ![...document.querySelectorAll('.exhibition-list > button')].some((button) => button.textContent.includes('Long Hall Smoke'))", "Delete exhibition did not select the remaining exhibition");
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
