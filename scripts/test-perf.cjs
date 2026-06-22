const fs = require("fs");
const path = require("path");
const { spawn, spawnSync } = require("child_process");

const root = process.cwd();
const defaultDataDir = path.join(root, "perf-data", "collection-archive-perf-data");
const tempRoot = path.join(root, `.tmp-perf-smoke-${Date.now()}`);
const appData = path.join(tempRoot, "appdata");
const userData = path.join(tempRoot, "user-data");
const artifactsDir = path.join(root, "test-artifacts");
const port = 9520 + Math.floor(Math.random() * 300);
const pidFile = path.join(artifactsDir, "perf-smoke-pids.json");
let activeChild = null;
let electronLineBuffer = "";
const electronOutput = [];
const mainPerfEvents = [];

function argValue(name, fallback = null) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] || fallback;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function readPidFile() {
  try {
    return JSON.parse(fs.readFileSync(pidFile, "utf8"));
  } catch {
    return { pids: [] };
  }
}

function writePidFile(pids) {
  fs.mkdirSync(artifactsDir, { recursive: true });
  fs.writeFileSync(pidFile, JSON.stringify({ pids, updatedAt: new Date().toISOString() }, null, 2));
}

function killProcessTree(pid) {
  if (!pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill.exe", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
    return;
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    // Process already exited.
  }
}

function cleanupStaleOwnedProcesses() {
  const stale = readPidFile().pids || [];
  if (!stale.length) return;
  console.log(`[perf] cleaning ${stale.length} stale process id(s) from previous perf run: ${stale.join(", ")}`);
  stale.forEach(killProcessTree);
  try {
    fs.rmSync(pidFile, { force: true });
  } catch {
    // Best effort only.
  }
}

function rememberChild(child) {
  const current = new Set(readPidFile().pids || []);
  current.add(child.pid);
  writePidFile([...current]);
  child.once("exit", () => {
    const remaining = (readPidFile().pids || []).filter((pid) => pid !== child.pid);
    if (remaining.length) writePidFile(remaining);
    else fs.rmSync(pidFile, { force: true });
  });
}

function parseElectronOutput(chunk) {
  const text = chunk.toString();
  electronOutput.push(text);
  electronLineBuffer += text;
  const lines = electronLineBuffer.split(/\r?\n/);
  electronLineBuffer = lines.pop() || "";
  lines.forEach((line) => {
    const marker = "[perf-main] ";
    const index = line.indexOf(marker);
    if (index === -1) return;
    try {
      mainPerfEvents.push(JSON.parse(line.slice(index + marker.length)));
    } catch {
      // Leave malformed output in the raw log.
    }
  });
}

function printableElectronText(chunk) {
  return chunk
    .toString()
    .split(/\r?\n/)
    .filter((line) => !line.includes("[perf-main]"))
    .join("\n")
    .trim();
}

function compactTraceEvents(events) {
  return events.map((entry) => {
    const compact = {
      event: entry.event,
      t: entry.t,
      traceId: entry.traceId,
      ms: entry.ms,
      rows: entry.rows,
      total: entry.total,
      count: entry.count,
      channel: entry.channel
    };
    if (entry.query) compact.query = entry.query;
    if (entry.filters) compact.filters = entry.filters;
    if (entry.countText) compact.countText = entry.countText;
    if (entry.cards !== undefined) compact.cards = entry.cards;
    if (entry.tiles !== undefined) compact.tiles = entry.tiles;
    if (entry.loading !== undefined) compact.loading = entry.loading;
    return Object.fromEntries(Object.entries(compact).filter(([, value]) => value !== undefined && value !== ""));
  });
}

function safeDataDir(folder) {
  const resolved = path.resolve(folder);
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Perf test data must live inside this workspace: ${resolved}`);
  }
  if (!resolved.toLowerCase().includes("perf")) {
    throw new Error(`Refusing to run against a data folder that is not clearly perf data: ${resolved}`);
  }
  const dbPath = path.join(resolved, "archive.sqlite");
  if (!fs.existsSync(dbPath)) {
    throw new Error(`Perf database not found at ${dbPath}. Run: npm run seed:perf -- --items 10000 --force`);
  }
  return resolved;
}

function launchElectron(dataDir) {
  const electronExe = path.join(root, "node_modules", "electron", "dist", "electron.exe");
  const start = performance.now();
  const child = spawn(electronExe, [`--remote-debugging-port=${port}`, `--user-data-dir=${userData}`, ".", "--disable-gpu"], {
    cwd: root,
    env: {
      ...process.env,
      APPDATA: appData,
      COLLECTION_ARCHIVE_DATA_DIR: dataDir,
      ELECTRON_ENABLE_LOGGING: "1",
      ARCHIVE_PERF_TRACE: "1"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  rememberChild(child);
  child.stdout.on("data", (chunk) => {
    parseElectronOutput(chunk);
    const printable = printableElectronText(chunk);
    if (printable) process.stdout.write(`[electron] ${printable}\n`);
  });
  child.stderr.on("data", (chunk) => {
    parseElectronOutput(chunk);
    const printable = printableElectronText(chunk);
    if (printable) process.stderr.write(`[electron] ${printable}\n`);
  });
  activeChild = child;
  return { child, start };
}

async function getWebSocketUrl() {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      const targets = await response.json();
      const page = targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      await sleep(200);
    }
  }
  throw new Error("Timed out waiting for Electron DevTools target");
}

class CdpClient {
  constructor(wsUrl) {
    this.nextId = 1;
    this.pending = new Map();
    this.events = [];
    this.rendererPerfEvents = [];
    this.opened = new Promise((resolve, reject) => {
      this.socket = new WebSocket(wsUrl);
      this.socket.addEventListener("open", resolve);
      this.socket.addEventListener("error", reject);
      this.socket.addEventListener("message", (event) => {
        const message = JSON.parse(event.data);
        if (message.id && this.pending.has(message.id)) {
          const { resolve: done, reject: fail, method, expression } = this.pending.get(message.id);
          this.pending.delete(message.id);
          if (message.error) fail(new Error(`${method} failed: ${message.error.message}${expression ? `\n${expression}` : ""}`));
          else done(message.result);
        } else if (message.method === "Runtime.consoleAPICalled" || message.method === "Runtime.exceptionThrown") {
          this.events.push(message);
          if (message.method === "Runtime.consoleAPICalled") {
            const text = (message.params?.args || []).map((arg) => arg.value || "").join(" ");
            const marker = "[perf-renderer] ";
            const index = text.indexOf(marker);
            if (index > -1) {
              try {
                this.rendererPerfEvents.push(JSON.parse(text.slice(index + marker.length)));
              } catch {
                // Keep raw console event in this.events.
              }
            }
          }
        }
      });
    });
  }

  async send(method, params = {}, timeoutMs = 45000) {
    await this.opened;
    const id = this.nextId++;
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${method} timed out after ${timeoutMs} ms${params.expression ? `\n${params.expression}` : ""}`));
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
        method,
        expression: params.expression
      });
    });
  }

  close() {
    this.socket.close();
  }
}

async function connect() {
  const client = new CdpClient(await getWebSocketUrl());
  await client.send("Runtime.enable");
  await client.send("Page.enable");
  return client;
}

async function evaluate(client, expression, timeoutMs = 45000) {
  const result = await client.send("Runtime.evaluate", {
    expression: `(async () => {
      const candidate = (${expression});
      const value = typeof candidate === "function" ? await candidate() : await candidate;
      return JSON.stringify(value === undefined ? null : value);
    })()`,
    awaitPromise: true,
    returnByValue: true
  }, timeoutMs);
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || "Runtime evaluation failed");
  }
  return JSON.parse(result.result.value);
}

async function collectDiagnostics(client) {
  let renderer = {};
  try {
    renderer = await evaluate(
      client,
      `() => ({
        url: window.location.href,
        activeNav: [...document.querySelectorAll('nav button')].find((button) => button.classList.contains('active'))?.textContent.trim() || '',
        topbar: document.querySelector('.topbar p')?.textContent || '',
        libraryCards: document.querySelectorAll('.item-card').length,
        galleryTiles: document.querySelectorAll('.gallery-tile').length,
        pickerResults: document.querySelectorAll('.picker-result').length,
        albumPlacements: document.querySelectorAll('.album-placement').length,
        loadingTexts: [...document.querySelectorAll('body *')].map((node) => node.textContent?.trim()).filter((text) => /^Loading|Loading/.test(text || '')).slice(0, 8),
        loadMore: [...document.querySelectorAll('.load-more')].map((node) => node.textContent.trim()),
        filters: {
          country: document.querySelectorAll('.filter-combobox .entity-combobox-trigger')[0]?.textContent.trim() || '',
          type: document.querySelector('.filters select')?.value || '',
          year: document.querySelector('.filters input[placeholder="Year"]')?.value || '',
          tag: document.querySelector('.filters input[placeholder^="Tags"]')?.value || '',
          favorite: Boolean(document.querySelector('.filters input[type="checkbox"]')?.checked)
        }
      })`,
      5000
    );
  } catch (error) {
    renderer = { diagnosticError: error.message };
  }
  const recentConsole = client.events.slice(-8).map((event) => event.params || {});
  return {
    renderer,
    recentConsole,
    recentRendererPerf: client.rendererPerfEvents.slice(-12),
    recentMainPerf: mainPerfEvents.slice(-12),
    recentElectronOutput: electronOutput.slice(-12).join("").slice(-4000)
  };
}

async function waitFor(client, expression, message, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await evaluate(client, `Boolean(${expression})`)) return;
    await sleep(100);
  }
  const recentEvents = client.events.slice(-5).map((event) => JSON.stringify(event.params || {})).join("\n");
  const diagnostics = await collectDiagnostics(client);
  throw new Error(`${message}${recentEvents ? `\nRecent renderer events:\n${recentEvents}` : ""}\nDiagnostics:\n${JSON.stringify(diagnostics, null, 2)}`);
}

async function measure(client, label, body) {
  console.log(`[perf] ${label}`);
  const mainStart = mainPerfEvents.length;
  const rendererStart = client.rendererPerfEvents.length;
  try {
    const measured = await evaluate(
      client,
      `async () => {
        const started = performance.now();
        const result = await (${body})();
        return {
          label: ${JSON.stringify(label)},
          ms: Math.round((performance.now() - started) * 10) / 10,
          result
        };
      }`,
      60000
    );
    console.log(`[perf] ${label}: ${measured.ms} ms`);
    measured.trace = {
      renderer: compactTraceEvents(client.rendererPerfEvents.slice(rendererStart)),
      main: compactTraceEvents(mainPerfEvents.slice(mainStart))
    };
    console.log(`[perf-trace] ${label} ${JSON.stringify(measured.trace)}`);
    return measured;
  } catch (error) {
    const diagnostics = await collectDiagnostics(client);
    throw new Error(`[perf] ${label} failed: ${error.message}\nDiagnostics:\n${JSON.stringify(diagnostics, null, 2)}`);
  }
}

function waitForLibraryCountScript(expectedTotal, label, timeoutMs = 8000) {
  return `
    {
    const waitResult = await new Promise((resolve) => {
      const started = performance.now();
      const expectedTotal = ${Number(expectedTotal)};
      const expectedCards = Math.min(100, expectedTotal);
      const check = () => {
        const text = document.querySelector('.topbar p')?.textContent || '';
        const cards = document.querySelectorAll('.item-card').length;
        const loading = [...document.querySelectorAll('.load-more')].some((node) => /Loading/i.test(node.textContent || ''));
        const matchedText = text.includes('of ' + expectedTotal + ' matching') || text.includes('from ' + expectedTotal + ' matching');
        if (matchedText && cards === expectedCards && !loading) {
          resolve({
            label: ${JSON.stringify(label)},
            timedOut: false,
            ms: Math.round((performance.now() - started) * 10) / 10,
            text,
            cards,
            loading
          });
          return;
        }
        if (performance.now() - started > ${Number(timeoutMs)}) {
          resolve({
            label: ${JSON.stringify(label)},
            timedOut: true,
            ms: Math.round((performance.now() - started) * 10) / 10,
            text,
            cards,
            expectedTotal,
            expectedCards,
            loading,
            filters: {
              country: document.querySelectorAll('.filter-combobox .entity-combobox-trigger')[0]?.textContent.trim() || '',
              type: document.querySelector('.filters select')?.value || '',
              year: document.querySelector('.filters input[placeholder="Year"]')?.value || '',
              tag: document.querySelector('.filters input[placeholder^="Tags"]')?.value || '',
              favorite: Boolean(document.querySelector('.filters input[type="checkbox"]')?.checked)
            }
          });
          return;
        }
        setTimeout(check, 25);
      };
      setTimeout(check, 0);
    });
    if (waitResult.timedOut) {
      throw new Error('Timed out waiting for library count: ' + JSON.stringify(waitResult));
    }
    }
  `;
}

function resetLibraryFiltersScript(expectedTotal) {
  return `
    const clear = document.querySelector('.clear-filters');
    if (clear && !clear.disabled) clear.click();
    ${waitForLibraryCountScript(expectedTotal, "reset")}
  `;
}

function chooseFilterComboboxScript(index, label) {
  return `
    {
      const combo = document.querySelectorAll('.filter-combobox')[${Number(index)}];
      if (!combo) throw new Error('Filter combobox not found at index ${Number(index)}');
      combo.querySelector('.entity-combobox-trigger').click();
      await new Promise((resolve) => setTimeout(resolve, 50));
      const input = combo.querySelector('.entity-combobox-panel input');
      if (!input) throw new Error('Filter combobox search input not found');
      input.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(label)});
      input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ${JSON.stringify(label)} }));
      const option = await new Promise((resolve) => {
        const started = performance.now();
        const check = () => {
          const match = [...combo.querySelectorAll('.entity-combobox-results button')]
            .find((button) => button.textContent.trim() === ${JSON.stringify(label)});
          if (match || performance.now() - started > 2500) {
            resolve(match || null);
            return;
          }
          setTimeout(check, 25);
        };
        check();
      });
      if (!option) throw new Error('Filter combobox option not found for ${String(label).replace(/'/g, "\\'")}');
      option.click();
    }
  `;
}

function waitForTextChangeScript(selector, beforeVariable = "beforeText") {
  return `
    await new Promise((resolve) => {
      const started = performance.now();
      const check = () => {
        const nextText = document.querySelector(${JSON.stringify(selector)})?.textContent || '';
        if (nextText !== ${beforeVariable} || performance.now() - started > 5000) {
          resolve();
          return;
        }
          setTimeout(check, 25);
        };
        setTimeout(check, 0);
    });
  `;
}

async function captureScreenshot(client, label) {
  fs.mkdirSync(artifactsDir, { recursive: true });
  try {
    const shot = await client.send("Page.captureScreenshot", { format: "png", fromSurface: true }, 8000);
    const filePath = path.join(artifactsDir, `${new Date().toISOString().replace(/[:.]/g, "-")}-${label}.png`);
    fs.writeFileSync(filePath, Buffer.from(shot.data, "base64"));
    return filePath;
  } catch (error) {
    console.warn(`[perf] screenshot skipped: ${error.message}`);
    return null;
  }
}

async function stop(child) {
  if (!child || child.killed) return;
  killProcessTree(child.pid);
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    sleep(3000)
  ]);
  if (activeChild === child) activeChild = null;
}

async function main() {
  cleanupStaleOwnedProcesses();
  const dataDir = safeDataDir(argValue("--data", defaultDataDir));
  fs.mkdirSync(appData, { recursive: true });
  fs.mkdirSync(userData, { recursive: true });

  const { child, start } = launchElectron(dataDir);
  console.log(`[perf] launched Electron with data ${dataDir}`);
  const client = await connect();
  console.log("[perf] connected to DevTools");
  await waitFor(client, "Boolean(window.archiveAPI && document.querySelector('.app'))", "App shell did not render");
  console.log("[perf] app shell rendered");
  await evaluate(client, `() => {
    localStorage.setItem("archivePerfTrace", "1");
    window.__archivePerfTrace = true;
    return true;
  }`);
  await waitFor(client, "document.querySelectorAll('.item-card').length > 0", "Library cards did not render");
  console.log("[perf] first library cards rendered");
  const launchMs = Math.round((performance.now() - start) * 10) / 10;

  const libraryState = await evaluate(
    client,
    `async () => {
      const library = await window.archiveAPI.getLibrary();
      const itemCount = await window.archiveAPI.countItems({});
      const firstCountry = library.countries[10] || library.countries[0] || {};
      const firstCountryId = firstCountry.id || "";
      const firstTypeId = library.types[4]?.id || library.types[0]?.id || "";
      return {
        itemCount,
        countryCount: library.countries.length,
        typeCount: library.types.length,
        firstCountryId,
        firstCountryName: firstCountry.name || "",
        firstTypeId,
        expected: {
          all: itemCount,
          country: await window.archiveAPI.countItems({ countryId: firstCountryId }),
          type: await window.archiveAPI.countItems({ typeId: firstTypeId }),
          year: await window.archiveAPI.countItems({ year: "190" }),
          tag: await window.archiveAPI.countItems({ tag: "classic" }),
          favorite: await window.archiveAPI.countItems({ favorite: true })
        }
      };
    }`
  );
  assert(libraryState.itemCount >= 1000, `Perf database has too few items: ${libraryState.itemCount}`);

  const timings = [];
  timings.push({
    label: "app launch to first library cards",
    ms: launchMs,
    result: {
      visibleCards: await evaluate(client, `() => document.querySelectorAll('.item-card').length`)
    }
  });

  timings.push(await measure(client, "library initial DOM audit", `() => ({
    renderedCards: document.querySelectorAll('.item-card').length,
    loadMoreVisible: Boolean(document.querySelector('.load-more')),
    fullCountText: document.querySelector('.topbar p')?.textContent || ''
  })`));

  timings.push(await measure(client, "filter by country", `async () => {
    const marks = [];
    const mark = (event) => marks.push({ event, t: Math.round(performance.now() * 10) / 10 });
    mark('reset.start');
    ${resetLibraryFiltersScript(libraryState.expected.all)}
    mark('reset.end');
    await new Promise((resolve) => setTimeout(resolve, 0));
    mark('interaction.start');
    ${chooseFilterComboboxScript(0, libraryState.firstCountryName)}
    mark('interaction.end');
    mark('wait.start');
    ${waitForLibraryCountScript(libraryState.expected.country, "country")}
    mark('wait.end');
    return {
      renderedCards: document.querySelectorAll('.item-card').length,
      countText: document.querySelector('.topbar p')?.textContent || '',
      marks
    };
  }`));

  timings.push(await measure(client, "filter by type", `async () => {
    const marks = [];
    const mark = (event) => marks.push({ event, t: Math.round(performance.now() * 10) / 10 });
    mark('reset.start');
    ${resetLibraryFiltersScript(libraryState.expected.all)}
    mark('reset.end');
    await new Promise((resolve) => setTimeout(resolve, 0));
    const select = document.querySelector('.filters select');
    mark('interaction.start');
    select.value = ${JSON.stringify(libraryState.firstTypeId)};
    select.dispatchEvent(new Event('change', { bubbles: true }));
    mark('interaction.end');
    mark('wait.start');
    ${waitForLibraryCountScript(libraryState.expected.type, "type")}
    mark('wait.end');
    return {
      renderedCards: document.querySelectorAll('.item-card').length,
      countText: document.querySelector('.topbar p')?.textContent || '',
      marks
    };
  }`));

  timings.push(await measure(client, "filter by year", `async () => {
    const marks = [];
    const mark = (event) => marks.push({ event, t: Math.round(performance.now() * 10) / 10 });
    mark('reset.start');
    ${resetLibraryFiltersScript(libraryState.expected.all)}
    mark('reset.end');
    await new Promise((resolve) => setTimeout(resolve, 0));
    const input = document.querySelector('.filters input[placeholder="Year"]');
    mark('interaction.start');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '190');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    mark('interaction.end');
    mark('wait.start');
    ${waitForLibraryCountScript(libraryState.expected.year, "year")}
    mark('wait.end');
    return {
      renderedCards: document.querySelectorAll('.item-card').length,
      countText: document.querySelector('.topbar p')?.textContent || '',
      marks
    };
  }`));

  timings.push(await measure(client, "filter by tag", `async () => {
    const marks = [];
    const mark = (event) => marks.push({ event, t: Math.round(performance.now() * 10) / 10 });
    mark('reset.start');
    ${resetLibraryFiltersScript(libraryState.expected.all)}
    mark('reset.end');
    await new Promise((resolve) => setTimeout(resolve, 0));
    const input = document.querySelector('.filters input[placeholder^="Tags"]');
    mark('interaction.start');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'classic');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    mark('interaction.end');
    mark('wait.start');
    ${waitForLibraryCountScript(libraryState.expected.tag, "tag")}
    mark('wait.end');
    return {
      renderedCards: document.querySelectorAll('.item-card').length,
      countText: document.querySelector('.topbar p')?.textContent || '',
      marks
    };
  }`));

  timings.push(await measure(client, "filter favorites", `async () => {
    const marks = [];
    const mark = (event) => marks.push({ event, t: Math.round(performance.now() * 10) / 10 });
    mark('reset.start');
    ${resetLibraryFiltersScript(libraryState.expected.all)}
    mark('reset.end');
    await new Promise((resolve) => setTimeout(resolve, 0));
    const checkbox = document.querySelector('.filters input[type="checkbox"]');
    mark('interaction.start');
    checkbox.click();
    mark('interaction.end');
    mark('wait.start');
    ${waitForLibraryCountScript(libraryState.expected.favorite, "favorite")}
    mark('wait.end');
    return {
      renderedCards: document.querySelectorAll('.item-card').length,
      countText: document.querySelector('.topbar p')?.textContent || '',
      marks
    };
  }`));

  await evaluate(client, `async () => { ${resetLibraryFiltersScript(libraryState.expected.all)} }`);
  await waitFor(client, "document.querySelectorAll('.item-card').length > 0", "Library did not recover after filters");

  timings.push(await measure(client, "gallery initial render", `async () => {
    [...document.querySelectorAll('nav button')].find((button) => button.textContent.trim() === 'Gallery').click();
    await new Promise((resolve) => {
      const started = performance.now();
      const check = () => {
        if (document.querySelectorAll('.gallery-tile').length > 0 || performance.now() - started > 5000) {
          resolve();
          return;
        }
        setTimeout(check, 25);
      };
      setTimeout(check, 0);
    });
    return {
      renderedTiles: document.querySelectorAll('.gallery-tile').length,
      loadMoreVisible: Boolean(document.querySelector('.gallery-grid + .load-more')),
      imageSrcUsesThumbs: [...document.querySelectorAll('.gallery-tile img')].every((image) => String(image.dataset.mediaSrc || image.src).includes('/thumbnails/'))
    };
  }`));

  timings.push(await measure(client, "gallery scroll sample", `() => {
    document.querySelector('main').scrollTo({ top: document.querySelector('main').scrollHeight, behavior: 'instant' });
    return {
      renderedTiles: document.querySelectorAll('.gallery-tile').length,
      scrollTop: document.querySelector('main').scrollTop
    };
  }`));

  timings.push(await measure(client, "album dense page render", `() => {
    [...document.querySelectorAll('nav button')].find((button) => button.textContent.trim() === 'Albums').click();
    return new Promise((resolve) => setTimeout(() => {
      const firstAlbum = document.querySelector('.album-list > button');
      firstAlbum?.click();
      const started = performance.now();
      const check = () => {
        const placements = document.querySelectorAll('.album-placement').length;
        if (placements > 0 || performance.now() - started > 5000) {
          resolve({
            placements,
            canvas: Boolean(document.querySelector('.album-canvas')),
            imageOnly: Boolean(document.querySelector('.image-only-preview'))
          });
          return;
        }
        setTimeout(check, 25);
      };
      setTimeout(check, 0);
    }));
  }`));

  timings.push(await measure(client, "open add item picker", `() => {
    [...document.querySelectorAll('.segmented button')].find((button) => button.textContent.trim() === 'Edit').click();
    return new Promise((resolve) => setTimeout(() => {
      [...document.querySelectorAll('button')].find((button) => button.textContent.trim() === 'Add item').click();
      const started = performance.now();
      const check = () => {
        if (document.querySelectorAll('.picker-result').length > 0 || performance.now() - started > 5000) {
          resolve({
            pickerOpen: Boolean(document.querySelector('.item-picker')),
            renderedResults: document.querySelectorAll('.picker-result').length,
            focusedSearch: document.activeElement === document.querySelector('.item-picker input[placeholder="Search title"]')
          });
          return;
        }
        setTimeout(check, 25);
      };
      setTimeout(check, 0);
    }));
  }`));

  timings.push(await measure(client, "add item picker title search", `async () => {
    const input = document.querySelector('.item-picker input[placeholder="Search title"]');
    const beforeText = document.querySelector('.item-picker header p')?.textContent || '';
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Perf Item 0009');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    ${waitForTextChangeScript(".item-picker header p")}
    return {
      renderedResults: document.querySelectorAll('.picker-result').length,
      matchText: document.querySelector('.item-picker header p')?.textContent || ''
    };
  }`));

  timings.push(await measure(client, "add item picker filters", `async () => {
    const country = document.querySelector('.picker-filters select');
    const type = document.querySelectorAll('.picker-filters select')[1];
    const tag = document.querySelector('.picker-filters input[placeholder="Tags"]');
    const beforeText = document.querySelector('.item-picker header p')?.textContent || '';
    country.value = ${JSON.stringify(libraryState.firstCountryId)};
    country.dispatchEvent(new Event('change', { bubbles: true }));
    type.value = ${JSON.stringify(libraryState.firstTypeId)};
    type.dispatchEvent(new Event('change', { bubbles: true }));
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(tag, 'classic');
    tag.dispatchEvent(new Event('input', { bubbles: true }));
    ${waitForTextChangeScript(".item-picker header p")}
    return {
      renderedResults: document.querySelectorAll('.picker-result').length,
      matchText: document.querySelector('.item-picker header p')?.textContent || ''
    };
  }`));

  const screenshot = await captureScreenshot(client, "perf-10k-album-editor");
  const warnings = client.events.filter((event) => event.method === "Runtime.exceptionThrown").length;
  const report = {
    dataDir,
    itemCount: libraryState.itemCount,
    countryCount: libraryState.countryCount,
    typeCount: libraryState.typeCount,
    expectedCounts: libraryState.expected,
    appLaunched: true,
    timings,
    renderedNodeLimits: {
      libraryCards: await evaluate(client, `() => document.querySelectorAll('.item-card').length`),
      galleryTiles: await evaluate(client, `() => document.querySelectorAll('.gallery-tile').length`),
      pickerResults: await evaluate(client, `() => document.querySelectorAll('.picker-result').length`)
    },
    runtimeExceptionEvents: warnings,
    perfTraceEvents: {
      renderer: client.rendererPerfEvents.length,
      main: mainPerfEvents.length
    },
    screenshot
  };
  report.renderedNodeLimits = {
    libraryCards: report.timings.find((entry) => entry.label === "library initial DOM audit").result.renderedCards,
    galleryTiles: report.timings.find((entry) => entry.label === "gallery initial render").result.renderedTiles,
    pickerResults: report.timings.find((entry) => entry.label === "open add item picker").result.renderedResults
  };

  assert(report.timings.find((entry) => entry.label === "library initial DOM audit").result.renderedCards <= 240, "Library renders too many cards at once");
  assert(report.timings.find((entry) => entry.label === "gallery initial render").result.renderedTiles <= 180, "Gallery renders too many tiles at once");
  assert(report.timings.find((entry) => entry.label === "open add item picker").result.renderedResults <= 24, "Item picker renders too many results at once");
  assert(warnings === 0, `${warnings} runtime exception event(s) captured`);

  console.log(JSON.stringify(report, null, 2));
  await stop(child);
  client.close();
  fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 });
}

main().catch(async (error) => {
  console.error(error);
  await stop(activeChild);
  fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 250 });
  process.exitCode = 1;
});
