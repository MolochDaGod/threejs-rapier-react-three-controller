/**
 * Attaches the Danger Room multiplayer relay onto the existing HTTP server.
 *
 * Mirrors the space/carrier servers: a `noServer` WebSocketServer that claims
 * only the `/api/danger` upgrade and leaves other upgrades alone. The shared
 * proxy forwards `/api/*` unrewritten, so clients connect to
 * `wss://<host>/api/danger`.
 *
 * A connection starts "unjoined" (lobby browsing). It may list/create/join a
 * room; once in a room it streams its self-state, combat, and (if host) NPCs.
 */
import type { Server } from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocketServer, type WebSocket } from "ws";
import { WS_PATH, decodeClient, encode } from "@workspace/danger-net";
import { DangerRoom, DangerRoomManager } from "./danger-room";
import { logger } from "../lib/logger";

interface Conn {
  id: string;
  send: (data: string) => void;
  room: DangerRoom | null;
}

export function attachDangerServer(server: Server): void {
  const wss = new WebSocketServer({ noServer: true });
  const manager = new DangerRoomManager();

  server.on("upgrade", (req, socket, head) => {
    let pathname = "";
    try {
      pathname = new URL(req.url ?? "", "http://localhost").pathname;
    } catch {
      pathname = req.url ?? "";
    }
    if (pathname !== WS_PATH) return; // not ours; leave it alone

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  wss.on("connection", (ws: WebSocket) => {
    const conn: Conn = {
      id: randomUUID(),
      send: (data) => {
        try {
          ws.send(data);
        } catch {
          /* ignore send on a closing socket */
        }
      },
      room: null,
    };

    const leaveRoom = () => {
      if (!conn.room) return;
      const code = conn.room.code;
      conn.room.remove(conn.id);
      manager.deleteRoomIfEmpty(code);
      conn.room = null;
    };

    ws.on("message", (raw) => {
      const msg = decodeClient(raw.toString());
      if (!msg) return;

      switch (msg.t) {
        case "list":
          conn.send(encode({ t: "rooms", rooms: manager.publicRooms() }));
          return;

        case "create": {
          leaveRoom();
          const room = manager.createRoom({
            name: (msg.name || "Danger Room").slice(0, 60),
            mode: msg.mode === "pvp" ? "pvp" : "coop",
            visibility: msg.visibility === "private" ? "private" : "public",
            content: msg.content,
          });
          room.addPlayer(conn.id, msg.player, conn.send);
          conn.room = room;
          return;
        }

        case "join": {
          const room = manager.getRoom(msg.code ?? "");
          if (!room) {
            conn.send(encode({ t: "error", code: "not_found", message: "Room not found" }));
            return;
          }
          if (room.isFull()) {
            conn.send(encode({ t: "error", code: "room_full", message: "Room is full" }));
            return;
          }
          leaveRoom();
          room.addPlayer(conn.id, msg.player, conn.send);
          conn.room = room;
          return;
        }

        case "leave":
          leaveRoom();
          return;

        case "state":
          conn.room?.setState(conn.id, msg.snap);
          return;

        case "combat":
          conn.room?.handleCombat(conn.id, msg.ev);
          return;

        case "npcs":
          conn.room?.setNpcs(conn.id, msg.npcs);
          return;

        case "preset":
          conn.room?.setPreset(conn.id, msg.preset);
          return;
      }
    });

    ws.on("close", leaveRoom);
    ws.on("error", leaveRoom);
  });

  logger.info({ path: WS_PATH }, "danger-room WS relay attached");
}
