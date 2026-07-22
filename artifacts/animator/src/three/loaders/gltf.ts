/**
 * Shared GLTFLoader for campfire / prop loads (controller-local).
 * Gameopen has Draco/Meshopt/KTX2 wired; here we keep a single plain loader
 * so torch + ethereal optional GLBs load without extra decoder deps.
 */
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

let shared: GLTFLoader | null = null;

export function sharedGltfLoader(): GLTFLoader {
  if (!shared) shared = new GLTFLoader();
  return shared;
}

export function makeGltfLoader(): GLTFLoader {
  return new GLTFLoader();
}
