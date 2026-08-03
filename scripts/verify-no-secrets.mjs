/**
 * Fails the build if a Pexels credential — or any sign that one was expected in
 * client code — can be found in dist/.
 *
 * Run after `npm run build` (it is part of `npm run check`).
 *
 * This script NEVER prints a matched secret value. It reports the file, the
 * name of the rule that fired, and a byte offset. That is enough to find the
 * problem and not enough to leak it into a terminal, a CI log, or a chat.
 */
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative, extname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DIST = join(ROOT, "dist");
const SCANNED_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".html", ".css", ".map", ".json"]);

/* Static rules. `pexels.com` image and photo URLs are expected in the bundle
   (attribution links, srcset hosts), so the rules target credentials and the
   direct-from-browser calling pattern instead of the word "pexels". */
const RULES = [
  {
    name: "VITE_PEXELS_KEY reference",
    // the old public variable must not exist anywhere any more
    test: /VITE_PEXELS_KEY/,
  },
  {
    name: "PEXELS_API_KEY reference in client code",
    // the server-side variable name must never reach the browser bundle
    test: /PEXELS_API_KEY/,
  },
  {
    name: "direct call to the Pexels API from the browser",
    // all photo traffic must go through the same-origin proxy
    test: /api\.pexels\.com/,
  },
  {
    name: "Authorization header in client code",
    test: /Authorization["'\s:]+[A-Za-z0-9]{20,}/,
  },
  {
    name: "bare Pexels-shaped credential (56 chars)",
    // Pexels keys are 56 lowercase-alphanumeric characters
    test: /\b[a-zA-Z0-9]{56}\b/,
  },
];

/* If a key is configured in this environment, also check for that exact value.
   It is compared, never printed. */
const liveKey = (process.env.PEXELS_API_KEY || "").trim();

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (SCANNED_EXTENSIONS.has(extname(entry))) out.push(full);
  }
  return out;
}

if (!existsSync(DIST)) {
  console.error("verify-no-secrets: dist/ not found — run `npm run build` first.");
  process.exit(1);
}

const findings = [];
for (const file of walk(DIST)) {
  const text = readFileSync(file, "utf8");
  const where = relative(ROOT, file);

  for (const rule of RULES) {
    const match = rule.test.exec(text);
    if (match) findings.push({ where, rule: rule.name, offset: match.index });
  }
  if (liveKey && liveKey.length >= 16 && text.includes(liveKey)) {
    findings.push({
      where,
      rule: "the configured Pexels key itself",
      offset: text.indexOf(liveKey),
    });
  }
}

if (findings.length > 0) {
  console.error("verify-no-secrets: FAILED — client bundle contains credential material.\n");
  for (const f of findings) {
    // value deliberately omitted
    console.error(`  ${f.where}  ->  ${f.rule}  (at byte ${f.offset})`);
  }
  console.error("\nNothing above prints the matched value. Inspect the file locally.");
  process.exit(1);
}

console.log("verify-no-secrets: OK — no Pexels credential or direct API call found in dist/.");
