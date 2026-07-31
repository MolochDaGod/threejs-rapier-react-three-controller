/**
 * Floating islands + airship deck cinema stage.
 *
 * - Scene GLB: models/landing/floating_islands.glb
 * - Removes flat helpers/orbit “background” — full environment as sky volume
 * - Wide FOV cinema camera (always inside sky dome)
 * - Establish shot → dolly to airship deck
 * - 4 deck crew spots + grid pathfinding between them
 * - Character mesh feet planted on deck (raycast + optional two-bone IK)
 */
import {
  useEffect,
  useRef,
  useImperativeHandle,
  forwardRef,
  type CSSProperties,
} from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { assetUrl } from "../three/assetHost";
import {
  makeGrid,
  idx,
  isWalkable,
  worldToCell,
  cellCenter,
  type NavGrid,
} from "../three/dungeon/navmesh";
import { FootGrounder } from "../three/anim/legIk";

const ISLANDS_URL = "models/landing/floating_islands.glb";
const HERO_CANDIDATES = [
  "models/landing/astrocreeper.glb",
  "models/astrocreeper.glb",
  "models/racalvin.glb",
  "models/orc.glb",
];

/** Cinema wide FOV (degrees) — clean anamorphic-ish landscape feel */
const CINEMA_FOV = 68;
const FAR = 2500;

export type DeckStageMode = "landing" | "deck";

export interface FloatingIslandsDeckStageHandle {
  /** Walk character to crew station 0..3 via pathfinding */
  walkToStation: (index: number) => void;
  /** Focus cinema on station without walk */
  lookAtStation: (index: number) => void;
  /** Replay establish → deck cinema */
  playCinema: () => void;
}

interface Props {
  mode?: DeckStageMode;
  /** Which station the active hero is assigned to (deck mode) */
  selectedStation?: number;
  className?: string;
  style?: CSSProperties;
}

const STATION_LABELS = ["Helm", "Main battery", "Fore guns", "Crow's line"] as const;

function prepMeshes(root: THREE.Object3D): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.castShadow = true;
    m.receiveShadow = true;
    m.frustumCulled = false;
    const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
    for (const mat of mats) {
      if (!mat) continue;
      if ("map" in mat && (mat as THREE.MeshStandardMaterial).map) {
        (mat as THREE.MeshStandardMaterial).map!.colorSpace = THREE.SRGBColorSpace;
      }
      if ("side" in mat) (mat as THREE.Material).side = THREE.FrontSide;
    }
  });
}

function plantRootOnY(obj: THREE.Object3D, targetHeight: number): void {
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  const s = targetHeight / Math.max(size.y, 0.001);
  obj.scale.setScalar(s);
  obj.updateMatrixWorld(true);
  const box2 = new THREE.Box3().setFromObject(obj);
  obj.position.y -= box2.min.y;
}

async function loadFirst(
  paths: string[],
  loader: GLTFLoader,
): Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[] }> {
  let last: unknown;
  for (const p of paths) {
    try {
      const gltf = await loader.loadAsync(assetUrl(p));
      return { scene: gltf.scene, animations: gltf.animations ?? [] };
    } catch (e) {
      last = e;
    }
  }
  throw last ?? new Error("load failed");
}

/** Collect mesh candidates that look like walkable decks / platforms */
function collectDeckMeshes(root: THREE.Object3D): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || !m.geometry) return;
    const n = (m.name || "").toLowerCase();
    if (/water|ocean|sky|cloud|fog|fx|particle/i.test(n)) return;
    if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
    const bb = m.geometry.boundingBox;
    if (!bb) return;
    const size = new THREE.Vector3();
    bb.getSize(size);
    // Prefer wide flat-ish surfaces (deck boards, islands tops)
    const horiz = Math.max(size.x, size.z);
    if (horiz < 0.5) return;
    if (size.y > horiz * 1.2 && !/deck|floor|platform|plank|wood|ship|boat|air/i.test(n)) {
      return;
    }
    meshes.push(m);
  });
  // Prefer names matching deck/ship; else largest horizontal footprint
  meshes.sort((a, b) => {
    const score = (m: THREE.Mesh) => {
      const n = (m.name || "").toLowerCase();
      let s = 0;
      if (/deck|platform|plank|floor|ship|boat|airship|hull/i.test(n)) s += 1000;
      if (!m.geometry.boundingBox) m.geometry.computeBoundingBox();
      const sz = new THREE.Vector3();
      m.geometry.boundingBox!.getSize(sz);
      s += sz.x * sz.z;
      return s;
    };
    return score(b) - score(a);
  });
  return meshes.slice(0, 24);
}

function buildSkyDome(): THREE.Mesh {
  const geo = new THREE.SphereGeometry(900, 48, 32);
  // Invert so we look from inside
  geo.scale(-1, 1, 1);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      topColor: { value: new THREE.Color(0x1a3a6e) },
      midColor: { value: new THREE.Color(0x6eb6e8) },
      botColor: { value: new THREE.Color(0xc8e4ff) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vPos;
      void main() {
        vPos = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 topColor;
      uniform vec3 midColor;
      uniform vec3 botColor;
      varying vec3 vPos;
      void main() {
        float h = normalize(vPos).y;
        vec3 col = mix(botColor, midColor, smoothstep(-0.2, 0.25, h));
        col = mix(col, topColor, smoothstep(0.2, 0.85, h));
        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = "cinema-sky-dome";
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  return mesh;
}

function sampleGroundY(
  meshes: THREE.Mesh[],
  x: number,
  z: number,
  ray: THREE.Raycaster,
  maxY = 400,
): number | null {
  ray.set(new THREE.Vector3(x, maxY, z), new THREE.Vector3(0, -1, 0));
  ray.far = maxY + 200;
  const hits = ray.intersectObjects(meshes, false);
  for (const h of hits) {
    if (Number.isFinite(h.point.y)) return h.point.y;
  }
  return null;
}

function buildDeckNav(
  deckMeshes: THREE.Mesh[],
  center: THREE.Vector3,
  half: number,
  ray: THREE.Raycaster,
): NavGrid {
  const cell = 0.75;
  const cols = Math.max(8, Math.ceil((half * 2) / cell));
  const rows = cols;
  const originX = center.x - ((cols - 1) * cell) / 2;
  const originZ = center.z - ((rows - 1) * cell) / 2;
  const g = makeGrid(cols, rows, cell, originX, originZ);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const { x, z } = cellCenter(g, c, r);
      const y = sampleGroundY(deckMeshes, x, z, ray, center.y + 80);
      if (y === null) continue;
      // Only walk near the highest surface band (deck, not distant islands far below)
      if (y < center.y - 4 || y > center.y + 6) continue;
      const i = idx(g, c, r);
      g.walkable[i] = 1;
      g.height[i] = y;
    }
  }
  return g;
}

/** A* on NavGrid → world polyline */
function findPath(
  g: NavGrid,
  from: THREE.Vector3,
  to: THREE.Vector3,
): THREE.Vector3[] {
  const a = worldToCell(g, from.x, from.z);
  const b = worldToCell(g, to.x, to.z);
  if (!isWalkable(g, a.c, a.r) || !isWalkable(g, b.c, b.r)) {
    return [from.clone(), to.clone()];
  }
  const key = (c: number, r: number) => r * g.cols + c;
  const open: { c: number; r: number; f: number }[] = [];
  const came = new Map<number, number>();
  const gScore = new Map<number, number>();
  const closed = new Set<number>();
  const startK = key(a.c, a.r);
  gScore.set(startK, 0);
  open.push({ c: a.c, r: a.r, f: 0 });
  const h = (c: number, r: number) => Math.abs(c - b.c) + Math.abs(r - b.r);
  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ];
  let found = false;
  let guard = 0;
  while (open.length && guard++ < g.cols * g.rows * 4) {
    open.sort((u, v) => u.f - v.f);
    const cur = open.shift()!;
    const ck = key(cur.c, cur.r);
    if (closed.has(ck)) continue;
    closed.add(ck);
    if (cur.c === b.c && cur.r === b.r) {
      found = true;
      break;
    }
    const base = gScore.get(ck) ?? 1e9;
    for (const [dc, dr] of dirs) {
      const nc = cur.c + dc;
      const nr = cur.r + dr;
      if (!isWalkable(g, nc, nr)) continue;
      const nk = key(nc, nr);
      if (closed.has(nk)) continue;
      const step = dc !== 0 && dr !== 0 ? 1.414 : 1;
      const tent = base + step;
      if (tent < (gScore.get(nk) ?? 1e9)) {
        gScore.set(nk, tent);
        came.set(nk, ck);
        open.push({ c: nc, r: nr, f: tent + h(nc, nr) });
      }
    }
  }
  if (!found) return [from.clone(), to.clone()];
  const cells: { c: number; r: number }[] = [];
  let k = key(b.c, b.r);
  while (k !== undefined) {
    const r = Math.floor(k / g.cols);
    const c = k % g.cols;
    cells.push({ c, r });
    if (k === startK) break;
    k = came.get(k)!;
  }
  cells.reverse();
  return cells.map(({ c, r }) => {
    const { x, z } = cellCenter(g, c, r);
    const y = g.height[idx(g, c, r)];
    return new THREE.Vector3(x, y, z);
  });
}

export const FloatingIslandsDeckStage = forwardRef<FloatingIslandsDeckStageHandle, Props>(
  function FloatingIslandsDeckStage(
    { mode = "landing", selectedStation = 0, className, style },
    ref,
  ) {
    const mountRef = useRef<HTMLDivElement | null>(null);
    const apiRef = useRef<FloatingIslandsDeckStageHandle>({
      walkToStation: () => {},
      lookAtStation: () => {},
      playCinema: () => {},
    });

    useImperativeHandle(ref, () => ({
      walkToStation: (i) => apiRef.current.walkToStation(i),
      lookAtStation: (i) => apiRef.current.lookAtStation(i),
      playCinema: () => apiRef.current.playCinema(),
    }));

    useEffect(() => {
      const mount = mountRef.current;
      if (!mount) return;
      let disposed = false;
      let raf = 0;

      const renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: false,
        powerPreference: "high-performance",
      });
      renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.05;
      renderer.setClearColor(0x6eb6e8, 1);
      mount.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      scene.fog = new THREE.FogExp2(0x8ec8e8, 0.0018);

      // Camera lives *inside* sky dome — high far plane, cinema FOV
      const camera = new THREE.PerspectiveCamera(CINEMA_FOV, 1, 0.2, FAR);
      const sky = buildSkyDome();
      scene.add(sky);

      scene.add(new THREE.HemisphereLight(0xc8e4ff, 0x3a2a18, 0.75));
      const sun = new THREE.DirectionalLight(0xfff2d6, 1.55);
      sun.position.set(40, 80, 20);
      sun.castShadow = false;
      scene.add(sun);
      const fill = new THREE.DirectionalLight(0xa8c8ff, 0.45);
      fill.position.set(-30, 20, -40);
      scene.add(fill);

      const worldRoot = new THREE.Group();
      scene.add(worldRoot);

      const stationMarkers: THREE.Object3D[] = [];
      const stationWorld: THREE.Vector3[] = [];
      let deckMeshes: THREE.Mesh[] = [];
      let nav: NavGrid | null = null;
      let hero: THREE.Object3D | null = null;
      let mixer: THREE.AnimationMixer | null = null;
      const footGrounder = new FootGrounder();
      let path: THREE.Vector3[] = [];
      let pathI = 0;
      let walkTarget: THREE.Vector3 | null = null;
      let cinemaT = 0;
      let cinemaPhase: "establish" | "approach" | "deck" = "establish";
      let deckCenter = new THREE.Vector3(0, 0, 0);
      let sceneRadius = 40;
      const ray = new THREE.Raycaster();
      const _look = new THREE.Vector3();
      const _camFrom = new THREE.Vector3();
      const _camTo = new THREE.Vector3();
      const _tmp = new THREE.Vector3();

      const loader = new GLTFLoader();

      const placeStations = (center: THREE.Vector3, span: number) => {
        stationWorld.length = 0;
        for (const m of stationMarkers) worldRoot.remove(m);
        stationMarkers.length = 0;
        // 4 spots along deck — diamond layout on flat plane
        const offsets: [number, number][] = [
          [-span * 0.35, span * 0.05],
          [-span * 0.12, -span * 0.08],
          [span * 0.12, -span * 0.06],
          [span * 0.32, span * 0.04],
        ];
        for (let i = 0; i < 4; i++) {
          const [ox, oz] = offsets[i];
          const x = center.x + ox;
          const z = center.z + oz;
          let y = sampleGroundY(deckMeshes, x, z, ray, center.y + 100) ?? center.y;
          const g = new THREE.Group();
          const ring = new THREE.Mesh(
            new THREE.RingGeometry(0.45, 0.58, 40),
            new THREE.MeshBasicMaterial({
              color: i === selectedStation ? 0xfbbf24 : 0x4fc3ff,
              transparent: true,
              opacity: 0.85,
              side: THREE.DoubleSide,
              depthWrite: false,
            }),
          );
          ring.rotation.x = -Math.PI / 2;
          ring.position.y = 0.04;
          g.add(ring);
          g.position.set(x, y, z);
          g.userData.station = i;
          worldRoot.add(g);
          stationMarkers.push(g);
          stationWorld.push(new THREE.Vector3(x, y, z));
        }
      };

      const plantHeroFeet = (dt: number) => {
        if (!hero || !deckMeshes.length) return;
        hero.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(hero);
        const feetX = (box.min.x + box.max.x) * 0.5;
        const feetZ = (box.min.z + box.max.z) * 0.5;
        const gy = sampleGroundY(deckMeshes, feetX, feetZ, ray, hero.position.y + 20);
        if (gy !== null) {
          const drop = box.min.y - gy;
          hero.position.y -= drop;
        }
        if (footGrounder.isBound && footGrounder.enabled) {
          try {
            footGrounder.apply(dt);
          } catch {
            /* IK optional if bones missing */
          }
        }
      };

      void (async () => {
        try {
          const islands = await loader.loadAsync(assetUrl(ISLANDS_URL));
          if (disposed) return;
          const sceneGltf = islands.scene;
          prepMeshes(sceneGltf);
          // Fit whole pack to a manageable cinema scale
          sceneGltf.updateMatrixWorld(true);
          const box = new THREE.Box3().setFromObject(sceneGltf);
          const size = box.getSize(new THREE.Vector3());
          const center = box.getCenter(new THREE.Vector3());
          sceneGltf.position.sub(center);
          const maxDim = Math.max(size.x, size.y, size.z, 1);
          const fit = 55 / maxDim;
          sceneGltf.scale.setScalar(fit);
          sceneGltf.updateMatrixWorld(true);
          worldRoot.add(sceneGltf);

          const box2 = new THREE.Box3().setFromObject(sceneGltf);
          sceneRadius = box2.getSize(new THREE.Vector3()).length() * 0.35;
          deckMeshes = collectDeckMeshes(sceneGltf);
          // Deck center = highest dense walkable band near world origin after fit
          let bestY = -1e9;
          let sx = 0,
            sz = 0,
            n = 0;
          for (const m of deckMeshes.slice(0, 8)) {
            m.updateMatrixWorld(true);
            const b = new THREE.Box3().setFromObject(m);
            const c = b.getCenter(new THREE.Vector3());
            if (c.y > bestY - 2) {
              if (c.y > bestY) {
                bestY = c.y;
                sx = c.x;
                sz = c.z;
                n = 1;
              } else {
                sx += c.x;
                sz += c.z;
                n++;
              }
            }
          }
          if (n > 0) {
            deckCenter.set(sx / n, bestY, sz / n);
          } else {
            deckCenter.set(0, box2.max.y * 0.35, 0);
          }
          const gy = sampleGroundY(deckMeshes, deckCenter.x, deckCenter.z, ray, deckCenter.y + 50);
          if (gy !== null) deckCenter.y = gy;

          const span = Math.min(18, Math.max(6, sceneRadius * 0.22));
          placeStations(deckCenter, span);
          nav = buildDeckNav(deckMeshes, deckCenter, span * 1.4, ray);

          // Hero on deck
          try {
            const heroGltf = await loadFirst(HERO_CANDIDATES, loader);
            if (disposed) return;
            hero = heroGltf.scene;
            prepMeshes(hero);
            plantRootOnY(hero, 1.85);
            const s0 = stationWorld[0] ?? deckCenter;
            hero.position.copy(s0);
            plantHeroFeet(0);
            worldRoot.add(hero);
            if (heroGltf.animations.length) {
              mixer = new THREE.AnimationMixer(hero);
              const clip =
                heroGltf.animations.find((c) => /idle|stand|breath/i.test(c.name)) ||
                heroGltf.animations[0];
              mixer.clipAction(clip).play();
            }
            footGrounder.bind(hero);
            footGrounder.setGroundSampler((x, z) => {
              const y = sampleGroundY(deckMeshes, x, z, ray, hero!.position.y + 25);
              return {
                y: y ?? hero!.position.y,
                normal: new THREE.Vector3(0, 1, 0),
              };
            });
            footGrounder.setEnabled(true);
          } catch (e) {
            console.warn("[FloatingIslandsDeckStage] hero optional", e);
          }

          console.info(
            "[FloatingIslandsDeckStage] islands ready deckMeshes=",
            deckMeshes.length,
            "stations=",
            stationWorld.length,
            "nav cells walkable=",
            nav ? Array.from(nav.walkable).filter((v) => v).length : 0,
          );
        } catch (err) {
          console.error("[FloatingIslandsDeckStage] failed to load islands", err);
        }
      })();

      // Camera cinema controls
      const setCinemaEstablish = (t: number) => {
        const az = t * 0.12;
        const r = sceneRadius * 1.35 + 25;
        const elev = 0.42;
        camera.position.set(
          deckCenter.x + Math.cos(az) * r * Math.cos(elev),
          deckCenter.y + 18 + Math.sin(elev) * r * 0.35,
          deckCenter.z + Math.sin(az) * r * Math.cos(elev),
        );
        _look.set(deckCenter.x, deckCenter.y + 2, deckCenter.z);
        camera.lookAt(_look);
      };

      const setCinemaDeck = (t: number, station = 0) => {
        const focus = stationWorld[station] ?? deckCenter;
        const az = Math.PI * 0.65 + Math.sin(t * 0.15) * 0.12;
        const r = 9.5;
        camera.position.set(
          focus.x + Math.cos(az) * r,
          focus.y + 4.2 + Math.sin(t * 0.2) * 0.25,
          focus.z + Math.sin(az) * r,
        );
        _look.set(focus.x, focus.y + 1.2, focus.z);
        camera.lookAt(_look);
      };

      apiRef.current.playCinema = () => {
        cinemaT = 0;
        cinemaPhase = "establish";
      };
      apiRef.current.lookAtStation = (i: number) => {
        cinemaPhase = "deck";
        selectedHold = THREE.MathUtils.clamp(i, 0, 3);
      };
      let selectedHold = selectedStation;
      apiRef.current.walkToStation = (i: number) => {
        if (!hero || !nav || !stationWorld[i]) return;
        selectedHold = i;
        const from = hero.position.clone();
        const to = stationWorld[i].clone();
        path = findPath(nav, from, to);
        pathI = 0;
        walkTarget = path[0] ?? to;
        cinemaPhase = "deck";
        // Update ring colors
        stationMarkers.forEach((m, idxM) => {
          const ring = m.children[0] as THREE.Mesh;
          if (ring?.material && "color" in ring.material) {
            (ring.material as THREE.MeshBasicMaterial).color.setHex(
              idxM === i ? 0xfbbf24 : 0x4fc3ff,
            );
          }
        });
      };

      const clock = new THREE.Clock();
      const resize = () => {
        const w = mount.clientWidth || 1;
        const h = mount.clientHeight || 1;
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.fov = CINEMA_FOV;
        camera.updateProjectionMatrix();
      };
      resize();
      const ro = new ResizeObserver(resize);
      ro.observe(mount);

      // Keep sky dome centered on camera so we always film from inside it
      const tick = () => {
        if (disposed) return;
        raf = requestAnimationFrame(tick);
        const dt = Math.min(clock.getDelta(), 0.05);
        cinemaT += dt;
        // Mixer must see undropped pelvis before foot IK
        footGrounder.beginFrame();
        if (mixer) mixer.update(dt);

        // Path walk
        if (hero && walkTarget && path.length) {
          const speed = 2.4;
          _tmp.copy(walkTarget).sub(hero.position);
          _tmp.y = 0;
          const dist = _tmp.length();
          if (dist < 0.12) {
            pathI++;
            if (pathI >= path.length) {
              walkTarget = null;
              path = [];
            } else {
              walkTarget = path[pathI];
            }
          } else {
            _tmp.normalize();
            hero.position.x += _tmp.x * speed * dt;
            hero.position.z += _tmp.z * speed * dt;
            hero.rotation.y = Math.atan2(_tmp.x, _tmp.z);
          }
          plantHeroFeet(dt);
        } else if (hero) {
          plantHeroFeet(dt);
        }

        // Cinema phases
        if (mode === "landing") {
          if (cinemaPhase === "establish" && cinemaT > 5.5) cinemaPhase = "approach";
          if (cinemaPhase === "approach" && cinemaT > 9.5) cinemaPhase = "deck";
          if (cinemaPhase === "establish") {
            setCinemaEstablish(cinemaT);
          } else if (cinemaPhase === "approach") {
            const u = THREE.MathUtils.smoothstep((cinemaT - 5.5) / 4, 0, 1);
            setCinemaEstablish(cinemaT);
            _camFrom.copy(camera.position);
            setCinemaDeck(cinemaT, 0);
            _camTo.copy(camera.position);
            camera.position.lerpVectors(_camFrom, _camTo, u);
            _look.set(deckCenter.x, deckCenter.y + 1.5, deckCenter.z);
            camera.lookAt(_look);
          } else {
            setCinemaDeck(cinemaT, selectedHold);
          }
        } else {
          // deck mode — hold wide cinema on selected station
          if (cinemaPhase === "establish" && cinemaT > 3.2) cinemaPhase = "deck";
          if (cinemaPhase !== "deck") setCinemaEstablish(cinemaT);
          else setCinemaDeck(cinemaT, selectedHold);
        }

        sky.position.copy(camera.position);
        renderer.render(scene, camera);
      };
      tick();

      return () => {
        disposed = true;
        cancelAnimationFrame(raf);
        ro.disconnect();
        renderer.dispose();
        if (renderer.domElement.parentElement === mount) mount.removeChild(renderer.domElement);
        scene.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) {
            m.geometry?.dispose();
            const mats = Array.isArray(m.material) ? m.material : [m.material];
            for (const mat of mats) mat?.dispose?.();
          }
        });
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [mode]);

    // React to selected station changes (deck mode)
    useEffect(() => {
      apiRef.current.walkToStation(selectedStation);
    }, [selectedStation]);

    return (
      <div
        ref={mountRef}
        className={className}
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 0,
          pointerEvents: "none",
          ...style,
        }}
        aria-hidden
        data-stations={STATION_LABELS.join(",")}
      />
    );
  },
);
