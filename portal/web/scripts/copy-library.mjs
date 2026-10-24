// Copies the existing SafeWorks India library (procedures, first aid, regulations…) into dist/library
// so the portal serves it at /library/ as the Knowledge section.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "..", "..", "..");
const out = path.resolve(here, "..", "dist", "library");

const files = ["index.html", "manifest.webmanifest", "sw.js"];
if (!fs.existsSync(path.join(repo, "index.html"))) {
  console.warn("[library] SafeWorks library not found next to the portal; /library/ will not be available.");
  process.exit(0);
}
fs.mkdirSync(path.join(out, "icons"), { recursive: true });
for (const f of files) {
  const src = path.join(repo, f);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(out, f));
}
for (const f of fs.readdirSync(path.join(repo, "icons"))) {
  if (f.endsWith(".png")) fs.copyFileSync(path.join(repo, "icons", f), path.join(out, "icons", f));
}
console.log("[library] copied SafeWorks library to dist/library");
