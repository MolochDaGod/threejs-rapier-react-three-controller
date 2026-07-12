/**
 * Standalone game server entry point.
 *
 * Runs ONLY the realtime WebSocket relays — space (`/api/space`), carrier
 * (`/api/carrier`), and the Danger Room multiplayer relay (`/api/danger`) — on a
 * bare HTTP server. Unlike `index.ts` (the full Replit deployment), this entry
 * deliberately omits Express, Clerk auth, the OpenAI proxy, and the database, so
 * it can run as an always-on service on an external host (e.g. a VPS) needing
 * nothing but a `PORT`.
 *
 * Put it behind a reverse proxy that terminates TLS and forwards WebSocket
 * upgrades, so browsers on an HTTPS page can reach it over `wss://`.
 */
import http from "node:http";
import { logger } from "./lib/logger";
import { attachGameServer } from "./game/server";
import { attachCarrierServer } from "./game/carrier-server";
import { attachDangerServer } from "./game/danger-server";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// The WS paths claimed by the attached game servers (kept in sync with each
// server's WS_PATH). Used only to reject unknown upgrade requests below.
const KNOWN_WS_PATHS = new Set(["/api/space", "/api/carrier", "/api/danger"]);

const server = http.createServer((req, res) => {
  // Minimal HTTP surface: a health check for the reverse proxy / process
  // manager. Everything else is 404 — this process serves no REST routes.
  let pathname = "";
  try {
    pathname = new URL(req.url ?? "", "http://localhost").pathname;
  } catch {
    pathname = req.url ?? "";
  }
  if (req.method === "GET" && (pathname === "/healthz" || pathname === "/api/healthz")) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ status: "ok", service: "game-server" }));
    return;
  }
  res.writeHead(404, { "content-type": "text/plain" });
  res.end("Not found");
});

// Attach the three realtime relays. Each registers its own `upgrade` handler
// that claims only its own WS_PATH and ignores the rest.
attachGameServer(server);
attachCarrierServer(server);
attachDangerServer(server);

// Final upgrade guard: if no game server claimed the path, close the socket so
// stray/probing upgrade requests don't hang half-open (the full Express app
// would 404 these; here there is nothing else to handle them).
server.on("upgrade", (req, socket) => {
  let pathname = "";
  try {
    pathname = new URL(req.url ?? "", "http://localhost").pathname;
  } catch {
    pathname = req.url ?? "";
  }
  if (KNOWN_WS_PATHS.has(pathname)) return; // a game server will handle it
  socket.destroy();
});

server.listen(port, () => {
  logger.info({ port }, "Game server listening (space + carrier + danger)");
});
