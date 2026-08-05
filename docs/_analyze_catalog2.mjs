import fs from "fs";

const path = "docs/ANIMATION_CATALOG2.csv";
const text = fs.readFileSync(path, "utf8");

function parseCsv(t) {
  const rows = [];
  let row = [];
  let field = "";
  let i = 0;
  let inQ = false;
  while (i < t.length) {
    const c = t[i];
    if (inQ) {
      if (c === '"') {
        if (t[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQ = false;
        i++;
        continue;
      }
      field += c;
      i++;
      continue;
    }
    if (c === '"') {
      inQ = true;
      i++;
      continue;
    }
    if (c === ",") {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (c === "\r") {
      i++;
      continue;
    }
    if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      i++;
      continue;
    }
    field += c;
    i++;
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

const rows = parseCsv(text);
const header = rows[0].map((h) => h.trim());
const data = rows.slice(1).filter((r) => r.length > 1 && r.some((x) => String(x).trim()));
const idx = Object.fromEntries(header.map((h, i) => [h, i]));
const col = (r, name) => String(r[idx[name]] ?? "").trim();

const byStatus = {};
const byPriority = {};
const byPreload = {};
const byLoop = {};
const byVerified = {};
const byLoadOk = {};
const byExists = {};
const bySkeleton = {};
const byDomain = {};
const byPack = {};
const byInWiring = {};
const cacheKeys = new Map();
const blocked = [];
const ready = [];
const readyToWire = [];
const otherStatus = [];
const virtualHints = [];
const multiWired = [];
const missingFields = {
  no_cache_key: 0,
  no_source_path: 0,
  no_wired: 0,
  no_loop: 0,
  no_preload: 0,
  no_skeleton: 0,
};

const hasVirtualCol = header.some((h) =>
  /virtual|subclip|start_frame|end_frame|parent_asset|exported_clip/i.test(h),
);

function bump(map, k) {
  map[k] = (map[k] || 0) + 1;
}

for (const r of data) {
  const status = col(r, "controller_status") || "(empty)";
  const prio = col(r, "optimization_priority") || "(empty)";
  const preload = col(r, "preload_tier") || "(empty)";
  const loop = col(r, "default_loop_policy") || "(empty)";
  const verified = col(r, "verified_for_use") || "(empty)";
  const loadOk = col(r, "load_ok") || "(empty)";
  const exists = col(r, "asset_exists") || "(empty)";
  const skel = col(r, "skeleton") || "(empty)";
  const domain = col(r, "storage_domain") || "(empty)";
  const pack = col(r, "pack_or_folder") || "(empty)";
  const wired = col(r, "wired_connections") || "";
  const cache = col(r, "asset_cache_key") || "";
  const name = col(r, "animation_name");
  const sourcePath = col(r, "source_path");
  const notes = col(r, "notes");
  const inWiring = col(r, "in_wiring_table") || "(empty)";
  const hip = col(r, "correct_hip");
  const xz = col(r, "correct_xz");
  const lengthSec = col(r, "length_sec");
  const trackCount = col(r, "track_count");
  const animType = col(r, "animation_type");
  const weapon = col(r, "weapon_attached");
  const recommended = col(r, "recommended_action");

  bump(byStatus, status);
  bump(byPriority, prio);
  bump(byPreload, preload);
  bump(byLoop, loop);
  bump(byVerified, verified);
  bump(byLoadOk, loadOk);
  bump(byExists, exists);
  bump(bySkeleton, skel);
  bump(byDomain, domain);
  bump(byPack, pack);
  bump(byInWiring, inWiring);

  if (!cache) missingFields.no_cache_key++;
  if (!sourcePath) missingFields.no_source_path++;
  if (!wired) missingFields.no_wired++;
  if (!loop || loop === "(empty)") missingFields.no_loop++;
  if (!preload || preload === "(empty)") missingFields.no_preload++;
  if (!skel || skel === "(empty)") missingFields.no_skeleton++;

  if (cache) {
    if (!cacheKeys.has(cache)) cacheKeys.set(cache, []);
    cacheKeys.get(cache).push({ name, status, path: sourcePath, pack });
  }

  const blockedReasons = [];
  if (prio === "P0") blockedReasons.push("P0");
  if (/BLOCKED_LOAD_ERROR/i.test(status)) blockedReasons.push("BLOCKED_LOAD_ERROR");
  if (/BLOCKED_MISSING_ASSET/i.test(status)) blockedReasons.push("BLOCKED_MISSING_ASSET");
  if (preload === "DO_NOT_LOAD" || status === "DO_NOT_LOAD") blockedReasons.push("DO_NOT_LOAD");
  // catch other BLOCKED_* not in the named set
  if (/^BLOCKED_/i.test(status) && !blockedReasons.some((x) => status.includes(x) || x === status)) {
    if (!blockedReasons.includes(status)) blockedReasons.push(status);
  }

  const rec = {
    name,
    status,
    prio,
    preload,
    loop,
    verified,
    loadOk,
    exists,
    skel,
    domain,
    pack,
    wired,
    cache,
    path: sourcePath,
    notes,
    inWiring,
    hip,
    xz,
    lengthSec,
    trackCount,
    animType,
    weapon,
    recommended,
  };

  if (blockedReasons.length) {
    let fix = recommended || "";
    if (!fix) {
      if (blockedReasons.includes("BLOCKED_MISSING_ASSET"))
        fix = "Restore/re-export asset at source_path; re-verify asset_exists=yes and load_ok=yes.";
      else if (blockedReasons.includes("BLOCKED_LOAD_ERROR"))
        fix = "Fix loader/skeleton/path until load_ok=yes; keep gated from controller.";
      else if (blockedReasons.includes("DO_NOT_LOAD"))
        fix = "Exclude from registration and preload unless catalog changes preload_tier.";
      else if (blockedReasons.includes("P0"))
        fix = "Critical: resolve path/load/skeleton before any controller registration.";
    }
    blocked.push({ ...rec, reasons: blockedReasons, recommended_fix: fix });
  } else if (/READY_TO_WIRE/i.test(status)) {
    readyToWire.push(rec);
  } else if (status === "READY" || /^READY$/i.test(status)) {
    ready.push(rec);
  } else {
    otherStatus.push(rec);
  }

  // multiple mappings signal
  if (wired && (wired.includes(";") || (wired.match(/\{/g) || []).length > 1 || /,\s*\w+:/.test(wired))) {
    multiWired.push({ name, wired });
  }

  if (/virtual|subclip|sub-clip|cut from|slice|parent clip|frame\s*\d/i.test(notes + " " + status)) {
    virtualHints.push({ name, notes, status, cache, path: sourcePath });
  }
}

const sharedCaches = [...cacheKeys.entries()].filter(([, names]) => names.length > 1);

// controller-ready definition for this plan:
// NOT gated by P0 / BLOCKED_* / DO_NOT_LOAD AND status in READY or READY_TO_WIRE?
// User said: exclude P0, BLOCKED_*, DO_NOT_LOAD from controller registration
// "290 controller-ready" likely = total - blocked gates
const gatedOut = new Set(blocked.map((b) => b.name + "|" + b.cache));
const controllerEligible = data.filter((r) => {
  const status = col(r, "controller_status");
  const prio = col(r, "optimization_priority");
  const preload = col(r, "preload_tier");
  if (prio === "P0") return false;
  if (/BLOCKED_LOAD_ERROR|BLOCKED_MISSING_ASSET/i.test(status)) return false;
  if (preload === "DO_NOT_LOAD" || status === "DO_NOT_LOAD") return false;
  if (/^BLOCKED_/i.test(status)) return false;
  return true;
});

// READY subset among eligible
const readyEligible = controllerEligible.filter((r) => {
  const s = col(r, "controller_status");
  return s === "READY" || /^READY$/i.test(s);
});

const out = {
  source: path,
  total: data.length,
  columns: header,
  hasVirtualSubclipColumns: hasVirtualCol,
  missingTimingFields: [
    "parent_asset",
    "start_frame",
    "end_frame",
    "fps",
    "exported_clip_name",
    "virtual_subclip",
  ].filter((f) => !header.includes(f)),
  aggregates: {
    byStatus,
    byPriority,
    byPreload,
    byLoop,
    byVerified,
    byLoadOk,
    byExists,
    bySkeleton,
    byDomain,
    byPack,
    byInWiring,
  },
  uniqueCacheKeys: cacheKeys.size,
  sharedCacheKeys: sharedCaches.map(([k, n]) => ({
    key: k,
    count: n.length,
    names: n.map((x) => x.name),
  })),
  rowsOnSharedCacheKeys: sharedCaches.reduce((s, [, n]) => s + n.length, 0),
  blocked,
  ready: ready.map((r) => ({
    name: r.name,
    cache: r.cache,
    path: r.path,
    loop: r.loop,
    preload: r.preload,
    wired: r.wired,
    hip: r.hip,
    xz: r.xz,
    skel: r.skel,
    domain: r.domain,
    exists: r.exists,
    loadOk: r.loadOk,
    verified: r.verified,
  })),
  readyToWire,
  otherStatus: otherStatus.map((r) => ({ name: r.name, status: r.status, prio: r.prio, preload: r.preload })),
  multiWiredSample: multiWired.slice(0, 40),
  virtualHints,
  missingFields,
  reconcile: {
    expected: {
      total: 325,
      controller_ready: 290,
      p0_blocked: 14,
      ready_to_wire: 21,
      shared_cache_rows: 16,
    },
    actual: {
      total: data.length,
      gated_blocked_rows: blocked.length,
      controller_eligible_not_gated: controllerEligible.length,
      status_READY: ready.length,
      status_READY_TO_WIRE: readyToWire.length,
      p0: byPriority["P0"] || 0,
      rows_on_shared_cache_keys: sharedCaches.reduce((s, [, n]) => s + n.length, 0),
      shared_key_count: sharedCaches.length,
      other_status: otherStatus.length,
    },
  },
};

fs.writeFileSync("docs/_animation_catalog2_analysis.json", JSON.stringify(out, null, 2));

console.log("total", data.length);
console.log("columns", header.join(", "));
console.log("hasVirtualSubclipColumns", hasVirtualCol);
console.log("missingTimingFields", out.missingTimingFields);
console.log("\nbyStatus", byStatus);
console.log("byPriority", byPriority);
console.log("byPreload", byPreload);
console.log("byLoop", byLoop);
console.log("byVerified", byVerified);
console.log("byLoadOk", byLoadOk);
console.log("byExists", byExists);
console.log("bySkeleton", bySkeleton);
console.log("byDomain", byDomain);
console.log("uniqueCacheKeys", cacheKeys.size);
console.log("sharedKeys", sharedCaches.length, "rowsOnShared", out.rowsOnSharedCacheKeys);
console.log("blocked", blocked.length);
console.log("READY", ready.length);
console.log("READY_TO_WIRE", readyToWire.length);
console.log("other", otherStatus.length);
console.log("controller_eligible", controllerEligible.length);
console.log("reconcile", JSON.stringify(out.reconcile, null, 2));
console.log("\n--- BLOCKED ---");
for (const b of blocked) {
  console.log(
    `${b.reasons.join("+")} | ${b.name} | ${b.status} | prio=${b.prio} | preload=${b.preload} | exists=${b.exists} load=${b.loadOk} | ${b.path} | ${b.recommended_fix?.slice(0, 100)}`,
  );
}
console.log("\n--- READY_TO_WIRE ---");
for (const b of readyToWire) {
  console.log(`${b.name} | ${b.wired || "(empty)"} | ${b.cache} | ${b.path} | ${b.recommended}`);
}
console.log("\n--- SHARED CACHES ---");
for (const s of out.sharedCacheKeys) {
  console.log(`${s.count}x ${s.key} => ${s.names.join(", ")}`);
}
console.log("\n--- OTHER STATUS ---");
for (const b of otherStatus) {
  console.log(`${b.status} | ${b.name} | ${b.prio} | ${b.preload}`);
}
console.log("\nvirtualHints", virtualHints.length);
console.log("wrote docs/_animation_catalog2_analysis.json");
