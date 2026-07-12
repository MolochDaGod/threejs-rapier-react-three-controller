import * as THREE from "three";
import {
  ROOM_PRESETS,
  type PropSpec,
  type RoomPreset,
  type RoomPresetId,
} from "./RoomPresets";
import type { ObstacleCircle } from "./types";

/**
 * The Danger Room training chamber. Originally a single fixed X-Men holographic
 * room, it is now **data-driven**: the look (floor, walls, grid, pillars,
 * lighting mood and decorative props) comes entirely from a {@link RoomPreset},
 * and {@link setPreset} tears the room down and rebuilds it from a different
 * preset on the fly.
 *
 * The structural shell — enclosing walls with the dungeon door + the recessed DJ
 * alcove window, the ceiling and the corner pillars — is built for EVERY preset
 * at the same fixed coordinates, so {@link doorPos}/{@link nearDoor} and the DJ
 * booth anchor stay valid no matter which environment is chosen. Presets only
 * re-skin materials/colours, change the lighting accents and place their own
 * props. Pure geometry, fully disposable.
 */
export class DangerRoom {
  group = new THREE.Group();
  readonly half = 16; // room is 32x32
  readonly height = 18; // wall/ceiling height (raised ~10m for headroom)
  private geos: THREE.BufferGeometry[] = [];
  private mats: THREE.Material[] = [];
  private grid!: THREE.GridHelper;
  /** Caller-requested grid visibility; gated by the preset's grid opacity. */
  private gridWanted = true;
  /** Extra push-out collision circles from collidable preset props. Circles
   *  with a finite `top` are landable — the player can stand on that surface. */
  private propObstacles: ObstacleCircle[] = [];
  /** World position of the dungeon entrance portal (centre of the arch, floor). */
  readonly doorPos = new THREE.Vector3(0, 0, this.half - 0.2);
  private doorGlow: THREE.MeshBasicMaterial[] = [];

  // --- DJ alcove (a lit cut-out above the door for the resident DJ) ---
  /** Window opening half-width in the +Z wall above the door. */
  private readonly djWinHalfW = 4.6;
  /** Window opening bottom / top in the +Z wall (above the 4.2m door lintel). */
  private readonly djWinBottom = 4.9;
  private readonly djWinTop = 11.5;
  /** Floor height of the recessed booth platform (flush with the window sill). */
  private readonly djFloorY = 4.9;
  /** How far the alcove is recessed behind the +Z wall plane. Deep enough that the
   *  scaled booth + DJ nest fully inside the crook instead of poking out. */
  private readonly djDepth = 4.6;
  /**
   * World anchor where the DJ stands on the alcove platform, facing -Z into the
   * room. {@link DjBooth} places the booth + character relative to this.
   */
  readonly djBoothAnchor = new THREE.Vector3(0, this.djFloorY, this.half + this.djDepth * 0.62);
  /** Pulsing club lights/emissives in the alcove (animated in {@link update}). */
  private djGlow: { mat: THREE.MeshBasicMaterial; base: number; speed: number; phase: number }[] = [];
  private djLights: { light: THREE.PointLight; base: number; speed: number; phase: number }[] = [];
  /** Animated GLSL "light show" shader painted directly on the alcove back wall
   *  (the wall Racalvin stands against), driven by the live music energy. */
  private djShowMat: THREE.ShaderMaterial | null = null;
  private djShowMesh: THREE.Mesh | null = null;
  private djShowTime = 0;
  private djShowEnabled = true;
  /** Speaker woofer cones + glow rings flanking the booth that "boom" on the beat. */
  private djSpeakers: {
    cone: THREE.Mesh;
    glow: THREE.MeshBasicMaterial;
    ring: THREE.Mesh;
    ringMat: THREE.MeshBasicMaterial;
    phase: number;
  }[] = [];
  /** Last update timestamp, for deriving dt (the loop passes absolute time). */
  private lastUpdateT = 0;
  /** When true, only the floor + grid are built (no enclosing walls/ceiling). */
  private readonly open: boolean;
  /** The active environment preset. */
  private preset: RoomPreset;

  constructor(opts: { open?: boolean; preset?: RoomPresetId } = {}) {
    this.open = !!opts.open;
    this.preset = ROOM_PRESETS[opts.preset ?? "holo"];
    this.build();
  }

  /** The id of the currently-built environment preset. */
  get presetId(): RoomPresetId {
    return this.preset.id;
  }

  /**
   * Swap to a different environment preset: dispose the current geometry and
   * rebuild from `id`. The door, DJ alcove anchor and combat coordinates are
   * preset-independent, so the dungeon portal, DJ booth and fighting all keep
   * working across the swap. No-op when the preset is already active.
   */
  setPreset(id: RoomPresetId) {
    if (id === this.preset.id) return;
    this.clearBuilt();
    this.preset = ROOM_PRESETS[id];
    this.build();
  }

  private track<T extends THREE.BufferGeometry>(g: T): T {
    this.geos.push(g);
    return g;
  }
  private trackMat<T extends THREE.Material>(m: T): T {
    this.mats.push(m);
    return m;
  }

  /** Build the whole room from the active preset. */
  private build() {
    this.buildFloor();
    this.grid = this.buildGrid();
    this.applyGridVisible();
    if (!this.open) {
      this.buildWalls();
      this.buildPillars();
      this.buildDoor();
      this.buildDjAlcove();
      this.buildAccentLights();
      this.buildProps();
    }
  }

  private buildFloor() {
    const p = this.preset;
    const geo = this.track(new THREE.PlaneGeometry(this.half * 2, this.half * 2));
    const mat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: p.floorColor,
        metalness: p.floorMetalness,
        roughness: p.floorRoughness,
      }),
    );
    const floor = new THREE.Mesh(geo, mat);
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.group.add(floor);

    // Emissive hologrid tiles slightly above the floor (preset-gated).
    if (p.showTiles) {
      const tileGeo = this.track(new THREE.PlaneGeometry(this.half * 2, this.half * 2, 16, 16));
      const tileMat = this.trackMat(
        new THREE.MeshBasicMaterial({ color: p.tileColor, wireframe: true, transparent: true, opacity: 0.35 }),
      );
      const tiles = new THREE.Mesh(tileGeo, tileMat);
      tiles.rotation.x = -Math.PI / 2;
      tiles.position.y = 0.02;
      this.group.add(tiles);
    }
  }

  private buildGrid(): THREE.GridHelper {
    const p = this.preset;
    const grid = new THREE.GridHelper(this.half * 2, 32, p.gridColor1, p.gridColor2);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = p.gridOpacity > 0 ? p.gridOpacity : 0.5;
    grid.position.y = 0.03;
    this.group.add(grid);
    return grid;
  }

  private buildWalls() {
    const p = this.preset;
    const h = this.height;
    const wallMat = this.trackMat(
      new THREE.MeshStandardMaterial({ color: p.wallColor, metalness: 0.6, roughness: 0.5, side: THREE.DoubleSide }),
    );
    const seamMat = p.showSeams
      ? this.trackMat(new THREE.MeshBasicMaterial({ color: p.seamColor, transparent: true, opacity: 0.8 }))
      : null;
    const sides: [number, number, number][] = [
      [0, h / 2, -this.half],
      [0, h / 2, this.half],
      [-this.half, h / 2, 0],
      [this.half, h / 2, 0],
    ];
    sides.forEach(([x, y, z], i) => {
      // The +Z wall (i===1) gets a rectangular window cut above the door for the
      // DJ alcove, so it is built from four panels around the opening instead of
      // one full plane (and skips the seam strips that would cross the window).
      if (i === 1) {
        this.buildFrontWall(wallMat, z);
        return;
      }
      const wallGeo = this.track(new THREE.PlaneGeometry(this.half * 2, h));
      const wall = new THREE.Mesh(wallGeo, wallMat);
      wall.position.set(x, y, z);
      if (i < 2) wall.rotation.y = z < 0 ? 0 : Math.PI;
      else wall.rotation.y = x < 0 ? Math.PI / 2 : -Math.PI / 2;
      wall.receiveShadow = true;
      this.group.add(wall);

      // Glowing seam strips up the wall (every 2m, leaving headroom near top).
      if (!seamMat) return;
      const seamCount = Math.floor((h - 2) / 2);
      for (let s = 1; s <= seamCount; s++) {
        const seamGeo = this.track(new THREE.PlaneGeometry(this.half * 2, 0.08));
        const seam = new THREE.Mesh(seamGeo, seamMat);
        seam.position.set(x, s * 2, z);
        seam.rotation.copy(wall.rotation);
        seam.position.addScaledVector(new THREE.Vector3(0, 0, 1).applyEuler(wall.rotation), 0.02);
        this.group.add(seam);
      }
    });

    // Ceiling.
    const ceilGeo = this.track(new THREE.PlaneGeometry(this.half * 2, this.half * 2));
    const ceilMat = this.trackMat(new THREE.MeshStandardMaterial({ color: p.ceilColor, metalness: 0.5, roughness: 0.6, side: THREE.DoubleSide }));
    const ceil = new THREE.Mesh(ceilGeo, ceilMat);
    ceil.rotation.x = Math.PI / 2;
    ceil.position.y = h;
    this.group.add(ceil);
  }

  private buildPillars() {
    const p = this.preset;
    const pillarMat = this.trackMat(
      new THREE.MeshStandardMaterial({ color: p.pillarColor, metalness: 0.8, roughness: 0.3 }),
    );
    const glowMat = this.trackMat(new THREE.MeshBasicMaterial({ color: p.pillarGlowColor }));
    const c = this.half - 1.2;
    const corners: [number, number][] = [
      [-c, -c],
      [c, -c],
      [-c, c],
      [c, c],
    ];
    const h = this.height;
    for (const [x, z] of corners) {
      const geo = this.track(new THREE.CylinderGeometry(0.5, 0.6, h, 12));
      const pillar = new THREE.Mesh(geo, pillarMat);
      pillar.position.set(x, h / 2, z);
      pillar.castShadow = true;
      this.group.add(pillar);
      const stripGeo = this.track(new THREE.CylinderGeometry(0.52, 0.52, h - 2, 12, 1, true));
      const strip = new THREE.Mesh(stripGeo, glowMat);
      strip.position.set(x, h / 2, z);
      this.group.add(strip);
    }
  }

  /** Preset lighting mood: a few coloured point lights baked into the room. */
  private buildAccentLights() {
    for (const a of this.preset.accents) {
      const light = new THREE.PointLight(a.color, a.intensity, a.distance, 1.8);
      light.position.set(a.pos[0], a.pos[1], a.pos[2]);
      this.group.add(light);
    }
  }

  /** Build the preset's deliberate decorative props around the perimeter. */
  private buildProps() {
    for (const spec of this.preset.props) this.buildProp(spec);
  }

  private buildProp(spec: PropSpec) {
    switch (spec.kind) {
      case "crate":
        return this.buildCrate(spec);
      case "barrel":
        return this.buildBarrel(spec);
      case "column":
        return this.buildColumn(spec);
      case "banner":
        return this.buildBanner(spec);
      case "girder":
        return this.buildGirder(spec);
      case "pylon":
        return this.buildPylon(spec);
    }
  }

  private buildCrate(spec: PropSpec) {
    const h = spec.height ?? 1.0;
    const size = 1.1 * (spec.scale ?? 1);
    const geo = this.track(new THREE.BoxGeometry(size, h, size));
    const mat = this.trackMat(
      new THREE.MeshStandardMaterial({ color: spec.color ?? 0x6b5236, metalness: 0.2, roughness: 0.85 }),
    );
    const crate = new THREE.Mesh(geo, mat);
    crate.position.set(spec.x, h / 2, spec.z);
    crate.rotation.y = spec.rotY ?? 0;
    crate.castShadow = true;
    crate.receiveShadow = true;
    this.group.add(crate);
    if (spec.collide) this.propObstacles.push({ x: spec.x, z: spec.z, r: size * 0.7, top: h });
  }

  private buildBarrel(spec: PropSpec) {
    const s = spec.scale ?? 1;
    const r = 0.45 * s;
    const h = 1.1 * s;
    const geo = this.track(new THREE.CylinderGeometry(r, r * 1.05, h, 14));
    const mat = this.trackMat(
      new THREE.MeshStandardMaterial({ color: spec.color ?? 0x7a3320, metalness: 0.5, roughness: 0.6 }),
    );
    const barrel = new THREE.Mesh(geo, mat);
    barrel.position.set(spec.x, h / 2, spec.z);
    barrel.castShadow = true;
    barrel.receiveShadow = true;
    this.group.add(barrel);
    if (spec.collide) this.propObstacles.push({ x: spec.x, z: spec.z, r: r + 0.15, top: h });
  }

  private buildColumn(spec: PropSpec) {
    const s = spec.scale ?? 1;
    const h = (spec.height ?? 9) * s;
    const r = 0.55 * s;
    const stoneMat = this.trackMat(
      new THREE.MeshStandardMaterial({ color: spec.color ?? 0xc9b894, metalness: 0.05, roughness: 0.95 }),
    );
    // Shaft.
    const shaftGeo = this.track(new THREE.CylinderGeometry(r * 0.9, r, h, 16));
    const shaft = new THREE.Mesh(shaftGeo, stoneMat);
    shaft.position.set(spec.x, h / 2, spec.z);
    shaft.castShadow = true;
    this.group.add(shaft);
    // Base + capital blocks.
    const blockGeo = this.track(new THREE.BoxGeometry(r * 2.6, 0.5, r * 2.6));
    const base = new THREE.Mesh(blockGeo, stoneMat);
    base.position.set(spec.x, 0.25, spec.z);
    this.group.add(base);
    const cap = new THREE.Mesh(blockGeo, stoneMat);
    cap.position.set(spec.x, h - 0.25, spec.z);
    this.group.add(cap);
    // Warm glow band just under the capital (torch-lit feel).
    if (spec.glow !== undefined) {
      const bandGeo = this.track(new THREE.CylinderGeometry(r * 0.95, r * 0.95, 0.3, 16, 1, true));
      const bandMat = this.trackMat(
        new THREE.MeshBasicMaterial({ color: spec.glow, transparent: true, opacity: 0.7 }),
      );
      const band = new THREE.Mesh(bandGeo, bandMat);
      band.position.set(spec.x, h - 1.0, spec.z);
      this.group.add(band);
    }
    if (spec.collide) this.propObstacles.push({ x: spec.x, z: spec.z, r: r + 0.3 });
  }

  private buildBanner(spec: PropSpec) {
    const s = spec.scale ?? 1;
    const w = 2.6 * s;
    const h = 7.5 * s;
    const geo = this.track(new THREE.PlaneGeometry(w, h));
    const mat = this.trackMat(
      new THREE.MeshStandardMaterial({
        color: spec.color ?? 0x8a2b2b,
        metalness: 0.0,
        roughness: 1.0,
        side: THREE.DoubleSide,
      }),
    );
    const banner = new THREE.Mesh(geo, mat);
    banner.position.set(spec.x, this.height * 0.5, spec.z);
    banner.rotation.y = spec.rotY ?? 0;
    this.group.add(banner);
  }

  private buildGirder(spec: PropSpec) {
    const len = spec.height ?? 16;
    const geo = this.track(new THREE.BoxGeometry(0.45, 0.6, len));
    const mat = this.trackMat(
      new THREE.MeshStandardMaterial({ color: spec.color ?? 0x33302a, metalness: 0.8, roughness: 0.5 }),
    );
    const girder = new THREE.Mesh(geo, mat);
    girder.position.set(spec.x, this.height - 1.6, spec.z);
    girder.rotation.y = spec.rotY ?? 0;
    girder.castShadow = true;
    this.group.add(girder);
  }

  private buildPylon(spec: PropSpec) {
    const s = spec.scale ?? 1;
    const h = 3.2 * s;
    const baseMat = this.trackMat(
      new THREE.MeshStandardMaterial({ color: spec.color ?? 0x141a24, metalness: 0.7, roughness: 0.4 }),
    );
    const geo = this.track(new THREE.BoxGeometry(0.6 * s, h, 0.6 * s));
    const pylon = new THREE.Mesh(geo, baseMat);
    pylon.position.set(spec.x, h / 2, spec.z);
    pylon.castShadow = true;
    this.group.add(pylon);
    if (spec.glow !== undefined) {
      const glowMat = this.trackMat(
        new THREE.MeshBasicMaterial({ color: spec.glow, transparent: true, opacity: 0.85 }),
      );
      this.doorGlow.push(glowMat); // ride the soft pulse already driven in update()
      const glowGeo = this.track(new THREE.BoxGeometry(0.66 * s, h * 0.7, 0.12));
      for (const rot of [0, Math.PI / 2]) {
        const strip = new THREE.Mesh(glowGeo, glowMat);
        strip.position.set(spec.x, h / 2, spec.z);
        strip.rotation.y = rot;
        this.group.add(strip);
      }
    }
    if (spec.collide) this.propObstacles.push({ x: spec.x, z: spec.z, r: 0.45 * s, top: h });
  }

  /**
   * The dungeon entrance: a glowing arched portal recessed into the +Z wall with
   * a pulsing semicircle decal on the floor in front of it. Players walk into the
   * semicircle and press E to enter the dungeon.
   */
  private buildDoor() {
    const z = this.half - 0.15;
    const archMat = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0x161c28, metalness: 0.7, roughness: 0.4 }),
    );
    const glowMat = this.trackMat(
      new THREE.MeshBasicMaterial({ color: 0x7b4dff, transparent: true, opacity: 0.9 }),
    );
    this.doorGlow.push(glowMat);

    // Door frame: two posts + a lintel framing a glowing portal plane.
    const postGeo = this.track(new THREE.BoxGeometry(0.4, 4.2, 0.5));
    for (const px of [-1.4, 1.4]) {
      const post = new THREE.Mesh(postGeo, archMat);
      post.position.set(px, 2.1, z);
      post.castShadow = true;
      this.group.add(post);
    }
    const lintelGeo = this.track(new THREE.BoxGeometry(3.2, 0.5, 0.5));
    const lintel = new THREE.Mesh(lintelGeo, archMat);
    lintel.position.set(0, 4.2, z);
    this.group.add(lintel);

    // The portal energy surface itself, facing into the room (-Z).
    const portalGeo = this.track(new THREE.PlaneGeometry(2.4, 3.9));
    const portal = new THREE.Mesh(portalGeo, glowMat);
    portal.position.set(0, 2.0, z - 0.26);
    portal.rotation.y = Math.PI;
    this.group.add(portal);

    // Pulsing semicircle decal on the floor in front of the door.
    const ringGeo = this.track(new THREE.RingGeometry(2.0, 2.5, 32, 1, 0, Math.PI));
    const ringMat = this.trackMat(
      new THREE.MeshBasicMaterial({ color: 0x9b6dff, transparent: true, opacity: 0.7, side: THREE.DoubleSide }),
    );
    this.doorGlow.push(ringMat);
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    // Orient the flat side of the semicircle along the wall, bulge into the room.
    ring.rotation.z = Math.PI;
    ring.position.set(0, 0.04, this.doorPos.z - 0.1);
    this.group.add(ring);
  }

  /**
   * The +Z wall built from four panels around a rectangular window above the
   * door, leaving the {@link djWinHalfW}/{@link djWinBottom}/{@link djWinTop}
   * opening clear so the recessed DJ alcove behind it is visible from the room.
   */
  private buildFrontWall(wallMat: THREE.Material, z: number) {
    const h = this.height;
    const W = this.half * 2;
    const winB = this.djWinBottom;
    const winT = this.djWinTop;
    const winHW = this.djWinHalfW;
    const sideW = this.half - winHW;
    const panels: [number, number, number, number][] = [
      // [width, height, centreX, centreY]
      [W, winB, 0, winB / 2], // below the window (includes the door region)
      [W, h - winT, 0, (winT + h) / 2], // above the window
      [sideW, winT - winB, -(winHW + sideW / 2), (winB + winT) / 2], // left of window
      [sideW, winT - winB, winHW + sideW / 2, (winB + winT) / 2], // right of window
    ];
    for (const [w, ph, cx, cy] of panels) {
      const geo = this.track(new THREE.PlaneGeometry(w, ph));
      const panel = new THREE.Mesh(geo, wallMat);
      panel.position.set(cx, cy, z);
      panel.rotation.y = Math.PI;
      panel.receiveShadow = true;
      this.group.add(panel);
    }
  }

  /**
   * The recessed, club-lit booth alcove behind the window: a platform floor,
   * back/side walls + ceiling forming a shallow box outside the +Z wall, a glowing
   * neon frame around the window and pulsing coloured spots so the resident DJ
   * (see {@link DjBooth}) reads as backlit. Pure geometry; pulsing handled in
   * {@link update}.
   */
  private buildDjAlcove() {
    const front = this.half; // window plane z
    const back = this.half + this.djDepth;
    const winHW = this.djWinHalfW;
    const floorY = this.djFloorY;
    const ceilY = this.djWinTop + 0.2;
    const innerHW = winHW + 0.5;

    const shellMat = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0x0c0f17, metalness: 0.5, roughness: 0.6, side: THREE.DoubleSide }),
    );

    // Platform floor.
    const floorGeo = this.track(new THREE.BoxGeometry(innerHW * 2, 0.3, this.djDepth + 0.4));
    const floor = new THREE.Mesh(floorGeo, shellMat);
    floor.position.set(0, floorY - 0.15, (front + back) / 2);
    floor.receiveShadow = true;
    this.group.add(floor);

    // Back wall (dark shell) — the surface Racalvin stands against.
    const backGeo = this.track(new THREE.PlaneGeometry(innerHW * 2, ceilY - floorY + 0.6));
    const backWall = new THREE.Mesh(backGeo, shellMat);
    backWall.position.set(0, (floorY + ceilY) / 2, back);
    this.group.add(backWall);

    // The animated light-show shader painted ONTO that back wall (flush, facing
    // the room) rather than as floating panels — a neon-plasma + equalizer +
    // scan-beam surface whose energy tracks the live music.
    this.buildDjShowWall(innerHW * 2, ceilY - floorY + 0.6, (floorY + ceilY) / 2, back);

    // Ceiling.
    const ceilGeo = this.track(new THREE.PlaneGeometry(innerHW * 2, this.djDepth + 0.4));
    const ceil = new THREE.Mesh(ceilGeo, shellMat);
    ceil.rotation.x = Math.PI / 2;
    ceil.position.set(0, ceilY, (front + back) / 2);
    this.group.add(ceil);

    // Side walls.
    for (const sx of [-1, 1]) {
      const sideGeo = this.track(new THREE.PlaneGeometry(this.djDepth + 0.4, ceilY - floorY + 0.6));
      const side = new THREE.Mesh(sideGeo, shellMat);
      side.rotation.y = sx < 0 ? Math.PI / 2 : -Math.PI / 2;
      side.position.set(sx * innerHW, (floorY + ceilY) / 2, (front + back) / 2);
      this.group.add(side);
    }

    // Neon frame around the window opening (top + bottom + sides), pulsing.
    const frameColor = 0xff2bd6;
    const frameBars: [number, number, number, number][] = [
      // [width, height, centreX, centreY]
      [winHW * 2 + 0.3, 0.16, 0, this.djWinBottom], // sill
      [winHW * 2 + 0.3, 0.16, 0, this.djWinTop], // header
      [0.16, this.djWinTop - this.djWinBottom, -winHW, (this.djWinBottom + this.djWinTop) / 2],
      [0.16, this.djWinTop - this.djWinBottom, winHW, (this.djWinBottom + this.djWinTop) / 2],
    ];
    for (const [w, ph, cx, cy] of frameBars) {
      const mat = this.trackMat(
        new THREE.MeshBasicMaterial({ color: frameColor, transparent: true, opacity: 0.85 }),
      );
      this.djGlow.push({ mat, base: 0.85, speed: 3.0, phase: Math.random() * Math.PI * 2 });
      const geo = this.track(new THREE.PlaneGeometry(w, ph));
      const bar = new THREE.Mesh(geo, mat);
      bar.position.set(cx, cy, front - 0.08);
      bar.rotation.y = Math.PI;
      this.group.add(bar);
    }

    // Emissive light strips on the back wall behind the DJ.
    for (let i = 0; i < 3; i++) {
      const mat = this.trackMat(
        new THREE.MeshBasicMaterial({
          color: i === 1 ? 0x29e0ff : 0xff2bd6,
          transparent: true,
          opacity: 0.7,
        }),
      );
      this.djGlow.push({ mat, base: 0.7, speed: 2.0 + i, phase: Math.random() * Math.PI * 2 });
      const geo = this.track(new THREE.PlaneGeometry(0.18, ceilY - floorY - 0.4));
      const strip = new THREE.Mesh(geo, mat);
      strip.position.set((i - 1) * (innerHW * 0.7), (floorY + ceilY) / 2, back - 0.06);
      this.group.add(strip);
    }

    // Pulsing coloured spots lighting the booth.
    const lightDefs: [number, number][] = [
      [0xff2bd6, -winHW * 0.6],
      [0x29e0ff, winHW * 0.6],
    ];
    for (let i = 0; i < lightDefs.length; i++) {
      const [color, lx] = lightDefs[i];
      const light = new THREE.PointLight(color, 6, 14, 2);
      light.position.set(lx, ceilY - 0.4, (front + back) / 2);
      this.group.add(light);
      this.djLights.push({ light, base: 6, speed: 2.5 + i, phase: Math.random() * Math.PI * 2 });
    }

    // Speakers flanking the booth, each with woofer cones + a glow ring that
    // "boom" (pulse forward) on the beat — animated in {@link update}.
    const cabMat = this.trackMat(
      new THREE.MeshStandardMaterial({ color: 0x05070c, metalness: 0.6, roughness: 0.4, side: THREE.DoubleSide }),
    );
    const cabW = 1.5;
    const cabH = 3.0;
    const cabD = 1.3;
    const cz = front + cabD / 2 + 0.15;
    for (const sx of [-1, 1]) {
      const cx = sx * (innerHW - cabW * 0.7);
      const cabGeo = this.track(new THREE.BoxGeometry(cabW, cabH, cabD));
      const cab = new THREE.Mesh(cabGeo, cabMat);
      cab.position.set(cx, floorY + cabH / 2, cz);
      this.group.add(cab);
      const color = sx < 0 ? 0xff2bd6 : 0x29e0ff;
      for (const wy of [0.72, -0.55]) {
        const coneGeo = this.track(new THREE.CylinderGeometry(0.44, 0.16, 0.4, 24, 1, true));
        const glow = this.trackMat(
          new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, side: THREE.DoubleSide }),
        );
        const cone = new THREE.Mesh(coneGeo, glow);
        cone.rotation.x = -Math.PI / 2; // wide mouth faces the room (-Z)
        cone.position.set(cx, floorY + cabH / 2 + wy, cz - cabD / 2 - 0.05);
        this.group.add(cone);
        // Expanding shockwave ring in front of the woofer.
        const ringGeo = this.track(new THREE.RingGeometry(0.46, 0.6, 28));
        const ringMat = this.trackMat(
          new THREE.MeshBasicMaterial({
            color,
            transparent: true,
            opacity: 0.0,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
            depthWrite: false,
          }),
        );
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.rotation.y = Math.PI;
        ring.position.set(cx, floorY + cabH / 2 + wy, cz - cabD / 2 - 0.1);
        this.group.add(ring);
        this.djSpeakers.push({ cone, glow, ring, ringMat, phase: Math.random() * Math.PI * 2 });
      }
    }
  }

  /**
   * Build the animated GLSL light show as a single flush panel on the alcove
   * back wall (facing the room). One additive {@link THREE.ShaderMaterial} whose
   * `uTime`/`uIntensity` uniforms are driven in {@link update} — a neon plasma
   * bed, pulsing equalizer bars and a sweeping scan beam. Because it is sized
   * from the wall dimensions it always tracks the box when the alcove resizes.
   */
  private buildDjShowWall(w: number, h: number, cy: number, z: number) {
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uIntensity: { value: 0.3 } },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        precision highp float;
        uniform float uTime;
        uniform float uIntensity;
        varying vec2 vUv;
        vec3 hue(float h) {
          return clamp(abs(mod(h * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
        }
        void main() {
          vec2 uv = vUv;
          // Neon plasma backdrop.
          float p = sin(uv.x * 9.0 + uTime * 1.6) + sin(uv.y * 7.0 - uTime * 1.2)
                  + sin((uv.x + uv.y) * 5.0 + uTime * 0.8);
          vec3 col = hue(0.6 + 0.12 * p + uTime * 0.04) * (0.16 + 0.14 * uIntensity);
          // Pulsing vertical equalizer bars.
          const float BARS = 30.0;
          float bi = floor(uv.x * BARS);
          float seed = fract(sin(bi * 12.9898) * 43758.5453);
          float bh = 0.12 + (0.5 + 0.45 * uIntensity) * abs(sin(uTime * (1.5 + seed * 3.5) + seed * 6.2831));
          float bar = step(uv.y, bh);
          float gap = smoothstep(0.06, 0.18, fract(uv.x * BARS));
          vec3 barCol = hue(bi / BARS + uTime * 0.08);
          col += barCol * bar * gap * (0.7 + 0.9 * uIntensity);
          // Sweeping scan beam.
          float beam = abs(fract(uv.y * 0.5 - uTime * 0.25) - 0.5);
          col += hue(uTime * 0.2) * (1.0 - smoothstep(0.46, 0.5, beam)) * 0.16;
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.mats.push(mat);
    const geo = this.track(new THREE.PlaneGeometry(w, h));
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(0, cy, z - 0.06);
    mesh.rotation.y = Math.PI; // face the room (-Z)
    mesh.visible = this.djShowEnabled;
    this.group.add(mesh);
    this.djShowMat = mat;
    this.djShowMesh = mesh;
  }

  /** Enable/disable the back-wall light show (settings toggle). */
  setDjShowEnabled(on: boolean) {
    this.djShowEnabled = on;
    if (this.djShowMesh) this.djShowMesh.visible = on;
  }

  /**
   * Static interior obstacle circles (XZ) for player push-out collision: the
   * four corner light pillars plus any collidable preset props. Kept in sync with
   * {@link buildPillars}/{@link buildProps}. Live training dummies / fighters
   * supply their own footprints via `Targets.obstacleCircles()`.
   */
  get obstacles(): ObstacleCircle[] {
    if (this.open) return [];
    const c = this.half - 1.2;
    const pillars: [number, number][] = [
      [-c, -c],
      [c, -c],
      [-c, c],
      [c, c],
    ];
    return [...pillars.map(([x, z]) => ({ x, z, r: 0.6 })), ...this.propObstacles];
  }

  /** True when `p` is standing in the door's activation zone (xz proximity). */
  nearDoor(p: THREE.Vector3): boolean {
    const dx = p.x - this.doorPos.x;
    const dz = p.z - this.doorPos.z;
    return Math.hypot(dx, dz) < 3.0;
  }

  setGridVisible(v: boolean) {
    this.gridWanted = v;
    this.applyGridVisible();
  }

  /** Grid is shown only when both requested AND the preset uses a grid. */
  private applyGridVisible() {
    this.grid.visible = this.gridWanted && this.preset.gridOpacity > 0;
  }

  /** Soft pulse of the holographic accents (door + DJ alcove club lighting). */
  update(t: number, musicIntensity = 0) {
    const dt = Math.max(0, Math.min(0.1, t - this.lastUpdateT));
    this.lastUpdateT = t;
    this.grid.position.y = 0.03 + Math.sin(t * 1.5) * 0.01;
    const pulse = 0.6 + Math.sin(t * 3) * 0.25;
    for (const m of this.doorGlow) m.opacity = pulse;
    for (const g of this.djGlow) {
      g.mat.opacity = Math.max(0.15, g.base * (0.55 + 0.45 * Math.sin(t * g.speed + g.phase)));
    }
    for (const l of this.djLights) {
      // Club lights ride the music energy when it's playing, else soft idle pulse.
      const energy = 0.5 + 0.5 * Math.abs(Math.sin(t * l.speed + l.phase));
      l.light.intensity = l.base * energy * (0.6 + musicIntensity * 1.1);
    }
    // Back-wall light show: advance time + ease its energy toward the music's.
    if (this.djShowMat && this.djShowEnabled) {
      this.djShowTime += dt;
      this.djShowMat.uniforms.uTime.value = this.djShowTime;
      const cur = this.djShowMat.uniforms.uIntensity.value as number;
      const target = musicIntensity > 0 ? musicIntensity : 0.15;
      this.djShowMat.uniforms.uIntensity.value = cur + (target - cur) * Math.min(1, dt * 3);
    }
    // Speaker "sound booms": woofer cones pump forward + glow, with an expanding
    // shockwave ring gated on the beat energy.
    for (const s of this.djSpeakers) {
      const beat = Math.abs(Math.sin(t * 8 + s.phase));
      const boom = 1 + musicIntensity * (0.35 + 0.4 * beat);
      s.cone.scale.set(boom, boom, 1 + musicIntensity * 0.9 * beat);
      s.glow.opacity = 0.35 + musicIntensity * 0.6;
      const ringPhase = (t * 1.6 + s.phase) % 1; // 0..1 expand cycle
      const rs = 1 + ringPhase * (1.5 + musicIntensity * 2.5);
      s.ring.scale.set(rs, rs, 1);
      s.ringMat.opacity = (1 - ringPhase) * musicIntensity * 0.7;
    }
  }

  /** Dispose all geometry/materials and empty the group (for rebuild/teardown). */
  private clearBuilt() {
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
    this.geos = [];
    this.mats = [];
    if (this.grid) {
      this.grid.geometry.dispose();
      (this.grid.material as THREE.Material).dispose();
    }
    this.doorGlow = [];
    this.djGlow = [];
    this.djLights = [];
    this.djShowMat = null;
    this.djShowMesh = null;
    this.djSpeakers = [];
    this.propObstacles = [];
    this.group.clear();
  }

  dispose() {
    this.clearBuilt();
    this.group.parent?.remove(this.group);
  }
}
