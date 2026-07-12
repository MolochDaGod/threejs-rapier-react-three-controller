import * as THREE from "three";
import { assetLoadError, resolveAssetUrl } from "./assetBase";

// Load a body-atlas texture. The atlas is a lossless `.webp`; we set sRGB colour
// space and keep `flipY = true` (the FBX UVs were authored for TGALoader's
// flipped orientation, which is also TextureLoader's default). Pass a bare
// default `textureUrl` (no `#tint-...` fragment).
export function loadBodyTexture(textureUrl: string): Promise<THREE.Texture> {
  const url = resolveAssetUrl(textureUrl);
  return new Promise((resolve, reject) => {
    new THREE.TextureLoader().load(
      url,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.flipY = true;
        tex.magFilter = THREE.LinearFilter;
        tex.minFilter = THREE.LinearFilter;
        tex.generateMipmaps = false;
        tex.needsUpdate = true;
        resolve(tex);
      },
      undefined,
      (err) => reject(assetLoadError(url, err)),
    );
  });
}
