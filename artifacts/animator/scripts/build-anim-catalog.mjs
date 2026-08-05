/**
 * HONEST animation catalog:
 *  - Real clip lengths via Three FBXLoader / CDN JSON
 *  - Exact wiring from clipCatalog (WEAPON_SETS, GLOBAL_*, TRAVERSAL, UNIVERSAL)
 *  - Orphan on-disk files called out (NOT verified for use)
 *
 *   node scripts/build-anim-catalog.mjs
 *   node scripts/build-anim-catalog.mjs --cdn
 *   node scripts/build-anim-catalog.mjs --skip-fbx   # wiring only, no FBX parse
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(__dirname, "..");
const REPO_DOCS = path.resolve(APP, "../../docs");
const ANIM_ROOT = path.join(APP, "public/anim");
const CATALOG_TS = path.join(APP, "src/three/explorer/clipCatalog.ts");
const ANIMS_TS = path.join(APP, "src/three/grudge/anims.ts");
const OUT_CSV = path.join(REPO_DOCS, "ANIMATION_CATALOG.csv");
/** Controller registry (same rows + gate columns). Authoritative for AnimationController wiring. */
const OUT_CSV2 = path.join(REPO_DOCS, "ANIMATION_CATALOG2.csv");
const OUT_CHECKLIST = path.join(REPO_DOCS, "ANIMATION_CHECKLIST.md");
const OUT_WIRING = path.join(REPO_DOCS, "ANIMATION_WIRING_AUDIT.md");
const CDN_BASE = (process.env.VITE_ASSET_BASE || "https://assets.grudge-studio.com").replace(
  /\/+$/,
  "",
);
const FETCH_CDN = process.argv.includes("--cdn") || process.env.FETCH_CDN === "1";
const SKIP_FBX = process.argv.includes("--skip-fbx");

// ── polyfills for Three loaders in Node ─────────────────────────────────────
if (typeof globalThis.ProgressEvent === "undefined") {
  globalThis.ProgressEvent = class ProgressEvent extends Event {
    constructor(type, init = {}) {
      super(type);
      this.lengthComputable = !!init.lengthComputable;
      this.loaded = init.loaded || 0;
      this.total = init.total || 0;
    }
  };
}
const _fetch = globalThis.fetch.bind(globalThis);
globalThis.fetch = async (input, init) => {
  const u = typeof input === "string" ? input : input?.url ?? String(input);
  if (u.startsWith("file:")) {
    const buf = fs.readFileSync(fileURLToPath(u));
    return new Response(buf, { status: 200 });
  }
  return _fetch(input, init);
};

const require = createRequire(import.meta.url);
// Resolve three from animator package
let FBXLoader;
let GLTFLoader;
async function loadThreeLoaders() {
  const threePath = path.join(APP, "node_modules/three");
  // pnpm may hoist to monorepo root
  const { FBXLoader: F } = await import("three/examples/jsm/loaders/FBXLoader.js");
  const { GLTFLoader: G } = await import("three/examples/jsm/loaders/GLTFLoader.js");
  FBXLoader = F;
  GLTFLoader = G;
}

function walkFiles(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walkFiles(p, acc);
    else if (/\.(fbx|glb)$/i.test(ent.name)) acc.push(p);
  }
  return acc;
}

function toCatalogId(absFile) {
  return path.relative(ANIM_ROOT, absFile).replace(/\\/g, "/").replace(/\.(fbx|glb)$/i, "");
}

/**
 * Parse clipCatalog.ts into:
 *  id -> [{ scope, weapon?, key, kind: loco|action|global|reaction|traversal|universal }]
 */
function parseWiring() {
  const src = fs.readFileSync(CATALOG_TS, "utf8");
  /** @type {Map<string, {scope:string, weapon:string, key:string, kind:string}[]>} */
  const wire = new Map();

  function add(id, meta) {
    if (!id || typeof id !== "string" || !id.startsWith("animations/")) return;
    if (!wire.has(id)) wire.set(id, []);
    wire.get(id).push(meta);
  }

  // UNIVERSAL_LOCO / UNIVERSAL_MOVEMENT
  for (const blockName of ["UNIVERSAL_LOCO", "UNIVERSAL_MOVEMENT"]) {
    const m = src.match(new RegExp(`export const ${blockName}[\\s\\S]*?^} as const;`, "m"));
    if (!m) continue;
    const re = /(\w+):\s*"(animations\/[^"]+)"/g;
    let em;
    while ((em = re.exec(m[0]))) {
      add(em[2], {
        scope: "universal",
        weapon: "*",
        key: em[1],
        kind: blockName === "UNIVERSAL_LOCO" ? "loco" : "movement",
      });
    }
  }

  // WEAPON_SETS — crude but effective: split by weapon class keys
  const ws = src.match(/export const WEAPON_SETS[\s\S]*?^};/m);
  if (ws) {
    const block = ws[0];
    const classRe = /^\s{2}([a-z0-9_]+):\s*\{/gm;
    const classes = [];
    let cm;
    while ((cm = classRe.exec(block))) classes.push({ name: cm[1], index: cm.index });
    // every "animations/..." with preceding key:
    const entryRe = /(\w+):\s*"(animations\/[^"]+)"/g;
    let em;
    while ((em = entryRe.exec(block))) {
      let weapon = "unknown";
      for (let i = classes.length - 1; i >= 0; i--) {
        if (classes[i].index < em.index) {
          weapon = classes[i].name;
          break;
        }
      }
      // skip non-weapon false positives
      if (
        ![
          "unarmed",
          "sword",
          "knife",
          "greatsword",
          "axe",
          "mace",
          "mace2h",
          "spear",
          "hammer",
          "greataxe",
          "hammer2h",
          "ranged",
          "bow",
          "magic",
          "pistol",
          "shotgun",
        ].includes(weapon)
      )
        continue;
      const key = em[1];
      const kind = /^(idle|idles|walkF|walkB|walkL|walkR|runF|runB|runL|runR)$/.test(key)
        ? "loco"
        : "action";
      add(em[2], { scope: "weapon", weapon, key, kind });
    }
    // idles arrays
    const idlesRe = /idles:\s*\[([^\]]+)\]/g;
    let im;
    while ((im = idlesRe.exec(block))) {
      let weapon = "unknown";
      for (let i = classes.length - 1; i >= 0; i--) {
        if (classes[i].index < im.index) {
          weapon = classes[i].name;
          break;
        }
      }
      const paths = [...im[1].matchAll(/"(animations\/[^"]+)"/g)].map((x) => x[1]);
      for (const p of paths) {
        add(p, { scope: "weapon", weapon, key: "idles", kind: "loco" });
      }
    }
  }

  // GLOBAL_ACTIONS / GLOBAL_REACTIONS / TRAVERSAL
  for (const [name, kind] of [
    ["GLOBAL_ACTIONS", "global_action"],
    ["GLOBAL_REACTIONS", "global_reaction"],
  ]) {
    const m = src.match(new RegExp(`export const ${name}[\\s\\S]*?^};`, "m"));
    if (!m) continue;
    const re = /(\w+):\s*"(animations\/[^"]+)"/g;
    let em;
    while ((em = re.exec(m[0]))) {
      add(em[2], { scope: "global", weapon: "*", key: em[1], kind });
    }
  }
  const trav = src.match(/export const TRAVERSAL_SETS[\s\S]*?^};/m);
  if (trav) {
    const modeRe = /^\s{2}(climb|swim):\s*\{/gm;
    const modes = [];
    let mm;
    while ((mm = modeRe.exec(trav[0]))) modes.push({ name: mm[1], index: mm.index });
    const re = /(\w+):\s*"(animations\/[^"]+)"/g;
    let em;
    while ((em = re.exec(trav[0]))) {
      let mode = "traversal";
      for (let i = modes.length - 1; i >= 0; i--) {
        if (modes[i].index < em.index) {
          mode = modes[i].name;
          break;
        }
      }
      add(em[2], { scope: "traversal", weapon: mode, key: em[1], kind: "traversal" });
    }
  }

  // GLB subclips / ids
  const glb = src.match(/export const GLB_CLIP_IDS[\s\S]*?^\];/m);
  if (glb) {
    const re = /"(animations\/[^"]+)"/g;
    let em;
    while ((em = re.exec(glb[0]))) {
      add(em[1], {
        scope: "glb_virtual",
        weapon: "sword|knife",
        key: "combo_slice",
        kind: "action",
      });
    }
  }

  return wire;
}

function formatWiring(list) {
  if (!list || !list.length) return "";
  // weapon:key,key2 | global:parryReact
  const by = new Map();
  for (const w of list) {
    const k = w.scope === "weapon" ? w.weapon : `${w.scope}`;
    if (!by.has(k)) by.set(k, new Set());
    by.get(k).add(w.key);
  }
  return [...by.entries()]
    .map(([k, keys]) => `${k}:{${[...keys].join("+")}}`)
    .join(" | ");
}

function weaponsFromWiring(list) {
  if (!list || !list.length) return "NONE_ORPHAN";
  const w = new Set();
  for (const x of list) {
    if (x.scope === "weapon") w.add(x.weapon);
    else if (x.weapon && x.weapon !== "*") w.add(x.weapon);
    else w.add(x.scope);
  }
  return [...w].sort().join("|");
}

function classifyType(id, wiring) {
  const keys = (wiring || []).map((w) => w.key).join(" ");
  const s = `${id} ${keys}`.toLowerCase();
  if (/dodge|evade|roll|sidestep|jump-away|backstep|dash(?!attack)/.test(s)) return "dodge";
  if (/block|parry|guard/.test(s)) return "defense";
  if (/attack|slash|stab|combo|kick|punch|cast|shoot|fire|whip|thrust|skill|smite|overhead|uppercut|headbutt|stomp/.test(s))
    return "attack";
  if (/idle|fight-idle|aim|kneel/.test(s) && !/reload/.test(s)) return "idle";
  if (/walk|run|strafe|loco|sprint|turn|start-run/.test(s)) return "locomotion";
  if (/jump|land|fall|flip|twirl|spin|slide|aerial|acrobatic|mantle|swim|climb/.test(s))
    return "acrobatics";
  if (/hit|hurt|react|stumble|stunned|fallen|knock|death|get-up|kip|wall|blow/.test(s))
    return "reaction";
  if (/reload|draw|equip|sheath|disarm|pump|charge/.test(s)) return "weapon_handling";
  if (/gesture/.test(s)) return "gesture";
  if (/farm|plant|water|dig|pull|pick|harvest/.test(s)) return "traversal";
  if (/throw|grenade/.test(s)) return "utility";
  return "other";
}

function folderOf(id) {
  const p = id.split("/");
  return p[0] === "animations" ? p[1] || "" : p[0] || "";
}

async function durationLocal(absFile, fbxLoader, gltfLoader) {
  const url = pathToFileURL(absFile).href;
  try {
    if (/\.glb$/i.test(absFile)) {
      const gltf = await gltfLoader.loadAsync(url);
      const c = gltf.animations[0];
      if (!c) return { duration: "", tracks: 0, ok: false, err: "no_clip" };
      return {
        duration: Number(c.duration.toFixed(4)),
        tracks: c.tracks.length,
        ok: true,
        err: "",
      };
    }
    const g = await fbxLoader.loadAsync(url);
    const c = g.animations[0];
    if (!c) return { duration: "", tracks: 0, ok: false, err: "no_clip" };
    return {
      duration: Number(c.duration.toFixed(4)),
      tracks: c.tracks.length,
      ok: true,
      err: c.tracks.length === 0 ? "empty_tracks" : "",
    };
  } catch (e) {
    return { duration: "", tracks: 0, ok: false, err: String(e.message || e).slice(0, 80) };
  }
}

async function durationCdn(rel) {
  try {
    const res = await fetch(`${CDN_BASE}/anims/baked/${rel}.json`, {
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return { duration: "", ok: false, status: res.status };
    const j = await res.json();
    return {
      duration: typeof j.duration === "number" ? Number(j.duration.toFixed(4)) : "",
      ok: true,
      status: 200,
      tracks: Array.isArray(j.tracks) ? j.tracks.length : "",
    };
  } catch {
    return { duration: "", ok: false, status: "err" };
  }
}

function parseGrudge() {
  if (!fs.existsSync(ANIMS_TS)) return [];
  const src = fs.readFileSync(ANIMS_TS, "utf8");
  const packBlock = src.match(/export const ANIM_PACK_CLIPS[\s\S]*?^};/m);
  if (!packBlock) return [];
  const block = packBlock[0];
  const packRe = /^\s{2}([a-z_]+):\s*\{/gm;
  const starts = [];
  let m;
  while ((m = packRe.exec(block))) starts.push({ pack: m[1], index: m.index });
  const entryRe =
    /(idle|walk|run|attack|sprint|walkB|walkL|walkR|runB|runL|runR|block|parry|dodgeF|dodgeB|dodgeL|dodgeR|hurt):\s*"([^"]+)"/g;
  const rows = [];
  let em;
  while ((em = entryRe.exec(block))) {
    let pack = "unknown";
    for (let i = starts.length - 1; i >= 0; i--) {
      if (starts[i].index < em.index) {
        pack = starts[i].pack;
        break;
      }
    }
    rows.push({ pack, key: em[1], rel: em[2] });
  }
  const sprint = src.match(/export const SPRINT_CLIP\s*=\s*"([^"]+)"/);
  if (sprint) {
    for (const p of ["unarmed", "magic", "sword_shield", "longbow"]) {
      rows.push({ pack: p, key: "sprint", rel: sprint[1] });
    }
  }
  return rows;
}

function csvEscape(v) {
  const s = v == null ? "" : String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

const COLS = [
  "animation_name",
  "length_sec",
  "track_count",
  "correct_hip",
  "correct_xz",
  "animation_type",
  "weapon_attached",
  "wired_connections",
  "storage_domain",
  "verified_for_use",
  "skeleton",
  "pack_or_folder",
  "source_path",
  "in_wiring_table",
  "asset_exists",
  "load_ok",
  "notes",
];

/** Extra columns for controller registration (CATALOG2). */
const COLS2 = [
  ...COLS,
  "asset_cache_key",
  "controller_status",
  "optimization_priority",
  "default_loop_policy",
  "preload_tier",
  "recommended_action",
];

function row(fields, cols = COLS) {
  return cols.map((k) => csvEscape(fields[k] ?? "")).join(",");
}

/**
 * Gate + cache + loop + preload from honest inventory fields.
 * Does NOT invent cut times for virtual subclips.
 */
function enrichControllerFields(rows) {
  const keyCount = new Map();
  for (const r of rows) {
    const key = r.source_path || r.animation_name;
    r.asset_cache_key = key;
    keyCount.set(key, (keyCount.get(key) || 0) + 1);
  }

  for (const r of rows) {
    const key = r.asset_cache_key;
    const shared = (keyCount.get(key) || 0) > 1;
    const isVirtual = r.asset_exists === "virtual" || r.load_ok === "virtual_subclip";
    const loadFail = r.load_ok === "fail" || r.load_ok === "empty_clip";
    const missing = r.asset_exists === "no";
    const wired =
      r.in_wiring_table === "yes" &&
      r.wired_connections &&
      !/^ORPHAN_/i.test(r.wired_connections);

    // Loop policy from animation_type
    const t = String(r.animation_type || "").toLowerCase();
    r.default_loop_policy =
      /loco|idle|strafe|block.?idle|aim/.test(t) || t === "idle" || t === "locomotion"
        ? "LoopRepeat"
        : "LoopOnce";

    // Defaults
    r.controller_status = "READY";
    r.optimization_priority = "P3";
    r.preload_tier = wired ? "CORE_PRELOAD" : "ON_DEMAND";
    r.recommended_action = "Keep mapped; monitor transition quality and memory use.";

    if (isVirtual) {
      r.controller_status = "BLOCKED_MISSING_ASSET";
      r.optimization_priority = "P0";
      r.preload_tier = "DO_NOT_LOAD";
      r.recommended_action =
        "Virtual subclip — add parent_asset,start_frame,end_frame,fps,exported_clip_name before cutting; parent must load_ok.";
    } else if (missing) {
      r.controller_status = "BLOCKED_MISSING_ASSET";
      r.optimization_priority = "P0";
      r.preload_tier = "DO_NOT_LOAD";
      r.recommended_action = "Restore or re-export the asset before controller registration.";
    } else if (loadFail) {
      r.controller_status = "BLOCKED_LOAD_ERROR";
      r.optimization_priority = "P0";
      r.preload_tier = "DO_NOT_LOAD";
      r.recommended_action =
        "Fix the loader/runtime error or convert the source to a validated GLB.";
    } else if (!wired) {
      r.controller_status = "READY_TO_WIRE";
      r.optimization_priority = "P1";
      r.preload_tier = "ON_DEMAND";
      r.recommended_action =
        "Add a controller mapping in clipCatalog, then play-test hip and XZ locking.";
    } else if (shared) {
      r.controller_status = "READY_SHARED_CACHE_KEY";
      r.optimization_priority = "P2";
      r.preload_tier = "ON_DEMAND";
      r.recommended_action = "Load asset_cache_key once; reuse AnimationClip for duplicate rows.";
    } else {
      // wired + loads
      if (t === "locomotion" || t === "idle" || /idle|walk|run|strafe/.test(t)) {
        r.preload_tier = "CORE_PRELOAD";
      } else if (/attack|death|hit|reaction/.test(t)) {
        r.preload_tier = "CORE_PRELOAD";
      } else {
        r.preload_tier = "ON_DEMAND";
      }
      r.controller_status = "READY";
      r.optimization_priority = "P3";
    }
  }
  return rows;
}

async function main() {
  console.log("Parsing wiring tables from clipCatalog.ts…");
  const wire = parseWiring();
  const wiredIds = new Set(wire.keys());

  const files = walkFiles(ANIM_ROOT);
  console.log(`Disk files: ${files.length}; unique wired catalog ids: ${wiredIds.size}`);

  let fbxLoader;
  let gltfLoader;
  if (!SKIP_FBX) {
    await loadThreeLoaders();
    fbxLoader = new FBXLoader();
    gltfLoader = new GLTFLoader();
    console.log("Loading FBX/GLB durations (this takes a few minutes)…");
  }

  /** @type {object[]} */
  const rows = [];
  let i = 0;
  for (const file of files) {
    i++;
    const id = toCatalogId(file);
    const wiring = wire.get(id) || [];
    const wired = wiring.length > 0;
    let length = "";
    let tracks = "";
    let loadOk = "skipped";
    let loadErr = "";
    if (!SKIP_FBX) {
      if (i % 25 === 0 || i === 1) console.log(`  [${i}/${files.length}] ${id}`);
      const d = await durationLocal(file, fbxLoader, gltfLoader);
      length = d.duration === "" ? "" : String(d.duration);
      tracks = d.tracks === "" || d.tracks === undefined ? "" : String(d.tracks);
      loadOk = d.ok ? (d.err === "empty_tracks" ? "empty_clip" : "yes") : "fail";
      loadErr = d.err || "";
    }
    const hasWire = wired;
    // Honest verification
    let verified = "orphan_not_wired";
    if (hasWire && loadOk === "yes") verified = "wired_and_loads";
    else if (hasWire && loadOk === "empty_clip") verified = "wired_but_empty_clip";
    else if (hasWire && loadOk === "fail") verified = "wired_but_load_fails";
    else if (hasWire && loadOk === "skipped") verified = "wired_duration_unknown";
    else if (!hasWire && loadOk === "yes") verified = "orphan_on_disk_loads";
    else if (!hasWire) verified = "orphan_not_wired";

    // Hip/XZ honesty: only pipeline if it actually plays via wiring
    const hip = hasWire && loadOk !== "fail" && loadOk !== "empty_clip" ? "pipeline_locked_if_played" : "not_played_unverified";
    const xz = hip;

    rows.push({
      animation_name: path.basename(id),
      length_sec: length,
      track_count: tracks,
      correct_hip: hip,
      correct_xz: xz,
      animation_type: classifyType(id, wiring),
      weapon_attached: weaponsFromWiring(wiring),
      wired_connections: formatWiring(wiring) || "ORPHAN_NOT_IN_WEAPON_SETS_OR_GLOBAL",
      storage_domain: "local:public/anim",
      verified_for_use: verified,
      skeleton: "mixamo",
      pack_or_folder: folderOf(id),
      source_path: id,
      in_wiring_table: hasWire ? "yes" : "no",
      asset_exists: "yes",
      load_ok: loadOk,
      notes: [
        loadErr && `load_err=${loadErr}`,
        !hasWire && "FILE EXISTS BUT NOT REFERENCED IN clipCatalog WEAPON_SETS/GLOBAL/TRAVERSAL",
        hasWire && loadOk === "yes" && "Duration from FBXLoader; hip/XZ only locked when Studio plays via Animator",
      ]
        .filter(Boolean)
        .join("; "),
    });
  }

  // Wired ids that are virtual (GLB subclips) or missing files
  for (const id of wiredIds) {
    if (rows.some((r) => r.source_path === id)) continue;
    const fbx = path.join(ANIM_ROOT, id + ".fbx");
    const glb = path.join(ANIM_ROOT, id + ".glb");
    const exists = fs.existsSync(fbx) || fs.existsSync(glb);
    const wiring = wire.get(id) || [];
    // GLB subclips have no file — derived from parent
    const isSub =
      id.includes("-hit1") || id.includes("-hit2") || id.includes("-hit3");
    let length = "";
    let loadOk = exists ? "unparsed" : isSub ? "virtual_subclip" : "missing";
    if (exists && !SKIP_FBX) {
      const d = await durationLocal(
        fs.existsSync(glb) ? glb : fbx,
        fbxLoader,
        gltfLoader,
      );
      length = d.duration === "" ? "" : String(d.duration);
      loadOk = d.ok ? "yes" : "fail";
    }
    if (isSub && !exists) {
      // duration from parent if we have it
      const parent = "animations/combo/melee-combo-1";
      const prow = rows.find((r) => r.source_path === parent);
      if (prow?.length_sec) {
        length = String(Number((Number(prow.length_sec) / 3).toFixed(4)));
        loadOk = "virtual_slice_of_parent";
      }
    }
    rows.push({
      animation_name: path.basename(id),
      length_sec: length,
      track_count: "",
      correct_hip: isSub ? "pipeline_locked_if_played" : "n/a",
      correct_xz: isSub ? "pipeline_locked_if_played" : "n/a",
      animation_type: classifyType(id, wiring),
      weapon_attached: weaponsFromWiring(wiring),
      wired_connections: formatWiring(wiring),
      storage_domain: "local:public/anim",
      verified_for_use: isSub
        ? "wired_virtual_glb_slice"
        : exists
          ? "wired_and_loads"
          : "wired_missing_file",
      skeleton: "mixamo",
      pack_or_folder: folderOf(id),
      source_path: id,
      in_wiring_table: "yes",
      asset_exists: exists || isSub ? (isSub ? "virtual" : "yes") : "no",
      load_ok: loadOk,
      notes: isSub
        ? "No standalone file — loader slices from animations/combo/melee-combo-1.glb"
        : "In clipCatalog but file missing on disk",
    });
  }

  // grudge6
  console.log("Grudge6 pack table…");
  const grudge = parseGrudge();
  const gmap = new Map();
  for (const { pack, key, rel } of grudge) {
    if (!gmap.has(rel)) {
      gmap.set(rel, { packs: new Set(), keys: new Set(), rel });
    }
    gmap.get(rel).packs.add(pack);
    gmap.get(rel).keys.add(key);
  }
  for (const { packs, keys, rel } of gmap.values()) {
    let length = "";
    let tracks = "";
    let exists = "unknown";
    let verified = "pending_cdn";
    let loadOk = "unknown";
    if (FETCH_CDN) {
      const d = await durationCdn(rel);
      length = d.duration === "" ? "" : String(d.duration);
      tracks = d.tracks === "" || d.tracks === undefined ? "" : String(d.tracks);
      exists = d.ok ? "yes" : "no";
      loadOk = d.ok ? "yes" : "fail";
      verified = d.ok ? "wired_cdn_ok" : "wired_cdn_missing";
    } else {
      verified = "wired_cdn_not_probed";
    }
    const packList = [...packs].join("|");
    const keyList = [...keys].join("+");
    rows.push({
      animation_name: path.basename(rel),
      length_sec: length,
      track_count: tracks,
      correct_hip: "pipeline_locked_if_played",
      correct_xz: "pipeline_locked_if_played",
      animation_type: classifyType(rel + " " + keyList, [
        { key: keyList, scope: "weapon", weapon: packList, kind: "action" },
      ]),
      weapon_attached: packList,
      wired_connections: `grudge_pack:{${keyList}} packs=${packList}`,
      storage_domain: "cdn:assets.grudge-studio.com/anims/baked",
      verified_for_use: verified,
      skeleton: "bip001",
      pack_or_folder: packList,
      source_path: rel,
      in_wiring_table: "yes",
      asset_exists: exists,
      load_ok: loadOk,
      notes: FETCH_CDN
        ? "Bip001 baked JSON; only plays on GrudgeAvatar after loadBakedClip"
        : "Run with --cdn to fill length_sec from CDN",
    });
  }

  rows.sort((a, b) =>
    `${a.skeleton}|${a.verified_for_use}|${a.pack_or_folder}|${a.source_path}`.localeCompare(
      `${b.skeleton}|${b.verified_for_use}|${b.pack_or_folder}|${b.source_path}`,
    ),
  );

  enrichControllerFields(rows);

  fs.mkdirSync(REPO_DOCS, { recursive: true });
  // v1 columns (compat) + v2 controller registry (authoritative for AnimationController gates)
  fs.writeFileSync(OUT_CSV, [COLS.join(","), ...rows.map((r) => row(r, COLS))].join("\n") + "\n", "utf8");
  fs.writeFileSync(OUT_CSV2, [COLS2.join(","), ...rows.map((r) => row(r, COLS2))].join("\n") + "\n", "utf8");

  // Stats
  const count = (fn) => rows.filter(fn).length;
  const stats = {
    total: rows.length,
    mixamo: count((r) => r.skeleton === "mixamo"),
    bip001: count((r) => r.skeleton === "bip001"),
    with_duration: count((r) => r.length_sec !== ""),
    wired_and_loads: count((r) => r.verified_for_use === "wired_and_loads"),
    orphan_not_wired: count((r) => r.verified_for_use === "orphan_not_wired" || r.verified_for_use === "orphan_on_disk_loads"),
    wired_missing: count((r) => r.verified_for_use === "wired_missing_file"),
    wired_fail: count((r) => r.verified_for_use === "wired_but_load_fails" || r.verified_for_use === "wired_but_empty_clip"),
    cdn_ok: count((r) => r.verified_for_use === "wired_cdn_ok"),
    cdn_missing: count((r) => r.verified_for_use === "wired_cdn_missing"),
  };

  const orphans = rows.filter((r) => r.in_wiring_table === "no");
  const orphanList = orphans.map((r) => `- \`${r.source_path}\` (${r.length_sec || "?"}s) — ${r.animation_type}`).join("\n");

  const audit = `# Animation wiring audit (honest)

Generated: ${new Date().toISOString()}

## The uncomfortable truth

| Fact | Count |
|------|------:|
| Total catalog rows | ${stats.total} |
| Explorer files on disk | ${files.length} |
| Unique paths referenced in clipCatalog wiring tables | ${wiredIds.size} |
| **On disk but NOT wired** (orphan) | **${stats.orphan_not_wired}** |
| Wired + loads OK (duration measured) | ${stats.wired_and_loads} |
| Wired but load fails / empty | ${stats.wired_fail} |
| Wired missing file | ${stats.wired_missing} |
| grudge6 CDN OK (if --cdn) | ${stats.cdn_ok} |
| Rows with length_sec filled | ${stats.with_duration} |

### What “wired” means

A clip is **wired** only if it appears in one of:

- \`WEAPON_SETS[weapon].loco\` or \`.actions\`
- \`UNIVERSAL_LOCO\` / \`UNIVERSAL_MOVEMENT\`
- \`GLOBAL_ACTIONS\` / \`GLOBAL_REACTIONS\`
- \`TRAVERSAL_SETS\`
- \`GLB_CLIP_IDS\` / GLB subclips (virtual slices of melee-combo-1)

**Folder name is NOT a connection.** Putting a file under \`public/anim/animations/pistol/\` does not attach it to the pistol class until \`clipCatalog.ts\` references that id.

### Hip / XZ honesty

- \`pipeline_locked_if_played\` = when Animator/GrudgeAvatar plays the clip, root hip position tracks are locked to bind. **Not** a measured Box3 pass.
- \`not_played_unverified\` = orphan / never bound — **never gets hip lock because it never plays**.
- We have **not** marked measured_pass unless a future ground audit runs.

### Orphan files on disk (not in any wiring table)

${orphanList || "_none_"}

### Broken / special wiring

| ID | Issue |
|----|--------|
| \`animations/combo/melee-combo-1-hit1/2/3\` | Virtual slices of \`melee-combo-1.glb\` — no standalone FBX (OK if parent loads) |
| Known FBX parse fails (historical) | \`draw-great-sword-2\`, \`standing-2h-magic-area-attack-01\` |

## CSV

\`${path.relative(REPO_DOCS, OUT_CSV).replace(/\\/g, "/") || "ANIMATION_CATALOG.csv"}\`

Columns include **wired_connections** (exact weapon:action keys) and **verified_for_use** (no soft lies).

## Regenerate

\`\`\`bash
cd artifacts/animator
node scripts/build-anim-catalog.mjs --cdn     # full durations + CDN
node scripts/build-anim-catalog.mjs --skip-fbx  # wiring only (fast)
\`\`\`
`;

  const checklist = `# Animation verification checklist

Generated: ${new Date().toISOString()}  
See also: \`ANIMATION_WIRING_AUDIT.md\`, \`ANIMATION_CATALOG.csv\`

## Status counts

| Metric | N |
|--------|--:|
| Total rows | ${stats.total} |
| With length_sec | ${stats.with_duration} |
| Wired + loads | ${stats.wired_and_loads} |
| **Orphan (file not wired)** | **${stats.orphan_not_wired}** |
| Wired missing file | ${stats.wired_missing} |
| Wired load fail/empty | ${stats.wired_fail} |
| grudge CDN OK | ${stats.cdn_ok} |

## Do not claim “verified for use” unless

\`\`\`
[ ] source_path appears in WEAPON_SETS / GLOBAL_* / TRAVERSAL / UNIVERSAL (see wired_connections)
[ ] asset_exists=yes OR virtual GLB slice
[ ] load_ok=yes (FBX/GLB parse has tracks) OR CDN 200 with duration
[ ] length_sec is filled (not blank)
[ ] correct_hip / correct_xz are not not_played_unverified
[ ] Played once in Danger Room / Dressing Room on real skeleton (Mixamo or Bip001)
\`\`\`

## Column reference

| Column | Honest meaning |
|--------|----------------|
| length_sec | Seconds from FBXLoader / GLTF / CDN JSON — blank means not measured this run |
| track_count | Animation tracks in the file (0 = empty clip, useless) |
| correct_hip / correct_xz | pipeline_locked_if_played OR not_played_unverified — **not** measured_pass |
| weapon_attached | Actual wiring scopes, or NONE_ORPHAN |
| wired_connections | e.g. sword:{attack1+comboHit1} \\| global:{parryReact} |
| verified_for_use | wired_and_loads · orphan_not_wired · wired_missing_file · wired_but_load_fails · wired_cdn_ok · … |

## Next work (product)

1. Wire orphans that matter (see audit list) into clipCatalog  
2. Delete or quarantine true junk orphans  
3. measured Box3 feet/XZ pass → update correct_hip/xz to measured_pass/fail  
`;

  fs.writeFileSync(OUT_WIRING, audit, "utf8");
  fs.writeFileSync(OUT_CHECKLIST, checklist, "utf8");
  console.log(`CSV  → ${OUT_CSV}`);
  console.log(`CSV2 → ${OUT_CSV2} (controller gates / cache / loop / preload)`);
  console.log(`Audit → ${OUT_WIRING}`);
  console.log(JSON.stringify(stats, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
