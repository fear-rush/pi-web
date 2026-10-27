# Next.js workarounds and upgrades

Pi Web is a client-rendered app on a JSON API, so Next is doing three things here: bundle the
client, serve `app/api/**`, and run the proxy. Everything in this note exists because one of those
three broke, or because Next's defaults fight this app.

Bumping Next means re-checking all of it. `lib/next-config.test.mjs` guards the ones that live in
config or in a source file; the rest are behavioural and listed in the checklist at the end.

Files: `next.config.ts`, `instrumentation.ts`, `instrumentation-node.ts`, `proxy.ts`,
`lib/gfm-autolink-email-loader.cjs`, `lib/next-config.test.mjs`, `bin/pi-web.js`,
`bin/rotate-preview-secrets.js`.

## The workarounds

| # | Workaround | Why | When it breaks |
|---|---|---|---|
| 1 | `outputFileTracingRoot: configDir` | The published package ships `.next` and starts it with `next start`; tracing must not walk above the package | A tarball whose server files reference paths that do not exist on the user's machine |
| 2 | `experimental.proxyClientMaxBodySize: "128mb"` | `proxy.ts` matches `/api/:path*`, and Next buffers a request body whenever a proxy is present, capped at 10 MB by default. The upload route accepts 25 MB per file and 100 MB per request | Uploads over 10 MB fail with `Failed to parse body as FormData` |
| 3 | `images.unoptimized: true` | `next/image` is only used for the static logo, and the optimizer brings sharp/libheif (GHSA-2xp9-vwfh-vxw4) | The `/_next/image` endpoint comes back, and with it the attack surface |
| 4 | Turbopack rule rewriting `mdast-util-gfm-autolink-literal` | Its email regex starts with a lookbehind, unparseable before Safari 16.4, and it ships in the first load of `/` (#753) | A blank page on iOS 16.2. Probe: `grep -rnF '/(?<=' .next/static .next/server` must print nothing; the rewrite leaves the lookbehind only inside a string (`RegExp("(?<=^|…", "gu")`) |
| 5 | `transpilePackages: ["mermaid", "@mermaid-js/parser"]` | Mermaid's lazy diagram chunks are full of class `static {}` blocks, which SWC only lowers for listed packages (#753) | A syntax error, only when a diagram is rendered on an older Safari |
| 6 | `serverExternalPackages` | `node-pty` is a native addon, `web-push` wants its own https stack, and the pi SDK must be the same modules the CLI loads rather than a second copy inside the bundle | The terminal stops spawning; pi state diverges between the bundle and the CLI |
| 7 | `allowedDevOrigins` with the RFC1918 ranges | Next 16 blocks cross-origin dev resources, which locks out every machine on the LAN | `npm run dev:lan` works on the host and not from the phone |
| 8 | `instrumentation.ts` branch on `NEXT_RUNTIME === "nodejs"` | Next builds instrumentation for the Edge graph too, which rejects `process.on` and undici. An early return leaves those calls in the Edge module | An Edge build error, or Node-only code in the Edge entry |
| 9 | `instrumentation-node.ts` closes SSE streams on SIGINT/SIGTERM | Next 16 answers a signal with `server.close()` and no timeout, and SSE streams only end when the client leaves | The process never exits after Ctrl+C with a chat open |
| 10 | `instrumentation-node.ts` prewarms `@earendil-works/pi-coding-agent` | Next evaluates route code on first request, so the first `/api/sessions` paid for importing the whole SDK, seconds on Windows (#964) | The first request after a start is slow again |
| 11 | `bin/rotate-preview-secrets.js` before `next start` | A published tarball carries `.next` with its preview-mode id, which `x-prerender-revalidate` could use to skip the proxy | Preview mode bypasses auth. Packaging only; harmless from a checkout |

Two Next behaviours that look like bugs but are not, and need no workaround:

- **`next dev` rewrites `AGENTS.md`.** It appends a `BEGIN:nextjs-agent-rules` block; commit it with
  unrelated work or leave it, but do not treat it as a local edit.
- **Turbopack warns "dynamic filesystem access causes tracing of the whole project"** (14 times, from
  `lib/worktree.ts` and `app/api/file-index/route.ts`). The paths come from a runtime cwd, so they
  cannot be static, and the webpack build traced the same files silently. Advisory only.

The 47 routes with `export const dynamic = "force-dynamic"` are belt and braces: Next's route handlers
are uncached by default, but these read live session and filesystem state and must never be baked at
build time. A new route that reads runtime state should declare it too. Nothing guards this, by
design: asserting it would flag the 20 routes that legitimately read the request instead.

## Bumping Next

1. `npm install next@<version>` and whatever `next` peers it moves (`react`, `react-dom`). This repo
   only takes releases that are at least three days old.
2. `npm run lint`, `node_modules/.bin/tsc --noEmit`, `npm test`. `lib/next-config.test.mjs` fails on a
   removed or disabled workaround above; the rest of the suite covers the SSE, proxy and route
   behaviour that Next's defaults can quietly change.
3. `npm run build`, then `npm start` and check by hand: `/` returns HTML with its
   `Cache-Control: private, no-cache` header, `/sw.js` returns `Service-Worker-Allowed: /`,
   `/api/home` returns JSON, a terminal created through `POST /api/terminal` echoes input over
   `/api/terminal/<id>/events` (this proves `serverExternalPackages` and the SSE path in production),
   and the build printed every page as prerendered rather than failing on one.
4. Probe the shipped bundle for the Safari killer: `grep -rnF '/(?<=' .next/static .next/server` must
   print nothing.
5. `npm run test:terminal` and `npm run test:e2e` from a checkout with no dev server running; both
   spawn their own server. The terminal suite is the only automated coverage of `node-pty`.
6. `git status`: `next dev` may have appended its block to `AGENTS.md`.

Do not run `npm run build` while a dev server is running: it owns `.next`, and the build replaces it.
Copy the checkout elsewhere (with its own `node_modules`, not a symlink; Turbopack refuses to resolve
`next` through one) when you need a production build next to a running dev server.
