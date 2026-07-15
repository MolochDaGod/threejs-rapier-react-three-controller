import * as THREE from "three";
import { assetLoadError, resolveAssetUrl } from "./assetBase";

function configureBodyTex(tex: THREE.Texture, flipY: boolean): THREE.Texture {
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = flipY;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Load a body-atlas texture (lossless `.webp` on R2).
 * sRGB colour space; flipY true matches FBX/TGA-authored UVs.
 * Tries primary URL then grudge6 textures/ mirror paths when CDN layout varies.
 */
export function loadBodyTexture(textureUrl: string): Promise<THREE.Texture> {
  const primary = resolveAssetUrl(textureUrl);
  // Alternate mirrors used by Open fleet / grudge6 packs
  const alts: string[] = [];
  const m = textureUrl.match(
    /\/assets\/(barbarians|dwarves|elves|orcs|undead|western-kingdoms)\/textures\/(.+)$/i,
  );
  if (m) {
    const folder =
      m[1]!.toLowerCase() === "elves" ? "elves" : m[1]!.toLowerCase();
    alts.push(resolveAssetUrl(`/textures/grudge6/${folder}/${m[2]}`));
  }

  const urls = [...new Set([primary, ...alts])];

  const tryLoad = (url: string, flipY: boolean) =>
    new Promise<THREE.Texture>((resolve, reject) => {
      new THREE.TextureLoader().load(
        url,
        (tex) => resolve(configureBodyTex(tex, flipY)),
        undefined,
        (err) => reject(assetLoadError(url, err)),
      );
    });

  return (async () => {
    let last: unknown;
    for (const url of urls) {
      try {
        return await tryLoad(url, true);
      } catch (e) {
        last = e;
        try {
          // Some atlases are authored flipY=false
          return await tryLoad(url, false);
        } catch (e2) {
          last = e2;
        }
      }
    }
    throw last instanceof Error ? last : assetLoadError(primary, last);
  })();
}
