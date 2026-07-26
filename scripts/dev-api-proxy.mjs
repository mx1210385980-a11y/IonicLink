import http from "node:http";
import process from "node:process";
import { pathToFileURL } from "node:url";

export function createProxyServer({ target }) {
  const targetUrl = new URL(target);

  return http.createServer((clientReq, clientRes) => {
    const upstreamReq = http.request(
      {
        hostname: targetUrl.hostname,
        port: targetUrl.port,
        protocol: targetUrl.protocol,
        method: clientReq.method,
        path: clientReq.url,
        headers: {
          ...clientReq.headers,
          host: targetUrl.host,
        },
      },
      (upstreamRes) => {
        clientRes.writeHead(upstreamRes.statusCode ?? 502, upstreamRes.headers);
        upstreamRes.pipe(clientRes);
      },
    );

    upstreamReq.on("error", (error) => {
      clientRes.writeHead(502, { "content-type": "application/json" });
      clientRes.end(
        JSON.stringify({
          error: "IonicLink dev frontend is not reachable",
          target: targetUrl.origin,
          detail: error.message,
        }),
      );
    });

    clientReq.pipe(upstreamReq);
  });
}

function readArg(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] || fallback;
}

export function isCliEntrypoint(moduleUrl, scriptPath) {
  return moduleUrl === pathToFileURL(scriptPath).href;
}

if (isCliEntrypoint(import.meta.url, process.argv[1])) {
  const port = Number(readArg("--port", process.env.PORT || "8000"));
  const host = readArg("--host", process.env.HOST || "127.0.0.1");
  const target = readArg("--target", process.env.TARGET || "http://127.0.0.1:3000");

  const server = createProxyServer({ target });
  server.listen(port, host, () => {
    console.log(`IonicLink dev API proxy listening on http://${host}:${port}`);
    console.log(`Forwarding requests to ${target}`);
  });
}
