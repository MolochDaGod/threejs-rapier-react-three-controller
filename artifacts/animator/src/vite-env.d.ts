/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Optional origin of a dedicated game server (e.g. a VPS-hosted realtime
   * relay). Accepts an `http(s)://` or `ws(s)://` base URL; when unset, the
   * client falls back to the same-origin relay. See `net/DangerClient.ts`.
   */
  readonly VITE_GAME_SERVER_URL?: string;
  /**
   * Optional external asset host (e.g. a Cloudflare R2 public bucket or CDN
   * domain) for all public media (models/anim/audio/rooms/frames/avatar/
   * backdrops). When unset, assets resolve same-origin against BASE_URL.
   * See `three/assetHost.ts`.
   */
  readonly VITE_ASSET_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
