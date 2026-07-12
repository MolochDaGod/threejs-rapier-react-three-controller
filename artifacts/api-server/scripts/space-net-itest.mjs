/**
 * Two-client integration test for the space-shooter netcode.
 *
 * Spins up two WebSocket clients against the running server (through the shared
 * proxy at localhost:80), joins both, streams forward-thrust inputs, and asserts:
 *   - each client gets a `welcome` with an id,
 *   - snapshots eventually contain BOTH joined ships,
 *   - the server's `ack` (lastProcessedInputSeq) advances (reconciliation works),
 *   - each ship actually moves (position changes from spawn).
 *
 * This validates the authoritative loop without the Puter guest gate (which
 * blocks headless browser screenshots of the cabinet).
 */
import { WebSocket } from "ws";

const URL = "ws://localhost:80/api/space";
const DURATION_MS = 2500;

function makeClient(label, shipType) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(URL);
    const state = {
      label,
      id: null,
      maxAck: 0,
      sawBothShips: false,
      firstPos: null,
      lastPos: null,
      snapshots: 0,
    };
    let seq = 0;

    const timeout = setTimeout(
      () => reject(new Error(`${label}: timed out before welcome`)),
      5000,
    );

    ws.on("open", () => {
      // join
      ws.send(JSON.stringify({ t: "join", name: label, shipType }));
    });

    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString());
      if (msg.t === "welcome") {
        clearTimeout(timeout);
        state.id = msg.id;
        // Start streaming inputs at ~30Hz: full forward thrust.
        const iv = setInterval(() => {
          if (ws.readyState !== WebSocket.OPEN) return;
          ws.send(
            JSON.stringify({
              t: "input",
              cmd: {
                seq: ++seq,
                dt: 1 / 30,
                thrust: 1,
                yaw: 0,
                pitch: 0,
                roll: 0,
                boost: false,
                fire: false,
              },
            }),
          );
        }, 1000 / 30);
        setTimeout(() => {
          clearInterval(iv);
          try {
            ws.close();
          } catch {}
          resolve(state);
        }, DURATION_MS);
      } else if (msg.t === "snapshot") {
        state.snapshots++;
        if (msg.ack > state.maxAck) state.maxAck = msg.ack;
        const ids = new Set(msg.ships.map((s) => s.id));
        if (ids.size >= 2) state.sawBothShips = true;
        const me = msg.ships.find((s) => s.id === state.id);
        if (me) {
          const pos = { px: me.px, py: me.py, pz: me.pz };
          if (!state.firstPos) state.firstPos = pos;
          state.lastPos = pos;
        }
      }
    });

    ws.on("error", reject);
  });
}

function moved(a, b) {
  if (!a || !b) return 0;
  return Math.hypot(b.px - a.px, b.py - a.py, b.pz - a.pz);
}

const [c1, c2] = await Promise.all([
  makeClient("Alpha", 0),
  makeClient("Bravo", 2),
]);

let failures = 0;
function check(cond, label) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}`);
  if (!cond) failures++;
}

for (const c of [c1, c2]) {
  console.log(
    `\n[${c.label}] id=${c.id} snapshots=${c.snapshots} maxAck=${c.maxAck} ` +
      `bothShips=${c.sawBothShips} moved=${moved(c.firstPos, c.lastPos).toFixed(1)}`,
  );
  check(!!c.id, `${c.label}: received welcome with id`);
  check(c.snapshots > 5, `${c.label}: received snapshots`);
  check(c.maxAck > 0, `${c.label}: ack advanced (reconciliation seq)`);
  check(c.sawBothShips, `${c.label}: snapshot shows both ships`);
  check(moved(c.firstPos, c.lastPos) > 5, `${c.label}: ship moved from spawn`);
}

console.log(`\n${failures === 0 ? "ALL PASS" : failures + " FAILURES"}`);
process.exit(failures === 0 ? 0 : 1);
