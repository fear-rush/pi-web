import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Script, createContext } from "node:vm";
import { findNodes, findVariable, nodeSource, parseProgram, toJs } from "../lib/test-source.mjs";

const code = await readFile(new URL("./AppShell.tsx", import.meta.url), "utf8");
const program = parseProgram("AppShell.tsx", code);
function script(text) {
  return new Script(toJs(text));
}
function setup(collapsed = false) {
  const preference = findVariable(program, "desktopSidebarOpenRef");
  assert.ok(preference, "desktop preference must be independent of drawer state");
  const effect = findNodes(program, (node) => node.type === "CallExpression"
    && node.callee?.name === "useEffect"
    && nodeSource(code, node.arguments[1]) === "[isMobile]"
    && nodeSource(code, node.arguments[0]).includes("setSidebarOpen"))[0];
  assert.ok(effect, "missing the isMobile effect");
  const toggle = findVariable(program, "handleSidebarToggle");
  const context = createContext({
    initialNavigation: { sidebarCollapsed: collapsed }, isMobile: false, sidebarOpen: !collapsed,
    useRef: (current) => ({ current }), setActiveTopPanel() {}, setMobileToolbarMoreOpen() {},
  });
  context.desktopSidebarOpenRef = script(nodeSource(code, preference.init)).runInContext(context);
  context.setSidebarOpen = (value) => { context.sidebarOpen = typeof value === "function" ? value(context.sidebarOpen) : value; };
  const runEffect = () => script(`(${nodeSource(code, effect.arguments[0])})()`).runInContext(context);
  const runToggle = () => script(`(${nodeSource(code, toggle.init.arguments[0])})()`).runInContext(context);
  return { context, runToggle, resize: (mobile) => { context.isMobile = mobile; runEffect(); } };
}

test("closing a mobile drawer restores the previously open desktop sidebar", () => {
  const state = setup();
  state.resize(true); assert.equal(state.context.sidebarOpen, false);
  state.runToggle(); assert.equal(state.context.sidebarOpen, true);
  state.runToggle(); assert.equal(state.context.sidebarOpen, false);
  state.resize(false); assert.equal(state.context.sidebarOpen, true);
});

test("opening a mobile drawer does not reopen an explicitly collapsed desktop sidebar", () => {
  const state = setup(); state.runToggle();
  assert.equal(state.context.sidebarOpen, false);
  state.resize(true); state.runToggle();
  state.resize(false); assert.equal(state.context.sidebarOpen, false);
  state.runToggle(); state.resize(true); state.resize(false);
  assert.equal(state.context.sidebarOpen, true);
});

test("URL sidebar collapse survives hydration and repeated breakpoint crossings", () => {
  const state = setup(true);
  state.resize(false); assert.equal(state.context.sidebarOpen, false);
  state.resize(true); state.runToggle(); state.resize(false);
  assert.equal(state.context.sidebarOpen, false);
  state.resize(true); state.resize(false); assert.equal(state.context.sidebarOpen, false);
});
