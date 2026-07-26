import assert from "node:assert/strict";
import * as React from "react";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RequestError, requestErrorMessage, requestJson } from "./request";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const originalFetch = globalThis.fetch;

async function main() {
  try {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ error: "The queue rejected this file." }), {
        status: 422,
        headers: { "Content-Type": "application/json" },
      });
    await assert.rejects(
      requestJson("http://localhost/fail", undefined, "Could not upload files"),
      /The queue rejected this file\./,
      "server error details are preserved"
    );

    globalThis.fetch = async () => {
      throw new TypeError("fetch failed");
    };
    await assert.rejects(
      requestJson("http://localhost/offline", undefined, "Could not save record"),
      /Could not save record\. Check your connection and try again\./,
      "network failures become actionable errors"
    );

    globalThis.fetch = async () => new Response("not json", { status: 200 });
    await assert.rejects(
      requestJson("http://localhost/unreadable", undefined, "Could not refresh queue"),
      /server returned an unreadable response/,
      "successful but malformed responses do not silently pass"
    );

    globalThis.fetch = async () =>
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    assert.deepEqual(await requestJson<{ ok: boolean }>("http://localhost/ok", undefined, "Request failed"), {
      ok: true,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(requestErrorMessage("unknown", "Fallback"), "Fallback");
  const alertHtml = renderToStaticMarkup(createElement(RequestError, null, "Could not save"));
  assert.match(alertHtml, /role="alert"/);
  assert.match(alertHtml, /Could not save/);

  console.log("Request error handling tests passed");
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
