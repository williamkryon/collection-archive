const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const dryRun = process.argv.includes("--dry-run");

const exactNames = new Set([
  ".vite",
  "build",
  "out",
  "test-artifacts"
]);

function isTempEntry(name) {
  return exactNames.has(name) || name.startsWith(".tmp-");
}

const entries = fs.readdirSync(root, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && isTempEntry(entry.name))
  .map((entry) => path.join(root, entry.name));

if (entries.length === 0) {
  console.log("No temporary folders to clean.");
  process.exit(0);
}

for (const entryPath of entries) {
  const relativePath = path.relative(root, entryPath);
  if (dryRun) {
    console.log(`Would remove ${relativePath}`);
  } else {
    fs.rmSync(entryPath, { recursive: true, force: true });
    console.log(`Removed ${relativePath}`);
  }
}
