const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { createRequire } = require("module");

const requireFromRoot = createRequire(path.join(process.cwd(), "package.json"));
const initSqlJs = requireFromRoot("sql.js");

const root = process.cwd();
const tempRoot = path.join(root, `.tmp-album-smoke-${Date.now()}`);
const appData = path.join(tempRoot, "appdata");
const userData = path.join(tempRoot, "user-data");
const archiveData = path.join(tempRoot, "collection-archive-data");
const artifactsDir = path.join(root, "test-artifacts");
const portBase = 9320 + Math.floor(Math.random() * 300);
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

function launchElectron(port) {
  const electronExe = path.join(root, "node_modules", "electron", "dist", "electron.exe");
  const child = spawn(electronExe, [`--remote-debugging-port=${port}`, `--user-data-dir=${userData}`, ".", "--disable-gpu"], {
    cwd: root,
    env: {
      ...process.env,
      APPDATA: appData,
      COLLECTION_ARCHIVE_DATA_DIR: archiveData,
      ELECTRON_ENABLE_LOGGING: "1"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout.on("data", (chunk) => process.stdout.write(`[electron] ${chunk}`));
  child.stderr.on("data", (chunk) => process.stderr.write(`[electron] ${chunk}`));
  activeChild = child;
  return child;
}

async function getWebSocketUrl(port) {
  const deadline = Date.now() + 20000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
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
      this.socket.addEventListener("message", (event) => {
        const message = JSON.parse(event.data);
        if (message.method === "Runtime.exceptionThrown") {
          this.runtimeExceptions.push(message.params?.exceptionDetails || message.params || message);
        }
        if (message.id && this.pending.has(message.id)) {
          const { resolve: done, reject: fail, method, expression } = this.pending.get(message.id);
          this.pending.delete(message.id);
          if (message.error) fail(new Error(`${method} failed: ${message.error.message}${expression ? `\n${expression}` : ""}`));
          else done(message.result);
        }
      });
    });
  }

  async send(method, params = {}) {
    await this.opened;
    const id = this.nextId++;
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, method, expression: params.expression });
    });
  }

  close() {
    this.socket.close();
  }
}

async function connect(port) {
  const client = new CdpClient(await getWebSocketUrl(port));
  await client.send("Runtime.enable");
  await client.send("Page.enable");
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

function assertNoRuntimeTypeErrors(client, context) {
  const failures = client.runtimeExceptions.filter((entry) => /TypeError|logRenderedImageState|getBoundingClientRect/.test(JSON.stringify(entry)));
  assert(failures.length === 0, `${context}: unexpected runtime exception ${JSON.stringify(failures[0])}`);
}

async function captureScreenshot(client, label) {
  fs.mkdirSync(artifactsDir, { recursive: true });
  console.log(`capturing screenshot ${label}`);
  try {
    const shot = await Promise.race([
      client.send("Page.captureScreenshot", { format: "png", fromSurface: true }),
      new Promise((_, reject) => setTimeout(() => reject(new Error("screenshot timed out")), 6000))
    ]);
    const filePath = path.join(artifactsDir, `${new Date().toISOString().replace(/[:.]/g, "-")}-${label}.png`);
    fs.writeFileSync(filePath, Buffer.from(shot.data, "base64"));
    console.log(`screenshot saved ${filePath}`);
    return filePath;
  } catch (error) {
    console.warn(`screenshot skipped ${label}: ${error.message}`);
    return null;
  }
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

  const dataFolder = path.dirname(dbPath);
  const imagesFolder = path.join(dataFolder, "images");
  const thumbsFolder = path.join(dataFolder, "thumbnails");
  fs.mkdirSync(imagesFolder, { recursive: true });
  fs.mkdirSync(thumbsFolder, { recursive: true });

  const imageOne = path.join(imagesFolder, "album-smoke-image-1.png");
  const imageTwo = path.join(imagesFolder, "album-smoke-image-2.png");
  const thumbOne = path.join(thumbsFolder, "album-smoke-thumb-1.png");
  const thumbTwo = path.join(thumbsFolder, "album-smoke-thumb-2.png");
  [imageOne, imageTwo, thumbOne, thumbTwo].forEach((file) => fs.writeFileSync(file, pngBytes));

  const now = new Date().toISOString();
  runStatement(db, "INSERT INTO countries (id, name, sort_key, sort_order, notes, created_at) VALUES (?, ?, ?, ?, ?, ?)", ["country-jp", "Japan", "Zulu", 0, "", now]);
  runStatement(db, "INSERT INTO countries (id, name, sort_key, sort_order, notes, created_at) VALUES (?, ?, ?, ?, ?, ?)", ["country-cn", "China", "Alpha", 1, "", now]);
  runStatement(db, "INSERT INTO countries (id, name, sort_key, sort_order, notes, created_at) VALUES (?, ?, ?, ?, ?, ?)", ["country-at", "Austria", "Middle", 2, "", now]);

  runStatement(db, "INSERT INTO collection_types (id, name, sort_key, sort_order, description, custom_fields_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", ["type-stamp", "Stamp", "Zulu", 0, "", "{}", now]);
  runStatement(db, "INSERT INTO collection_types (id, name, sort_key, sort_order, description, custom_fields_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", ["type-postcard", "Postcard", "Alpha", 1, "", "{}", now]);
  runStatement(db, "INSERT INTO collection_types (id, name, sort_key, sort_order, description, custom_fields_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", ["type-coin", "Coin", "Middle", 2, "", "{}", now]);

  runStatement(
    db,
    "INSERT INTO items (id, title, country_id, type_id, year, description, condition, purchase_price, source, tags_json, custom_fields_json, favorite, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ["item-multi", "Multi Image Test", "country-cn", "type-stamp", "1901", "Blue catalog entry", "Fine", "", "Estate box", "[\"imperial\",\"ship\"]", "{\"catalog\":\"A1\"}", 0, now, now]
  );
  runStatement(
    db,
    "INSERT INTO images (id, item_id, original_filename, stored_filename, image_path, thumbnail_path, width, height, aspect_ratio, size_bytes, mime_type, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ["image-one", "item-multi", "front.png", "album-smoke-image-1.png", imageOne, thumbOne, 400, 800, 0.5, pngBytes.length, "image/png", 0, now]
  );
  runStatement(
    db,
    "INSERT INTO images (id, item_id, original_filename, stored_filename, image_path, thumbnail_path, width, height, aspect_ratio, size_bytes, mime_type, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ["image-two", "item-multi", "back.png", "album-smoke-image-2.png", imageTwo, thumbTwo, 1200, 600, 2, pngBytes.length, "image/png", 1, now]
  );

  runStatement(db, "INSERT INTO albums (id, title, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)", ["album-smoke", "Album Smoke Test", "", now, now]);
  runStatement(
    db,
    "INSERT INTO album_pages (id, album_id, title, page_number, notes, column_count, page_width, page_height, orientation, background, custom_background, show_guides, snap_to_grid, grid_size, template_name, layout_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ["page-one", "album-smoke", "First page", 1, "", 3, 1000, 1400, "portrait", "cream", "#ffffff", 1, 1, 25, "blank", 2, now, now]
  );
  runStatement(
    db,
    "INSERT INTO album_pages (id, album_id, title, page_number, notes, column_count, page_width, page_height, orientation, background, custom_background, show_guides, snap_to_grid, grid_size, template_name, layout_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ["page-two", "album-smoke", "Second page", 2, "", 3, 1000, 1400, "portrait", "white", "#ffffff", 1, 1, 25, "blank", 2, now, now]
  );
  runStatement(
    db,
    "INSERT INTO album_page_items (id, page_id, item_id, image_id, x, y, width, height, rotation, z_index, caption, show_caption, show_title, show_metadata, locked, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ["slot-two", "page-one", "item-multi", "image-two", 80, 110, 330, 240, 0, 1, "Back scan", 1, 1, 1, 1, 0, now]
  );
  runStatement(
    db,
    "INSERT INTO album_page_items (id, page_id, item_id, image_id, x, y, width, height, rotation, z_index, caption, show_caption, show_title, show_metadata, locked, sort_order, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ["slot-one", "page-one", "item-multi", "image-one", 480, 110, 230, 360, 0, 2, "Front scan", 1, 1, 1, 1, 1, now]
  );

  fs.writeFileSync(dbPath, Buffer.from(db.export()));
  db.close();
}

async function main() {
  fs.mkdirSync(appData, { recursive: true });

  let child = launchElectron(portBase);
  let client = await connect(portBase);
  await waitFor(client, "Boolean(window.archiveAPI)", "archiveAPI did not load");
  await stop(child);
  client.close();

  const dbPath = findFile(archiveData, "archive.sqlite");
  assert(dbPath, "Temporary archive database was not created");
  await seedDatabase(dbPath);

  child = launchElectron(portBase + 1);
  client = await connect(portBase + 1);
  await waitFor(client, "Boolean(window.archiveAPI && document.querySelector('.app'))", "App did not render");

  const data = await evaluate(
    client,
    `(async () => {
      const library = await window.archiveAPI.getLibrary();
      const album = await window.archiveAPI.getAlbum("album-smoke");
      return {
        countries: library.countries.map((entry) => entry.name),
        types: library.types.map((entry) => entry.name),
        countryIds: library.countries.map((entry) => entry.id),
        typeIds: library.types.map((entry) => entry.id),
        coverIds: album.pages[0].items.map((entry) => entry.cover && entry.cover.id),
        imageCounts: album.pages[0].items.map((entry) => entry.images.length),
        placementBoxes: album.pages[0].items.map((entry) => ({ x: entry.x, y: entry.y, width: entry.width, height: entry.height }))
      };
    })()`
  );

  assert(JSON.stringify(data.countries) === JSON.stringify(["Japan", "China", "Austria"]), `Unexpected manual country order: ${data.countries.join(", ")}`);
  assert(JSON.stringify(data.types) === JSON.stringify(["Stamp", "Postcard", "Coin"]), `Unexpected manual type order: ${data.types.join(", ")}`);
  assert(JSON.stringify(data.coverIds) === JSON.stringify(["image-two", "image-one"]), `Unexpected album cover ids: ${data.coverIds.join(", ")}`);
  assert(data.imageCounts.every((count) => count === 2), "Album slot image selector data is missing images");
  assert(data.placementBoxes.every((box) => box.width > 20 && box.height > 20), "Album placements did not load freeform dimensions");

  const reordered = await evaluate(
    client,
    `(async () => {
      await window.archiveAPI.reorderCountries(["country-at", "country-cn", "country-jp"]);
      await window.archiveAPI.reorderTypes(["type-coin", "type-postcard", "type-stamp"]);
      const library = await window.archiveAPI.getLibrary();
      return {
        countries: library.countries.map((entry) => entry.name),
        types: library.types.map((entry) => entry.name)
      };
    })()`
  );
  assert(JSON.stringify(reordered.countries) === JSON.stringify(["Austria", "China", "Japan"]), `Country reorder failed: ${reordered.countries.join(", ")}`);
  assert(JSON.stringify(reordered.types) === JSON.stringify(["Coin", "Postcard", "Stamp"]), `Type reorder failed: ${reordered.types.join(", ")}`);

  const appendDelete = await evaluate(
    client,
    `(async () => {
      let library = await window.archiveAPI.createCountry({ name: "Brazil" });
      const brazil = library.countries.find((entry) => entry.name === "Brazil");
      library = await window.archiveAPI.createType({ name: "Cover" });
      const cover = library.types.find((entry) => entry.name === "Cover");
      const appended = {
        countries: library.countries.map((entry) => entry.name),
        types: library.types.map((entry) => entry.name)
      };
      await window.archiveAPI.reorderCountries(["country-at", brazil.id, "country-cn", "country-jp"]);
      await window.archiveAPI.reorderTypes(["type-coin", cover.id, "type-postcard", "type-stamp"]);
      await window.archiveAPI.deleteCountry({ id: brazil.id, action: "check" });
      await window.archiveAPI.deleteType({ id: cover.id, action: "check" });
      library = await window.archiveAPI.getLibrary();
      return {
        appended,
        afterDelete: {
          countries: library.countries.map((entry) => entry.name),
          countryOrders: library.countries.map((entry) => entry.sort_order),
          types: library.types.map((entry) => entry.name),
          typeOrders: library.types.map((entry) => entry.sort_order)
        }
      };
    })()`
  );
  assert(JSON.stringify(appendDelete.appended.countries) === JSON.stringify(["Austria", "China", "Japan", "Brazil"]), `New country did not append: ${appendDelete.appended.countries.join(", ")}`);
  assert(JSON.stringify(appendDelete.appended.types) === JSON.stringify(["Coin", "Postcard", "Stamp", "Cover"]), `New type did not append: ${appendDelete.appended.types.join(", ")}`);
  assert(JSON.stringify(appendDelete.afterDelete.countries) === JSON.stringify(["Austria", "China", "Japan"]), `Country delete/normalize failed: ${appendDelete.afterDelete.countries.join(", ")}`);
  assert(JSON.stringify(appendDelete.afterDelete.countryOrders) === JSON.stringify([0, 1, 2]), `Country sort_order normalization failed: ${appendDelete.afterDelete.countryOrders.join(", ")}`);
  assert(JSON.stringify(appendDelete.afterDelete.types) === JSON.stringify(["Coin", "Postcard", "Stamp"]), `Type delete/normalize failed: ${appendDelete.afterDelete.types.join(", ")}`);
  assert(JSON.stringify(appendDelete.afterDelete.typeOrders) === JSON.stringify([0, 1, 2]), `Type sort_order normalization failed: ${appendDelete.afterDelete.typeOrders.join(", ")}`);

  const entityGroupSmoke = await evaluate(
    client,
    `(async () => {
      let library = await window.archiveAPI.createEntityGroup({ name: "British Empire", kind: "historical", notes: "Smoke group" });
      library = await window.archiveAPI.createEntityGroup({ name: "North America" });
      const empire = library.entityGroups.find((entry) => entry.name === "British Empire");
      const northAmerica = library.entityGroups.find((entry) => entry.name === "North America");
      await window.archiveAPI.reorderEntityGroups([northAmerica.id, empire.id]);
      await window.archiveAPI.setEntityMemberships({ entityId: "country-cn", groupIds: [empire.id, northAmerica.id] });
      library = await window.archiveAPI.getLibrary();
      const groupQuery = await window.archiveAPI.queryItems({ entityGroupId: empire.id, limit: 10, offset: 0 });
      const entityQuery = await window.archiveAPI.queryItems({ countryId: "country-cn", limit: 10, offset: 0 });
      const combinedQuery = await window.archiveAPI.queryItems({ countryId: "country-cn", entityGroupId: empire.id, limit: 10, offset: 0 });
      const titleSearch = await window.archiveAPI.queryItems({ searchText: "Multi", limit: 10, offset: 0 });
      const sourceSearch = await window.archiveAPI.queryItems({ searchText: "Estate", limit: 10, offset: 0 });
      const conditionSearch = await window.archiveAPI.queryItems({ searchText: "Fine", limit: 10, offset: 0 });
      const yearSearch = await window.archiveAPI.queryItems({ searchText: "1901", limit: 10, offset: 0 });
      const tagSearch = await window.archiveAPI.queryItems({ searchText: "imperial", limit: 10, offset: 0 });
      const entityNameSearch = await window.archiveAPI.queryItems({ searchText: "China", limit: 10, offset: 0 });
      const singleTagFilter = await window.archiveAPI.queryItems({ tag: "imperial", limit: 10, offset: 0 });
      const multiTagFilter = await window.archiveAPI.queryItems({ tag: "imperial, ship", limit: 10, offset: 0 });
      const spacedTagFilter = await window.archiveAPI.queryItems({ tag: " imperial ; ship ", limit: 10, offset: 0 });
      const missingMultiTagFilter = await window.archiveAPI.queryItems({ tag: "imperial, Aden", limit: 10, offset: 0 });
      const combinedTagFilter = await window.archiveAPI.queryItems({ entityGroupId: empire.id, tag: "imperial, ship", limit: 10, offset: 0 });
      return {
        groups: library.entityGroups.map((entry) => entry.name),
        memberships: library.entityMemberships.filter((entry) => entry.entity_id === "country-cn").map((entry) => String(entry.group_id)).sort(),
        expectedMemberships: [empire.id, northAmerica.id].map(String).sort(),
        groupQueryTotal: groupQuery.total,
        entityQueryTotal: entityQuery.total,
        combinedQueryTotal: combinedQuery.total,
        titleSearchTotal: titleSearch.total,
        sourceSearchTotal: sourceSearch.total,
        conditionSearchTotal: conditionSearch.total,
        yearSearchTotal: yearSearch.total,
        tagSearchTotal: tagSearch.total,
        entityNameSearchTotal: entityNameSearch.total,
        singleTagFilterTotal: singleTagFilter.total,
        multiTagFilterTotal: multiTagFilter.total,
        spacedTagFilterTotal: spacedTagFilter.total,
        missingMultiTagFilterTotal: missingMultiTagFilter.total,
        combinedTagFilterTotal: combinedTagFilter.total,
        groupNamesOnItem: groupQuery.items[0]?.entity_group_names || ""
      };
    })()`
  );
  assert(JSON.stringify(entityGroupSmoke.groups) === JSON.stringify(["North America", "British Empire"]), `Entity group reorder failed: ${entityGroupSmoke.groups.join(", ")}`);
  assert(JSON.stringify(entityGroupSmoke.memberships) === JSON.stringify(entityGroupSmoke.expectedMemberships), `Entity membership did not persist: ${JSON.stringify(entityGroupSmoke)}`);
  assert(entityGroupSmoke.groupQueryTotal === 1, `Entity group filter failed: ${JSON.stringify(entityGroupSmoke)}`);
  assert(entityGroupSmoke.entityQueryTotal === 1 && entityGroupSmoke.combinedQueryTotal === 1, `Entity/entity group combined filters failed: ${JSON.stringify(entityGroupSmoke)}`);
  assert(entityGroupSmoke.titleSearchTotal === 1 && entityGroupSmoke.sourceSearchTotal === 1 && entityGroupSmoke.conditionSearchTotal === 1, `Text search failed: ${JSON.stringify(entityGroupSmoke)}`);
  assert(entityGroupSmoke.yearSearchTotal === 0 && entityGroupSmoke.tagSearchTotal === 0 && entityGroupSmoke.entityNameSearchTotal === 0, `Search should not match year/tag/entity names: ${JSON.stringify(entityGroupSmoke)}`);
  assert(entityGroupSmoke.singleTagFilterTotal === 1, `Single tag filter failed: ${JSON.stringify(entityGroupSmoke)}`);
  assert(entityGroupSmoke.multiTagFilterTotal === 1 && entityGroupSmoke.spacedTagFilterTotal === 1, `Multi-tag filter failed: ${JSON.stringify(entityGroupSmoke)}`);
  assert(entityGroupSmoke.missingMultiTagFilterTotal === 0, `Multi-tag filter should use AND semantics: ${JSON.stringify(entityGroupSmoke)}`);
  assert(entityGroupSmoke.combinedTagFilterTotal === 1, `Combined entity-group and multi-tag filter failed: ${JSON.stringify(entityGroupSmoke)}`);
  assert(entityGroupSmoke.groupNamesOnItem.includes("British Empire"), `Item did not include inherited group names: ${JSON.stringify(entityGroupSmoke)}`);

  await evaluate(client, `window.archiveAPI.createEntityGroup({ name: "Europe" }).then(() => { window.location.reload(); return true; })`);
  await waitFor(client, "Boolean(window.archiveAPI && document.querySelector('.app'))", "App did not rerender after entity group setup");
  await evaluate(
    client,
    `(() => {
      [...document.querySelectorAll("button")].find((button) => button.textContent.trim() === "Manage lists").click();
      return true;
    })()`
  );
  await waitFor(client, "document.querySelector('.manage-modal')", "Manage Lists did not open");
  await evaluate(
    client,
    `(() => {
      [...document.querySelectorAll('.manage-tabs button')]
        .find((button) => button.textContent.trim() === 'Issuing Entities').click();
      return true;
    })()`
  );
  await waitFor(client, "[...document.querySelectorAll('.manage-tab-panel .manage-row strong')].some((entry) => entry.textContent.trim() === 'China')", "Issuing Entities tab did not show China");
  await evaluate(
    client,
    `(() => {
      const issuingSection = document.querySelector('.manage-tab-panel section');
      const row = [...issuingSection.querySelectorAll('.manage-row')]
        .find((entry) => entry.querySelector('strong')?.textContent.trim() === 'China');
      [...row.querySelectorAll('button')].find((button) => button.textContent.trim() === 'Edit').click();
      return true;
    })()`
  );
  await waitFor(client, "document.querySelector('.membership-editor')", "Issuing entity membership editor did not open");
  const groupAssignmentUi = await evaluate(
    client,
    `(async () => {
      const before = [...document.querySelectorAll('.group-chip')]
        .map((chip) => (chip.firstChild?.textContent || '').trim());
      const oldCheckboxList = Boolean(document.querySelector('.membership-fieldset'));
      [...document.querySelectorAll('.membership-editor button')].find((button) => button.textContent.trim() === 'Add group').click();
      await new Promise((resolve) => setTimeout(resolve, 80));
      const search = document.querySelector('.group-picker input[aria-label="Search entity groups"]');
      search.value = 'Euro';
      search.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 80));
      const pickerRows = [...document.querySelectorAll('.group-picker-list label')].map((label) => label.textContent.trim());
      const europeRow = [...document.querySelectorAll('.group-picker-list label')]
        .find((label) => label.textContent.includes('Europe'));
      const europeInput = europeRow.querySelector('input');
      const rowStyle = getComputedStyle(europeRow);
      const pickerRowDisplay = rowStyle.display;
      const inputRect = europeInput.getBoundingClientRect();
      const rowRect = europeRow.getBoundingClientRect();
      europeRow.querySelector('input').click();
      [...document.querySelectorAll('.group-picker-actions button')]
        .find((button) => button.textContent.trim() === 'Add selected groups').click();
      await new Promise((resolve) => setTimeout(resolve, 80));
      const after = [...document.querySelectorAll('.group-chip')]
        .map((chip) => (chip.firstChild?.textContent || '').trim());
      [...document.querySelectorAll('form.modal footer button')]
        .find((button) => button.textContent.trim() === 'Save').click();
      await new Promise((resolve) => setTimeout(resolve, 300));
      const library = await window.archiveAPI.getLibrary();
      const europe = library.entityGroups.find((entry) => entry.name === 'Europe');
      const persisted = library.entityMemberships.some((entry) => entry.entity_id === 'country-cn' && String(entry.group_id) === String(europe.id));
      document.querySelector('.manage-modal header button').click();
      return {
        before,
        after,
        oldCheckboxList,
        pickerRows,
        pickerRowDisplay,
        pickerInputWidth: Math.round(inputRect.width),
        pickerInputAligned: Math.abs((inputRect.top + inputRect.height / 2) - (rowRect.top + rowRect.height / 2)) < 4,
        persisted
      };
    })()`
  );
  assert(groupAssignmentUi.before.includes("British Empire") && groupAssignmentUi.before.includes("North America"), `Existing memberships did not render as chips: ${JSON.stringify(groupAssignmentUi)}`);
  assert(!groupAssignmentUi.oldCheckboxList, `Old always-visible checkbox list is still present: ${JSON.stringify(groupAssignmentUi)}`);
  assert(groupAssignmentUi.pickerRows.length === 1 && groupAssignmentUi.pickerRows[0] === "Europe", `Group picker search did not narrow results: ${JSON.stringify(groupAssignmentUi)}`);
  assert(groupAssignmentUi.pickerRowDisplay === "flex" && groupAssignmentUi.pickerInputWidth <= 20 && groupAssignmentUi.pickerInputAligned, `Group picker checkbox is not compact and inline: ${JSON.stringify(groupAssignmentUi)}`);
  assert(groupAssignmentUi.after.includes("Europe"), `Adding a group through the picker did not create a chip: ${JSON.stringify(groupAssignmentUi)}`);
  assert(groupAssignmentUi.persisted, `Group picker assignment did not persist: ${JSON.stringify(groupAssignmentUi)}`);

  await evaluate(
    client,
    `(() => {
      [...document.querySelectorAll("button")].find((button) => button.textContent.trim() === "Manage lists").click();
      return true;
    })()`
  );
  await waitFor(client, "document.querySelector('.manage-modal')", "Manage Lists did not reopen");
  const manageInitialUi = await evaluate(
    client,
    `(() => {
      const activeBefore = document.querySelector('.manage-tabs button.active')?.textContent.trim() || '';
      const collectionTypesFirst = document.querySelector('.manage-tabs button')?.textContent.trim() === 'Collection Types';
      const typeAddVisible = [...document.querySelectorAll('.manage-tab-panel button')].some((button) => button.textContent.trim() === 'Add type');
      return { activeBefore, collectionTypesFirst, typeAddVisible };
    })()`
  );
  await evaluate(
    client,
    `(() => {
      [...document.querySelectorAll('.manage-tabs button')].find((button) => button.textContent.trim() === 'Issuing Entities').click();
      return true;
    })()`
  );
  await waitFor(client, "document.querySelector('.manage-search')?.getAttribute('placeholder') === 'Search issuing entities...'", "Issuing Entities search did not render");
  const entityTabUi = await evaluate(
    client,
    `(async () => {
      const entitySearch = document.querySelector('.manage-search');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(entitySearch, 'Chi');
      entitySearch.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 120));
      const entityRows = [...document.querySelectorAll('.manage-row strong')].map((entry) => entry.textContent.trim());
      const entityDragHidden = !document.querySelector('.manage-row .drag-handle');
      const entityAddVisible = [...document.querySelectorAll('.manage-tab-panel button')].some((button) => button.textContent.trim() === 'Add entity');
      return { entityRows, entityDragHidden, entityAddVisible };
    })()`
  );
  await evaluate(
    client,
    `(() => {
      [...document.querySelectorAll('.manage-tabs button')].find((button) => button.textContent.trim() === 'Entity Groups').click();
      return true;
    })()`
  );
  await waitFor(client, "document.querySelector('.manage-search')?.getAttribute('placeholder') === 'Search entity groups...'", "Entity Groups search did not render");
  const groupTabUi = await evaluate(
    client,
    `(async () => {
      const groupSearch = document.querySelector('.manage-search');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(groupSearch, 'Euro');
      groupSearch.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 120));
      const groupRows = [...document.querySelectorAll('.manage-row strong')].map((entry) => entry.textContent.trim());
      const groupDragHidden = !document.querySelector('.manage-row .drag-handle');
      const groupAddVisible = [...document.querySelectorAll('.manage-tab-panel button')].some((button) => button.textContent.trim() === 'Add group');
      document.querySelector('.manage-modal header button').click();
      return { groupRows, groupDragHidden, groupAddVisible };
    })()`
  );
  assert(manageInitialUi.activeBefore === "Collection Types" && manageInitialUi.collectionTypesFirst && manageInitialUi.typeAddVisible, `Collection Types tab should be first and prominent: ${JSON.stringify(manageInitialUi)}`);
  assert(JSON.stringify(entityTabUi.entityRows) === JSON.stringify(["China"]) && entityTabUi.entityDragHidden && entityTabUi.entityAddVisible, `Issuing Entities searchable tab failed: ${JSON.stringify(entityTabUi)}`);
  assert(JSON.stringify(groupTabUi.groupRows) === JSON.stringify(["Europe"]) && groupTabUi.groupDragHidden && groupTabUi.groupAddVisible, `Entity Groups searchable tab failed: ${JSON.stringify(groupTabUi)}`);

  await evaluate(
    client,
    `(() => {
      [...document.querySelectorAll("button")].find((button) => button.textContent.trim() === "New item").click();
      return true;
    })()`
  );
  await waitFor(client, "document.querySelector('.entity-combobox')", "New item form did not show issuing entity combobox");
  const itemComboboxUi = await evaluate(
    client,
    `(async () => {
      const titleInput = document.querySelector('.form-grid input[required]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(titleInput, 'Combobox Smoke');
      titleInput.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('.entity-combobox-trigger').click();
      await new Promise((resolve) => setTimeout(resolve, 80));
      const search = document.querySelector('.entity-combobox-panel input');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(search, 'Aust');
      search.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 80));
      const resultNames = [...document.querySelectorAll('.entity-combobox-results button')].map((button) => button.textContent.trim()).filter(Boolean);
      [...document.querySelectorAll('.entity-combobox-results button')]
        .find((button) => button.textContent.trim() === 'Austria').click();
      await new Promise((resolve) => setTimeout(resolve, 80));
      const selectedBeforeSave = document.querySelector('.entity-combobox-trigger')?.textContent.trim();
      document.querySelector('.entity-combobox-clear').click();
      await new Promise((resolve) => setTimeout(resolve, 80));
      const selectedClearBeforeSave = document.querySelector('.entity-combobox-trigger')?.textContent.trim();
      document.querySelector('.entity-combobox-trigger').click();
      await new Promise((resolve) => setTimeout(resolve, 80));
      const searchAgain = document.querySelector('.entity-combobox-panel input');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(searchAgain, 'Aust');
      searchAgain.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 80));
      [...document.querySelectorAll('.entity-combobox-results button')]
        .find((button) => button.textContent.trim() === 'Austria').click();
      await new Promise((resolve) => setTimeout(resolve, 80));
      [...document.querySelectorAll('.modal footer button')]
        .find((button) => button.textContent.trim() === 'Save').click();
      await new Promise((resolve) => setTimeout(resolve, 500));
      let created = await window.archiveAPI.queryItems({ searchText: 'Combobox Smoke', limit: 1, offset: 0 });
      const item = created.items[0];
      if (!item) return { error: 'created item not found', resultNames, selectedBeforeSave, createdTotal: created.total };
      const detailBeforeClear = await window.archiveAPI.getItem(item.id);
      await window.archiveAPI.updateItem({
        id: item.id,
        title: detailBeforeClear.title,
        country_id: '',
        type_id: detailBeforeClear.type_id || '',
        year: detailBeforeClear.year || '',
        description: detailBeforeClear.description || '',
        condition: detailBeforeClear.condition || '',
        purchase_price: detailBeforeClear.purchase_price || '',
        source: detailBeforeClear.source || '',
        tags: detailBeforeClear.tags || [],
        customFields: detailBeforeClear.customFields || {},
        favorite: detailBeforeClear.favorite
      });
      const detail = await window.archiveAPI.getItem(item.id);
      await window.archiveAPI.deleteItem(item.id);
      return {
        resultNames,
        selectedBeforeSave,
        selectedClearBeforeSave,
        createdCountry: item.country_name,
        clearedCountryId: detail.country_id || ''
      };
    })()`
  );
  assert(itemComboboxUi.resultNames.includes("Austria"), `Issuing entity combobox search did not find Austria: ${JSON.stringify(itemComboboxUi)}`);
  assert(itemComboboxUi.selectedBeforeSave === "Austria" && itemComboboxUi.createdCountry === "Austria", `Selected issuing entity did not persist on create: ${JSON.stringify(itemComboboxUi)}`);
  assert(itemComboboxUi.selectedClearBeforeSave === "None" && itemComboboxUi.clearedCountryId === "", `Clearing issuing entity did not work: ${JSON.stringify(itemComboboxUi)}`);

  await evaluate(client, `(() => { window.location.reload(); return true; })()`);
  await waitFor(client, "Boolean(window.archiveAPI && document.querySelector('.item-card .favorite'))", "Library cards did not return after reload");

  const favoriteUi = await evaluate(
    client,
    `(async () => {
      const before = {
        text: document.querySelector('.item-card .favorite')?.textContent.trim(),
        label: document.querySelector('.item-card .favorite')?.getAttribute('aria-label'),
        saveWords: [...document.querySelectorAll('.item-card .favorite')].some((button) => /Save|Saved/.test(button.textContent))
      };
      document.querySelector('.item-card .favorite').click();
      await new Promise((resolve) => setTimeout(resolve, 300));
      const after = {
        text: document.querySelector('.item-card .favorite')?.textContent.trim(),
        label: document.querySelector('.item-card .favorite')?.getAttribute('aria-label')
      };
      return { before, after };
    })()`
  );
  assert(favoriteUi.before.text === "☆", `Expected empty star before favorite toggle, got ${favoriteUi.before.text}`);
  assert(favoriteUi.before.label === "Add to favorites", `Unexpected favorite aria label: ${favoriteUi.before.label}`);
  assert(!favoriteUi.before.saveWords, "Favorite item-card buttons still use Save/Saved wording");
  assert(favoriteUi.after.text === "★", `Expected filled star after favorite toggle, got ${favoriteUi.after.text}`);
  assert(favoriteUi.after.label === "Remove from favorites", `Unexpected favorite aria label after toggle: ${favoriteUi.after.label}`);

  await evaluate(
    client,
    `(() => {
      [...document.querySelectorAll("button")].find((button) => button.textContent.trim() === "Albums").click();
    })()`
  );
  await waitFor(client, "document.querySelector('.album-list button')", "Album list did not render");
  await evaluate(
    client,
    `(() => {
      [...document.querySelectorAll(".album-list button")].find((button) => button.textContent.includes("Album Smoke Test")).click();
    })()`
  );
  await waitFor(client, "document.querySelectorAll('.album-placement').length === 2", "Album placements did not render");

  const defaultPreview = await evaluate(
    client,
    `(() => ({
      cleanPreview: Boolean(document.querySelector('.image-only-preview')),
      textCount: document.querySelectorAll('.placement-text').length,
      pageLabel: document.querySelector('.album-page header span')?.textContent || '',
      pageTitle: document.querySelector('.album-page header h2')?.textContent || '',
      canvasWidth: Math.round(document.querySelector('.album-canvas').getBoundingClientRect().width),
      previewWrapper: (() => {
        const page = document.querySelector('.album-page');
        const styles = getComputedStyle(page);
        return {
          borderTopWidth: styles.borderTopWidth,
          backgroundColor: styles.backgroundColor,
          boxShadow: styles.boxShadow,
          headerVisible: getComputedStyle(page.querySelector('header')).display !== 'none'
        };
      })()
    }))()`
  );
  assert(defaultPreview.cleanPreview, "Clean preview should be the default");
  assert(defaultPreview.textCount === 0, "Clean preview should hide item metadata by default");
  assert(defaultPreview.pageLabel === "Page 1" && defaultPreview.pageTitle === "First page", `Unexpected page heading: ${defaultPreview.pageLabel} ${defaultPreview.pageTitle}`);
  assert(defaultPreview.canvasWidth > 300, "Album canvas did not render at a visible size");
  assert(defaultPreview.previewWrapper.borderTopWidth === "0px", `Preview still shows an outer page border: ${JSON.stringify(defaultPreview.previewWrapper)}`);
  assert(defaultPreview.previewWrapper.boxShadow === "none", `Preview still shows an outer page shadow: ${defaultPreview.previewWrapper.boxShadow}`);
  assert(!defaultPreview.previewWrapper.headerVisible, "Preview should not show the outer page header wrapper");
  const singlePagePreview = await evaluate(
    client,
    `(async () => {
      const selector = document.querySelector('.album-page-select');
      const initial = {
        pageCount: document.querySelectorAll('.album-page').length,
        placementCount: document.querySelectorAll('.album-placement').length,
        label: document.querySelector('.album-page header span')?.textContent || '',
        title: document.querySelector('.album-page header h2')?.textContent || ''
      };
      selector.value = 'page-two';
      selector.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 250));
      const second = {
        pageCount: document.querySelectorAll('.album-page').length,
        placementCount: document.querySelectorAll('.album-placement').length,
        label: document.querySelector('.album-page header span')?.textContent || '',
        title: document.querySelector('.album-page header h2')?.textContent || ''
      };
      selector.value = 'page-one';
      selector.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 250));
      const back = {
        pageCount: document.querySelectorAll('.album-page').length,
        placementCount: document.querySelectorAll('.album-placement').length,
        label: document.querySelector('.album-page header span')?.textContent || '',
        title: document.querySelector('.album-page header h2')?.textContent || ''
      };
      return { initial, second, back };
    })()`
  );
  assert(singlePagePreview.initial.pageCount === 1, `Preview should render one selected page, got ${singlePagePreview.initial.pageCount}`);
  assert(singlePagePreview.initial.placementCount === 2, `First preview page should show two placements, got ${singlePagePreview.initial.placementCount}`);
  assert(singlePagePreview.second.pageCount === 1, `Switching preview pages should still render one page, got ${singlePagePreview.second.pageCount}`);
  assert(singlePagePreview.second.placementCount === 0, `Second preview page should replace the first page, got ${singlePagePreview.second.placementCount} placements`);
  assert(singlePagePreview.second.label === "Page 2" && singlePagePreview.second.title === "Second page", `Preview page switch failed: ${singlePagePreview.second.label} ${singlePagePreview.second.title}`);
  assert(singlePagePreview.back.pageCount === 1 && singlePagePreview.back.placementCount === 2, "Switching preview back to Page 1 did not restore the selected page");
  await captureScreenshot(client, "album-clean-preview");
  await evaluate(client, `localStorage.setItem("archiveDebugMedia", "1")`);

  await evaluate(
    client,
    `(() => {
      [...document.querySelectorAll("button")].find((button) => button.textContent.trim() === "Designed page").click();
    })()`
  );
  await waitFor(client, "!document.querySelector('.image-only-preview')", "Designed page preview did not activate");
  const designedPreview = await evaluate(
    client,
    `(() => {
      const placements = [...document.querySelectorAll('.album-placement')];
      return {
        textCount: document.querySelectorAll('.placement-text').length,
        overlaps: placements.some((placement) => {
          const image = placement.querySelector('.placement-image-button')?.getBoundingClientRect();
          const text = placement.querySelector('.placement-text')?.getBoundingClientRect();
          if (!image || !text) return false;
          return !(text.top >= image.bottom - 1 || text.bottom <= image.top + 1 || text.left >= image.right - 1 || text.right <= image.left + 1);
        })
      };
    })()`
  );
  assert(designedPreview.textCount === 2, "Designed page preview should show placement text");
  assert(!designedPreview.overlaps, "Designed page text overlaps placement images");
  await evaluate(client, "document.querySelector('.placement-image-button').click()");
  await waitFor(
    client,
    "(() => { const img = [...document.querySelectorAll('.viewer .zoom-canvas img')].find((entry) => ((entry.getAttribute('data-media-src') || entry.getAttribute('src') || '').includes('album-smoke-image-2.png'))) || document.querySelector('.viewer .zoom-canvas img'); return img && img.naturalWidth > 0 && img.getBoundingClientRect().width > 4; })()",
    "Designed preview click did not open a visible image viewer"
  );
  const designedViewer = await evaluate(
    client,
    `(() => {
      const image = [...document.querySelectorAll('.viewer .zoom-canvas img')].find((entry) => ((entry.getAttribute('data-media-src') || entry.getAttribute('src') || '').includes('album-smoke-image-2.png'))) || document.querySelector('.viewer .zoom-canvas img');
      return {
        src: image?.getAttribute('data-media-src') || image?.getAttribute('src') || '',
        naturalWidth: image?.naturalWidth || 0,
        rectWidth: Math.round(image?.getBoundingClientRect().width || 0),
        rectHeight: Math.round(image?.getBoundingClientRect().height || 0),
        zoomLabel: document.querySelector('.viewer .zoom-controls span')?.textContent || '',
        closeVisible: Boolean(document.querySelector('.viewer .viewer-close')?.getBoundingClientRect().width),
        closeCount: document.querySelectorAll('.viewer .viewer-close').length,
        closeText: document.querySelector('.viewer .viewer-close')?.textContent || '',
        closeRect: (() => {
          const rect = document.querySelector('.viewer .viewer-close')?.getBoundingClientRect();
          return rect ? { width: Math.round(rect.width), height: Math.round(rect.height), x: Math.round(rect.x), y: Math.round(rect.y) } : null;
        })(),
        notFound: document.querySelector('.viewer .large-placeholder')?.textContent || ''
      };
    })()`
  );
  assert(designedViewer.src.includes('/images/') || designedViewer.src.includes('archive://local/images/'), `Designed preview viewer did not use a full image URL: ${designedViewer.src}`);
  assert(designedViewer.src.includes('album-smoke-image-2.png'), `Designed preview opened the wrong placement image: ${designedViewer.src}`);
  assert(designedViewer.rectWidth > 4 && designedViewer.rectHeight > 4, `Designed preview viewer image rendered too small: ${JSON.stringify(designedViewer)}`);
  assert(designedViewer.zoomLabel !== "10%", `Designed preview viewer opened at minimum zoom: ${JSON.stringify(designedViewer)}`);
  assert(designedViewer.closeVisible, `Designed preview viewer Close button is not visible: ${JSON.stringify(designedViewer)}`);
  assert(!designedViewer.notFound, `Designed preview showed missing image: ${designedViewer.notFound}`);
  assertNoRuntimeTypeErrors(client, "Designed preview debug viewer");
  await evaluate(client, `[...document.querySelectorAll("button")].find((button) => button.textContent.trim() === "Close").click()`);

  await evaluate(
    client,
    `(async () => {
      const preview = [...document.querySelectorAll("button")].find((button) => button.textContent.trim() === "Preview");
      preview?.click();
      await new Promise((resolve) => setTimeout(resolve, 150));
      const cleanPreview = [...document.querySelectorAll("button")].find((button) => button.textContent.trim() === "Clean preview");
      if (!cleanPreview) throw new Error("Clean preview toggle not found after switching to Preview");
      cleanPreview.click();
    })()`
  );
  await waitFor(client, "document.querySelector('.image-only-preview')", "Clean preview did not reactivate");

  await evaluate(client, "document.querySelector('.placement-image-button').click()");
  await waitFor(
    client,
    "(() => { const img = [...document.querySelectorAll('.viewer .zoom-canvas img')].find((entry) => ((entry.getAttribute('data-media-src') || entry.getAttribute('src') || '').includes('album-smoke-image-2.png'))) || document.querySelector('.viewer .zoom-canvas img'); return img && img.naturalWidth > 0 && img.getBoundingClientRect().width > 4; })()",
    "Clean preview click did not open a visible viewer image"
  );
  const cleanViewer = await evaluate(
    client,
    `(() => {
      const image = [...document.querySelectorAll('.viewer .zoom-canvas img')].find((entry) => ((entry.getAttribute('data-media-src') || entry.getAttribute('src') || '').includes('album-smoke-image-2.png'))) || document.querySelector('.viewer .zoom-canvas img');
      const textBox = document.querySelector('.text-placement');
      textBox?.click();
      return {
        src: image?.getAttribute('data-media-src') || image?.getAttribute('src') || '',
        naturalWidth: image?.naturalWidth || 0,
        rectWidth: Math.round(image?.getBoundingClientRect().width || 0),
        rectHeight: Math.round(image?.getBoundingClientRect().height || 0),
        zoomLabel: document.querySelector('.viewer .zoom-controls span')?.textContent || '',
        closeVisible: Boolean(document.querySelector('.viewer .viewer-close')?.getBoundingClientRect().width),
        viewerCountAfterTextClick: document.querySelectorAll('.viewer').length,
        notFound: document.querySelector('.viewer .large-placeholder')?.textContent || ''
      };
    })()`
  );
  assert(cleanViewer.src.includes('/images/') || cleanViewer.src.includes('archive://local/images/'), `Clean preview viewer did not use a full image URL: ${cleanViewer.src}`);
  assert(cleanViewer.src.includes('album-smoke-image-2.png'), `Clean preview opened the wrong placement image: ${cleanViewer.src}`);
  assert(cleanViewer.rectWidth > 4 && cleanViewer.rectHeight > 4, `Clean preview viewer image rendered too small: ${JSON.stringify(cleanViewer)}`);
  assert(cleanViewer.zoomLabel !== "10%", `Clean preview viewer opened at minimum zoom: ${JSON.stringify(cleanViewer)}`);
  assert(cleanViewer.closeVisible, "Clean preview viewer Close button is not visible");
  assert(!cleanViewer.notFound, `Clean preview showed missing image: ${cleanViewer.notFound}`);
  assert(cleanViewer.viewerCountAfterTextClick === 1, "Text box click should not open another image viewer");
  assertNoRuntimeTypeErrors(client, "Clean preview debug viewer");
  await evaluate(client, `document.querySelector('.viewer .zoom-canvas img').dispatchEvent(new Event('error', { bubbles: true }))`);
  await waitFor(client, "document.querySelector('.viewer .large-placeholder') || document.querySelector('.viewer .zoom-canvas img')", "Viewer did not respond to simulated image error");
  await evaluate(client, `document.querySelector('.viewer .zoom-canvas img')?.dispatchEvent(new Event('error', { bubbles: true }))`);
  await waitFor(client, "document.querySelector('.viewer .large-placeholder')?.textContent.includes('Image not found')", "Missing album preview image did not show an error message");
  assertNoRuntimeTypeErrors(client, "Missing image debug viewer");
  await evaluate(client, `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await waitFor(client, "!document.querySelector('.viewer')", "Escape did not close the viewer");

  await evaluate(
    client,
    `(() => {
      [...document.querySelectorAll("button")].find((button) => button.textContent.trim() === "Edit").click();
    })()`
  );
  await waitFor(client, "document.querySelector('.page-settings-panel')", "Edit mode did not render page settings");
  const addPicker = await evaluate(
    client,
    `(() => ({
      nativeItemSelectCount: [...document.querySelectorAll('.album-controls select')].filter((select) => [...select.options].some((option) => option.textContent.includes('Multi Image Test'))).length,
      hasAddButton: [...document.querySelectorAll('button')].some((button) => button.textContent.trim() === 'Add item'),
      pageSelectorInAddRow: Boolean(document.querySelector('form.album-page-row .album-page-select')),
      duplicateTopPageTitle: Boolean([...document.querySelectorAll('.album-toolbar input')].find((input) => input.placeholder === 'Page title'))
    }))()`
  );
  assert(addPicker.nativeItemSelectCount === 0, "Album edit mode still renders a giant native item select");
  assert(addPicker.hasAddButton, "Album edit mode missing Add item button");
  assert(addPicker.pageSelectorInAddRow, "Page selector should share the compact Add page row in Edit mode");
  assert(!addPicker.duplicateTopPageTitle, "Edit header should not show a duplicate Page title input");
  const editLayoutState = await evaluate(
    client,
    `(() => {
      const albumList = document.querySelector('.album-list').getBoundingClientRect();
      return {
        editLayout: document.querySelector('.albums-view')?.classList.contains('edit-layout'),
        listWidth: Math.round(albumList.width),
        hasFocusButton: [...document.querySelectorAll("button")].some((button) => button.textContent.trim() === "Focus editor")
      };
    })()`
  );
  assert(editLayoutState.editLayout, "Edit layout did not activate");
  assert(editLayoutState.listWidth <= 90, `Edit album list should be a narrow strip, got ${editLayoutState.listWidth}px`);
  assert(!editLayoutState.hasFocusButton, "Focus editor button should be removed in the simplified edit layout");
  const pageSizingState = await evaluate(
    client,
    `(async () => {
      const nativeConfirm = window.confirm;
      window.confirm = () => false;
      const paperLabel = [...document.querySelectorAll('.page-settings-panel label')].find((label) => label.textContent.includes('Paper size'));
      const paperSelect = paperLabel.querySelector('select');
      const setPreset = async (value) => {
        paperSelect.value = value;
        paperSelect.dispatchEvent(new Event('change', { bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 600));
        const album = await window.archiveAPI.getAlbum('album-smoke');
        const page = album.pages.find((entry) => entry.id === document.querySelector('.album-page-select').value);
        return { width: page.page_width, height: page.page_height, preset: page.paper_preset };
      };
      const a4Portrait = await setPreset('a4-portrait');
      const a4Landscape = await setPreset('a4-landscape');
      const letterPortrait = await setPreset('letter-portrait');
      const letterLandscape = await setPreset('letter-landscape');
      paperSelect.value = 'custom';
      paperSelect.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 150));
      const widthInput = [...document.querySelectorAll('.page-settings-panel label')].find((label) => label.textContent.includes('Custom width')).querySelector('input');
      const heightInput = [...document.querySelectorAll('.page-settings-panel label')].find((label) => label.textContent.includes('Custom height')).querySelector('input');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(widthInput, '777');
      widthInput.dispatchEvent(new Event('input', { bubbles: true }));
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(heightInput, '888');
      heightInput.dispatchEvent(new Event('input', { bubbles: true }));
      [...document.querySelectorAll("button")].find((button) => button.textContent.trim() === "Save page").click();
      await new Promise((resolve) => setTimeout(resolve, 600));
      let album = await window.archiveAPI.getAlbum('album-smoke');
      let activePage = album.pages.find((entry) => entry.id === document.querySelector('.album-page-select').value);
      const custom = { width: activePage.page_width, height: activePage.page_height, preset: activePage.paper_preset };
      const square = await setPreset('square');
      window.confirm = nativeConfirm;
      [...document.querySelectorAll("button")].find((button) => button.textContent.trim() === "Fit page").click();
      await new Promise((resolve) => setTimeout(resolve, 300));
      const canvas = document.querySelector('.album-canvas').getBoundingClientRect();
      const wrap = document.querySelector('.album-canvas-wrap');
      const beforeWheelWidth = Math.round(canvas.width);
      const wheelRect = wrap.getBoundingClientRect();
      const normalWheelAllowed = wrap.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 120, clientX: wheelRect.left + 80, clientY: wheelRect.top + 80 }));
      const ctrlWheelAllowed = wrap.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, ctrlKey: true, deltaY: -180, clientX: wheelRect.left + 80, clientY: wheelRect.top + 80 }));
      await new Promise((resolve) => setTimeout(resolve, 200));
      const afterCtrlWheelWidth = Math.round(document.querySelector('.album-canvas').getBoundingClientRect().width);
      [...document.querySelectorAll("button")].find((button) => button.textContent.trim() === "Fit page").click();
      await new Promise((resolve) => setTimeout(resolve, 250));
      const refitCanvas = document.querySelector('.album-canvas').getBoundingClientRect();
      wrap.scrollTop = wrap.scrollHeight;
      await new Promise((resolve) => setTimeout(resolve, 80));
      const canvasBottomReachable = Math.abs(wrap.scrollTop - Math.max(0, wrap.scrollHeight - wrap.clientHeight)) <= 4;
      const panel = document.querySelector('.placement-inspector-panel');
      panel.scrollTop = panel.scrollHeight;
      await new Promise((resolve) => setTimeout(resolve, 80));
      const panelBottomReachable = Math.abs(panel.scrollTop - Math.max(0, panel.scrollHeight - panel.clientHeight)) <= 4;
      return {
        a4Portrait,
        a4Landscape,
        letterPortrait,
        letterLandscape,
        custom,
        square,
        orientationDropdowns: [...document.querySelectorAll('.page-settings-panel label')].filter((label) => label.textContent.trim().startsWith('Orientation')).length,
        width: Math.round(refitCanvas.width),
        height: Math.round(refitCanvas.height),
        noHorizontalOverflow: wrap.scrollWidth <= wrap.clientWidth + 3,
        usefulSize: Math.round(refitCanvas.width) >= Math.min(620, wrap.clientWidth - 24),
        normalWheelAllowed,
        ctrlWheelAllowed,
        ctrlWheelZoomed: afterCtrlWheelWidth > beforeWheelWidth,
        fullScaledHeightReserved: wrap.scrollHeight >= Math.round(refitCanvas.height),
        canvasBottomReachable,
        panelBottomReachable,
        pageSettingsVisible: Boolean(document.querySelector('.page-settings-panel'))
      };
    })()`
  );
  assert(pageSizingState.a4Portrait.width === 1000 && pageSizingState.a4Portrait.height === 1414, `A4 portrait dimensions wrong: ${JSON.stringify(pageSizingState.a4Portrait)}`);
  assert(pageSizingState.a4Landscape.width === 1414 && pageSizingState.a4Landscape.height === 1000, `A4 landscape dimensions wrong: ${JSON.stringify(pageSizingState.a4Landscape)}`);
  assert(pageSizingState.letterPortrait.width === 1000 && pageSizingState.letterPortrait.height === 1294, `Letter portrait dimensions wrong: ${JSON.stringify(pageSizingState.letterPortrait)}`);
  assert(pageSizingState.letterLandscape.width === 1294 && pageSizingState.letterLandscape.height === 1000, `Letter landscape dimensions wrong: ${JSON.stringify(pageSizingState.letterLandscape)}`);
  assert(pageSizingState.custom.width === 777 && pageSizingState.custom.height === 888 && pageSizingState.custom.preset === "custom", `Custom paper size failed: ${JSON.stringify(pageSizingState.custom)}`);
  assert(pageSizingState.square.width === 1000 && pageSizingState.square.height === 1000, `Square paper preset failed: ${JSON.stringify(pageSizingState.square)}`);
  assert(pageSizingState.orientationDropdowns === 0, "Page settings still shows a separate Orientation dropdown");
  assert(Math.abs(pageSizingState.width - pageSizingState.height) <= 2, `Square paper preset did not produce a square canvas: ${pageSizingState.width} x ${pageSizingState.height}`);
  assert(pageSizingState.noHorizontalOverflow, "Fit page left unnecessary horizontal overflow");
  assert(pageSizingState.usefulSize, `Fit page over-shrank the canvas: ${pageSizingState.width}px`);
  assert(pageSizingState.normalWheelAllowed, "Normal wheel events should not be intercepted by the editor viewport");
  assert(!pageSizingState.ctrlWheelAllowed, "Ctrl+wheel should be handled by the editor viewport");
  assert(pageSizingState.ctrlWheelZoomed, "Ctrl+wheel did not zoom the edit canvas");
  assert(pageSizingState.fullScaledHeightReserved, "Edit viewport does not reserve the full scaled page height");
  assert(pageSizingState.canvasBottomReachable, "Edit canvas scroll container cannot reach its bottom");
  assert(pageSizingState.panelBottomReachable, "Right inspector/page settings panel cannot reach its bottom");
  assert(pageSizingState.pageSettingsVisible, "Right panel should show Page settings when no placement is selected");
  const zoomStability = await evaluate(
    client,
    `(async () => {
      const before = Math.round(document.querySelector('.album-canvas').getBoundingClientRect().width);
      await new Promise((resolve) => setTimeout(resolve, 1200));
      const idle = Math.round(document.querySelector('.album-canvas').getBoundingClientRect().width);
      const placement = document.querySelector('.album-placement');
      const rect = placement.getBoundingClientRect();
      placement.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: rect.left + 10, clientY: rect.top + 10, button: 0 }));
      window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: rect.left + 35, clientY: rect.top + 10, button: 0 }));
      window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0 }));
      await new Promise((resolve) => setTimeout(resolve, 600));
      const afterDrag = Math.round(document.querySelector('.album-canvas').getBoundingClientRect().width);
      [...document.querySelectorAll("button")].find((button) => button.textContent.trim() === "Add text").click();
      await new Promise((resolve) => setTimeout(resolve, 600));
      const afterAddText = Math.round(document.querySelector('.album-canvas').getBoundingClientRect().width);
      document.querySelector('.album-canvas').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 150));
      return { before, idle, afterDrag, afterAddText };
    })()`
  );
  assert(Math.abs(zoomStability.before - zoomStability.idle) <= 2, `Edit zoom changed while idle: ${JSON.stringify(zoomStability)}`);
  assert(Math.abs(zoomStability.before - zoomStability.afterDrag) <= 2, `Edit zoom changed after dragging: ${JSON.stringify(zoomStability)}`);
  assert(Math.abs(zoomStability.before - zoomStability.afterAddText) <= 2, `Edit zoom changed after adding text: ${JSON.stringify(zoomStability)}`);
  await evaluate(client, `window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await waitFor(client, "document.querySelector('.page-settings-panel')", "Page settings did not return after clearing selection");
  const pageControlLabels = await evaluate(
    client,
    `(() => [...document.querySelectorAll('.page-settings-panel label, .page-settings-panel .check-row')].map((label) => ({ text: label.textContent.trim(), title: label.getAttribute('title') })))()`
  );
  assert(pageControlLabels.some((entry) => entry.text.includes("Show guides") && entry.title === "Display alignment guides while editing the page."), "Show guides label/tooltip missing");
  assert(pageControlLabels.some((entry) => entry.text.includes("Snap to grid") && entry.title === "When moving or resizing items, align them to the grid."), "Snap to grid label/tooltip missing");
  assert(pageControlLabels.some((entry) => entry.text.includes("Grid size") && entry.title === "Controls spacing of the snap grid; smaller values allow finer positioning."), "Grid size label/tooltip missing");
  const dragReleaseState = await evaluate(
    client,
    `(async () => {
      const activePageId = () => document.querySelector('.album-page-select').value;
      const savePage = async () => {
        [...document.querySelectorAll("button")].find((button) => button.textContent.trim() === "Save page").click();
        await new Promise((resolve) => setTimeout(resolve, 500));
      };
      const clearSelection = async () => {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await new Promise((resolve) => setTimeout(resolve, 150));
      };
      const setSnap = async (enabled) => {
        await clearSelection();
        const row = [...document.querySelectorAll('.page-settings-panel .check-row')].find((label) => label.textContent.includes('Snap to grid'));
        const input = row.querySelector('input');
        if (input.checked !== enabled) input.click();
        await savePage();
      };
      const dragPlacement = async (snapEnabled) => {
        await setSnap(snapEnabled);
        const placement = [...document.querySelectorAll('.album-placement')].find((node) => !node.classList.contains('text-placement'));
        const id = placement.dataset.placementId;
        const rect = placement.getBoundingClientRect();
        placement.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: rect.left + 14, clientY: rect.top + 14, button: 0 }));
        window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: rect.left + 57, clientY: rect.top + 41, button: 0 }));
        window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: rect.left + 57, clientY: rect.top + 41, button: 0 }));
        await new Promise((resolve) => setTimeout(resolve, 700));
        const updatedNode = document.querySelector(\`.album-placement[data-placement-id="\${id}"]\`);
        const album = await window.archiveAPI.getAlbum('album-smoke');
        const page = album.pages.find((entry) => entry.id === activePageId());
        const saved = page.items.find((entry) => entry.id === id);
        return {
          snapEnabled,
          id,
          domX: Number.parseFloat(updatedNode.style.left || '0'),
          domY: Number.parseFloat(updatedNode.style.top || '0'),
          savedX: Number(saved.x || 0),
          savedY: Number(saved.y || 0),
          gridSize: Number(page.grid_size || 25)
        };
      };
      const withoutSnap = await dragPlacement(false);
      const withSnap = await dragPlacement(true);
      await clearSelection();
      return { withoutSnap, withSnap };
    })()`
  );
  assert(Math.abs(dragReleaseState.withoutSnap.domX - dragReleaseState.withoutSnap.savedX) < 0.01 && Math.abs(dragReleaseState.withoutSnap.domY - dragReleaseState.withoutSnap.savedY) < 0.01, `Drag release without snap did not match saved position: ${JSON.stringify(dragReleaseState.withoutSnap)}`);
  assert(Math.abs(dragReleaseState.withSnap.domX - dragReleaseState.withSnap.savedX) < 0.01 && Math.abs(dragReleaseState.withSnap.domY - dragReleaseState.withSnap.savedY) < 0.01, `Drag release with snap did not match saved position: ${JSON.stringify(dragReleaseState.withSnap)}`);
  assert(Math.abs(dragReleaseState.withSnap.domX % dragReleaseState.withSnap.gridSize) < 0.01 && Math.abs(dragReleaseState.withSnap.domY % dragReleaseState.withSnap.gridSize) < 0.01, `Snap-to-grid did not land on grid: ${JSON.stringify(dragReleaseState.withSnap)}`);
  await evaluate(client, `[...document.querySelectorAll("button")].find((button) => button.textContent.trim() === "Set background image").click()`);
  await waitFor(client, "document.querySelector('.item-picker')", "Background image picker did not open");
  await evaluate(
    client,
    `(() => {
      document.querySelector('.picker-result').click();
    })()`
  );
  await waitFor(client, "document.querySelectorAll('.picker-image-grid button').length >= 1", "Background picker image choices did not load");
  await evaluate(
    client,
    `(() => {
      document.querySelector('.picker-image-grid button').click();
      [...document.querySelectorAll('.picker-actions button')].find((button) => button.textContent.trim() === 'Add and close').click();
    })()`
  );
  await waitFor(client, "document.querySelector('.page-background-image')", "Background image did not render behind the page");
  const backgroundState = await evaluate(
    client,
    `(async () => {
      const range = document.querySelector('.page-settings-panel input[type="range"]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(range, '35');
      range.dispatchEvent(new Event('input', { bubbles: true }));
      [...document.querySelectorAll("button")].find((button) => button.textContent.trim() === "Save page").click();
      await new Promise((resolve) => setTimeout(resolve, 500));
      const background = document.querySelector('.page-background-image');
      [...document.querySelectorAll("button")].find((button) => button.textContent.trim() === "Clear background").click();
      await new Promise((resolve) => setTimeout(resolve, 500));
      return {
        opacity: Number(background ? background.style.opacity : 0),
        cleared: !document.querySelector('.page-background-image')
      };
    })()`
  );
  assert(backgroundState.opacity > 0.3 && backgroundState.opacity < 0.4, `Background opacity did not save: ${backgroundState.opacity}`);
  assert(backgroundState.cleared, "Clear background did not remove the background image");
  await evaluate(client, `[...document.querySelectorAll("button")].find((button) => button.textContent.trim() === "Add item").click()`);
  await waitFor(client, "document.querySelector('.item-picker')", "Item picker did not open");
  const pickerState = await evaluate(
    client,
    `(() => {
      const search = document.querySelector('.item-picker input[placeholder="Search title"]');
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(search, 'Multi');
      search.dispatchEvent(new Event('input', { bubbles: true }));
      return {
        focused: document.activeElement === search,
        results: document.querySelectorAll('.picker-result').length
      };
    })()`
  );
  assert(pickerState.focused, "Item picker search input was not focused");
  assert(pickerState.results > 0, "Item picker search did not return results");
  await evaluate(
    client,
    `(() => {
      document.querySelector('.picker-result').click();
    })()`
  );
  await waitFor(client, "document.querySelectorAll('.picker-image-grid button').length >= 2", "Picker image choices did not load");
  await evaluate(
    client,
    `(() => {
      const buttons = [...document.querySelectorAll('.picker-image-grid button')];
      buttons[1].click();
      [...document.querySelectorAll('.picker-actions button')].find((button) => button.textContent.trim() === 'Add and keep open').click();
    })()`
  );
  await waitFor(client, "document.querySelectorAll('.album-placement').length >= 3", "Picker did not add a placement");
  await evaluate(client, `document.querySelector('.item-picker').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await waitFor(client, "!document.querySelector('.item-picker')", "Escape did not close item picker");

  await evaluate(client, "document.querySelector('.album-placement').click()");
  await waitFor(client, "document.querySelector('.placement-inspector')", "Placement inspector did not render");
  const stableSelection = await evaluate(
    client,
    `(() => {
      const input = document.querySelector('.placement-inspector input[type="text"], .placement-inspector input:not([type])');
      input.focus();
      input.value = 'Stable caption';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      const titleToggle = [...document.querySelectorAll('.placement-inspector label')].find((label) => label.textContent.includes('Show title'))?.querySelector('input');
      titleToggle?.click();
      return {
        selected: document.querySelectorAll('.album-placement.selected').length,
        inspector: Boolean(document.querySelector('.placement-inspector')),
        activeInInspector: document.querySelector('.placement-inspector').contains(document.activeElement)
      };
    })()`
  );
  assert(stableSelection.selected === 1, "Selection was lost while using the placement inspector");
  assert(stableSelection.inspector, "Placement inspector disappeared while editing controls");
  assert(stableSelection.activeInInspector, "Caption input did not receive focus inside inspector");
  const editState = await evaluate(
    client,
    `(() => ({
      selectors: [...document.querySelectorAll('.slot-image-select select')].map((select) => select.value),
      selected: document.querySelectorAll('.album-placement.selected').length,
      handles: document.querySelectorAll('.resize-handle').length,
      inspectorButtons: [...document.querySelectorAll('.placement-inspector button')].map((button) => button.textContent.trim()),
      layerTitles: [...document.querySelectorAll('.placement-inspector .placement-actions button')].map((button) => button.getAttribute('title')),
      itemInfoLabel: [...document.querySelectorAll('.placement-inspector label')].some((label) => label.textContent.includes('Show item info') && label.getAttribute('title') === 'Show or hide issuing entity, type, and year for this placement.'),
      pageSettingsHidden: !document.querySelector('.page-settings-panel')
    }))()`
  );
  assert(editState.selectors.includes("image-two"), `Selected image dropdown missing image-two: ${editState.selectors.join(", ")}`);
  assert(editState.selected === 1, "Selecting a placement should show one selected outline");
  assert(editState.handles === 1, "Selected placement should show a resize handle");
  assert(editState.inspectorButtons.includes("Duplicate"), "Placement inspector missing duplicate action");
  assert(["Forward", "Backward", "To front", "To back"].every((label) => editState.inspectorButtons.includes(label)), `Layer button labels are unclear: ${editState.inspectorButtons.join(", ")}`);
  assert(editState.layerTitles.includes("Move selected placement up one layer"), "Forward tooltip missing");
  assert(editState.layerTitles.includes("Move selected placement down one layer"), "Backward tooltip missing");
  assert(editState.layerTitles.includes("Put selected placement above all other placements"), "To front tooltip missing");
  assert(editState.layerTitles.includes("Put selected placement behind all other placements"), "To back tooltip missing");
  assert(editState.itemInfoLabel, "Show item info label/tooltip missing");
  assert(editState.pageSettingsHidden, "Selection inspector should replace Page settings when a placement is selected");
  await evaluate(
    client,
    `(() => {
      document.querySelector('.album-canvas').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      return true;
    })()`
  );
  await waitFor(client, "document.querySelectorAll('.album-placement.selected').length === 0", "Clicking empty canvas did not clear selection");
  await evaluate(
    client,
    `(() => {
      [...document.querySelectorAll("button")].find((button) => button.textContent.trim() === "Add text").click();
    })()`
  );
  await waitFor(client, "document.querySelector('.text-placement')", "Text box was not added to the album page");
  const textBoxState = await evaluate(
    client,
    `(async () => {
      const textBox = document.querySelector('.text-placement');
      textBox.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: textBox.getBoundingClientRect().left + 10, clientY: textBox.getBoundingClientRect().top + 10, button: 0 }));
      window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0 }));
      await new Promise((resolve) => setTimeout(resolve, 150));
      let album = await window.archiveAPI.getAlbum('album-smoke');
      let textEntry = album.pages[0].items.find((entry) => entry.element_type === 'text');
      await window.archiveAPI.updateAlbumPageItem({ ...textEntry, text_content: 'Smoke text box' });
      album = await window.archiveAPI.getAlbum('album-smoke');
      textEntry = album.pages[0].items.find((entry) => entry.element_type === 'text');
      return {
        selectedText: document.querySelectorAll('.text-placement.selected').length,
        persistedText: textEntry?.text_content,
        designedTextVisible: Boolean(document.querySelector('.album-text-content')),
        handleWidth: (() => {
          const handle = document.querySelector('.album-placement.selected .resize-handle') || document.querySelector('.resize-handle');
          return handle ? Math.round(getComputedStyle(handle).width.replace('px', '') || 0) : 18;
        })()
      };
    })()`
  );
  assert(textBoxState.persistedText === "Smoke text box", `Text box did not persist edited text: ${textBoxState.persistedText}`);
  assert(textBoxState.designedTextVisible, "Text box content did not render in edit/designed canvas");
  assert(textBoxState.handleWidth >= 18, `Resize handle is still too small: ${textBoxState.handleWidth}`);

  const shortcutState = await evaluate(
    client,
    `(async () => {
      window.confirm = () => true;
      const key = (value, options = {}) => window.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, ...options }));
      document.querySelector('.text-placement').click();
      await new Promise((resolve) => setTimeout(resolve, 150));
      const beforeText = document.querySelectorAll('.text-placement').length;
      key('c', { ctrlKey: true });
      key('v', { ctrlKey: true });
      await new Promise((resolve) => setTimeout(resolve, 600));
      const afterTextPaste = document.querySelectorAll('.text-placement').length;
      key('Backspace');
      await new Promise((resolve) => setTimeout(resolve, 600));
      const afterTextDelete = document.querySelectorAll('.text-placement').length;
      const image = [...document.querySelectorAll('.album-placement')].find((node) => !node.classList.contains('text-placement'));
      image.click();
      await new Promise((resolve) => setTimeout(resolve, 120));
      const beforeImages = [...document.querySelectorAll('.album-placement')].filter((node) => !node.classList.contains('text-placement')).length;
      key('c', { ctrlKey: true });
      key('v', { ctrlKey: true });
      await new Promise((resolve) => setTimeout(resolve, 600));
      const afterImagePaste = [...document.querySelectorAll('.album-placement')].filter((node) => !node.classList.contains('text-placement')).length;
      const pasted = document.querySelector('.album-placement.selected');
      const beforeLeft = Math.round(pasted.getBoundingClientRect().left);
      key('ArrowRight');
      await new Promise((resolve) => setTimeout(resolve, 500));
      const afterLeft = Math.round(document.querySelector('.album-placement.selected').getBoundingClientRect().left);
      key('Backspace');
      await new Promise((resolve) => setTimeout(resolve, 600));
      const afterImageDelete = [...document.querySelectorAll('.album-placement')].filter((node) => !node.classList.contains('text-placement')).length;
      key('a', { ctrlKey: true });
      await new Promise((resolve) => setTimeout(resolve, 150));
      return {
        beforeText,
        afterTextPaste,
        afterTextDelete,
        beforeImages,
        afterImagePaste,
        afterImageDelete,
        nudgeMoved: afterLeft > beforeLeft,
        selectAll: document.querySelectorAll('.album-placement.selected').length,
        total: document.querySelectorAll('.album-placement').length
      };
    })()`
  );
  assert(shortcutState.afterTextPaste === shortcutState.beforeText + 1, "Ctrl+V did not paste a copied text box");
  assert(shortcutState.afterTextDelete === shortcutState.beforeText, "Backspace did not delete the pasted text box");
  assert(shortcutState.afterImagePaste === shortcutState.beforeImages + 1, "Ctrl+V did not paste a copied image placement");
  assert(shortcutState.afterImageDelete === shortcutState.beforeImages, "Backspace did not delete the pasted image placement");
  assert(shortcutState.nudgeMoved, "Arrow key did not nudge the selected placement");
  assert(shortcutState.selectAll === shortcutState.total, "Ctrl+A did not select all album objects");

  const multiSelectState = await evaluate(
    client,
    `(async () => {
      const placements = [...document.querySelectorAll('.album-placement')];
      placements[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
      placements[1].dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
      await new Promise((resolve) => setTimeout(resolve, 150));
      const alignLeft = [...document.querySelectorAll('.placement-inspector button')].find((button) => button.textContent.trim() === 'Align left');
      const deleteSelected = [...document.querySelectorAll('.placement-inspector button')].find((button) => button.textContent.trim() === 'Delete selected placements');
      return {
        selected: document.querySelectorAll('.album-placement.selected').length,
        multiHeader: document.querySelector('.multi-inspector strong')?.textContent || '',
        hasAlignLeft: Boolean(alignLeft),
        hasDeleteSelected: Boolean(deleteSelected)
      };
    })()`
  );
  assert(multiSelectState.selected >= 2, `Ctrl-click multi-select failed: ${multiSelectState.selected}`);
  assert(multiSelectState.multiHeader.includes("placements selected"), `Multi-select inspector missing: ${multiSelectState.multiHeader}`);
  assert(multiSelectState.hasAlignLeft, "Multi-select inspector missing align controls");
  assert(multiSelectState.hasDeleteSelected, "Multi-select inspector missing delete selected control");

  await evaluate(
    client,
    `(async () => {
      const preview = [...document.querySelectorAll("button")].find((button) => button.textContent.trim() === "Preview");
      preview?.click();
      await new Promise((resolve) => setTimeout(resolve, 150));
      const cleanPreview = [...document.querySelectorAll("button")].find((button) => button.textContent.trim() === "Clean preview");
      if (!cleanPreview) throw new Error("Clean preview toggle not found after switching to Preview");
      cleanPreview.click();
    })()`
  );
  await waitFor(client, "document.querySelector('.image-only-preview')", "Clean preview did not reactivate after text smoke");
  const cleanTextState = await evaluate(client, `(() => ({
    textBoxes: document.querySelectorAll('.text-placement .album-text-content').length,
    metadata: document.querySelectorAll('.placement-text').length
  }))()`);
  assert(cleanTextState.textBoxes > 0, "Clean preview should show text boxes");
  assert(cleanTextState.metadata === 0, "Clean preview should hide item metadata/card text");
  await evaluate(
    client,
    `(() => {
      [...document.querySelectorAll("button")].find((button) => button.textContent.trim() === "Edit").click();
    })()`
  );
  await evaluate(
    client,
    `(() => {
      document.querySelector('.album-canvas').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      return true;
    })()`
  );
  await waitFor(client, "document.querySelector('.page-settings-panel')", "Edit mode did not return to page settings after text smoke");

  const sidebarState = await evaluate(
    client,
    `(() => {
      const sidebar = document.querySelector('.sidebar').getBoundingClientRect();
      const action = [...document.querySelectorAll('.sidebar-actions button')].find((button) => button.textContent.trim() === 'New album').getBoundingClientRect();
      return {
        sidebarHeight: Math.round(sidebar.height),
        viewportHeight: window.innerHeight,
        actionInView: action.bottom <= window.innerHeight + 1
      };
    })()`
  );
  assert(Math.abs(sidebarState.sidebarHeight - sidebarState.viewportHeight) <= 2, "Sidebar is not constrained to viewport height");
  assert(sidebarState.actionInView, "Sidebar action buttons are not visible near the bottom of the viewport");
  await captureScreenshot(client, "album-edit-canvas");

  const longRows = await evaluate(
    client,
    `(async () => {
      const names = [
        "Austro-Hungarian Empire",
        "British South Africa Company",
        "French Colonies and Protectorates",
        "Österreich-Ungarn",
        "英属北婆罗洲及相关保护地"
      ];
      let library = null;
      for (const name of names) {
        library = await window.archiveAPI.createCountry({ name });
      }
      return library.countries.filter((entry) => names.includes(entry.name)).map((entry) => entry.id);
    })()`
  );
  await evaluate(client, "window.location.reload()");
  await waitFor(client, "Boolean(window.archiveAPI && document.querySelector('.app'))", "App did not reload after creating long rows");

  await evaluate(
    client,
    `(() => {
      [...document.querySelectorAll(".sidebar-actions button")].find((button) => button.textContent.trim() === "Manage lists").click();
    })()`
  );
  await waitFor(client, "document.querySelector('.manage-modal')", "Manage Lists modal did not open");
  await evaluate(
    client,
    `(() => {
      [...document.querySelectorAll('.manage-tabs button')].find((button) => button.textContent.trim() === 'Issuing Entities').click();
      return true;
    })()`
  );
  await waitFor(client, "[...document.querySelectorAll('.manage-tab-panel .manage-row-main strong')].some((node) => node.textContent.includes('British South Africa Company'))", "Issuing Entities tab did not render long-name rows");
  const manageLayout = await evaluate(
    client,
    `(() => {
      const rows = [...document.querySelectorAll('.reorder-row')];
      const measured = rows.map((row) => {
        const name = row.querySelector('.manage-row-main').getBoundingClientRect();
        const actions = row.querySelector('.order-actions').getBoundingClientRect();
        return {
          overlap: name.right > actions.left - 1,
          up: row.querySelector('.order-actions button')?.textContent.trim(),
          down: row.querySelectorAll('.order-actions button')[1]?.textContent.trim()
        };
      });
      return {
        measured,
        hasLongName: [...document.querySelectorAll('.manage-row-main strong')].some((node) => node.textContent.includes('British South Africa Company'))
      };
    })()`
  );
  assert(manageLayout.hasLongName, "Manage Lists did not render long-name rows");
  assert(manageLayout.measured.every((row) => !row.overlap), "Manage Lists name area overlaps move controls");
  assert(manageLayout.measured.every((row) => row.up === "↑" && row.down === "↓"), "Move controls are not compact arrow buttons");
  const moveFallback = await evaluate(
    client,
    `(async () => {
      let rows = [...document.querySelector('.manage-tab-panel .manage-list').querySelectorAll('.reorder-row')];
      rows[0].querySelectorAll('.order-actions button')[1].click();
      await new Promise((resolve) => setTimeout(resolve, 500));
      let library = await window.archiveAPI.getLibrary();
      const afterDown = library.countries.slice(0, 3).map((entry) => entry.name);
      rows = [...document.querySelector('.manage-tab-panel .manage-list').querySelectorAll('.reorder-row')];
      rows[1].querySelectorAll('.order-actions button')[0].click();
      await new Promise((resolve) => setTimeout(resolve, 500));
      library = await window.archiveAPI.getLibrary();
      return {
        afterDown,
        restored: library.countries.slice(0, 3).map((entry) => entry.name)
      };
    })()`
  );
  assert(JSON.stringify(moveFallback.afterDown) === JSON.stringify(["China", "Austria", "Japan"]), `Move down fallback failed: ${moveFallback.afterDown.join(", ")}`);
  assert(JSON.stringify(moveFallback.restored) === JSON.stringify(["Austria", "China", "Japan"]), `Move up fallback failed: ${moveFallback.restored.join(", ")}`);
  const dragResult = await evaluate(
    client,
    `(async () => {
      const countryRows = [...document.querySelector('.manage-tab-panel .manage-list').querySelectorAll('.reorder-row')];
      const dragged = countryRows[0];
      const target = countryRows[2];
      const draggedName = dragged.querySelector('.manage-row-main strong').textContent;
      const targetName = target.querySelector('.manage-row-main strong').textContent;
      const dataTransfer = new DataTransfer();
      dragged.querySelector('.drag-handle').dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer }));
      const rect = target.getBoundingClientRect();
      target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, clientY: rect.bottom, dataTransfer }));
      target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, clientY: rect.bottom, dataTransfer }));
      dragged.querySelector('.drag-handle').dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer }));
      await new Promise((resolve) => setTimeout(resolve, 500));
      let library = await window.archiveAPI.getLibrary();
      const countryOrder = library.countries.map((entry) => entry.name);
      [...document.querySelectorAll('.manage-tabs button')].find((button) => button.textContent.trim() === 'Collection Types').click();
      await new Promise((resolve) => setTimeout(resolve, 200));
      const typeRows = [...document.querySelector('.manage-tab-panel .manage-list').querySelectorAll('.reorder-row')];
      const typeDragged = typeRows[0];
      const typeTarget = typeRows[2];
      const typeDraggedName = typeDragged.querySelector('.manage-row-main strong').textContent;
      const typeTargetName = typeTarget.querySelector('.manage-row-main strong').textContent;
      const typeData = new DataTransfer();
      typeDragged.querySelector('.drag-handle').dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: typeData }));
      const typeRect = typeTarget.getBoundingClientRect();
      typeTarget.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, clientY: typeRect.bottom, dataTransfer: typeData }));
      typeDragged.querySelector('.drag-handle').dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: typeData }));
      await new Promise((resolve) => setTimeout(resolve, 500));
      library = await window.archiveAPI.getLibrary();
      return {
        draggedName,
        targetName,
        countryOrder,
        typeDraggedName,
        typeTargetName,
        typeOrder: library.types.map((entry) => entry.name)
      };
    })()`
  );
  assert(dragResult.countryOrder.indexOf(dragResult.draggedName) === dragResult.countryOrder.indexOf(dragResult.targetName) + 1, `Country drag reorder failed: ${dragResult.countryOrder.join(", ")}`);
  assert(dragResult.typeOrder.indexOf(dragResult.typeDraggedName) === dragResult.typeOrder.indexOf(dragResult.typeTargetName) + 1, `Type drag reorder failed: ${dragResult.typeOrder.join(", ")}`);
  const afterLongCleanup = await evaluate(client, `(async () => {
    for (const id of ${JSON.stringify(longRows)}) {
      await window.archiveAPI.deleteCountry({ id, action: "check" });
    }
    const library = await window.archiveAPI.getLibrary();
    return {
      countries: library.countries.map((entry) => entry.name),
      types: library.types.map((entry) => entry.name)
    };
  })()`);

  await stop(child);
  client.close();

  child = launchElectron(portBase + 2);
  client = await connect(portBase + 2);
  await waitFor(client, "Boolean(window.archiveAPI && document.querySelector('.app'))", "App did not relaunch");
  const persisted = await evaluate(
    client,
    `(async () => {
      const library = await window.archiveAPI.getLibrary();
      return {
        countries: library.countries.map((entry) => entry.name),
        types: library.types.map((entry) => entry.name)
      };
    })()`
  );
  assert(JSON.stringify(persisted.countries) === JSON.stringify(afterLongCleanup.countries), `Country drag order did not persist: ${persisted.countries.join(", ")}`);
  assert(JSON.stringify(persisted.types) === JSON.stringify(afterLongCleanup.types), `Type drag order did not persist: ${persisted.types.join(", ")}`);

  console.log("album smoke test passed", JSON.stringify({ initial: data, reordered, appendDelete, persisted }));
  await stop(child);
  client.close();
  fs.rmSync(tempRoot, { recursive: true, force: true });
}

main().catch(async (error) => {
  console.error(error);
  await stop(activeChild);
  fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 });
  process.exitCode = 1;
});
