// Copies the shared design tokens (repo /design/tokens.css) into the web source so Vite can import them.
// Edit /design/tokens.css, never the copy.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.resolve(here, "..", "..", "..", "design", "tokens.css");
const dst = path.resolve(here, "..", "src", "shared", "tokens.css");
const css = fs.readFileSync(src, "utf8");
fs.writeFileSync(dst, "/* GENERATED from /design/tokens.css by scripts/sync-tokens.mjs — do not edit. */\n" + css);
console.log("[tokens] synced", path.relative(process.cwd(), dst));
