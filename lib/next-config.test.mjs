import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

// Every assertion here guards one of the Next.js workarounds listed in
// docs/agents/next-upgrades.md. They catch a workaround being deleted or
// silently disabled by a config rewrite; they cannot catch Next changing the
// behaviour the workaround tames, which is why that note also lists the
// behavioural checks (npm test, npm run test:terminal, npm run build && npm start).

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function sizeLimitToBytes(value) {
  if (typeof value === "number") return value;
  const match = /^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)$/i.exec(value.trim());
  assert.ok(match, `unparseable SizeLimit: ${value}`);
  const units = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3 };
  return Number(match[1]) * units[match[2].toLowerCase()];
}

const nextConfig = () => createJiti(import.meta.url).import("../next.config.ts", { default: true });

test("scopes Next.js output file tracing to the pi-web package", async () => {
  const config = await nextConfig();

  assert.equal(config.outputFileTracingRoot, projectRoot);
});

test("raises the proxy body buffer above the upload route's 100 MB request cap", async () => {
  const config = await nextConfig();

  assert.ok(sizeLimitToBytes(config.experimental.proxyClientMaxBodySize) > 100 * 1024 * 1024);
});

test("keeps the image optimizer off", async () => {
  const config = await nextConfig();

  // next/image is only used for the static logo; the optimizer's sharp/libheif
  // attack surface (GHSA-2xp9-vwfh-vxw4) is not worth a resized logo.
  assert.equal(config.images?.unoptimized, true);
});

test("rewrites the remark-gfm email regex for Safari 16.2 in the one bundler that builds", async () => {
  const config = await nextConfig();

  // A regex literal with a lookbehind is a parse error before Safari 16.4 (#753),
  // and this one ships in the first load of `/`. The loader is the only thing
  // standing between iOS 16.2 and a blank page.
  const rules = config.turbopack?.rules ?? {};
  const rule = rules["**/mdast-util-gfm-autolink-literal/lib/index.js"];
  assert.equal(rule?.loaders?.length, 1, "the rewrite is registered once");
  assert.ok(
    rule.loaders[0].endsWith(path.join("lib", "gfm-autolink-email-loader.cjs")),
    `unexpected loader: ${rule.loaders[0]}`,
  );
  // One bundler, one registration: `next build` runs Turbopack now, so a second
  // webpack hook would only drift.
  assert.equal(config.webpack, undefined);
});

test("transpiles the mermaid chunks Safari 16.2 cannot parse", async () => {
  const config = await nextConfig();

  // mermaid's lazy diagram chunks are full of class `static {}` blocks, which
  // SWC only lowers for the packages listed here (#753).
  assert.deepEqual(config.transpilePackages, ["mermaid", "@mermaid-js/parser"]);
});

test("keeps the native and SDK packages out of the server bundle", async () => {
  const config = await nextConfig();

  // node-pty is a native addon, web-push needs its own https stack, and the pi
  // SDK must be the same modules the CLI loads, so all of them are required at
  // runtime instead of bundled.
  for (const name of ["node-pty", "undici", "web-push", "@earendil-works/pi-coding-agent", "@earendil-works/pi-ai"]) {
    assert.ok(config.serverExternalPackages?.includes(name), `${name} is external`);
  }
});

test("keeps the LAN able to reach the dev server", async () => {
  const config = await nextConfig();

  // Next 16 blocks cross-origin dev resources by default, which would lock out
  // every machine on the same network except the loopback.
  assert.ok(config.allowedDevOrigins?.includes("192.168.*.*"), "private ranges stay allowed");
  assert.ok(config.allowedDevOrigins?.includes("10.*.*.*"));
});

async function routeFiles(dir = path.join(projectRoot, "app")) {
  const found = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) found.push(...await routeFiles(full));
    else if (entry.name === "route.ts") found.push(full);
  }
  return found;
}

test("no route opts into the edge runtime", async () => {
  const routes = await routeFiles();
  assert.ok(routes.length > 60, `found ${routes.length} routes`);

  // instrumentation.ts keeps its Node-only setup (`process.on`, the SDK prewarm)
  // out of the Edge graph with a build-time branch. A route that asks for the
  // edge runtime would load an entry that must stay Node-only.
  for (const route of routes) {
    const source = await readFile(route, "utf8");
    assert.doesNotMatch(source, /export const runtime\s*=\s*["']edge["']/, path.relative(projectRoot, route));
  }
});

test("instrumentation keeps the Node-only setup behind its build-time branch", async () => {
  const entry = await readFile(path.join(projectRoot, "instrumentation.ts"), "utf8");
  const nodeOnly = await readFile(path.join(projectRoot, "instrumentation-node.ts"), "utf8");

  // Next builds instrumentation for the Node and the Edge graph. An early return
  // instead of this branch would leave `process.on` and undici in the Edge module.
  assert.match(entry, /NEXT_RUNTIME === "nodejs"/);
  assert.match(entry, /import\("\.\/instrumentation-node"\)/);

  // Node-only work that only happens because Next runs the server this way.
  assert.match(nodeOnly, /configureHttpDispatcher\(readHttpIdleTimeoutMs\(\)\)/);
  assert.match(nodeOnly, /SIGINT/);
  assert.match(nodeOnly, /SIGTERM/);
  assert.match(nodeOnly, /closeAllAgentEventStreams/);
  assert.match(nodeOnly, /import\("@earendil-works\/pi-coding-agent"\)/);
});
