/**
 * Cinematic 3D backdrop for the landing page:
 *   - Short-circuit AstroCreeper character (hero) with fleet fallbacks
 *   - Helpers toolkit props arranged around them
 *   - Slow orbiting / crane camera that keeps the hero as focus
 *
 * Pure three.js (no R3F) — same pattern as {@link DoorsHeroStage}.
 */
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { assetUrl } from "../three/assetHost";

/** Prefer landing pack; fall back to live-proven root models (deployed on Vercel). */
const HERO_CANDIDATES = [
  "models/landing/astrocreeper.glb",
  "models/astrocreeper.glb",
  "models/racalvin.glb",
  "models/karate-boss.glb",
  "models/orc.glb",
];
const HELPERS_CANDIDATES = [
  "models/landing/helpers.glb",
  "models/landing-helpers.glb",
  "models/dj-booth.glb",
];

/** Height-normalize a model and plant feet on y=0; returns world height. */
function plantOnGround(obj: THREE.Object3D, targetHeight: number): number {
  obj.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(obj);
  const size = box.getSize(new THREE.Vector3());
  const s = targetHeight / Math.max(size.y, 0.001);
  obj.scale.setScalar(s);
  obj.updateMatrixWorld(true);
  const box2 = new THREE.Box3().setFromObject(obj);
  obj.position.y -= box2.min.y;
  return targetHeight;
}

/** Enable shadows / double-sided where helpful for Minecraft-style meshes. */
function prepMeshes(root: THREE.Object3D, cast = true): void {
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.castShadow = cast;
    m.receiveShadow = true;
    m.frustumCulled = false;
    const mats = Array.isArray(m.material) ? m.material : m.material ? [m.material] : [];
    for (const mat of mats) {
      if (!mat) continue;
      mat.side = THREE.DoubleSide;
      if ("map" in mat && mat.map) {
        mat.map.colorSpace = THREE.SRGBColorSpace;
      }
    }
  });
}

/**
 * Pull named tool subtrees out of helpers.glb for a ring of props. Falls back
 * to cloning the whole root if no named tools are found.
 */
function extractHelperProps(root: THREE.Object3D): THREE.Object3D[] {
  const named: THREE.Object3D[] = [];
  root.traverse((o) => {
    if (o === root) return;
    if (!o.name) return;
    if (/tool|prop|kit|wrench|hammer|sword|shield|box|crate/i.test(o.name) && o.children.length > 0) {
      named.push(o);
    }
  });
  if (named.length >= 3) {
    return named.slice(0, 8).map((o) => o.clone(true));
  }
  // Whole-pack clone ring
  return [0, 1, 2, 3, 4, 5].map(() => root.clone(true));
}

async function loadGltfFirst(
  paths: string[],
  loader: GLTFLoader,
): Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[]; url: string }> {
  let last: unknown;
  for (const p of paths) {
    const url = assetUrl(p);
    try {
      const gltf = await loader.loadAsync(url);
      return {
        scene: gltf.scene,
        animations: gltf.animations ?? [],
        url,
      };
    } catch (err) {
      last = err;
    }
  }
  throw last ?? new Error(`Failed to load: ${paths.join(", ")}`);
}

/** Procedural placeholder if every CDN candidate 404s. */
function buildFallbackHero(): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.32, 0.85, 6, 12),
    new THREE.MeshStandardMaterial({ color: 0x4fc3ff, roughness: 0.55, metalness: 0.15 }),
  );
  body.position.y = 1.0;
  body.castShadow = true;
  g.add(body);
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.28, 16, 12),
    new THREE.MeshStandardMaterial({ color: 0xe8c877, roughness: 0.5 }),
  );
  head.position.y = 1.75;
  head.castShadow = true;
  g.add(head);
  return g;
}

export function LandingHeroStage() {
  const mountRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    let disposed = false;
    let raf = 0;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 120);
    camera.position.set(4.5, 2.4, 5.5);

    scene.add(new THREE.HemisphereLight(0xb8d4ff, 0x1a1420, 0.65));
    const key = new THREE.DirectionalLight(0xfff0dd, 1.45);
    key.position.set(5, 10, 6);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x4fc3ff, 0.95);
    rim.position.set(-7, 5, -5);
    scene.add(rim);
    const gold = new THREE.PointLight(0xe8c877, 0.55, 28);
    gold.position.set(0, 2.2, 1.5);
    scene.add(gold);

    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(8, 64),
      new THREE.MeshBasicMaterial({
        color: 0x1a6cff,
        transparent: true,
        opacity: 0.1,
        depthWrite: false,
      }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = 0.01;
    scene.add(ground);

    const root = new THREE.Group();
    scene.add(root);

    let focus = new THREE.Vector3(0, 1.0, 0);
    let orbitR = 4.8;
    let heroRoot: THREE.Object3D | null = null;
    let heroBaseY = 0;
    let mixer: THREE.AnimationMixer | null = null;
    const propRoots: THREE.Object3D[] = [];

    const loader = new GLTFLoader();

    void (async () => {
      try {
        let hero: THREE.Object3D;
        let anims: THREE.AnimationClip[] = [];
        try {
          const heroGltf = await loadGltfFirst(HERO_CANDIDATES, loader);
          if (disposed) return;
          console.info("[LandingHeroStage] hero from", heroGltf.url);
          hero = heroGltf.scene;
          anims = heroGltf.animations;
        } catch (err) {
          console.warn("[LandingHeroStage] all hero GLBs failed — procedural fallback", err);
          hero = buildFallbackHero();
        }
        if (disposed) return;

        prepMeshes(hero);
        plantOnGround(hero, 1.85);
        hero.rotation.y = Math.PI;
        root.add(hero);
        heroRoot = hero;
        heroBaseY = hero.position.y;
        focus.set(0, 1.05, 0);
        orbitR = 4.6;

        try {
          const helpersGltf = await loadGltfFirst(HELPERS_CANDIDATES, loader);
          if (disposed) return;
          console.info("[LandingHeroStage] helpers from", helpersGltf.url);
          const props = extractHelperProps(helpersGltf.scene);
          const n = Math.max(props.length, 1);
          props.forEach((prop, i) => {
            prepMeshes(prop, false);
            plantOnGround(prop, 0.55 + (i % 3) * 0.12);
            const angle = (i / n) * Math.PI * 2 + 0.35;
            const r = 1.55 + (i % 2) * 0.35;
            prop.position.x = Math.cos(angle) * r;
            prop.position.z = Math.sin(angle) * r;
            prop.rotation.y = -angle + Math.PI * 0.5;
            prop.rotation.z = Math.sin(i * 1.7) * 0.08;
            root.add(prop);
            propRoots.push(prop);
          });
        } catch {
          /* props optional */
        }

        if (anims.length) {
          mixer = new THREE.AnimationMixer(hero);
          const clip =
            anims.find((c) => /idle|stand|breath|loop/i.test(c.name)) || anims[0];
          const action = mixer.clipAction(clip);
          action.setLoop(THREE.LoopRepeat, Infinity);
          action.clampWhenFinished = false;
          action.play();
        }
      } catch (err) {
        console.error("[LandingHeroStage] failed to load models", err);
      }
    })();

    const clock = new THREE.Clock();
    const resize = () => {
      const w = mount.clientWidth || 1;
      const h = mount.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(mount);

    const tick = () => {
      if (disposed) return;
      raf = requestAnimationFrame(tick);
      const t = clock.getElapsedTime();
      const dt = clock.getDelta();
      if (mixer) mixer.update(dt);
      if (heroRoot) {
        heroRoot.position.y = heroBaseY + Math.sin(t * 1.1) * 0.04;
      }
      propRoots.forEach((p, i) => {
        p.rotation.y += dt * (0.15 + (i % 3) * 0.05);
      });
      const az = t * 0.18;
      const elev = 0.35 + Math.sin(t * 0.22) * 0.08;
      camera.position.set(
        Math.cos(az) * orbitR * Math.cos(elev),
        focus.y + Math.sin(elev) * orbitR * 0.55 + 0.4,
        Math.sin(az) * orbitR * Math.cos(elev),
      );
      camera.lookAt(focus);
      renderer.render(scene, camera);
    };
    tick();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.dispose();
      mount.removeChild(renderer.domElement);
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.geometry?.dispose();
          const mats = Array.isArray(m.material) ? m.material : [m.material];
          for (const mat of mats) mat?.dispose?.();
        }
      });
    };
  }, []);

  return (
    <div
      ref={mountRef}
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        zIndex: 0,
      }}
      aria-hidden
    />
  );
}
