/**
 * Cinematic 3D backdrop for the doors hall:
 *   - Phyxt fight arena map (floor)
 *   - Intro gamer character standing on top
 *   - Hovering / orbiting / crane camera motion
 *
 * Pure three.js (matches Animator policy: no R3F in engine paths).
 */
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { assetUrl } from "../three/assetHost";

const ARENA_URL = assetUrl("models/instarena-phyxt-fight.glb");
const HERO_URL = assetUrl("models/introgamer.glb");

function fitOnTop(
  arena: THREE.Object3D,
  hero: THREE.Object3D,
  targetHeroHeight = 1.85,
): { arenaRadius: number; focus: THREE.Vector3 } {
  arena.updateMatrixWorld(true);
  const arenaBox = new THREE.Box3().setFromObject(arena);
  const arenaSize = arenaBox.getSize(new THREE.Vector3());
  const arenaCenter = arenaBox.getCenter(new THREE.Vector3());

  // Normalize arena: center XZ, sit bottom on y=0, keep reasonable scale
  const arenaMax = Math.max(arenaSize.x, arenaSize.z, 0.001);
  const arenaScale = 12 / arenaMax; // ~12m wide stage
  arena.scale.setScalar(arenaScale);
  arena.updateMatrixWorld(true);
  const ab2 = new THREE.Box3().setFromObject(arena);
  arena.position.x -= (ab2.min.x + ab2.max.x) / 2;
  arena.position.z -= (ab2.min.z + ab2.max.z) / 2;
  arena.position.y -= ab2.min.y;
  arena.updateMatrixWorld(true);

  // Hero: height-normalize, feet on arena top
  hero.updateMatrixWorld(true);
  const heroBox = new THREE.Box3().setFromObject(hero);
  const heroSize = heroBox.getSize(new THREE.Vector3());
  const hScale = targetHeroHeight / Math.max(heroSize.y, 0.001);
  hero.scale.setScalar(hScale);
  hero.updateMatrixWorld(true);
  const hb2 = new THREE.Box3().setFromObject(hero);
  const arenaTop = new THREE.Box3().setFromObject(arena).max.y;
  hero.position.set(0, arenaTop - hb2.min.y, 0);
  // Face camera-ish default forward
  hero.rotation.y = Math.PI;

  const finalArena = new THREE.Box3().setFromObject(arena);
  const radius = Math.max(
    finalArena.getSize(new THREE.Vector3()).x,
    finalArena.getSize(new THREE.Vector3()).z,
  ) * 0.55;

  const focus = new THREE.Vector3(
    0,
    arenaTop + targetHeroHeight * 0.55,
    0,
  );
  return { arenaRadius: radius, focus };
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

    // Lights — dramatic rim + cool key for "awesome" combat vibe
    const hemi = new THREE.HemisphereLight(0x9ec9ff, 0x1a1020, 0.55);
    scene.add(hemi);
    const key = new THREE.DirectionalLight(0xffe6c8, 1.35);
    key.position.set(6, 12, 4);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x4fc3ff, 0.85);
    rim.position.set(-8, 6, -6);
    scene.add(rim);
    const fill = new THREE.PointLight(0xff5577, 0.55, 40);
    fill.position.set(0, 3, 2);
    scene.add(fill);

    // Soft ground glow under the stage
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
        const [arenaGltf, heroGltf] = await Promise.all([
          loadGltf(ARENA_URL),
          loadGltf(HERO_URL),
        ]);
        if (disposed) return;

        const arena = arenaGltf.scene;
        arena.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) {
            m.castShadow = false;
            m.receiveShadow = true;
            if (m.material) {
              const mats = Array.isArray(m.material) ? m.material : [m.material];
              for (const mat of mats) {
                // Slight emissive punch so arena pops under fog
                if ("emissive" in mat && mat.emissive) {
                  (mat as THREE.MeshStandardMaterial).emissive = new THREE.Color(0x0a1a33);
                  (mat as THREE.MeshStandardMaterial).emissiveIntensity = 0.15;
                }
              }
            }
          }
        });

        const hero = heroGltf.scene;
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

        if (heroGltf.animations?.length) {
          mixer = new THREE.AnimationMixer(hero);
          // Prefer idle-like clip, else first
          const clip =
            heroGltf.animations.find((c) => /idle|stand|breath/i.test(c.name)) ||
            heroGltf.animations[0];
          const action = mixer.clipAction(clip);
          action.play();
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

    // Cinematic camera: slow orbit + crane + hover + subtle FOV breathe
    const animate = () => {
      if (disposed) return;
      raf = requestAnimationFrame(animate);
      const t = clock.getElapsedTime();
      const dt = clock.getDelta();

      mixer?.update(dt);

      // Hero hover / idle sway (absolute offsets — no accumulation)
      if (heroRoot) {
        heroRoot.position.y = heroBaseY + Math.sin(t * 1.35) * 0.07;
        heroRoot.rotation.y = Math.PI + Math.sin(t * 0.35) * 0.12;
      }

      // Multi-layer camera path
      const orbit = t * 0.18;
      const crane = 2.4 + Math.sin(t * 0.22) * 1.1 + Math.sin(t * 0.07) * 0.5;
      const radius = orbitR * (1.0 + Math.sin(t * 0.15) * 0.12 + Math.sin(t * 0.41) * 0.04);
      const bob = Math.sin(t * 0.9) * 0.18;

      camera.position.set(
        Math.cos(orbit) * radius,
        crane + bob,
        Math.sin(orbit) * radius,
      );

      // Look target drifts slightly for drama
      const look = focus.clone();
      look.x += Math.sin(t * 0.25) * 0.35;
      look.y += Math.sin(t * 0.33) * 0.2;
      camera.lookAt(look);

      // FOV breathe
      camera.fov = 40 + Math.sin(t * 0.2) * 2.2;
      camera.updateProjectionMatrix();

      // Subtle stage spin opposite camera for depth
      root.rotation.y = Math.sin(t * 0.05) * 0.08;

      // Ground pulse
      groundGlow.material.opacity = 0.08 + Math.sin(t * 1.1) * 0.04;
      groundGlow.scale.setScalar(1 + Math.sin(t * 0.6) * 0.04);

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

  return (
    <canvas
      ref={canvasRef}
      className="doors-hero-stage"
      aria-hidden
    />
  );
}
