import * as Popover from "@radix-ui/react-popover";
import {
  Disc3,
  SkipBack,
  SkipForward,
  Shuffle,
  RefreshCw,
  Play,
  Pause,
  Volume2,
  VolumeX,
  Radio,
} from "lucide-react";
import {
  DJ_TRANSITIONS,
  type DjStationSettings,
  type DjTransition,
} from "../three/djStationSettings";
import { RADIO_STATIONS } from "../three/audio/radioStations";

export interface DjNowPlaying {
  title: string;
  index: number;
  count: number;
}

export interface DjStationBodyProps {
  settings: DjStationSettings;
  onChange: (patch: Partial<DjStationSettings>) => void;
  nowPlaying: DjNowPlaying | null;
  titles: string[];
  onPrev: () => void;
  onNext: () => void;
  onSelect: (index: number) => void;
  onReset: () => void;
  /** Station transport state + controls (play/pause, station mute, DJ mix). */
  paused: boolean;
  muted: boolean;
  onTogglePlay: () => void;
  onToggleMute: () => void;
  onMixNext: () => void;
  /** Radio station picker: currently-tuned station + switch handler. */
  stationId: string;
  onStation: (id: string) => void;
  /** Non-null while an Audius station's playlist is being fetched. */
  stationBusy: string | null;
  stationName: string;
}

interface Props extends DjStationBodyProps {
  /** Visual variant: menubar button (default) or the play-mode topbar tab. */
  variant?: "menubar" | "topbar";
}

/**
 * The radio station controls themselves — station picker (CPT RAC's local set
 * plus free Audius genre streams), now-playing readout, transport (play/pause /
 * prev / skip / DJ-mix / mute / re-roll), auto-mix settings (transition style,
 * crossfade length, shuffle, random start) and the full track list. Rendered
 * inside the menubar popover ({@link DjStationPanel}) and the Toolbox's Music tab.
 */
export function DjStationBody({
  settings,
  onChange,
  nowPlaying,
  titles,
  onPrev,
  onNext,
  onSelect,
  onReset,
  paused,
  muted,
  onTogglePlay,
  onToggleMute,
  onMixNext,
  stationId,
  onStation,
  stationBusy,
  stationName,
}: DjStationBodyProps) {
  const label = stationBusy ? `Tuning ${stationBusy}…` : nowPlaying?.title || stationName;
  const fadeDisabled = !settings.autoMix || settings.transition === "cut";
  return (
    <>
      <div className="dj-now">
            <div className="dj-now-title">{label}</div>
            {nowPlaying && !stationBusy && (
              <div className="dj-now-sub">
                {stationName} — Track {nowPlaying.index + 1} / {nowPlaying.count}
              </div>
            )}
          </div>

          <div className="dj-transport">
            <button
              className={`dj-btn ${paused ? "" : "on"}`}
              onClick={onTogglePlay}
              title={paused ? "Play" : "Pause"}
              aria-label={paused ? "Play" : "Pause"}
            >
              {paused ? <Play size={15} /> : <Pause size={15} />}
            </button>
            <button className="dj-btn" onClick={onPrev} title="Previous track" aria-label="Previous track">
              <SkipBack size={15} />
            </button>
            <button className="dj-btn" onClick={onNext} title="Next track" aria-label="Next track">
              <SkipForward size={15} />
            </button>
            <button
              className={`dj-btn ${muted ? "on" : ""}`}
              onClick={onToggleMute}
              title={muted ? "Unmute music" : "Mute music"}
              aria-label={muted ? "Unmute music" : "Mute music"}
            >
              {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
            </button>
            <button
              className="dj-btn dj-btn-wide"
              onClick={onMixNext}
              title="DJ-mix into the next song now (uses your transition style)"
            >
              <Disc3 size={13} />
              <span>Mix →</span>
            </button>
            <button className="dj-btn dj-btn-wide" onClick={onReset} title="Re-roll to a random track">
              <RefreshCw size={13} />
              <span>Re-roll</span>
            </button>
          </div>

          <div className="dj-stations">
            <div className="dj-stations-title">
              <Radio size={12} /> Stations
            </div>
            <div className="dj-stations-grid">
              {RADIO_STATIONS.map((s) => (
                <button
                  key={s.id}
                  className={`dj-station ${stationId === s.id ? "on" : ""}`}
                  onClick={() => onStation(s.id)}
                  disabled={stationBusy !== null}
                  data-tip={s.hint}
                  title={s.hint}
                >
                  {s.name}
                </button>
              ))}
            </div>
          </div>

          <label className="dj-toggle">
            <span>Auto-mix (blend songs)</span>
            <input
              type="checkbox"
              checked={settings.autoMix}
              onChange={(e) => onChange({ autoMix: e.target.checked })}
            />
          </label>

          <label className={`dj-field ${settings.autoMix ? "" : "dj-disabled"}`}>
            <span className="dj-field-label">Transition</span>
            <select
              value={settings.transition}
              disabled={!settings.autoMix}
              onChange={(e) => onChange({ transition: e.target.value as DjTransition })}
            >
              {DJ_TRANSITIONS.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>

          <label className={`slider dj-slider ${fadeDisabled ? "dj-disabled" : ""}`}>
            <span className="slider-label">
              Crossfade
              <em>{settings.crossfadeSec}s</em>
            </span>
            <input
              type="range"
              min={1}
              max={12}
              step={1}
              value={settings.crossfadeSec}
              disabled={fadeDisabled}
              onChange={(e) => onChange({ crossfadeSec: Number(e.target.value) })}
            />
          </label>

          <label className="dj-toggle">
            <span>
              <Shuffle size={12} /> Shuffle order
            </span>
            <input
              type="checkbox"
              checked={settings.shuffle}
              onChange={(e) => onChange({ shuffle: e.target.checked })}
            />
          </label>

          <label className="dj-toggle">
            <span>Random start track</span>
            <input
              type="checkbox"
              checked={settings.randomStart}
              onChange={(e) => onChange({ randomStart: e.target.checked })}
            />
          </label>

          {titles.length > 0 && (
            <div className="dj-tracklist">
              {titles.map((t, i) => (
                <button
                  key={i}
                  className={`dj-track ${nowPlaying?.index === i ? "on" : ""}`}
                  onClick={() => onSelect(i)}
                  title={t}
                >
                  <span className="dj-track-num">{i + 1}</span>
                  <span className="dj-track-name">{t}</span>
                </button>
              ))}
            </div>
          )}
    </>
  );
}

/**
 * Radio station control: a popover holding the resident DJ's now-playing
 * readout, transport (play/pause / prev / skip / DJ-mix / mute / re-roll), the
 * station picker, the full track list, and the auto-mix settings.
 */
export function DjStationPanel({ variant = "menubar", ...body }: Props) {
  const btnBase = variant === "topbar" ? "tab" : "tm-btn";
  const label = body.stationBusy
    ? `Tuning…`
    : body.nowPlaying?.title || body.stationName;
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button className={`${btnBase} dj-trigger`} title={`${body.stationName} — DJ settings`}>
          <Disc3 size={14} className={body.paused ? "" : "dj-spin"} />
          <span className="dj-trigger-label">{label}</span>
          <span aria-hidden>▾</span>
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="sound-popover dj-popover" align="end" sideOffset={6}>
          <div className="sound-popover-title">{body.stationName}</div>
          <DjStationBody {...body} />
          <Popover.Arrow className="sound-popover-arrow" />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
