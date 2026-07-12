/**
 * The six "rooms" shown in the phone-style carousel on the LED Mask home page.
 * Each room carries two pieces of art: a tall `poster` (the carousel card face)
 * and a square `scene` (the full-screen loading background shown while entering
 * that room).
 *
 * Art lives in `public/rooms/` so it is served by the web server (the
 * `attached_assets/` source dir is not). URLs are BASE_URL-aware so they resolve
 * under whatever base path the artifact is mounted at.
 */
export type RoomTarget = "danger" | "voxel" | "editor" | "lobby" | "avatar";

export interface MaskRoom {
  id: string;
  label: string;
  tagline: string;
  /** App mode this room navigates to. */
  target: RoomTarget;
  /** Tall poster art (portrait card). */
  poster: string;
  /** Square scene art (grid tile + loading background). */
  scene: string;
  /** "r, g, b" accent used for the card glow / loader tint. */
  accent: string;
}

import { assetUrl } from "../three/assetHost";

const base = assetUrl("").replace(/\/$/, "") + "/";

export const MASK_ROOMS: MaskRoom[] = [
  {
    id: "danger",
    label: "Danger Room",
    tagline: "Live combat sandbox — fight training targets with every weapon & skill.",
    target: "danger",
    poster: `${base}rooms/danger-poster.png`,
    scene: `${base}rooms/danger-scene.png`,
    accent: "255, 72, 72",
  },
  {
    id: "voxel",
    label: "Voxel Editor",
    tagline: "Build a custom map — blocks, deployable NPCs & bags, dungeon authoring.",
    target: "voxel",
    poster: `${base}rooms/voxel-poster.png`,
    scene: `${base}rooms/voxel-scene.png`,
    accent: "0, 224, 255",
  },
  {
    id: "dressing",
    label: "Dressing Room",
    tagline: "Swap models & skins, attach weapons & gear, preview animations & FX.",
    target: "editor",
    poster: `${base}rooms/dressing-poster.png`,
    scene: `${base}rooms/dressing-scene.png`,
    accent: "232, 70, 255",
  },
  {
    id: "lobby",
    label: "The Lobby",
    tagline: "Join a multiplayer room, or browse community maps & scenes to play.",
    target: "lobby",
    poster: `${base}rooms/lobby-poster.png`,
    scene: `${base}rooms/lobby-scene.png`,
    accent: "79, 160, 255",
  },
  {
    id: "voxgrudge",
    label: "VOXGRUDGE",
    // VOXGRUDGE has no dedicated screen yet; it opens the Lobby (its multiplayer /
    // PvP-arena home) until a standalone arena mode exists.
    tagline: "Underground PvP arena — fight · glitch · win. Opens the Lobby for now.",
    target: "lobby",
    poster: `${base}rooms/voxgrudge-poster.png`,
    scene: `${base}rooms/voxgrudge-scene.png`,
    accent: "255, 60, 60",
  },
  {
    id: "avatar",
    label: "Avatar Edit",
    tagline: "Build your cube head — six races with modular hair, eyes & extras.",
    target: "avatar",
    poster: `${base}rooms/avatar-poster.png`,
    scene: `${base}rooms/avatar-scene.png`,
    accent: "72, 230, 210",
  },
];
