/**
 * Cinematic 3D backdrop for the doors hall.
 * Multi-candidate GLB load — introgamer / instarena often 404 on Vercel until
 * redeployed; fall back to live models (racalvin, dungeon, karate-boss).
 */
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { assetUrl } from "../three/assetHost";

const ARENA_CANDIDATES = [
  "models/instarena-phyxt-fight.glb",
  "models/dungeon.glb",
  "models/dj-booth.glb",
];
const HERO_CANDIDATES = [
  "models/introgamer.glb",
  "models/astrocreeper.glb",
  "models/landing/astrocreeper.glb",
  "models/racalvin.glb",
  "models/karate-boss.glb",
  "models/orc.glb",
];

function fitOnTop(
  arena: THREE.Object3D,
  hero: THREE.Object3D,
  targetHeroHeight = 1.85,
): { arenaRadius: number; focus: THREE.Vector3 } {
  arena.updateMatrixWorld(true);
  const arenaBox = new THREE.Box3().setFromObject(arena);
  const arenaSize = arenaBox.getSize(new THREE.Vector3());

  const arenaMax = Math.max(arenaSize.x, arenaSize.z, 0.001);
  const arenaScale = 12 / arenaMax;
  arena.scale.setScalar(arenaScale);
  arena.updateMatrixWorld(true);
  const ab2 = new THREE.Box3().setFromObject(arena);
  arena.position.x -= (ab2.min.x + ab2.max.x) / 2;
  arena.position.z -= (ab2.min.z + ab2.max.z) / 2;
  arena.position.y -= ab2.min.y;
  arena.updateMatrixWorld(true);

  hero.updateMatrixWorld(true);
  const heroBox = new THREE.Box3().setFromObject(hero);
  const heroSize = heroBox.getSize(new THREE.Vector3());
  const hScale = targetHeroHeight / Math.max(heroSize.y, 0.001);
  hero.scale.setScalar(hScale);
  hero.updateMatrixWorld(true);
  const hb2 = new THREE.Box3().setFromObject(hero);
  const arenaTop = new THREE.Box3().setFromObject(arena).max.y;
  hero.position.set(0, arenaTop - hb2.min.y, 0);
  hero.rotation.y = Math.PI;

  const finalArena = new THREE.Box3().setFromObject(arena);
  const radius =
    Math.max(
      finalArena.getSize(new THREE.Vector3()).x,
      finalArena.getSize(new THREE.Vector3()).z,
    ) * 0.55;

  const focus = new THREE.Vector3(0, arenaTop + targetHeroHeight * 0.55, 0);
  return { arenaRadius: radius, focus };
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
      return { scene: gltf.scene, animations: gltf.animations ?? [], url };
    } catch (err) {
      last = err;
    }
  }
  throw last ?? new Error(`Failed to load: ${paths.join(", ")}`);
}

function buildFallbackArena(): THREE.Group {
  const g = new THREE.Group();
  const floor = new THREE.Mesh(
    new THREE.CylinderGeometry(6, 6.2, 0.35, 32),
    new THREE.MeshStandardMaterial({ color: 0x1a2740, metalness: 0.3, roughness: 0.7 }),
  );
  floor.receiveShadow = true;
  g.add(floor);
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(5.5, 0.08, 8, 48),
    new THREE.MeshStandardMaterial({ color: 0x4fc3ff, emissive: 0x0a3050, emissiveIntensity: 0.4 }),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.2;
  g.add(ring);
  return g;
}

function buildFallbackHero(): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.32, 0.85, 6, 12),
    new THREE.MeshStandardMaterial({ color: 0xe8c877, roughness: 0.55, metalness: 0.2 }),
  );
  body.position.y = 1.0;
  body.castShadow = true;
  g.add(body);
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.28, 16, 12),
    new THREE.MeshStandardMaterial({ color: 0xc98c5a, roughness: 0.5 }),
  );
  head.position.y = 1.75;
  head.castShadow = true;
  g.add(head);
  return g;
}

export function DoorsHeroStage() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let disposed = false;
    let raf = 0;
    const clock = new THREE.Clock();

    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: "high-performance",
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x050a14, 0.028);

    const camera = new THREE.PerspectiveCamera(42, 1, 0.05, 200);
    camera.position.set(8, 5, 10);

    scene.add(new THREE.HemisphereLight(0x9ec9ff, 0x1a1020, 0.55));
    const key = new THREE.DirectionalLight(0xffe6c8, 1.35);
    key.position.set(6, 12, 4);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x4fc3ff, 0.85);
    rim.position.set(-8, 6, -6);
    scene.add(rim);
    const fill = new THREE.PointLight(0xff5577, 0.55, 40);
    fill.position.set(0, 3, 2);
    scene.add(fill);

    const groundGlow = new THREE.Mesh(
      new THREE.CircleGeometry(14, 64),
      new THREE.MeshBasicMaterial({
        color: 0x1a6cff,
        transparent: true,
        opacity: 0.12,
        depthWrite: false,
      }),
    );
    groundGlow.rotation.x = -Math.PI / 2;
    groundGlow.position.y = 0.02;
    scene.add(groundGlow);

    const root = new THREE.Group();
    scene.add(root);

    let focus = new THREE.Vector3(0, 1.2, 0);
    let orbitR = 9;
    let heroRoot: THREE.Object3D | null = null;
    let heroBaseY = 0;
    let mixer: THREE.AnimationMixer | null = null;

    const loader = new GLTFLoader();

    void (async () => {
      try {
        let arena: THREE.Object3D;
        let hero: THREE.Object3D;
        let anims: THREE.AnimationClip[] = [];

        try {
          const arenaGltf = await loadGltfFirst(ARENA_CANDIDATES, loader);
          if (disposed) return;
          console.info("[DoorsHeroStage] arena from", arenaGltf.url);
          arena = arenaGltf.scene;
        } catch (err) {
          console.warn("[DoorsHeroStage] arena GLB failed — procedural stage", err);
          arena = buildFallbackArena();
        }

        try {
          const heroGltf = await loadGltfFirst(HERO_CANDIDATES, loader);
          if (disposed) return;
          console.info("[DoorsHeroStage] hero from", heroGltf.url);
          hero = heroGltf.scene;
          anims = heroGltf.animations;
        } catch (err) {
          console.warn("[DoorsHeroStage] hero GLB failed — procedural hero", err);
          hero = buildFallbackHero();
        }
        if (disposed) return;

        arena.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) {
            m.castShadow = false;
            m.receiveShadow = true;
            if (m.material) {
              const mats = Array.isArray(m.material) ? m.material : [m.material];
              for (const mat of mats) {
                if ("emissive" in mat && mat.emissive) {
                  (mat as THREE.MeshStandardMaterial).emissive = new THREE.Color(0x0a1a33);
                  (mat as THREE.MeshStandardMaterial).emissiveIntensity = 0.15;
                }
              }
            }
          }
        });

        hero.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) {
            m.castShadow = true;
            m.receiveShadow = true;
          }
        });

        root.add(arena);
        root.add(hero);
        heroRoot = hero;

        const fit = fitOnTop(arena, hero, 1.9);
        focus.copy(fit.focus);
        orbitR = Math.max(6.5, fit.arenaRadius * 1.35);
        heroBaseY = hero.position.y;

        if (anims.length) {
          mixer = new THREE.AnimationMixer(hero);
          const clip =
            anims.find((c) => /idle|stand|breath/i.test(c.name)) || anims[0];
          mixer.clipAction(clip).play();
        }
      } catch (err) {
        console.error("[DoorsHeroStage] failed to load models", err);
      }
    })();

    const resize = () => {
      const w = canvas.clientWidth || window.innerWidth;
      const h = canvas.clientHeight || window.innerHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / Math.max(h, 1);
      camera.updateProjectionMatrix();
    };
    resize();
    window.addEventListener("resize", resize);

    const tick = () => {
      if (disposed) return;
      raf = requestAnimationFrame(tick);
      const t = clock.getElapsedTime();
      const dt = clock.getDelta();
      if (mixer) mixer.update(dt);
      if (heroRoot) {
        heroRoot.position.y = heroBaseY + Math.sin(t * 1.15) * 0.05;
      }
      const az = t * 0.12;
      const elev = 0.42 + Math.sin(t * 0.2) * 0.06;
      camera.position.set(
        Math.cos(az) * orbitR * Math.cos(elev),
        focus.y + Math.sin(elev) * orbitR * 0.45,
        Math.sin(az) * orbitR * Math.cos(elev),
      );
      camera.lookAt(focus);
      renderer.render(scene, camera);
    };
    tick();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      renderer.dispose();
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
    <canvas
      ref={canvasRef}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        zIndex: 0,
      }}
      aria-hidden
    />
  );
}
