/**
 * Landing-page player badge — the black square left of the DANGERROOM title.
 * Shows the player's own composed avatar portrait as the button art plus their
 * name and race; clicking it pops out the full character panel. (The king
 * emblem art moved to the AppShell's Toolbox button.)
 */
import { useMemo, useState } from "react";
import { useUser } from "@clerk/clerk-react";
import { loadPlayerHeadConfig } from "../three/avatar/playerHead";
import { defaultConfig, raceDef } from "../three/avatar/catalog";
import { renderPortraitDataUrl } from "../three/avatar/portrait";
import { useGbux } from "../lib/gbux";
import { PlayerPanel } from "./PlayerPanel";
import "./playerPanel.css";

interface Props {
  /** Jump to the Avatar Edit door (used by the panel's edit button). */
  onEditAvatar: () => void;
}

export function PlayerBadge({ onEditAvatar }: Props) {
  const { user, isSignedIn } = useUser();
  const [open, setOpen] = useState(false);
  const gbux = useGbux();

  // Fresh read per mount — returning from Avatar Edit remounts this screen.
  const saved = useMemo(loadPlayerHeadConfig, []);
  const cfg = useMemo(() => saved ?? defaultConfig("human"), [saved]);
  const portrait = useMemo(() => renderPortraitDataUrl(cfg, 192), [cfg]);

  const name = user?.firstName || user?.username || "Player";

  return (
    <>
      <button
        className="player-badge"
        onClick={() => setOpen(true)}
        aria-label="Open your character panel"
        aria-haspopup="dialog"
      >
        <span className="pb-portrait">
          {portrait && <img src={portrait} alt="" draggable={false} />}
        </span>
        <span className="pb-name">{name}</span>
        <span className="pb-race">{saved ? raceDef(cfg.race).label : "New recruit"}</span>
      </button>

      {open && (
        <PlayerPanel
          name={name}
          isSignedIn={!!isSignedIn}
          cfg={cfg}
          hasSavedHead={!!saved}
          portrait={portrait}
          gbux={gbux}
          onClose={() => setOpen(false)}
          onEditAvatar={onEditAvatar}
        />
      )}
    </>
  );
}
