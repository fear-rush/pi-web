import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// A RegExp lookbehind is a SyntaxError before Safari 16.4, and pi-web supports
// 16.2 (#753). A client bundle is one chunk per route, so a literal in any
// client-reachable module blanks the page on an older iPhone. Server modules
// may use one; nothing a browser parses may.
//
// The scan follows the import graph from the UI entry points instead of
// guessing from a file's directory, and it reads code rather than comments, so
// a doc comment explaining the rule does not trip it.

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const UI_DIRS = ["app", "components", "hooks"];
const SPECIFIER = /(?:from\s*|import\s*\(|require\s*\()\s*["']([^"']+)["']/g;

async function sourceFiles(dir) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...await sourceFiles(full));
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.ts$/.test(entry.name)) found.push(full);
  }
  return found;
}

function resolveImport(fromFile, specifier) {
  const base = specifier.startsWith("@/")
    ? path.join(projectRoot, specifier.slice(2))
    : specifier.startsWith(".")
      ? path.resolve(path.dirname(fromFile), specifier)
      : undefined;
  if (!base) return undefined; // a package, not our source
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`]) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

/** Code only: comments removed, so documentation examples do not count. */
function withoutComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

test("no client-reachable module ships a RegExp lookbehind", async () => {
  const queue = [];
  for (const dir of UI_DIRS) {
    // app/api are server route handlers: never parsed by a browser.
    queue.push(...(await sourceFiles(path.join(projectRoot, dir))).filter((file) => !file.includes("/app/api/")));
  }
  const seen = new Set();
  const offenders = [];
  while (queue.length > 0) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const source = await readFile(file, "utf8");
    if (/\(\?<[=!]/.test(withoutComments(source))) offenders.push(path.relative(projectRoot, file));
    for (const match of source.matchAll(SPECIFIER)) {
      const target = resolveImport(file, match[1]);
      if (target && !seen.has(target)) queue.push(target);
    }
  }
  assert.ok(seen.size > 150, `followed only ${seen.size} modules from the UI`);
  assert.deepEqual(offenders, []);
});
