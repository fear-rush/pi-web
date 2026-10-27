// Helpers for the tests that exercise a function taken out of a component or a
// hook: they parse the source, find the node by name, and run it in isolation
// with stubbed free variables. Until TypeScript 7 there was no way around this
// pattern for a `useCallback` buried in a 3,000-line component, and this module
// is where the pattern lives now.
//
// It uses the Oxc parser for the AST (`oxc-parser`, an ESTree shape) and esbuild
// for emitting JavaScript (`esbuild`, which can also emit CommonJS, something the
// Oxc transformer cannot). TypeScript 7 ships no compiler API at all, so both
// jobs come from these two dev dependencies instead.

import { transformSync as esbuildTransform } from "esbuild";
import { parseSync } from "oxc-parser";

/** A parsed source file. Throws on a syntax error, so a bad edit fails loudly. */
export function parseProgram(fileName, code) {
  const { program, errors } = parseSync(fileName, code);
  if (errors.length > 0) {
    const [{ message, labels }] = errors;
    const where = labels[0] ? ` at ${fileName}:${labels[0].start}` : ` in ${fileName}`;
    throw new Error(`${message}${where}`);
  }
  return program;
}

const SKIP_KEYS = new Set(["parent", "loc", "range", "start", "end", "type"]);

/**
 * Visits every AST node depth first. `visit` may stop the walk by returning false.
 */
export function walk(node, visit) {
  if (!node || typeof node !== "object" || typeof node.type !== "string") return true;
  if (visit(node) === false) return false;
  for (const [key, value] of Object.entries(node)) {
    if (SKIP_KEYS.has(key)) continue;
    if (Array.isArray(value)) {
      for (const child of value) {
        if (walk(child, visit) === false) return false;
      }
    } else if (walk(value, visit) === false) return false;
  }
  return true;
}

/** Every node matching `predicate`, in source order. */
export function findNodes(program, predicate) {
  const found = [];
  walk(program, (node) => {
    if (predicate(node)) found.push(node);
  });
  return found;
}

/** The first node matching `predicate`, or undefined. */
export function findNode(program, predicate) {
  let found;
  walk(program, (node) => {
    if (!predicate(node)) return true;
    found = node;
    return false;
  });
  return found;
}

/** The node's own source text. */
export function nodeSource(code, node) {
  return code.slice(node.start, node.end);
}

/** `const <name> = ...` as a declarator, so `.init` is the initializer. */
export function findVariable(program, name) {
  return findNode(
    program,
    (node) => node.type === "VariableDeclarator" && node.id?.type === "Identifier" && node.id.name === name,
  );
}

/**
 * The body of the callback a hook call wraps: `useCallback(fn, deps)` and
 * `useMemo(fn, deps)` both keep it as the first argument.
 *
 * `includes` narrows a hook used many times in one component to the call whose
 * source contains that text, as the tests did before this helper existed.
 */
export function findCallback(code, program, name, includes) {
  const call = findNode(program, (node) => {
    if (node.type !== "CallExpression") return false;
    const callee = node.callee;
    const calleeName = callee?.type === "Identifier" ? callee.name : callee?.property?.name;
    if (calleeName !== name) return false;
    return includes === undefined || nodeSource(code, node.arguments[0] ?? node).includes(includes);
  });
  if (!call) throw new Error(`no ${name}(${includes ? `…${includes}…` : ""}) in the source`);
  const callback = call.arguments[0];
  if (!callback) throw new Error(`${name}(…) has no callback argument`);
  return { node: callback, source: nodeSource(code, callback) };
}

/**
 * The callback of `const <name> = <hook>(fn, deps)`, whatever the hook is.
 *
 * The hook components of this app keep their effects and handlers this way, and
 * the tests run those handlers with stubbed free variables instead of mounting
 * the component.
 */
export function findHookCallback(code, program, name) {
  const declarator = findVariable(program, name);
  if (!declarator) throw new Error(`no ${name} declaration in the source`);
  const call = declarator.init;
  if (call?.type !== "CallExpression") throw new Error(`${name} is not initialized by a call`);
  const callback = call.arguments?.[0];
  if (!callback || callback.type === "SpreadElement") throw new Error(`${name}'s call has no callback argument`);
  return nodeSource(code, callback);
}

/** A `function <name>(…) {…}` declaration's source. */
export function findFunction(code, program, name) {
  const declaration = findNode(
    program,
    (node) => node.type === "FunctionDeclaration" && node.id?.type === "Identifier" && node.id.name === name,
  );
  if (!declaration) throw new Error(`no function ${name} in the source`);
  return { node: declaration, source: nodeSource(code, declaration) };
}

/**
 * TypeScript to JavaScript, for running a fragment in a `vm` context.
 *
 * `format: "commonjs"` exists for the tests that replace `require`, which is how
 * a module-level store is re-created per fixture. Everything else uses ESM.
 */
export function toJs(source, { fileName = "fragment.tsx", format = "esm", jsx = "automatic" } = {}) {
  const { code } = esbuildTransform(source, {
    loader: fileName.endsWith(".tsx") ? "tsx" : "ts",
    format,
    target: "es2022",
    // "transform" emits React.createElement, for the tests that hand the compiled
    // JSX a `React` global instead of an importable runtime.
    jsx,
  });
  return code;
}

/**
 * One expression, compiled, ready to splice after a `return` keyword.
 *
 * A fragment that starts with a top-level `return` (the tests build those for
 * `new Function`) makes esbuild wrap the whole thing in a CommonJS shim, so an
 * expression plus this helper keeps the output a single expression.
 */
export function toJsExpression(source, options = {}) {
  return toJs(`(${source})`, options).trim().replace(/;\s*$/, "");
}

/**
 * The same, as a CommonJS module for `runInNewContext` with a stub `require`.
 *
 * esbuild assigns `module.exports`, while the fixtures hand the context an
 * `exports` object to read afterwards, so the wrapper points `module` at that
 * object and copies what the module assigned back into it.
 */
export function toCommonJs(source, { fileName = "module.ts" } = {}) {
  const code = toJs(source, { fileName, format: "cjs" });
  return `const module = { exports };\n${code}\n;Object.assign(exports, module.exports);`;
}
