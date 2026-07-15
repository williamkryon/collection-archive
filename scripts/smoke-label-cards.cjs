const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { createRequire } = require("module");

const requireFromRoot = createRequire(path.join(process.cwd(), "package.json"));
const initSqlJs = requireFromRoot("sql.js");
const { PNG } = requireFromRoot("pngjs");

const root = process.cwd();
const tempRoot = path.join(root, `.tmp-label-card-smoke-${Date.now()}`);
const appData = path.join(tempRoot, "appdata");
const userData = path.join(tempRoot, "user-data");
const archiveData = path.join(tempRoot, "collection-archive-data");
const rendererExportPath = path.join(tempRoot, "label-card-renderer-export.png");
const port = 9720 + Math.floor(Math.random() * 250);
let activeChild = null;

const pngBytes = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAFgwJ/l7+PfwAAAABJRU5ErkJggg==",
  "base64"
);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function pngDimensions(filePath) {
  const header = fs.readFileSync(filePath).subarray(0, 24);
  return { width: header.readUInt32BE(16), height: header.readUInt32BE(20) };
}

function pngFinishStats(filePath) {
  const png = PNG.sync.read(fs.readFileSync(filePath));
  let greenPixels = 0;
  const totalPixels = png.width * png.height;
  for (let index = 0; index < png.data.length; index += 4) {
    const red = png.data[index];
    const green = png.data[index + 1];
    const blue = png.data[index + 2];
    if (green > red * 1.12 && green > blue * 1.08 && green > 45) greenPixels += 1;
  }
  return { greenRatio: greenPixels / totalPixels };
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

async function waitForFile(folder, filename, timeoutMs = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const found = findFile(folder, filename);
    if (found) return found;
    await sleep(100);
  }
  return null;
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
      COLLECTION_ARCHIVE_LABEL_CARD_EXPORT_PATH: rendererExportPath,
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
          const { resolve: done, reject: fail, method, expression, timeout } = this.pending.get(message.id);
          clearTimeout(timeout);
          this.pending.delete(message.id);
          if (message.error) fail(new Error(`${method} failed: ${message.error.message}${expression ? `\n${expression}` : ""}`));
          else done(message.result);
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
      this.pending.set(id, { resolve, reject, method, expression: params.expression, timeout });
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
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || "Runtime evaluation failed");
  }
  return JSON.parse(result.result.value);
}

async function waitFor(client, expression, message) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    if (await evaluate(client, `Boolean(${expression})`)) return;
    await sleep(200);
  }
  throw new Error(message);
}

async function stop(child) {
  if (!child || child.killed) return;
  child.kill();
  await new Promise((resolve) => child.once("exit", resolve));
  if (activeChild === child) activeChild = null;
}

async function seedDatabase(dbPath) {
  const SQL = await initSqlJs({
    locateFile: (file) => path.join(root, "node_modules", "sql.js", "dist", file)
  });
  const db = new SQL.Database(fs.readFileSync(dbPath));
  db.exec("PRAGMA foreign_keys = ON;");

  const imagesFolder = path.join(path.dirname(dbPath), "images");
  const thumbsFolder = path.join(path.dirname(dbPath), "thumbnails");
  fs.mkdirSync(imagesFolder, { recursive: true });
  fs.mkdirSync(thumbsFolder, { recursive: true });

  const imagePath = path.join(imagesFolder, "label-card-smoke-image.png");
  const detailImagePath = path.join(imagesFolder, "label-card-smoke-detail.png");
  const thumbPath = path.join(thumbsFolder, "label-card-smoke-thumb.png");
  const detailThumbPath = path.join(thumbsFolder, "label-card-smoke-detail-thumb.png");
  fs.writeFileSync(imagePath, pngBytes);
  fs.writeFileSync(detailImagePath, pngBytes);
  fs.writeFileSync(thumbPath, pngBytes);
  fs.writeFileSync(detailThumbPath, pngBytes);

  const now = new Date().toISOString();
  runStatement(db, "INSERT INTO countries (id, name, sort_key, sort_order, notes, created_at) VALUES (?, ?, ?, ?, ?, ?)", ["country-smoke", "Smoke Entity", "Smoke Entity", 0, "", now]);
  runStatement(db, "INSERT INTO collection_types (id, name, sort_key, sort_order, description, custom_fields_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", ["type-smoke", "Stamp", "Stamp", 0, "", "{}", now]);
  runStatement(
    db,
    "INSERT INTO items (id, title, country_id, type_id, year, description, condition, purchase_price, source, tags_json, custom_fields_json, favorite, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ["item-label-smoke", "Label Smoke Item", "country-smoke", "type-smoke", "1912", "Manual label text.", "Fine", "", "Smoke source", "[\"label\"]", "{}", 0, now, now]
  );
  runStatement(
    db,
    "INSERT INTO images (id, item_id, original_filename, stored_filename, image_path, thumbnail_path, width, height, aspect_ratio, size_bytes, mime_type, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ["image-label-smoke", "item-label-smoke", "label-card-smoke-image.png", "label-card-smoke-image.png", imagePath, thumbPath, 400, 600, 0.6667, pngBytes.length, "image/png", 0, now]
  );
  runStatement(
    db,
    "INSERT INTO images (id, item_id, original_filename, stored_filename, image_path, thumbnail_path, width, height, aspect_ratio, size_bytes, mime_type, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ["image-label-detail-smoke", "item-label-smoke", "label-card-smoke-detail.png", "label-card-smoke-detail.png", detailImagePath, detailThumbPath, 400, 600, 0.6667, pngBytes.length, "image/png", 1, now]
  );

  fs.writeFileSync(dbPath, Buffer.from(db.export()));
  db.close();
}

async function main() {
  fs.mkdirSync(appData, { recursive: true });

  let child = launchElectron(port);
  let client = await connect(port);
  await waitFor(client, "Boolean(window.archiveAPI)", "archiveAPI did not load");
  const dbPath = await waitForFile(archiveData, "archive.sqlite");
  assert(dbPath, "Temporary archive database was not created");
  await stop(child);
  client.close();

  await seedDatabase(dbPath);

  child = launchElectron(port + 1);
  client = await connect(port + 1);
  await waitFor(client, "Boolean(window.archiveAPI && document.querySelector('.app'))", "App did not render");

  const result = await evaluate(
    client,
    `(async () => {
      let detail = await window.archiveAPI.createLabelCard({
        itemId: "item-label-smoke",
        title: "Stamp Exhibition Card",
        subtitle: "Smoke subtitle",
        main_text: "A manually written collection card.",
        small_notes: "front scan",
        provenance_text: "Smoke source",
        catalog_text: "REF-1",
        image_id: "image-label-smoke",
        image_position: "pair",
        preset: "stamp-exhibition",
        style: {
          fontSize: 18,
          alignment: "center",
          border: true,
          backgroundColor: "#d8bd82",
          textColor: "#3a2a19",
          cardSize: "small-ticket",
          exportScale: 2,
          material: "aged-paper",
          frame: "black-mount",
          edge: "clipped",
          side: "front",
          textureIntensity: 65,
          brightness: 96,
          aging: 45,
          secondaryImageId: "image-label-detail-smoke",
          backAcquisitionNotes: "Acquired for smoke testing.",
          backResearchNotes: "Research note persists."
        }
      });
      const card = detail.labelCards.find((entry) => entry.title === "Stamp Exhibition Card");
      return {
        cardId: card?.id,
        imageId: card?.image_id,
        preset: card?.preset,
        cardSize: card?.style?.cardSize,
        exportScale: card?.style?.exportScale,
        material: card?.style?.material,
        frame: card?.style?.frame,
        edge: card?.style?.edge,
        secondaryImageId: card?.style?.secondaryImageId,
        acquisitionNotes: card?.style?.backAcquisitionNotes
      };
    })()`
  );

  assert(result.cardId, `Label card was not created: ${JSON.stringify(result)}`);
  assert(result.imageId === "image-label-smoke", `Label card image did not persist: ${JSON.stringify(result)}`);
  assert(result.preset === "stamp-exhibition", `Label card preset did not persist: ${JSON.stringify(result)}`);
  assert(result.cardSize === "small-ticket", `Label card size did not persist: ${JSON.stringify(result)}`);
  assert(result.exportScale === 2, `Label card export scale did not persist: ${JSON.stringify(result)}`);
  assert(result.material === "aged-paper", `Label card material did not persist: ${JSON.stringify(result)}`);
  assert(result.frame === "black-mount", `Label card frame did not persist: ${JSON.stringify(result)}`);
  assert(result.edge === "clipped", `Label card edge did not persist: ${JSON.stringify(result)}`);
  assert(result.secondaryImageId === "image-label-detail-smoke", `Label card detail image did not persist: ${JSON.stringify(result)}`);
  assert(result.acquisitionNotes === "Acquired for smoke testing.", `Label card back-side notes did not persist: ${JSON.stringify(result)}`);

  await evaluate(client, "(() => { window.location.reload(); return true; })()");
  await waitFor(client, "[...document.querySelectorAll('.item-card .title-button')].some((button) => button.textContent.includes('Label Smoke Item'))", "Seeded item did not render after reload");
  await evaluate(client, `(() => {
    const button = [...document.querySelectorAll('.item-card .title-button')].find((entry) => entry.textContent.includes('Label Smoke Item'));
    button.click();
    return true;
  })()`);
  await waitFor(client, "Boolean(document.querySelector('.label-card-shelf-item'))", "Label Card shelf did not render in item detail");
  await evaluate(client, "(() => { document.querySelector('.label-card-shelf-item .ghost').click(); return true; })()");
  assert(await waitForFile(tempRoot, path.basename(rendererExportPath)), "Shelf Export PNG button did not create an output file");
  assert(fs.statSync(rendererExportPath).size > 20, `Shelf Label Card PNG was empty: ${rendererExportPath}`);
  let outputDimensions = pngDimensions(rendererExportPath);
  assert(outputDimensions.width === 1200 && outputDimensions.height === 720, `Shelf Label Card PNG dimensions were wrong: ${JSON.stringify(outputDimensions)}`);
  fs.rmSync(rendererExportPath, { force: true });

  await evaluate(client, "(() => { document.querySelector('.label-card-shelf-item .secondary').click(); return true; })()");
  await waitFor(client, "Boolean(document.querySelector('.label-card-modal .label-card-preview-stage'))", "Label Card editor modal did not open");
  const modalState = await evaluate(client, `(() => ({
    tabCount: document.querySelectorAll('.label-card-modal [role="tab"]').length,
    hasPreview: Boolean(document.querySelector('.label-card-modal .label-card-preview')),
    hasOverflowingBody: document.body.scrollWidth > document.body.clientWidth,
    previewWidth: Math.round(document.querySelector('.label-card-modal .label-card-preview').getBoundingClientRect().width),
    stageWidth: Math.round(document.querySelector('.label-card-preview-stage').getBoundingClientRect().width),
    controlsWidth: Math.round(document.querySelector('.label-card-controls').getBoundingClientRect().width),
    hasMaterial: document.querySelector('.label-card-modal .label-card-preview').classList.contains('material-aged-paper'),
    hasFrame: document.querySelector('.label-card-modal .label-card-preview').classList.contains('frame-black-mount'),
    hasEdge: document.querySelector('.label-card-modal .label-card-preview').classList.contains('edge-clipped'),
    imageCount: document.querySelectorAll('.label-card-modal .label-card-media img').length
  }))()`);
  assert(modalState.tabCount === 4, `Label Card modal tabs were incomplete: ${JSON.stringify(modalState)}`);
  assert(modalState.hasPreview, `Label Card modal preview was missing: ${JSON.stringify(modalState)}`);
  assert(!modalState.hasOverflowingBody, `Label Card modal caused app-level horizontal overflow: ${JSON.stringify(modalState)}`);
  assert(modalState.stageWidth > modalState.controlsWidth, `Label Card preview did not receive the flexible majority of modal width: ${JSON.stringify(modalState)}`);
  assert(modalState.previewWidth >= 600, `Small ticket preview was not enlarged for editing: ${JSON.stringify(modalState)}`);
  assert(modalState.hasMaterial && modalState.hasFrame && modalState.hasEdge, `Saved Label Card finish options did not reopen in preview: ${JSON.stringify(modalState)}`);
  assert(modalState.imageCount === 2, `Fixed pair layout did not render both selected images: ${JSON.stringify(modalState)}`);

  await evaluate(client, `(() => {
    const backButton = [...document.querySelectorAll('.label-card-side-toggle button')].find((button) => button.textContent.includes('Back'));
    backButton.click();
    return true;
  })()`);
  await waitFor(client, "Boolean(document.querySelector('.label-card-modal .label-card-preview.side-back .label-card-back'))", "Label Card back side did not render");
  await evaluate(client, "(() => { document.querySelector('.label-card-modal > footer .primary').click(); return true; })()");
  await waitFor(client, "!document.querySelector('.label-card-modal')", "Label Card editor did not close after saving side choice");
  await evaluate(client, "(() => { document.querySelector('.label-card-shelf-item .secondary').click(); return true; })()");
  await waitFor(client, "Boolean(document.querySelector('.label-card-modal .label-card-preview.side-back .label-card-back'))", "Saved Label Card back side did not persist after reopening");

  await evaluate(client, `(() => {
    const frontButton = [...document.querySelectorAll('.label-card-side-toggle button')].find((button) => button.textContent.includes('Front'));
    const styleTab = [...document.querySelectorAll('.label-card-modal [role="tab"]')].find((button) => button.textContent.includes('Style'));
    frontButton.click();
    styleTab.click();
    return true;
  })()`);
  await waitFor(client, "Boolean(document.querySelector('.label-card-control-section option[value=\"green-felt\"]'))", "Label Card Style tab did not render");
  await evaluate(client, `(() => {
    const setSelect = (value) => {
      const select = document.querySelector('.label-card-control-section option[value="' + value + '"]').parentElement;
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(select, value);
      select.dispatchEvent(new Event('change', { bubbles: true }));
    };
    setSelect('green-felt');
    setSelect('wood-slot');
    setSelect('embossed');
    const sliders = [...document.querySelectorAll('.label-card-finish-grid input[type="range"]')];
    for (const [input, value] of sliders.map((input, index) => [input, [72, 94, 28][index]])) {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, String(value));
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    }
    return true;
  })()`);
  await waitFor(client, `(() => {
    const preview = document.querySelector('.label-card-modal .label-card-preview');
    return preview?.classList.contains('material-green-felt')
      && preview.classList.contains('frame-wood-slot')
      && preview.classList.contains('edge-embossed')
      && preview.classList.contains('side-front')
      && preview.style.getPropertyValue('--texture-intensity') === '0.72'
      && preview.style.getPropertyValue('--surface-brightness') === '94%'
      && preview.style.getPropertyValue('--surface-aging') === '0.28';
  })()`, "Unsaved Label Card draft finish did not reach the modal preview");
  await evaluate(client, `(() => {
    const actualSize = [...document.querySelectorAll('.label-card-preview-toolbar button')].find((button) => button.textContent.includes('100%'));
    actualSize.click();
    return true;
  })()`);
  await waitFor(client, "document.querySelector('.label-card-preview-toolbar output')?.textContent === '100%' && [...document.querySelectorAll('.label-card-modal .label-card-media img')].every((image) => image.complete)", "Label Card preview was not ready at 100%");

  await evaluate(client, `(() => {
    const exportTab = [...document.querySelectorAll('.label-card-modal [role="tab"]')].find((button) => button.textContent.includes('Export'));
    exportTab.click();
    return true;
  })()`);
  await waitFor(client, "Boolean(document.querySelector('.label-card-export-panel .primary'))", "Label Card modal Export tab did not render");
  await evaluate(client, `(() => {
    const scale = document.querySelector('.label-card-export-panel select');
    scale.value = '1';
    scale.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await waitFor(client, "document.querySelector('.label-card-export-panel select')?.value === '1'", "Label Card export scale did not update");
  await evaluate(client, `(() => {
    window.__archiveLabelCardSmokeExport = null;
    window.addEventListener('archive:label-card-exported', (event) => {
      window.__archiveLabelCardSmokeExport = event.detail;
    }, { once: true });
    return true;
  })()`);
  await evaluate(client, "(() => { document.querySelector('.label-card-export-panel .primary').click(); return true; })()");
  assert(await waitForFile(tempRoot, path.basename(rendererExportPath)), "Modal Export PNG button did not create an output file");
  assert(fs.statSync(rendererExportPath).size > 20, `Modal Label Card PNG was empty: ${rendererExportPath}`);
  outputDimensions = pngDimensions(rendererExportPath);
  assert(outputDimensions.width === 600 && outputDimensions.height === 360, `Modal Label Card PNG dimensions were wrong: ${JSON.stringify(outputDimensions)}`);
  const finishStats = pngFinishStats(rendererExportPath);
  assert(finishStats.greenRatio > 0.2, `Unsaved green felt draft did not reach exported PNG: ${JSON.stringify(finishStats)}`);
  await waitFor(client, "Boolean(window.__archiveLabelCardSmokeExport?.diagnostics)", "Modal export diagnostics were not returned");
  const exportState = await evaluate(client, `(async () => {
    const item = await window.archiveAPI.getItem('item-label-smoke');
    return { diagnostics: window.__archiveLabelCardSmokeExport.diagnostics, savedStyle: item.labelCards[0].style };
  })()`);
  assert(exportState.diagnostics.pageClass.includes("material-green-felt"), `Export missed current draft material: ${JSON.stringify(exportState.diagnostics)}`);
  assert(exportState.diagnostics.pageClass.includes("frame-wood-slot"), `Export missed current draft frame: ${JSON.stringify(exportState.diagnostics)}`);
  assert(exportState.diagnostics.pageClass.includes("edge-embossed"), `Export missed current draft edge: ${JSON.stringify(exportState.diagnostics)}`);
  assert(exportState.diagnostics.pageClass.includes("side-front"), `Export missed current draft side: ${JSON.stringify(exportState.diagnostics)}`);
  assert(exportState.diagnostics.cardStyle.textureIntensity === "0.72", `Export texture intensity differed from preview: ${JSON.stringify(exportState.diagnostics)}`);
  assert(exportState.diagnostics.cardStyle.surfaceBrightness === "94%", `Export brightness differed from preview: ${JSON.stringify(exportState.diagnostics)}`);
  assert(exportState.diagnostics.cardStyle.surfaceAging === "0.28", `Export aging differed from preview: ${JSON.stringify(exportState.diagnostics)}`);
  assert(exportState.diagnostics.frameStyle?.backgroundImage?.includes("linear-gradient"), `Wood frame CSS was missing from export: ${JSON.stringify(exportState.diagnostics)}`);
  assert(exportState.diagnostics.cardStyle.boxShadow !== "none", `Embossed edge CSS was missing from export: ${JSON.stringify(exportState.diagnostics)}`);
  assert(exportState.savedStyle.material === "aged-paper" && exportState.savedStyle.frame === "black-mount" && exportState.savedStyle.edge === "clipped", `Modal test draft was unexpectedly saved before export: ${JSON.stringify(exportState.savedStyle)}`);
  assert(!client.runtimeExceptions.some((message) => /ReferenceError|sanitizeExportName/.test(message)), `Renderer export raised a runtime ReferenceError: ${JSON.stringify(client.runtimeExceptions)}`);

  console.log(`Label card smoke passed: ${rendererExportPath}`);
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
    if (failed) process.exit(1);
  });
