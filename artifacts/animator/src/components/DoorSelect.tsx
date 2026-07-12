import { assetUrl } from "../three/assetHost";
import { PlayerBadge } from "./PlayerBadge";

interface Props {
  onEnter: (mode: "danger" | "voxel" | "editor" | "lobby" | "ledmask" | "avatar") => void;
}

// Square room art (public/rooms/*-scene.png) — the same room art the LED-Mask
// room gallery uses — served through the app base so it resolves under any base
// path. Each scene is a complete, self-labelled square card (it carries the room
// title), so the whole door IS the image.
const poster = (name: string) => assetUrl(`rooms/${name}-scene.png`);

/**
 * The facility entrance: five poster doors. The first drops into the live Danger
 * Room combat sandbox; the second opens the Voxel Map Editor; the third opens the
 * Dressing Room (character models, weapons, animations & effects); the fourth
 * opens the multiplayer / community Lobby; the last opens the Voxel LED Mask
 * studio. Each door is its hand-made poster.
 */
export function DoorSelect({ onEnter }: Props) {
  return (
    <div className="doors">
      <div className="doors-head">
        <PlayerBadge onEditAvatar={() => onEnter("avatar")} />
        <div className="doors-title">
          <span className="brand">
            DANGER<span className="brand-accent">ROOM</span>
          </span>
          <p className="doors-sub">Choose a door</p>
        </div>
      </div>

      <div className="doors-row">
        <button
          className="door door-combat"
          onClick={() => onEnter("danger")}
          aria-label="Danger Room — live combat sandbox"
        >
          <img className="door-art" src={poster("danger")} alt="Danger Room" draggable={false} />
        </button>

        <button
          className="door door-editor"
          onClick={() => onEnter("voxel")}
          aria-label="Voxel Editor — build a custom map"
        >
          <img className="door-art" src={poster("voxel")} alt="Voxel Editor" draggable={false} />
        </button>

        <button
          className="door door-scene"
          onClick={() => onEnter("editor")}
          aria-label="Dressing Room — dress up a character"
        >
          <img className="door-art" src={poster("dressing")} alt="Dressing Room" draggable={false} />
        </button>

        <button
          className="door door-lobby"
          onClick={() => onEnter("lobby")}
          aria-label="The Lobby — multiplayer rooms & community maps"
        >
          <img className="door-art" src={poster("lobby")} alt="The Lobby" draggable={false} />
        </button>

        <button
          className="door door-ledmask"
          onClick={() => onEnter("ledmask")}
          aria-label="Voxel LED Mask — drive a cube voxel head"
        >
          <img className="door-art" src={poster("voxgrudge")} alt="Voxel LED Mask" draggable={false} />
        </button>

        <button
          className="door door-avatar"
          onClick={() => onEnter("avatar")}
          aria-label="Avatar Edit — build a cube modular head"
        >
          <img className="door-art" src={poster("avatar")} alt="Avatar Edit" draggable={false} />
        </button>
      </div>
    </div>
  );
}
