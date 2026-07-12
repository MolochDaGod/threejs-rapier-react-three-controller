import * as THREE from "three";

/**
 * A tiny in-world, camera-facing health bar — the same readout the training
 * dummies get, but rendered as a billboard above a non-Targets object (the
 * post-mounted punching bags). A dark backing plate with a left-anchored fill
 * that shrinks and shifts green → red as health drops. Cheap: two unlit planes,
 * billboarded to the camera each frame.
 *
 * Renderer-agnostic intent: only the visual lives here; callers own the health
 * value and feed it via {@link setRatio}, so this drops cleanly into any host.
 */
export class HealthBar {
  group = new THREE.Group();
  private fill: THREE.Mesh;
  private bg: THREE.Mesh;
  private fillMat: THREE.MeshBasicMaterial;
  private bgMat: THREE.MeshBasicMaterial;
  private geos: THREE.BufferGeometry[] = [];
  private readonly width: number;
  private readonly green = new THREE.Color(0x46e08a);
  private readonly red = new THREE.Color(0xff4d57);
  private readonly tmp = new THREE.Color();

  constructor(width = 1.1, height = 0.13) {
    this.width = width;
    const pad = 0.03;
    const bgGeo = new THREE.PlaneGeometry(width + pad * 2, height + pad * 2);
    // Fill geometry is left-anchored (origin at its left edge) so scaling X
    // shrinks it from the right, like a real depleting bar.
    const fillGeo = new THREE.PlaneGeometry(1, height).translate(0.5, 0, 0);
    this.geos.push(bgGeo, fillGeo);

    this.bgMat = new THREE.MeshBasicMaterial({ color: 0x0a0d14, transparent: true, opacity: 0.85, depthTest: false });
    this.fillMat = new THREE.MeshBasicMaterial({ color: this.green.getHex(), depthTest: false });

    this.bg = new THREE.Mesh(bgGeo, this.bgMat);
    this.bg.renderOrder = 998;
    this.fill = new THREE.Mesh(fillGeo, this.fillMat);
    this.fill.position.set(-width / 2, 0, 0.001);
    this.fill.scale.x = width;
    this.fill.renderOrder = 999;

    this.group.add(this.bg, this.fill);
    this.group.renderOrder = 998;
  }

  /** Set the health fraction (0..1): resizes + recolours the fill. */
  setRatio(ratio: number): void {
    const r = THREE.MathUtils.clamp(ratio, 0, 1);
    this.fill.scale.x = Math.max(1e-4, this.width * r);
    this.tmp.copy(this.red).lerp(this.green, r);
    this.fillMat.color.copy(this.tmp);
  }

  /** Place the bar in world space and turn it to face the camera. */
  place(pos: THREE.Vector3, camera: THREE.Camera): void {
    this.group.position.copy(pos);
    this.group.quaternion.copy(camera.quaternion);
  }

  setVisible(v: boolean): void {
    this.group.visible = v;
  }

  dispose(): void {
    for (const g of this.geos) g.dispose();
    this.bgMat.dispose();
    this.fillMat.dispose();
    this.group.clear();
    this.group.parent?.remove(this.group);
  }
}
