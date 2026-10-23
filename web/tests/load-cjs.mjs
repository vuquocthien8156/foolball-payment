import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
const installed = createRequire(new URL("../../server/package.json", import.meta.url));
export function loadCjs(relativePath, mocks = {}, context = {}) {
  const filename = new URL(relativePath, import.meta.url);
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(filename, "utf8"), {
    module, exports: module.exports, console, Date, URL, ...context,
    require(name) {
      if (name in mocks) return mocks[name];
      if (["firebase-admin", "axios", "@payos/node"].some((id) => name === id || name.startsWith(`${id}/`))) throw new Error(`External dependency must be mocked: ${name}`);
      return installed(name);
    },
  }, { filename: filename.pathname });
  return module.exports;
}
