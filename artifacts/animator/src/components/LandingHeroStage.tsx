/**
 * Cinematic 3D backdrop for the landing page:
 *   - Short-circuit AstroCreeper character (hero)
 *   - Helpers toolkit props arranged around them (from helpers.glb showcase)
 *   - Slow orbiting / crane camera that keeps the hero as focus
 *
 * Pure three.js (no R3F) — same pattern as {@link DoorsHeroStage}.
 */
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { assetUrl } from "../three/assetHost";

const HERO_URL = assetUrl("models/landing/astrocreeper.glb");
const HELPERS_URL = assetUrl("models/landing/helpers.glb");

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
 * to the whole scene if individual tools can't be identified.
 */
function extractHelperProps(helpersRoot: THREE.Object3D): THREE.Object3D[] {
  const want = [
    "Pickaxe",
    "Hammer_Circle027",
    "Knife",
    "Shovel_1",
    "Bucket",
    "FirstAidKit_Hard",
    "FishingRod_Lvl2",
    "Lure_2",
  ];
  const found: THREE.Object3D[] = [];
  for (const name of want) {
    const n = helpersRoot.getObjectByName(name);
    if (n) found.push(n.clone(true));
  }
  if (found.length >= 3) return found;
  // Fallback: use the whole helpers pack as one decorative cluster.
  return [helpersRoot.clone(true)];
}

export function LandingHeroStage() {
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
    renderer.toneMappingExposure = 1.2;

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x050a14, 0.035);

    const camera = new THREE.PerspectiveCamera(40, 1, 0.05, 120);
    camera.position.set(4.5, 2.4, 5.5);

    // Cool studio lights — readable skin + gold rim for brand fit
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

    // Soft ground disc under the hero
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
    const loadGltf = (url: string) =>
      new Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[] }>((resolve, reject) => {
        loader.load(
          url,
          (gltf) => resolve({ scene: gltf.scene, animations: gltf.animations ?? [] }),
          undefined,
          (err) => reject(err),
        );
      });

    void (async () => {
      try {
        const [heroGltf, helpersGltf] = await Promise.all([
          loadGltf(HERO_URL),
          loadGltf(HELPERS_URL),
        ]);
        if (disposed) return;

        const hero = heroGltf.scene;
        prepMeshes(hero);
        plantOnGround(hero, 1.85);
        hero.rotation.y = Math.PI; // face default camera start
        root.add(hero);
        heroRoot = hero;
        heroBaseY = hero.position.y;
        focus.set(0, 1.05, 0);
        orbitR = 4.6;

        // Helpers toolkit — ring of props around the character (showcase style)
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
          // Slight outward lean so tools read as set dressing
          prop.rotation.z = Math.sin(i * 1.7) * 0.08;
          root.add(prop);
          propRoots.push(prop);
        });

        if (heroGltf.animations?.length) {
          mixer = new THREE.AnimationMixer(hero);
          // Prefer idle; otherwise use the first clip (this pack ships "dissection")
          const clip =
            heroGltf.animations.find((c) => /idle|stand|breath|loop/i.test(c.name)) ||
            heroGltf.animations[0];
          const action = mixer.clipAction(clip);
          action.setLoop(THREE.LoopRepeat, Infinity);
          action.clampWhenFinished = false;
          action.play();
        }
      } catch (err) {
        console.error("[LandingHeroStage] failed to load models", err);
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

    const animate = () => {
      if (disposed) return;
      raf = requestAnimationFrame(animate);
      const t = clock.getElapsedTime();
      const dt = clock.getDelta();

      mixer?.update(dt);

      // Gentle hero hover + slow turn so the skin reads from all sides
      if (heroRoot) {
        heroRoot.position.y = heroBaseY + Math.sin(t * 1.1) * 0.04;
        heroRoot.rotation.y = Math.PI + t * 0.12;
      }

      // Props idle bob, offset per item
      propRoots.forEach((p, i) => {
        p.position.y = Math.sin(t * 1.3 + i * 0.9) * 0.03;
        p.rotation.y += dt * 0.15 * (i % 2 === 0 ? 1 : -1);
      });

      // Multi-layer camera path around the character
      const orbit = t * 0.22;
      const crane = 1.55 + Math.sin(t * 0.28) * 0.55 + Math.sin(t * 0.09) * 0.25;
      const radius = orbitR * (1.05 + Math.sin(t * 0.17) * 0.1 + Math.sin(t * 0.5) * 0.03);
      const bob = Math.sin(t * 0.85) * 0.12;

      camera.position.set(
        Math.cos(orbit) * radius,
        crane + bob,
        Math.sin(orbit) * radius,
      );

      const look = focus.clone();
      look.x += Math.sin(t * 0.3) * 0.2;
      look.y += Math.sin(t * 0.4) * 0.12;
      camera.lookAt(look);

      camera.fov = 38 + Math.sin(t * 0.18) * 1.8;
      camera.updateProjectionMatrix();

      root.rotation.y = Math.sin(t * 0.04) * 0.05;

      (ground.material as THREE.MeshBasicMaterial).opacity = 0.07 + Math.sin(t * 1.0) * 0.03;
      ground.scale.setScalar(1 + Math.sin(t * 0.55) * 0.03);

      renderer.render(scene, camera);
    };
    animate();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      mixer?.stopAllAction();
      renderer.dispose();
      scene.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry) m.geometry.dispose();
        if (m.material) {
          const mats = Array.isArray(m.material) ? m.material : [m.material];
          for (const mat of mats) mat.dispose();
        }
      });
    };
  }, []);

  return <canvas ref={canvasRef} className="landing-hero-stage" aria-hidden />;
}
