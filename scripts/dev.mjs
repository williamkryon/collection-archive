import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const viteBin = path.join(root, "node_modules", "vite", "bin", "vite.js");
const electronBin = require("electron");
const devUrl = "http://127.0.0.1:5173";

const vite = spawn(process.execPath, [viteBin, "--host", "127.0.0.1"], {
  cwd: root,
  stdio: "inherit",
  shell: false
});

function waitForServer(url, timeoutMs = 30000) {
  const started = Date.now();

  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve();
      });

      req.on("error", () => {
        if (Date.now() - started > timeoutMs) {
          reject(new Error(`Timed out waiting for ${url}`));
          return;
        }
        setTimeout(tick, 350);
      });
    };

    tick();
  });
}

try {
  await waitForServer(devUrl);
  const electron = spawn(electronBin, ["."], {
    cwd: root,
    stdio: "inherit",
    shell: false,
    env: {
      ...process.env,
      VITE_DEV_SERVER_URL: devUrl
    }
  });

  electron.on("exit", (code) => {
    vite.kill();
    process.exit(code ?? 0);
  });
} catch (error) {
  vite.kill();
  console.error(error);
  process.exit(1);
}
