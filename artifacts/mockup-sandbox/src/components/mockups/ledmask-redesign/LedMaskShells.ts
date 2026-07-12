import * as THREE from "three";

/**
 * Head-local z of the LED panel front. Shared with {@link LedMask} (the single
 * source of truth for the panel depth). Any shell geometry that sits IN FRONT of
 * the LED face footprint must stay behind this z, or it occludes the matrix and
 * the face renders "behind the screen". Frame pieces OUTSIDE the opening may poke
 * forward of this for a recessed-screen look.
 */
export const PANEL_Z = 1.55;

/**
 * The clear face opening every shell must frame but never cover. Comfortably
 * larger than the lit LED footprint (~±0.6 wide, ~+0.36..-0.46 tall) so bezels
 * never bury an edge cell even after the head's base scale.
 */
const OPEN_HW = 0.84; // half-width of the clear opening
const OPEN_TOP = 0.56; // top edge (y)
const OPEN_BOT = -0.66; // bottom edge (y)
const OPEN_CY = (OPEN_TOP + OPEN_BOT) / 2;
const OPEN_H = OPEN_TOP - OPEN_BOT;

/**
 * Head-local Y of the face-opening centre. Exported alongside {@link PANEL_Z} so
 * the baked Explorer rig can map a shell built in this (studio-scale) coordinate
 * frame onto its much smaller box head: the point `(0, OPENING_CENTER_Y, PANEL_Z)`
 * is the centre of the LED face that every shell frames.
 */
export const OPENING_CENTER_Y = OPEN_CY;

export type ShellId =
  | "hood"
  | "arcade"
  | "steampunk"
  | "crystal"
  | "robot"
  | "boombox"
  | "crt"
  | "satellite";

export interface ShellDef {
  id: ShellId;
  label: string;
  glyph: string;
  /** Add the shell's meshes to `g` (parented to the head). Owns its materials. */
  build: (g: THREE.Group) => void;
}

export const DEFAULT_SHELL: ShellId = "hood";

const SHELL_KEY = "ledmask:shell";

/** Read the persisted shell id, validated against the known set. */
export function loadShellId(): ShellId {
  try {
    const v = localStorage.getItem(SHELL_KEY);
    if (v && SHELLS.some((s) => s.id === v)) return v as ShellId;
  } catch {
    /* private mode / no storage */
  }
  return DEFAULT_SHELL;
}

/** Persist the chosen shell id (best-effort). */
export function saveShellId(id: ShellId) {
  try {
    localStorage.setItem(SHELL_KEY, id);
  } catch {
    /* ignore */
  }
}

// --- shared builder helpers ---------------------------------------------

/**
 * Add a rectangular bezel frame around the face opening: four bars filling the
 * gap between the opening and an outer rectangle. Every bar lives OUTSIDE the
 * opening, so `frontZ` may exceed {@link PANEL_Z} (recessed screen) safely.
 */
function addFrame(
  g: THREE.Group,
  mat: THREE.Material,
  p: { frontZ: number; depth: number; outerHW: number; outerTop: number; outerBot: number },
) {
  const cz = p.frontZ - p.depth / 2;
  const top = new THREE.Mesh(new THREE.BoxGeometry(p.outerHW * 2, p.outerTop - OPEN_TOP, p.depth), mat);
  top.position.set(0, (p.outerTop + OPEN_TOP) / 2, cz);
  const bot = new THREE.Mesh(new THREE.BoxGeometry(p.outerHW * 2, OPEN_BOT - p.outerBot, p.depth), mat);
  bot.position.set(0, (OPEN_BOT + p.outerBot) / 2, cz);
  const sideW = p.outerHW - OPEN_HW;
  const left = new THREE.Mesh(new THREE.BoxGeometry(sideW, OPEN_H, p.depth), mat);
  left.position.set(-(p.outerHW + OPEN_HW) / 2, OPEN_CY, cz);
  const right = new THREE.Mesh(new THREE.BoxGeometry(sideW, OPEN_H, p.depth), mat);
  right.position.set((p.outerHW + OPEN_HW) / 2, OPEN_CY, cz);
  g.add(top, bot, left, right);
}

/** A deep housing box behind the face (front face kept well behind the visor). */
function addBackBody(g: THREE.Group, mat: THREE.Material, w: number, h: number, d: number, y = OPEN_CY) {
  const front = 0.9; // < visor front (1.45) so it never competes with the face
  const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  body.position.set(0, y, front - d / 2);
  g.add(body);
}

// --- shell variants -----------------------------------------------------

/** The original modern "hooded TV-head": cowl shell, crown, brow brim, drapes. */
function buildHoodShell(g: THREE.Group) {
  const shell = new THREE.MeshPhongMaterial({ color: 0x0a0b12, shininess: 4, flatShading: true });
  const hood = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1.98, 1.7), shell);
  hood.position.set(0, 0.02, -0.26);
  g.add(hood);

  const panel = new THREE.MeshPhongMaterial({ color: 0x101220, shininess: 6, flatShading: true });

  const crown = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.52, 1.32), panel);
  crown.position.set(0, 1.02, 0.1);
  crown.rotation.x = -0.12;
  hood.add(crown);

  const brow = new THREE.Mesh(new THREE.BoxGeometry(1.66, 0.3, 0.9), panel);
  brow.position.set(0, 0.6, 1.02);
  brow.rotation.x = 0.4;
  g.add(brow);

  const trimMat = new THREE.MeshBasicMaterial({ color: 0x2a6cff, toneMapped: false });
  const trim = new THREE.Mesh(new THREE.BoxGeometry(1.46, 0.05, 0.06), trimMat);
  trim.position.set(0, 0.47, 1.45);
  g.add(trim);

  const drapeGeo = new THREE.BoxGeometry(0.34, 1.5, 1.5);
  const left = new THREE.Mesh(drapeGeo, panel);
  left.position.set(-0.86, -0.05, 0.22);
  left.rotation.y = 0.34;
  g.add(left);
  const right = new THREE.Mesh(drapeGeo, panel);
  right.position.set(0.86, -0.05, 0.22);
  right.rotation.y = -0.34;
  g.add(right);
}

/** Neon arcade cabinet: dark cabinet body, lit marquee, glowing edge tubes. */
function buildArcadeShell(g: THREE.Group) {
  const body = new THREE.MeshPhongMaterial({ color: 0x111426, shininess: 30 });
  addBackBody(g, body, 2.0, 2.1, 1.5);
  addFrame(g, body, { frontZ: 1.66, depth: 0.34, outerHW: 0.98, outerTop: 0.78, outerBot: -0.84 });

  // Lit marquee block across the top.
  const marqueeBase = new THREE.MeshPhongMaterial({ color: 0x0c0e1c, shininess: 20 });
  const marquee = new THREE.Mesh(new THREE.BoxGeometry(2.04, 0.34, 0.5), marqueeBase);
  marquee.position.set(0, 1.0, 1.0);
  g.add(marquee);
  const marqueeGlow = new THREE.MeshBasicMaterial({ color: 0xff2bd6, toneMapped: false });
  const glow = new THREE.Mesh(new THREE.BoxGeometry(1.86, 0.2, 0.06), marqueeGlow);
  glow.position.set(0, 1.0, 1.26);
  g.add(glow);

  // Neon edge tubes hugging the bezel (cyan + magenta).
  const cyan = new THREE.MeshBasicMaterial({ color: 0x2bf0ff, toneMapped: false });
  const mag = new THREE.MeshBasicMaterial({ color: 0xff2bd6, toneMapped: false });
  const tubeZ = 1.7;
  const vert = new THREE.BoxGeometry(0.05, OPEN_H + 0.5, 0.05);
  const lT = new THREE.Mesh(vert, cyan);
  lT.position.set(-0.96, OPEN_CY, tubeZ);
  const rT = new THREE.Mesh(vert, mag);
  rT.position.set(0.96, OPEN_CY, tubeZ);
  g.add(lT, rT);
  const horiz = new THREE.BoxGeometry(1.96, 0.05, 0.05);
  const tT = new THREE.Mesh(horiz, mag);
  tT.position.set(0, 0.74, tubeZ);
  const bT = new THREE.Mesh(horiz, cyan);
  bT.position.set(0, -0.82, tubeZ);
  g.add(tT, bT);

  // Console lip below the screen.
  const lip = new THREE.Mesh(new THREE.BoxGeometry(2.04, 0.22, 0.7), body);
  lip.position.set(0, -1.04, 0.9);
  lip.rotation.x = 0.5;
  g.add(lip);
}

/** Steampunk box: riveted brass frame, copper pipes, a brass gear. */
function buildSteampunkShell(g: THREE.Group) {
  const brass = new THREE.MeshPhongMaterial({ color: 0xb8862a, shininess: 90, specular: 0xfff0c0, flatShading: true });
  const dark = new THREE.MeshPhongMaterial({ color: 0x2a1c0e, shininess: 40 });
  addBackBody(g, dark, 1.9, 2.0, 1.4);
  addFrame(g, brass, { frontZ: 1.64, depth: 0.3, outerHW: 0.96, outerTop: 0.82, outerBot: -0.86 });

  // Rivets studding the frame corners + edges.
  const rivetGeo = new THREE.SphereGeometry(0.05, 10, 8);
  const rivetMat = new THREE.MeshPhongMaterial({ color: 0xe8c060, shininess: 120, specular: 0xffffff });
  const rivetSpots: [number, number][] = [
    [-0.9, 0.74], [0, 0.78], [0.9, 0.74],
    [-0.9, -0.78], [0, -0.82], [0.9, -0.78],
    [-0.9, 0.1], [0.9, 0.1], [-0.9, -0.4], [0.9, -0.4],
  ];
  for (const [x, y] of rivetSpots) {
    const r = new THREE.Mesh(rivetGeo, rivetMat);
    r.position.set(x, y, 1.62);
    g.add(r);
  }

  // Copper pipes down each side.
  const copper = new THREE.MeshPhongMaterial({ color: 0xc56a3a, shininess: 80, specular: 0xffd0a0 });
  const pipeGeo = new THREE.CylinderGeometry(0.07, 0.07, 1.5, 14);
  const lp = new THREE.Mesh(pipeGeo, copper);
  lp.position.set(-1.02, -0.05, 1.1);
  const rp = new THREE.Mesh(pipeGeo, copper);
  rp.position.set(1.02, -0.05, 1.1);
  g.add(lp, rp);

  // A toothed brass gear in the top corner.
  const gear = new THREE.Group();
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.12, 18), brass);
  hub.rotation.x = Math.PI / 2;
  gear.add(hub);
  const toothGeo = new THREE.BoxGeometry(0.1, 0.1, 0.12);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    const tooth = new THREE.Mesh(toothGeo, brass);
    tooth.position.set(Math.cos(a) * 0.27, Math.sin(a) * 0.27, 0);
    tooth.rotation.z = a;
    gear.add(tooth);
  }
  gear.position.set(0.78, 0.86, 1.3);
  g.add(gear);
}

/** Crystal cube: translucent faceted shards framing the opening + a back cluster. */
function buildCrystalShell(g: THREE.Group) {
  const glass = new THREE.MeshPhongMaterial({
    color: 0x9fe8ff,
    emissive: 0x18506e,
    shininess: 120,
    specular: 0xffffff,
    transparent: true,
    opacity: 0.42,
    flatShading: true,
  });
  // A faceted crystal cluster BEHIND the head — bulk of the "cube" silhouette.
  const back = new THREE.Mesh(new THREE.IcosahedronGeometry(1.25, 0), glass);
  back.position.set(0, OPEN_CY, -0.2);
  back.scale.set(1, 1.05, 0.7);
  g.add(back);

  // Shards framing the opening (kept outside the face footprint).
  const shardGeo = new THREE.OctahedronGeometry(0.4, 0);
  const shardSpots: [number, number, number][] = [
    [-1.0, 0.5, 1.3], [0, 0.85, 1.2], [1.0, 0.5, 1.3],
    [-1.05, -0.3, 1.2], [1.05, -0.3, 1.2], [0, -0.9, 1.15],
  ];
  for (const [x, y, z] of shardSpots) {
    const s = new THREE.Mesh(shardGeo, glass);
    s.position.set(x, y, z);
    s.scale.setScalar(0.7 + Math.abs(x) * 0.5);
    s.rotation.set(x, y, z);
    g.add(s);
  }

  // Inner glowing edge to define the screen rim.
  const edge = new THREE.MeshBasicMaterial({ color: 0x66e6ff, toneMapped: false, transparent: true, opacity: 0.8 });
  addFrame(g, edge, { frontZ: 1.6, depth: 0.06, outerHW: 0.9, outerTop: 0.64, outerBot: -0.74 });
}

/** Robot helmet: domed crown, ear pods, chin guard, antenna, red brow visor. */
function buildRobotShell(g: THREE.Group) {
  const metal = new THREE.MeshPhongMaterial({ color: 0x6b7686, shininess: 80, specular: 0xcfd8e6, flatShading: true });
  const dark = new THREE.MeshPhongMaterial({ color: 0x20242c, shininess: 40 });
  addBackBody(g, dark, 1.8, 1.9, 1.4);
  addFrame(g, metal, { frontZ: 1.62, depth: 0.3, outerHW: 0.94, outerTop: 0.74, outerBot: -0.8 });

  // Domed crown.
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.92, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2), metal);
  dome.position.set(0, 0.62, 0.1);
  dome.scale.set(1, 0.7, 1);
  g.add(dome);

  // Ear pods.
  const podGeo = new THREE.CylinderGeometry(0.26, 0.26, 0.3, 20);
  const podMat = new THREE.MeshPhongMaterial({ color: 0x3a4250, shininess: 60 });
  const lPod = new THREE.Mesh(podGeo, podMat);
  lPod.rotation.z = Math.PI / 2;
  lPod.position.set(-1.0, 0.0, 0.6);
  const rPod = new THREE.Mesh(podGeo, podMat);
  rPod.rotation.z = Math.PI / 2;
  rPod.position.set(1.0, 0.0, 0.6);
  g.add(lPod, rPod);

  // Red brow visor strip + glowing ear dots.
  const red = new THREE.MeshBasicMaterial({ color: 0xff3b30, toneMapped: false });
  const brow = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.08, 0.06), red);
  brow.position.set(0, 0.66, 1.5);
  g.add(brow);
  const dotGeo = new THREE.CircleGeometry(0.12, 16);
  const lDot = new THREE.Mesh(dotGeo, red);
  lDot.position.set(-1.16, 0, 0.6);
  lDot.rotation.y = -Math.PI / 2;
  const rDot = new THREE.Mesh(dotGeo, red);
  rDot.position.set(1.16, 0, 0.6);
  rDot.rotation.y = Math.PI / 2;
  g.add(lDot, rDot);

  // Chin guard.
  const chin = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.28, 0.6), metal);
  chin.position.set(0, -0.92, 0.7);
  chin.rotation.x = -0.35;
  g.add(chin);

  // Antenna.
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.6, 8), metal);
  rod.position.set(0.5, 1.2, 0.1);
  g.add(rod);
  const tip = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 10), red);
  tip.position.set(0.5, 1.52, 0.1);
  g.add(tip);
}

/** Boombox: wide deck, twin speaker cones, carry handle, knobs. */
function buildBoomboxShell(g: THREE.Group) {
  const body = new THREE.MeshPhongMaterial({ color: 0x2b2f38, shininess: 50, specular: 0x8892a0 });
  const silver = new THREE.MeshPhongMaterial({ color: 0xb9c0cc, shininess: 90, specular: 0xffffff });
  addBackBody(g, body, 2.3, 1.7, 1.3);
  addFrame(g, silver, { frontZ: 1.6, depth: 0.26, outerHW: 0.95, outerTop: 0.6, outerBot: -0.7 });

  // Twin speakers either side of the screen.
  for (const sx of [-1.35, 1.35]) {
    const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.16, 24), silver);
    ring.rotation.x = Math.PI / 2;
    ring.position.set(sx, 0, 1.36);
    g.add(ring);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.18, 24, 1, true), body);
    cone.rotation.x = -Math.PI / 2;
    cone.position.set(sx, 0, 1.4);
    g.add(cone);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 10), silver);
    cap.position.set(sx, 0, 1.48);
    g.add(cap);
  }

  // Carry handle across the top.
  const handle = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.05, 12, 24, Math.PI), silver);
  handle.position.set(0, 0.78, 0.6);
  g.add(handle);

  // Knobs + EQ lights along the bottom lip.
  const knobMat = new THREE.MeshPhongMaterial({ color: 0x3a4150, shininess: 70 });
  for (const kx of [-0.4, 0, 0.4]) {
    const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.08, 16), knobMat);
    knob.rotation.x = Math.PI / 2;
    knob.position.set(kx, -0.88, 1.3);
    g.add(knob);
  }
  const eq = new THREE.MeshBasicMaterial({ color: 0x37ff9e, toneMapped: false });
  for (let i = 0; i < 5; i++) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 0.04), eq);
    bar.position.set(0.62 + i * 0.08 - 0.16, -0.88, 1.32);
    g.add(bar);
  }
}

/** Retro CRT monitor: chunky cream bezel, base stand, dial, power LED. */
function buildCrtShell(g: THREE.Group) {
  const cream = new THREE.MeshPhongMaterial({ color: 0xd8cba8, shininess: 24, specular: 0x6b6450 });
  const dark = new THREE.MeshPhongMaterial({ color: 0x171410, shininess: 30 });
  addBackBody(g, dark, 1.9, 1.85, 1.5);
  // Thick rounded bezel.
  addFrame(g, cream, { frontZ: 1.62, depth: 0.42, outerHW: 1.0, outerTop: 0.86, outerBot: -0.86 });

  // Casing shoulders to round out the boxy monitor body.
  const shoulder = new THREE.Mesh(new THREE.BoxGeometry(2.0, 1.9, 0.5), cream);
  shoulder.position.set(0, OPEN_CY, 0.95);
  g.add(shoulder);

  // Base stand: neck + foot.
  const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 0.3, 16), cream);
  neck.position.set(0, -1.12, 0.6);
  g.add(neck);
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.7, 0.12, 24), cream);
  foot.position.set(0, -1.32, 0.6);
  g.add(foot);

  // Control dials on the lower-right bezel + a power LED.
  const dialMat = new THREE.MeshPhongMaterial({ color: 0x8c8266, shininess: 40 });
  const dial = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.06, 16), dialMat);
  dial.rotation.x = Math.PI / 2;
  dial.position.set(0.78, -0.78, 1.62);
  g.add(dial);
  const led = new THREE.Mesh(
    new THREE.SphereGeometry(0.04, 10, 8),
    new THREE.MeshBasicMaterial({ color: 0x37ff5e, toneMapped: false }),
  );
  led.position.set(-0.78, -0.78, 1.64);
  g.add(led);
}

/** Satellite: compact metal body, solar wings, comms dish, antennas. */
function buildSatelliteShell(g: THREE.Group) {
  const metal = new THREE.MeshPhongMaterial({ color: 0x8b919c, shininess: 70, specular: 0xe6ecf5, flatShading: true });
  const gold = new THREE.MeshPhongMaterial({ color: 0xd9a92b, shininess: 110, specular: 0xfff0b0, flatShading: true });
  addBackBody(g, gold, 1.5, 1.6, 1.3);
  addFrame(g, metal, { frontZ: 1.6, depth: 0.28, outerHW: 0.92, outerTop: 0.7, outerBot: -0.74 });

  // Solar wings on arms either side.
  const armGeo = new THREE.BoxGeometry(0.5, 0.06, 0.06);
  const panelMat = new THREE.MeshPhongMaterial({ color: 0x1d3b8a, shininess: 90, specular: 0x9fc0ff, emissive: 0x0a1633 });
  for (const dir of [-1, 1]) {
    const arm = new THREE.Mesh(armGeo, metal);
    arm.position.set(dir * 1.2, 0, 0.4);
    g.add(arm);
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.9, 1.5, 0.04), panelMat);
    panel.position.set(dir * 1.9, 0, 0.4);
    g.add(panel);
    // Cell grid lines.
    const lineMat = new THREE.MeshBasicMaterial({ color: 0x4a6cff, toneMapped: false });
    for (let i = -2; i <= 2; i++) {
      const line = new THREE.Mesh(new THREE.BoxGeometry(0.88, 0.015, 0.05), lineMat);
      line.position.set(dir * 1.9, i * 0.3, 0.42);
      g.add(line);
    }
  }

  // Comms dish up top, tilted forward.
  const dish = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.3, 24, 1, true), metal);
  dish.rotation.x = -Math.PI * 0.62;
  dish.position.set(-0.55, 0.95, 0.7);
  g.add(dish);
  const feed = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.32, 8), metal);
  feed.rotation.x = -Math.PI * 0.62;
  feed.position.set(-0.55, 0.98, 0.92);
  g.add(feed);

  // Whip antennas with glowing tips.
  const tipMat = new THREE.MeshBasicMaterial({ color: 0x37e0ff, toneMapped: false });
  for (const ax of [0.45, 0.7]) {
    const whip = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.7, 8), metal);
    whip.position.set(ax, 1.1, 0.2);
    whip.rotation.z = -0.15 * (ax - 0.5);
    g.add(whip);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), tipMat);
    tip.position.set(ax, 1.45, 0.2);
    g.add(tip);
  }
}

export const SHELLS: ShellDef[] = [
  { id: "hood", label: "HOODED", glyph: "🥷", build: buildHoodShell },
  { id: "arcade", label: "ARCADE", glyph: "🕹️", build: buildArcadeShell },
  { id: "steampunk", label: "STEAMPUNK", glyph: "⚙️", build: buildSteampunkShell },
  { id: "crystal", label: "CRYSTAL", glyph: "💎", build: buildCrystalShell },
  { id: "robot", label: "ROBOT", glyph: "🤖", build: buildRobotShell },
  { id: "boombox", label: "BOOMBOX", glyph: "📻", build: buildBoomboxShell },
  { id: "crt", label: "RETRO CRT", glyph: "📺", build: buildCrtShell },
  { id: "satellite", label: "SATELLITE", glyph: "🛰️", build: buildSatelliteShell },
];
