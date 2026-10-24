import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);

// Evaluate source with explicit fakes. Never import Firebase initialization or
// notification code; an unexpected dependency or network request fails closed.
export function loadSource(relativePath, mocks = {}, context = {}, transformers) {
  const filename = new URL(relativePath, import.meta.url);
  const source = fs.readFileSync(filename, "utf8").replaceAll("import.meta.env", "({})");
  const { outputText } = ts.transpileModule(source, {
    fileName: filename.pathname,
    compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
    transformers,
  });
  const sandbox = {
    exports: {}, console, Date, Map, Set, Intl, URLSearchParams,
    setInterval: () => 0, clearInterval: () => {},
    fetch: () => { throw new Error("Live network is disabled in tests"); },
    ...context,
    require: (id) => {
      if (id in mocks) return mocks[id];
      if (id === "clsx" || id === "tailwind-merge") return require(id);
      if (id === "react/jsx-runtime") {
        return { jsx: (type, props) => ({ type, props }), jsxs: (type, props) => ({ type, props }) };
      }
      if (id === "@/contexts/AuthContext") {
        return { useAuth: () => ({ user: { uid: "test-uid", displayName: "Test User" }, loading: false }) };
      }
      if (id === "firebase/firestore") {
        return {
          collection: () => ({}),
          addDoc: async () => ({ id: "mock-doc-id" }),
          updateDoc: async () => {},
          serverTimestamp: () => ({}),
          doc: () => ({}),
          getDoc: async () => ({ exists: () => false, data: () => ({}) }),
          getDocs: async () => ({ docs: [] }),
          query: () => ({}),
          where: () => ({}),
          orderBy: () => ({}),
          collectionGroup: () => ({}),
        };
      }
      if (id.startsWith("@/components/") || id === "lucide-react") {
        return new Proxy({}, { get: (_, key) => key });
      }
      throw new Error(`Unmocked dependency: ${id}`);
    },
  };
  vm.runInNewContext(outputText, sandbox, { filename: filename.pathname });
  return { exports: sandbox.exports, sandbox };
}

// Run the real page's handlers/effects with an in-memory hook host. State names
// are discovered from TypeScript rather than depending on hook array positions.
export function mountPage(pageName, initialState, mocks = {}, context = {}) {
  const states = new Map(Object.entries(initialState));
  const cache = new Map();
  const effects = [];
  let index = 0;
  let dirty = true;
  let loaded;
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const react = {
    useState: (value, name) => {
      if (!states.has(name)) states.set(name, typeof value === "function" ? value() : value);
      return [states.get(name), (next) => {
        const value = typeof next === "function" ? next(states.get(name)) : next;
        if (!Object.is(value, states.get(name))) { states.set(name, value); dirty = true; }
      }];
    },
    useRef: (value) => {
      const key = index++;
      if (!cache.has(key)) cache.set(key, { current: value });
      return cache.get(key);
    },
    useMemo: (fn, deps) => {
      const key = index++;
      const prev = cache.get(key);
      if (!prev || !same(prev.deps, deps)) cache.set(key, { value: fn(), deps });
      return cache.get(key).value;
    },
    useCallback: (fn, deps) => react.useMemo(() => fn, deps),
    useEffect: (fn, deps) => {
      const key = index++;
      const prev = cache.get(key);
      if (!prev || !same(prev.deps, deps)) {
        effects.push(() => { prev?.cleanup?.(); cache.set(key, { deps, cleanup: fn() }); });
      }
    },
  };
  const transformer = (ctx) => (root) => {
    const visit = (node) => {
      if (ts.isVariableDeclaration(node) && ts.isArrayBindingPattern(node.name) &&
          node.initializer && ts.isCallExpression(node.initializer) && node.initializer.expression.getText(root) === "useState") {
        return ts.factory.updateVariableDeclaration(node, node.name, node.exclamationToken, node.type,
          ts.factory.updateCallExpression(node.initializer, node.initializer.expression, undefined,
            [node.initializer.arguments[0] ?? ts.factory.createIdentifier("undefined"), ts.factory.createStringLiteral(node.name.elements[0].name.getText(root))]));
      }
      if (ts.isVariableDeclaration(node) && node.name.getText(root) === pageName && ts.isArrowFunction(node.initializer)) {
        const body = ts.visitEachChild(node.initializer.body, visit, ctx);
        const names = body.statements.flatMap((s) => ts.isVariableStatement(s)
          ? s.declarationList.declarations.flatMap((d) => ts.isIdentifier(d.name) ? [d.name.text] : []) : []);
        const capture = ts.factory.createExpressionStatement(ts.factory.createBinaryExpression(
          ts.factory.createPropertyAccessExpression(ts.factory.createIdentifier("globalThis"), "page"),
          ts.SyntaxKind.EqualsToken,
          ts.factory.createObjectLiteralExpression(names.map((n) => ts.factory.createShorthandPropertyAssignment(n)))));
        const statements = [...body.statements];
        const position = statements.findIndex((s) => ts.isReturnStatement(s) ||
          (ts.isIfStatement(s) && s.expression.getText(root) === "isLoading"));
        statements.splice(position, 0, capture);
        return ts.factory.updateVariableDeclaration(node, node.name, undefined, node.type,
          ts.factory.updateArrowFunction(node.initializer, node.initializer.modifiers, node.initializer.typeParameters,
            node.initializer.parameters, node.initializer.type, node.initializer.equalsGreaterThanToken,
            ts.factory.updateBlock(body, statements)));
      }
      return ts.visitEachChild(node, visit, ctx);
    };
    return ts.visitNode(root, visit);
  };
  loaded = loadSource(`../src/pages/${pageName}.tsx`, { react, ...mocks }, context, { before: [transformer] });
  const render = () => { dirty = false; index = 0; return loaded.exports.default(); };
  render();
  return {
    states,
    get page() { return loaded.sandbox.page; },
    render,
    async flush({ runEffects = false } = {}) {
      for (let i = 0; i < 25; i++) {
        if (runEffects) effects.splice(0).forEach((fn) => fn());
        await new Promise((resolve) => setImmediate(resolve));
        if (dirty) render();
        else if (!runEffects || effects.length === 0) return;
      }
      throw new Error("Page did not settle");
    },
  };
}
