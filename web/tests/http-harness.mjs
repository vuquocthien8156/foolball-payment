import { createRequire } from "node:module";
const require = createRequire(new URL("../../server/package.json", import.meta.url));
const express = require("express");
export async function startRouter(router) {
  const app = express();
  app.use(express.json());
  app.use(router);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => { server.once("listening", resolve); server.once("error", reject); });
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve())) };
}
