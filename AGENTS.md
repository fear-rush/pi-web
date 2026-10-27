# Pi Web - Development Notes

## Quick Start

```bash
npm run dev   # port 30141
```

Typecheck: `node_modules/.bin/tsc --noEmit` · Lint: `npm run lint` (Oxlint, `.oxlintrc.json`)

Lint is Oxlint, not ESLint: 76 of the 82 rules `eslint-config-next` enabled are ported by name, and the six that are not have no Oxlint equivalent (`react-hooks/config`, `react-hooks/gating`, `react/jsx-uses-react`, `react/jsx-uses-vars`, `react/no-deprecated`, `@next/next/no-location-assign-relative-destination`). `react/react-in-jsx-scope` is dropped: Oxlint cannot see the automatic JSX runtime, so it would fire on every file. Oxlint also lints the `.mjs` tests, which ESLint's config applied `prefer-const` to nowhere, so test files turn that rule off through `overrides`.

TypeScript is 7.x (the native compiler, `tsgo`), which ships no compiler API. The tests that read a function out of a component's source use `lib/test-source.mjs` instead: `oxc-parser` for the AST and `esbuild` for emitting JavaScript (including the CommonJS a few fixtures need to stub `require`).

**Never run `next build` during dev**: it pollutes `.next/` and breaks `npm run dev`.

### Dev server troubleshooting

- First run `lsof -nP -iTCP:30141 -sTCP:LISTEN` and reuse a healthy Pi Web process. A second `next dev` on another port is no workaround: both contend for `.next/dev/lock`.
- A browser-only `Module ... factory is not available` overlay usually means that tab has a stale Turbopack/HMR graph, not a broken server or source. Use the browser's explicit reload, then compare the server log and a direct HTTP/API request.
- Restart only when the failure reproduces from a fresh page and the server-side checks fail too: stop that exact dev process gracefully, move `.next` into a `mktemp -d` backup, restart with `npm run dev`.
- Never fall back to `next dev --webpack`: the dev graph can fail on `undici` imports such as `node:console`. Development uses Turbopack.
- `next dev` may append a generated `BEGIN:nextjs-agent-rules` block to `AGENTS.md`. It is tooling output: check `git status` and keep it out of unrelated commits.

### Upgrading pi

pi's packages depend on each other with `^` ranges, and the published pi-web's dependencies resolve afresh on install (no lockfile ships). Install every `@earendil-works/*` package the tree holds, the SDK's own dependencies included (`pi-codemode`, `pi-mcp`, `pi-telemetry`, …), with `npm install --save-exact`, so npm reuses those exact versions for the SDK's ranges. `lib/pi-packages.test.mjs` fails on any pi package that is not pinned that way; pi-web 0.12.0 pinned four, and installs after pi 1.2.0 paired pi-coding-agent 1.1.0 with pi-codemode 1.2.0.

---

## Architecture

- **Browsing** (read-only, no AgentSession): `GET /api/sessions` lists `~/.pi/agent/sessions/`; `GET /api/sessions/[id]` reads the `.jsonl` through SDK `SessionManager` helpers and `lib/session/session-reader.ts`, or an open wrapper's in-memory `SessionManager`. `GET /api/agent/running` snapshots the running ids.
- **Sending**: `POST /api/agent/[id]` → `startRpcSession()` (`lib/agent/rpc-manager.ts`) creates the AgentSession in-process (`createAgentSessionFromServices()`); `session.send(cmd)` → `session.prompt()`.
- **Events**: `GET /api/agent/[id]/events` streams SSE `data: {...}` from `session.onEvent()`, fed by `session.subscribe()`.
- **Product scope**: a light web wrapper around pi, not an IDE or a platform of its own. Before adding a feature, check the out-of-scope list in [CONTRIBUTING.md](CONTRIBUTING.md).
- **Extension compatibility (principle)**: extensions written for the pi CLI must behave the same here. Fix display problems in the web client; never add pi-web-only options or fields to the extension API (`ctx.ui.*` options, `extension_ui_request`). pi's TUI (`node_modules/@earendil-works/pi-tui`) is the reference for what an extension asking for something means.

---

## File Map

```
app/api/
  sessions/route.ts                GET list all sessions
  sessions/[id]/route.ts           GET/PATCH/DELETE a session
  sessions/[id]/context/route.ts   GET ?leafId=&tail=&before= a page of a leaf's context (tail defaults to 50; before pages upward)
  sessions/[id]/export/route.ts    GET exported HTML
  sessions/[id]/fork/route.ts      POST copy the session's current branch into a new session (never starts an AgentSession)
  sessions/delete/route.ts         POST { ids } delete sessions and their subagents (a project's Delete all sessions); running ones kept
  sessions/stats/route.ts          POST { ids } each session's tokens, cost, tool calls, active time (the agent switcher's rows)
  sessions/[id]/state/route.ts     GET live wrapper state while running
  sessions/ui-state/route.ts       GET/POST sidebar pins, archive, project order and names (set, restore, pin-project, add-projects, move-project, rename-project)
  sessions/[id]/auto-name/route.ts POST generate a session title
  sessions/search/route.ts         GET session search
  agent/new/route.ts               POST { cwd, type: prompt|ensure_session (start only), message?, toolNames?, provider?, modelId?, thinkingLevel? }
  agent/[id]/route.ts              GET state (?systemPrompt=0: without the prompt) | POST any command
  agent/[id]/events/route.ts       GET SSE stream
  agent/[id]/lease/route.ts        POST ?holder=<page id> keep the session that page has selected alive (with or without its stream); reply: running, awaitingInput, subagentsActive
  agent/running/route.ts           GET running + awaiting-input session ids, sidebar pins/archive revision
  auth/api-key/[provider]/route.ts POST/DELETE stored provider API key
  auth/login/[provider]/route.ts   GET OAuth/device-code SSE | POST manual code
  auth/logout/[provider]/route.ts  POST OAuth logout
  auth/providers/route.ts          GET OAuth and API-key provider lists
  cwd/validate/route.ts            POST validate/select a cwd
  cwd/browse/route.ts              GET browse any readable directory for the cwd picker | POST create child directory
  default-cwd/route.ts             POST create ~/pi-cwd/YYYYMMDD (local date)
  home/route.ts                    GET user home directory
  open-in-explorer/route.ts        GET availability | POST open a cwd in the OS file manager (loopback only)
  files/[...path]/route.ts         GET ?type=list|read|download|meta|preview|watch | POST ?type=upload|upload-check|allow-link
  file-index/route.ts              GET file list for @-mentions
  git/status/route.ts              GET changed files for a cwd
  git/diff/route.ts                GET diff of one changed file
  worktrees/route.ts               GET/POST/DELETE git worktrees
  terminal/route.ts                POST create a terminal session
  terminal/[id]/route.ts           GET { id, cwd } (404 once closed; stream at [id]/events) | POST input/resize | DELETE kill
  mcp/route.ts                     GET [?cwd=] Settings › MCP overview, files only | POST add/enable/disable/remove/undo/set-enabled/set-exposure/set-in-project/sign-out
  mcp/test/route.ts                POST { scope, name, cwd? } test one server once (entry read from its file)
  mcp/sign-in/route.ts             POST { scope, name, cwd? } start or join an OAuth sign-in
  mcp/sign-in/[flowId]/route.ts    GET flow state (polled) | POST { redirectUrl } | DELETE cancel
  project-trust/route.ts           GET trust status + project .pi/mcp.json servers (files only) | POST trust, rebuild the cwd's wrappers
  tools/settings/route.ts          GET/PUT defaultTools switches: PowerShell (Windows), Code mode automatic/always; codemode.mode, codemode.inlineBudget
  cache-miss-notices/route.ts      GET/PUT pi's global showCacheMissNotices (Settings › General)
  models/route.ts                  GET ?cwd= { models, modelList, defaultModel, … }
  models/enabled/route.ts          GET/PUT enabledModels switches
  models/default/route.ts          PUT default model / reasoning level for new sessions
  models/refresh/route.ts          POST fetch provider catalogs from pi.dev on demand
  models-config/route.ts           GET/PUT ~/.pi/agent/models.json
  models-config/catalog/route.ts   GET models.dev pricing presets
  models-config/discover/route.ts  POST fetch a configured provider's upstream model list
  models-config/test/route.ts      POST test a configured model/provider
  plugins/route.ts                 GET/POST package plugin management
  plugins/check/route.ts           POST check plugin package updates
  skills/route.ts                  GET/PATCH loaded skills, disable-model-invocation
  skills/content/route.ts          GET one loaded skill's bounded Markdown source, or ?document= a Markdown file in its folder
  skills/install/route.ts          POST install skills via npx skills add
  skills/search/route.ts           POST skills.sh search
  subagents/settings/route.ts      GET/PUT built-in subagent switch and maxConcurrent
  web-auth/route.ts                GET status | POST login | DELETE logout (browser password)
  provider-usage/query/route.ts    POST provider usage quotas
  push/config/route.ts             GET VAPID public key
  push/subscribe/route.ts          POST register a push subscription
  app-update/route.ts              GET current vs latest published pi-web version

lib/  (domain folders; cross-cutting modules stay at the root)
  agent/         AgentSession wrapper and registry, the SDK bridge, agent events and their wire format, extension UI plumbing, tool presets' runtime
  auth/          the web password, its throttle and the API request security checks
  files/         the file access allow-list, worktrees, uploads, the file tree, git status/diff, CSV/TSV parsing, text preview
  i18n/          messages and the formatting registry
  mcp/           MCP config read/write, overrides, secrets, transports, the per-session host, test and OAuth sign-in
  models/        model catalogs, providers, enabledModels scopes, context windows, usage
  project/       project trust, identity, folders and their order, the workspace memory file
  push/          web push subscriptions and browser notifications
  rendering/     Markdown, its blocks, Prism loading, ANSI text, the Safari autolink loader
  session/       session files, the reader and its caches, forks, sidebar rows and prefs, message display, turn timing, transcripts
  settings/      the global settings file and its locked writes, Code mode and PowerShell switches, theme and fonts, stacked dialogs
  skills/        loaded skills, their frontmatter, lock and updates
  subagents/     profiles, runtime, isolation, prompts, queues, settings
  terminal/      the pty manager, terminal input and theme, shell word splitting, the npx/CLI helpers
  tools/         tool names, fields, results and their expansion state
  root          api-types.ts, types.ts, test-source.mjs, json-response.ts, key-serializer.ts, perf.ts, http-dispatcher.ts, request-security.ts, normalize.ts, display-path.ts, clipboard.ts, codemode-view.ts, app-update.ts, plugin-updates.ts, login-destination.ts, bounded-form-data.ts, next-config.test.mjs, pi-packages.test.mjs
                plus the tests of bin/ (pi-web-options, process-lifecycle, rotate-preview-secrets, node-version)
hooks/
  useAgentSession.ts       messages, streaming, SSE, fork/navigate, reconciliation; built-in slash commands (/session, bare /mcp)
  useStreamingSelector.ts  one value of the streaming store (lib/session/streaming-message.ts): a chunk re-renders only its subscribers
  useAudio.ts              completion sound + AudioContext unlock
  useDragDrop.ts           chat drop zone: dropped files, folders marked
  useFilesPlacement.ts     per-browser choice: the desktop sidebar's file browser below the sessions or in its own tab
  useGroupDrag.ts          dragging a sidebar project group: mouse threshold, touch/pen long-press, auto-scroll, drop
  useIsMobile.ts           responsive breakpoint
  usePageHidden.ts         HIDDEN_PAGE_GRACE_MS; true once the page has been hidden that long (file watches pause)
  useSessionUiState.ts     sidebar pins, archive, project order: optimistic writes in order, refetch on revision change
  useSidebarMotion.ts      the sidebar's fold and archive-view motion: phase, end fallback, reduced motion, what shows meanwhile
  useKeyboardShortcuts.ts  Esc stops the running agent unless a field or nearer handler took it; Ctrl+Alt+N
  useResizablePanel.ts     drag/keyboard panel size kept per key; persistClamp: false never saves a short window's clamp
  usePrismLanguages.ts     true once the Prism languages are loaded; starts the load for a highlighter
  useTheme.ts              theme state
  useTerminalTheme.ts      the terminal's own dark/light choice (localStorage), apart from the app theme
```

---

## Topic Notes

Design decisions and traps live in `docs/agents/`, one note per area. Read every note whose files a change touches before making it. Add new notes to the area's file, not here.

- [sessions.md](docs/agents/sessions.md): AgentSession lifecycle and shutdown, fork vs in-session branching, the sidebar's on-disk Fork, session file rewrites, toolCall normalization, a run's message keys across the file read, SSE reconnect and tool events, a tool card's flat arguments as rows, transcript system / usage / context-edit entries, running-state polling, custom-message collapsing, streamed chunks re-rendering only the reply, streaming markdown block by block, hand-written anchors in rendered Markdown landing after the sanitizer's id prefix, long thinking rendered in pieces, a finished turn's duration, history caches (tool-result images, subagent runs, session views) and deferred code highlighting with Prism languages loaded on demand, a patch shown in one column or two, the session sidebar (toolbar row and its brand, project groups, their order and display names, pins, archive, new-session project adoption, the files below the sessions or in a tab), the project/worktree bar above a fresh composer (the header: brand, then the bar) and what it carries across the remount, exported HTML, the extension status bar and its `command:` buttons, cache and cost notices (`showCacheMissNotices`). Files: `lib/agent/rpc-manager.ts`, `lib/session/session-reader.ts`, `lib/session-fork*.ts`, `lib/session/session-delete.ts`, `lib/normalize.ts`, `lib/session/message-keys.ts`, `lib/session/session-tree.ts`, `lib/session-ui-state*.ts`, `lib/session/sidebar-prefs.ts`, `lib/session/sidebar-actions.ts`, `lib/session/session-links.ts`, `lib/session/new-session-context.ts`, `hooks/useAgentSession.ts`, `hooks/useSessionUiState.ts`, `hooks/useSidebarMotion.ts`, `hooks/useGroupDrag.ts`, `hooks/useFilesPlacement.ts`, `hooks/useResizablePanel.ts`, `app/api/agent/**`, `app/api/sessions/**`, `components/SessionSidebar.tsx`, `components/PiWebTitle.tsx`, `components/SessionTree.tsx`, `components/SidebarMenu.tsx`, `components/SidebarToast.tsx`, `components/SidebarIcons.tsx`, `components/ProjectWorktreePicker.tsx`, `components/NewSessionContextBar.tsx`, `components/WorktreeCreateForm.tsx`, `handleNewSession`, `handleSelectSession` and the bar's handlers in `components/AppShell.tsx`, `components/BranchNavigator.tsx`, `components/MessageView.tsx`, `lib/session/message-display.ts`, `lib/session/patch.ts`, `components/FileViewer.tsx`, `components/MarkdownBody.tsx`, `lib/rendering/markdown.ts`, `lib/rendering/markdown-blocks.ts`, `lib/session/streaming-message.ts`, `hooks/useStreamingSelector.ts`, `lib/session/turn-duration.ts`, `components/MermaidBlock.tsx`, `lib/rendering/highlight-queue.ts`, `lib/rendering/prism-languages.ts`, `hooks/usePrismLanguages.ts`, `lib/session/session-view-cache.ts`, `components/CodemodeToolView.tsx`, `components/ExtensionStatusBar.tsx`, `components/ExtensionWidgets.tsx`, `lib/transcript-notices*.ts`, `components/TranscriptNotices.tsx`, `app/api/cache-miss-notices/**`, `lib/tools/tool-fields.ts`.
- [tools.md](docs/agents/tools.md): tool presets and Chat only, exact system prompts, tool exposure, the codemode / tool-search / mcp built-ins, the read-only MCP policy, the Code mode and PowerShell `defaultTools` switches. Files: `lib/tools/tool-presets.ts`, `lib/tools/tool-preset-preference.ts`, `lib/session/chat-only.ts`, `lib/agent/exact-system-prompt.ts`, `lib/agent/builtin-extensions.ts`, `lib/mcp/mcp-read-only-policy.ts`, `lib/settings/codemode-settings.ts`, `lib/settings/powershell-settings.ts`, `lib/settings/global-settings-file.ts`, `app/api/agent/new/route.ts`, `app/api/tools/settings/route.ts`, tool selection in `lib/agent/rpc-manager.ts`.
- [mcp-runtime.md](docs/agents/mcp-runtime.md): the per-session MCP host (when servers register and connect, reported states, trust read on every sync, idle release); `/mcp` in the composer. Files: `lib/mcp/mcp-host.ts`, `lib/mcp/mcp-transport.ts`, `lib/mcp/mcp-status.ts`, `lib/mcp/mcp-command.ts`, `lib/mcp/mcp-config-key.ts`, MCP wiring in `lib/agent/rpc-manager.ts` and `lib/agent/builtin-extensions.ts`, `/mcp` handling in `hooks/useAgentSession.ts`.
- [mcp-settings.md](docs/agents/mcp-settings.md): Settings › MCP reads without running anything, masking, the trust dialog's server list, row states, notices, Code mode choice, trust from Settings, Escape stacking, every `mcp.json` write and undo. Files: `app/api/mcp/route.ts`, `app/api/project-trust/route.ts`, `lib/mcp/mcp-config-read.ts`, `lib/mcp/mcp-config-file.ts`, `lib/mcp/mcp-override.ts`, `lib/mcp/mcp-undo.ts`, `lib/mcp/mcp-secrets.ts`, `lib/mcp/mcp-server-display.ts`, `lib/mcp/mcp-json-error.ts`, `lib/project/project-trust.ts`, `lib/files/regular-file.ts`, `lib/settings/stacked-dialog.ts`, `lib/settings/settings-navigation.ts`, `components/McpConfig.tsx`, `components/mcp-config-helpers.ts`, `components/ProjectTrustDialog.tsx`, `components/SettingsPanel.tsx`.
- [mcp-test-sign-in.md](docs/agents/mcp-test-sign-in.md): Settings › MCP Test (route checks, bounded connection, `!command` queue, redaction, status store) and OAuth sign-in / sign-out. Files: `app/api/mcp/test/**`, `app/api/mcp/sign-in/**`, `lib/mcp/mcp-test.ts`, `lib/mcp/mcp-entry-request.ts`, `lib/mcp/mcp-status.ts`, `lib/mcp/mcp-sign-in.ts`, `lib/mcp/mcp-sign-out.ts`, `components/McpSignIn.tsx`, `components/mcp-sign-in-helpers.ts`, `components/OAuthPastePanel.tsx`.
- [mcp-add.md](docs/agents/mcp-add.md): Settings › MCP add (paste re-parsed on the server, host-variable confirmation, literal secrets kept global, fresh-folder trust, the add pane) and the paste importer's escaping and grammars. Files: `lib/mcp/mcp-add.ts`, `lib/mcp-import*.ts`, `lib/terminal/shell-words.ts`, fresh-folder trust in `lib/project/project-trust.ts`, `components/McpAddServer.tsx`, `components/mcp-add-helpers.ts`, the `add` action of `app/api/mcp/route.ts`.
- [models.md](docs/agents/models.md): default model and reasoning level, providers registered at session_start, mid-run reasoning changes, remote provider catalogs, `enabledModels` scoping and minimal edits, managed models' context-window overrides, provider auth listing and credentials, the extension-loaded runtime those routes share. Files: `app/api/models/**`, `app/api/models-config/**`, `app/api/auth/**`, `lib/models/model-runtime.ts`, `lib/models/default-preferences.ts`, `lib/models/model-scope.ts`, `lib/enabled-models*.ts`, `lib/models/model-context.ts`, `lib/models/model-catalog-refresh.ts`, `lib/models/deferred-provider-models.ts`, `lib/provider-listing*.ts`, `components/ModelsConfig.tsx`, `components/EnabledModelsSection.tsx`, `components/ModelContextWindow.tsx`, `components/ModelSelector.tsx`, `components/SelectorRow.tsx`.
- [files-and-access.md](docs/agents/files-and-access.md): worktrees and project grouping, the file access allow-list (the `/api/files` security boundary), file tree visibility and its open directories per folder, uploads and chat file drops, the source view's languages by extension, the CSV/TSV table view, web password throttling. Files: `app/api/files/**`, `app/api/cwd/**`, `app/api/worktrees/**`, `app/api/file-index/**`, `app/api/web-auth/**`, `proxy.ts`, `lib/files/path-security.ts`, `lib/files/file-access.ts`, `lib/files/linked-directory.ts`, `lib/session-file-references*.ts`, `lib/files/file-tree-visibility.ts`, `lib/files/file-tree-expansion.ts`, `lib/files/file-upload-client.ts`, `lib/files/file-version.ts`, `lib/files/worktree.ts`, `lib/files/paths.ts`, `lib/auth/auth-throttle.ts`, `components/ProjectWorktreePicker.tsx`, `components/NewSessionContextBar.tsx`, `components/FileExplorer.tsx`, `lib/files/delimited-table.ts`, `components/DelimitedTable.tsx`, the table branch of `components/FileViewer.tsx`, `hooks/useDragDrop.ts`.
- [settings-ui.md](docs/agents/settings-ui.md): General's sidebar file-browser choice, Plugins and Skills routes, sidebar group switches, the shared `SettingsUi` blocks every settings panel and add pane uses. Files: `app/api/plugins/**`, `app/api/skills/**`, `lib/skills/skills-service.ts`, `components/SettingsUi.tsx`, `components/settings-ui-helpers.ts`, `components/SkillsConfig.tsx`, `components/PluginsConfig.tsx`, `hooks/useFilesPlacement.ts`; also before adding a settings section or add pane.
- [subagents.md](docs/agents/subagents.md): the built-in subagent setting, profiles and their files, run status, completion notifications, the subagent viewer tab. Files: `lib/subagent*.ts`, `app/api/subagents/**`, `components/AgentsConfig.tsx`, `components/SubagentViewer.tsx`, `components/subagent-viewer-state.ts`.
- [client-platform.md](docs/agents/client-platform.md): the global shortcuts (Ctrl+Alt+N on macOS's dead-key Option+N and Windows AltGr, Esc stacking), mobile software keyboard and viewport height, the terminal's extra keys, its own dark/light theme and its font size following the chat's, completion sound. Files: `hooks/useKeyboardShortcuts.ts`, `hooks/useViewportHeight.ts`, `hooks/useAudio.ts`, `components/TerminalExtraKeys.tsx`, `lib/terminal/terminal-extra-keys.ts`, `lib/terminal/terminal-theme.ts`, `hooks/useTerminalTheme.ts`, `terminalFontSize()` in `hooks/useChatAppearance.ts`, the keyboard-open CSS.
- [next-upgrades.md](docs/agents/next-upgrades.md): the Next.js workarounds (proxy body buffer, image optimizer, Turbopack rule for the Safari 16.2 lookbehind, mermaid transpiling, server externals, dev origins, the Node/Edge instrumentation split, SSE close on shutdown, SDK prewarm, preview-secret rotation), the Turbopack tracing warnings, the force-dynamic guidance, and the checklist for bumping Next. Files: `next.config.ts`, `instrumentation.ts`, `instrumentation-node.ts`, `proxy.ts`, `lib/rendering/gfm-autolink-email-loader.cjs`, `lib/next-config.test.mjs`, `bin/pi-web.js`, `bin/rotate-preview-secrets.js`.

---

## Tests

- A test asserts behaviour: a value a function returns, a file it writes, HTML it renders, an error it throws. It does not read the source to check what the source says. The exceptions are invariants a runtime test cannot express, and they are centralized: `lib/safari-16-2.test.mjs` follows the import graph from the UI and forbids a RegExp lookbehind in anything a browser parses, `lib/next-config.test.mjs` guards the Next workarounds, `lib/session/session-ui-state-shared.test.mjs` guards a client-safe module against Node imports. Asserting on a file a function wrote is behaviour, not a source check.
- When a handler is not reachable from a test without mounting a 3,000-line component, the test may run the callback taken from the source. `lib/test-source.mjs` does the parsing (Oxc) and compiling (esbuild) for that, so no test file carries its own parser. Ask first whether the callback deserves its own module instead.
- Do not add a test that grep-matches a component's source, a constant's formula, or a style value. Those break on every refactor and prove nothing at runtime.

## Old Safari (iOS 16.2)

- `/` renders entirely on the client, so one script chunk the browser cannot parse is a blank page. Next 16 targets Safari 16.4+; the `browserslist` in `package.json` lowers Safari and iOS to 16.2 so SWC turns class `static {}` blocks into private static fields. That covers Next's client runtime; other node_modules keep their syntax unless listed in `transpilePackages` (mermaid and `@mermaid-js/parser` are, for their lazy diagram chunks). Keep the other browserslist entries at Next's defaults.
- Never write a RegExp lookbehind (`(?<=`, `(?<!`) in client code: SWC cannot downlevel it and Safari parses it only from 16.4. `lib/rendering/markdown.ts` emulates its leading lookbehinds with `replaceNotPrecededBy()`. A lookbehind built at runtime (`new RegExp("(?<=…)")` in `try`) fails only when run; that is how `lib/rendering/gfm-autolink-email-loader.cjs` fixes `mdast-util-gfm-autolink-literal`'s email regex. The loader is registered for webpack and Turbopack in `next.config.ts` and fails the build if that regex changes upstream.

## Pi Session File Format

Location: `~/.pi/agent/sessions/<encoded-cwd>/<timestamp>_<uuid>.jsonl`

```jsonl
{"type":"session","version":3,"id":"<uuid>","timestamp":"...","cwd":"/path","parentSession":"/abs/path/to/parent.jsonl"}
{"type":"model_change","id":"<8hex>","parentId":null,"provider":"zenmux","modelId":"claude-sonnet-4-6","timestamp":"..."}
{"type":"message","id":"<8hex>","parentId":"<8hex>","message":{"role":"user","content":"..."}}
{"type":"message","id":"<8hex>","parentId":"<8hex>","message":{"role":"assistant","content":[...],...}}
{"type":"message","id":"<8hex>","parentId":"<8hex>","message":{"role":"toolResult","toolCallId":"...","content":[...]}}
{"type":"compaction","id":"<8hex>","parentId":"<8hex>","summary":"...","firstKeptEntryId":"<8hex>","tokensBefore":N}
{"type":"session_info","id":"...","parentId":"...","name":"user-defined name"}
```

`SessionContext.entryIds[]` parallels `messages[]`: each displayed message's `.jsonl` entry id, used for fork and navigate_tree.

## CSS Variables (`app/globals.css`)

```
--bg --bg-panel --bg-hover --bg-selected --border
--text --text-muted --text-dim
--accent --user-bg --tool-bg
--font-mono
```

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
