import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import test from "node:test";

import { createProxyServer, isCliEntrypoint } from "./dev-api-proxy.mjs";

async function listen(server) {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.equal(typeof address, "object");
  return address.port;
}

async function close(server) {
  server.close();
  await once(server, "close");
}

test("forwards requests to the target dev server", async () => {
  const target = http.createServer((req, res) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          method: req.method,
          url: req.url,
          body,
        }),
      );
    });
  });

  const targetPort = await listen(target);
  const proxy = createProxyServer({
    target: `http://127.0.0.1:${targetPort}`,
  });
  const proxyPort = await listen(proxy);

  try {
    const response = await fetch(`http://127.0.0.1:${proxyPort}/api/tribology/records?limit=1`, {
      method: "POST",
      body: "payload",
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      method: "POST",
      url: "/api/tribology/records?limit=1",
      body: "payload",
    });
  } finally {
    await close(proxy);
    await close(target);
  }
});

test("detects CLI entrypoint when the script path contains non-ASCII characters", () => {
  assert.equal(
    isCliEntrypoint("file:///Users/example/%E9%A1%B9%E7%9B%AE/scripts/dev-api-proxy.mjs", "/Users/example/项目/scripts/dev-api-proxy.mjs"),
    true,
  );
});
