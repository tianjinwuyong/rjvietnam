#!/usr/bin/env node
// Every UI string must exist in all three locales.
//
// apps/web/src/i18n.ts is one flat dictionary of roughly 5k entries, written by hand
// and merged by many people. A key added with two languages renders as a blank or a
// raw dotted key on the shop floor, and nothing in the build notices.
//
// This parses the source, not React: no bundler, no DOM.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const file = path.join(root, "apps", "web", "src", "i18n.ts");
const src = readFileSync(file, "utf8");

// The file mixes two spellings for the same three languages -- BCP-47 keys
// ("zh-CN") and short bare keys (zh / vi / en). Both are in use, so both count.
const locales = [
  { name: "zh", keys: ["zh-CN", "zh"] },
  { name: "vi", keys: ["vi-VN", "vi"] },
  { name: "en", keys: ["en-US", "en"] },
];

// Value of one locale key inside an entry body, or undefined when the key is absent.
// Matches `zh: "..."`, `"zh-CN": "..."`, `'vi': "..."`, and null/undefined literals.
function localeValue(body, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `(?:^|[{,\\s])["']?${escaped}["']?\\s*:\\s*(?:"([^"]*)"|'([^']*)'|(null|undefined))`,
  );
  const m = re.exec(body);
  if (!m) return undefined;
  return m[1] ?? m[2] ?? m[3];
}

const start = src.indexOf("const dictionary");
if (start < 0) {
  console.error("I18N_NO_DICTIONARY `const dictionary` not found in apps/web/src/i18n.ts");
  process.exit(2);
}

const entries = [];
const incomplete = [];

for (const line of src.slice(start).split("\n")) {
  const one = /"([^"]+)"\s*:\s*\{([^{}]*)\}/.exec(line);
  if (!one) continue;
  const [, key, body] = one;
  entries.push(key);

  const missing = [];
  const empty = [];
  for (const locale of locales) {
    const values = locale.keys.map((k) => localeValue(body, k)).filter((v) => v !== undefined);
    if (!values.length) missing.push(locale.name);
    else if (values.every((v) => v === "" || v === "null" || v === "undefined")) empty.push(locale.name);
  }
  if (missing.length || empty.length) incomplete.push({ key, missing, empty });
}

if (!entries.length) {
  console.error("I18N_PARSED_NOTHING 0 dictionary entries matched -- the parser is wrong, not the file.");
  process.exit(2);
}

if (incomplete.length) {
  for (const item of incomplete.slice(0, 25)) {
    const parts = [];
    if (item.missing.length) parts.push(`missing=${item.missing.join(",")}`);
    if (item.empty.length) parts.push(`empty=${item.empty.join(",")}`);
    console.error(`  ${item.key}  ${parts.join(" ")}`);
  }
  if (incomplete.length > 25) console.error(`  ... ${incomplete.length - 25} more`);
  console.error(`I18N_INCOMPLETE entries=${entries.length} bad=${incomplete.length}`);
  process.exit(1);
}

console.log(`I18N_OK entries=${entries.length} locales=${locales.map((l) => l.name).join(",")}`);
