import * as THREE from "three";
import type { EFAnimationJson } from "./types.js";
import { matrixFromTransform } from "./matrix.js";

/**
 * Convert an Epic Fight animation JSON into a `THREE.AnimationClip`.
 *
 * Each channel's `transform` entries are the bone's **parent-relative local
 * pose** at each keyframe (already the value a THREE bone's local matrix should
 * take), so we decompose them straight into position/quaternion/scale tracks
 * keyed by bone name. Times are already in seconds.
 *
 * Consecutive quaternion keys are sign-aligned (dot >= 0) so the mixer's slerp
 * always takes the short path.
 */
export function buildAnimationClip(
  json: EFAnimationJson,
  name = "clip",
): THREE.AnimationClip {
  if (!json.animation || json.animation.length === 0) {
    throw new Error("Epic Fight animation JSON has no animation channels");
  }

  const tracks: THREE.KeyframeTrack[] = [];
  const m = new THREE.Matrix4();
  const p = new THREE.Vector3();
  const q = new THREE.Quaternion();
  const s = new THREE.Vector3();

  for (const channel of json.animation) {
    const times = channel.time;
    const n = times.length;
    if (n === 0 || channel.transform.length !== n) continue;

    const pos = new Array<number>(n * 3);
    const scl = new Array<number>(n * 3);
    const quat = new Array<number>(n * 4);
    let px = 0,
      py = 0,
      pz = 0,
      pw = 1;

    for (let i = 0; i < n; i++) {
      matrixFromTransform(channel.transform[i], m).decompose(p, q, s);
      pos[i * 3] = p.x;
      pos[i * 3 + 1] = p.y;
      pos[i * 3 + 2] = p.z;
      scl[i * 3] = s.x;
      scl[i * 3 + 1] = s.y;
      scl[i * 3 + 2] = s.z;

      let x = q.x,
        y = q.y,
        z = q.z,
        w = q.w;
      if (i > 0 && px * x + py * y + pz * z + pw * w < 0) {
        x = -x;
        y = -y;
        z = -z;
        w = -w;
      }
      quat[i * 4] = x;
      quat[i * 4 + 1] = y;
      quat[i * 4 + 2] = z;
      quat[i * 4 + 3] = w;
      px = x;
      py = y;
      pz = z;
      pw = w;
    }

    tracks.push(new THREE.VectorKeyframeTrack(`${channel.name}.position`, times, pos));
    tracks.push(
      new THREE.QuaternionKeyframeTrack(`${channel.name}.quaternion`, times, quat),
    );
    tracks.push(new THREE.VectorKeyframeTrack(`${channel.name}.scale`, times, scl));
  }

  // duration = -1 → derived from the longest track.
  return new THREE.AnimationClip(name, -1, tracks);
}
