import * as Popover from "@radix-ui/react-popover";
import { Volume2, VolumeX } from "lucide-react";
import type { SoundSettings } from "../three/soundSettings";

export type SoundChannel = "master" | "combat" | "ambient" | "klaxon" | "music";

const CHANNELS: { id: SoundChannel; label: string }[] = [
  { id: "master", label: "Master volume" },
  { id: "music", label: "Music" },
  { id: "combat", label: "Combat hits" },
  { id: "ambient", label: "Ambient bed" },
  { id: "klaxon", label: "Warning klaxon" },
];

interface Props {
  sound: SoundSettings;
  onToggleMute: () => void;
  onLevel: (channel: SoundChannel, value: number) => void;
  /** Visual variant: menubar button (default) or the play-mode topbar tab. */
  variant?: "menubar" | "topbar";
}

/**
 * The volume sliders themselves (master + per-category). Rendered inside the
 * {@link SoundMixer} popover and the Toolbox's Music tab.
 */
export function SoundLevels({
  sound,
  onLevel,
}: {
  sound: SoundSettings;
  onLevel: (channel: SoundChannel, value: number) => void;
}) {
  const { muted } = sound;
  return (
    <>
      {CHANNELS.map(({ id, label }) => {
        const pct = Math.round(sound[id] * 100);
        return (
          <label className="slider sound-slider" key={id}>
            <span className="slider-label">
              {label}
              <em>{muted ? "muted" : `${pct}%`}</em>
            </span>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={pct}
              disabled={muted}
              onChange={(e) => onLevel(id, Number(e.target.value) / 100)}
            />
          </label>
        );
      })}
    </>
  );
}

/**
 * Sound control: a mute toggle button that doubles as a popover trigger holding
 * the volume mixer (master + per-category levels). Muting hard-silences
 * everything; the sliders set what unmuting restores.
 */
export function SoundMixer({ sound, onToggleMute, onLevel, variant = "menubar" }: Props) {
  const { muted } = sound;
  const btnClass = variant === "topbar" ? `tab ${muted ? "on" : ""}` : `tm-btn ${muted ? "on" : ""}`;
  return (
    <Popover.Root>
      <div className="sound-ctl">
        <button
          className={btnClass}
          onClick={onToggleMute}
          aria-pressed={muted}
          title={muted ? "Unmute all sound" : "Mute all sound"}
        >
          {muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
          <span>{muted ? "Muted" : "Sound"}</span>
        </button>
        <Popover.Trigger asChild>
          <button className={variant === "topbar" ? "tab sound-caret" : "tm-btn sound-caret"} title="Volume mixer" aria-label="Volume mixer">
            <span aria-hidden>▾</span>
          </button>
        </Popover.Trigger>
      </div>
      <Popover.Portal>
        <Popover.Content className="sound-popover" align="end" sideOffset={6}>
          <div className="sound-popover-title">Volume mixer</div>
          <SoundLevels sound={sound} onLevel={onLevel} />
          <Popover.Arrow className="sound-popover-arrow" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
