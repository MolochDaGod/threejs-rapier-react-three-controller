import { Eye, EyeOff, Plus, RotateCcw, Trash2, X } from "lucide-react";
import { useState } from "react";
import {
  hasAppearanceOverrides,
  HUD_LAYOUT_IDS,
  HUD_LAYOUTS,
  HUD_PANEL_IDS,
  HUD_PANEL_META,
  lookMatchesConfig,
  MAX_GLOW,
  MAX_LOOK_NAME,
  MAX_RADIUS,
  MAX_SCALE,
  MIN_GLOW,
  MIN_RADIUS,
  MIN_SCALE,
  type HudPanelId,
} from "../../hud/hudConfig";
import {
  isQuickActionId,
  QUICK_ACTION_IDS,
  QUICK_ACTIONS,
  QUICK_SLOTS_PER_SIDE,
} from "../../hud/quickActions";
import {
  HUD_FONT_IDS,
  HUD_FONTS,
  HUD_THEMES,
  HUD_THEME_IDS,
  hudThemeVars,
  type HudFontId,
} from "../../hud/hudThemes";
import type { HudEditorControls } from "../../hud/useHudEditor";

interface Props {
  controls: HudEditorControls;
  onClose: () => void;
}

/**
 * The Danger Room 2D UI-layer editor — a Grudge-kit-style left rail for picking a
 * theme, fine-tuning its colors / corners / glow / typeface, toggling/selecting
 * HUD layers, and tweaking the selected panel. The live HUD panels themselves are
 * dragged directly on the canvas; a transparent catcher behind the rail swallows
 * clicks so the engine never grabs pointer-lock.
 */
export function HudEditor({ controls, onClose }: Props) {
  const {
    config,
    selected,
    setSelected,
    setTheme,
    setLayout,
    setQuickSlot,
    setAppearance,
    resetAppearance,
    setPanel,
    toggleHidden,
    resetPanel,
    resetAll,
    looks,
    looksFull,
    saveLook,
    applyLook,
    deleteLook,
  } = controls;
  const [lookName, setLookName] = useState("");
  const sel = selected;
  const selLayout = sel ? config.panels[sel] : null;

  const themeVars = hudThemeVars(config.theme);
  const a = config.appearance;
  const themed = config.theme !== "default";
  const accent = a.accent ?? themeVars["--hud-accent"];
  const accent2 = a.accent2 ?? themeVars["--hud-accent-2"];
  const radius = a.radius ?? (parseFloat(themeVars["--hud-radius"]) || 0);
  const glow = a.glow ?? 1;
  const hasTweaks = hasAppearanceOverrides(a);

  return (
    <>
      {/* Catches canvas clicks so the engine doesn't lock the pointer; click to deselect. */}
      <div className="hud-edit-catcher" onPointerDown={() => setSelected(null)} />

      <aside className="hud-editor" onPointerDown={(e) => e.stopPropagation()}>
        <header className="hud-editor-head">
          <div>
            <div className="hud-editor-title">HUD STUDIO</div>
            <div className="hud-editor-sub">Theme · customize · layout</div>
          </div>
          <button className="hud-editor-close" onClick={onClose} title="Done">
            <X size={15} />
          </button>
        </header>

        <div className="hud-editor-scroll">
          <section className="hud-editor-section">
            <div className="hud-editor-label">Theme</div>
            {HUD_THEME_IDS.map((id) => {
              const t = HUD_THEMES[id];
              return (
                <button
                  key={id}
                  className={`hud-theme-card${config.theme === id ? " active" : ""}`}
                  onClick={() => setTheme(id)}
                >
                  <span className="hud-theme-swatches">
                    <span style={{ background: t.vars["--hud-accent"] }} />
                    <span style={{ background: t.vars["--hud-accent-2"] }} />
                  </span>
                  <span className="hud-theme-text">
                    <span className="hud-theme-name">{t.name}</span>
                    <span className="hud-theme-blurb">{t.blurb}</span>
                  </span>
                </button>
              );
            })}
          </section>

          <section className="hud-editor-section">
            <div className="hud-editor-label">Layout</div>
            {HUD_LAYOUT_IDS.map((id) => {
              const l = HUD_LAYOUTS[id];
              return (
                <button
                  key={id}
                  className={`hud-layout-card${config.layout === id ? " active" : ""}`}
                  onClick={() => setLayout(id)}
                >
                  <span className="hud-theme-text">
                    <span className="hud-theme-name">{l.name}</span>
                    <span className="hud-theme-blurb">{l.blurb}</span>
                  </span>
                </button>
              );
            })}
          </section>

          {config.layout === "tight" && (
            <section className="hud-editor-section">
              <div className="hud-editor-label">Quick Menu</div>
              <div className="hud-editor-note">
                Bind the 6+6 side slots to actions, skills and items.
              </div>
              {config.quickSlots.map((slot, i) => {
                const side = i < QUICK_SLOTS_PER_SIDE ? "L" : "R";
                const n = (i % QUICK_SLOTS_PER_SIDE) + 1;
                return (
                  <label key={i} className="hud-quickslot-row">
                    <span className="hud-quickslot-cap">
                      {side}
                      {n}
                    </span>
                    <select
                      className="hud-quickslot-select"
                      value={slot ?? ""}
                      onChange={(e) => {
                        const v = e.target.value;
                        setQuickSlot(i, isQuickActionId(v) ? v : null);
                      }}
                    >
                      <option value="">— Empty —</option>
                      {QUICK_ACTION_IDS.map((id) => (
                        <option key={id} value={id}>
                          {QUICK_ACTIONS[id].label} ({QUICK_ACTIONS[id].key})
                        </option>
                      ))}
                    </select>
                  </label>
                );
              })}
            </section>
          )}

          <section className="hud-editor-section">
            <div className="hud-editor-label">
              Customize
              {hasTweaks && (
                <button className="hud-mini-reset" onClick={resetAppearance} title="Reset tweaks">
                  <RotateCcw size={11} /> Reset
                </button>
              )}
            </div>
            {!themed && (
              <div className="hud-editor-note">Pick a theme above to apply your tweaks.</div>
            )}

            <div className="hud-custom-grid">
              <label className="hud-color-row">
                <span className="hud-color-cap">Accent</span>
                <input
                  type="color"
                  className="hud-color-input"
                  value={toHex(accent)}
                  onChange={(e) => setAppearance({ accent: e.target.value })}
                />
              </label>
              <label className="hud-color-row">
                <span className="hud-color-cap">Secondary</span>
                <input
                  type="color"
                  className="hud-color-input"
                  value={toHex(accent2)}
                  onChange={(e) => setAppearance({ accent2: e.target.value })}
                />
              </label>
            </div>

            <label className="hud-slider-row">
              <span className="hud-slider-cap">Corners</span>
              <input
                type="range"
                min={MIN_RADIUS}
                max={MAX_RADIUS}
                step={1}
                value={radius}
                onChange={(e) => setAppearance({ radius: parseFloat(e.target.value) })}
              />
              <span className="hud-slider-val">{Math.round(radius)}px</span>
            </label>

            <label className="hud-slider-row">
              <span className="hud-slider-cap">Glow</span>
              <input
                type="range"
                min={MIN_GLOW}
                max={MAX_GLOW}
                step={0.05}
                value={glow}
                onChange={(e) => setAppearance({ glow: parseFloat(e.target.value) })}
              />
              <span className="hud-slider-val">{Math.round(glow * 100)}%</span>
            </label>

            <div className="hud-editor-sublabel">Typeface</div>
            <div className="hud-font-row">
              <button
                className={`hud-font-chip${a.font === null ? " active" : ""}`}
                onClick={() => setAppearance({ font: null })}
              >
                Theme
              </button>
              {HUD_FONT_IDS.map((fid: HudFontId) => (
                <button
                  key={fid}
                  className={`hud-font-chip${a.font === fid ? " active" : ""}`}
                  style={{ fontFamily: HUD_FONTS[fid].stack }}
                  onClick={() => setAppearance({ font: fid })}
                >
                  {HUD_FONTS[fid].name}
                </button>
              ))}
            </div>
          </section>

          <section className="hud-editor-section">
            <div className="hud-editor-label">Saved Looks</div>
            <form
              className="hud-look-save"
              onSubmit={(e) => {
                e.preventDefault();
                if (looksFull) return;
                saveLook(lookName);
                setLookName("");
              }}
            >
              <input
                type="text"
                className="hud-look-input"
                placeholder={looksFull ? "Saved-look limit reached" : "Name this look…"}
                maxLength={MAX_LOOK_NAME}
                value={lookName}
                disabled={looksFull}
                onChange={(e) => setLookName(e.target.value)}
              />
              <button
                type="submit"
                className="hud-look-add"
                title="Save current look"
                disabled={looksFull || lookName.trim() === ""}
              >
                <Plus size={14} />
              </button>
            </form>

            {looks.length === 0 ? (
              <div className="hud-editor-note">
                Tune a theme, then save it here to reuse it later.
              </div>
            ) : (
              looks.map((look) => {
                const lt = HUD_THEMES[look.theme] ?? HUD_THEMES.default;
                const accentSwatch = look.appearance.accent ?? lt.vars["--hud-accent"];
                const accent2Swatch = look.appearance.accent2 ?? lt.vars["--hud-accent-2"];
                const active = lookMatchesConfig(look, config);
                return (
                  <div
                    key={look.id}
                    className={`hud-look-row${active ? " active" : ""}`}
                    onClick={() => applyLook(look.id)}
                    title={`Apply "${look.name}"`}
                  >
                    <span className="hud-theme-swatches">
                      <span style={{ background: accentSwatch }} />
                      <span style={{ background: accent2Swatch }} />
                    </span>
                    <span className="hud-look-text">
                      <span className="hud-look-name">{look.name}</span>
                      <span className="hud-look-meta">{lt.name}</span>
                    </span>
                    <button
                      className="hud-look-del"
                      title="Delete look"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteLook(look.id);
                      }}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                );
              })
            )}
          </section>

          <section className="hud-editor-section">
            <div className="hud-editor-label">Layers</div>
            {HUD_PANEL_IDS.map((id) => {
              const meta = HUD_PANEL_META[id];
              const panel = config.panels[id];
              return (
                <div
                  key={id}
                  className={`hud-layer-row${selected === id ? " active" : ""}${
                    panel.hidden ? " hidden" : ""
                  }`}
                  onClick={() => setSelected(id)}
                >
                  <button
                    className="hud-layer-eye"
                    title={panel.hidden ? "Show panel" : "Hide panel"}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleHidden(id);
                    }}
                  >
                    {panel.hidden ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                  <span className="hud-layer-text">
                    <span className="hud-layer-name">{meta.label}</span>
                    <span className="hud-layer-hint">{meta.hint}</span>
                  </span>
                </div>
              );
            })}
          </section>

          {sel && selLayout && (
            <section className="hud-editor-section">
              <div className="hud-editor-label">{HUD_PANEL_META[sel].label}</div>
              <PanelInspector
                id={sel}
                scale={selLayout.scale}
                hidden={selLayout.hidden}
                onScale={(scale) => setPanel(sel, { scale })}
                onToggleHidden={() => toggleHidden(sel)}
                onReset={() => resetPanel(sel)}
                onNudge={(dx, dy) =>
                  setPanel(sel, { dx: selLayout.dx + dx, dy: selLayout.dy + dy })
                }
              />
            </section>
          )}
        </div>

        <footer className="hud-editor-foot">
          <button className="hud-editor-reset" onClick={resetAll}>
            <RotateCcw size={13} /> Reset all
          </button>
          <button className="hud-editor-done" onClick={onClose}>
            Done
          </button>
        </footer>
      </aside>
    </>
  );
}

/** Coerce an arbitrary CSS color into a `#rrggbb` value an <input type=color> accepts. */
function toHex(color: string): string {
  if (/^#[0-9a-fA-F]{6}$/.test(color)) return color;
  if (/^#[0-9a-fA-F]{3}$/.test(color)) {
    const [, r, g, b] = color.match(/^#(.)(.)(.)$/)!;
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  return "#4fc3ff";
}

function PanelInspector({
  id,
  scale,
  hidden,
  onScale,
  onToggleHidden,
  onReset,
  onNudge,
}: {
  id: HudPanelId;
  scale: number;
  hidden: boolean;
  onScale: (v: number) => void;
  onToggleHidden: () => void;
  onReset: () => void;
  onNudge: (dx: number, dy: number) => void;
}) {
  const STEP = 8;
  return (
    <div className="hud-inspector" key={id}>
      <div className="hud-inspector-row">
        <span className="hud-inspector-cap">Position</span>
        <div className="hud-nudge">
          <button onClick={() => onNudge(0, -STEP)} title="Up">↑</button>
          <div className="hud-nudge-mid">
            <button onClick={() => onNudge(-STEP, 0)} title="Left">←</button>
            <button onClick={() => onNudge(STEP, 0)} title="Right">→</button>
          </div>
          <button onClick={() => onNudge(0, STEP)} title="Down">↓</button>
        </div>
      </div>

      <label className="hud-inspector-row">
        <span className="hud-inspector-cap">Scale</span>
        <input
          type="range"
          min={MIN_SCALE}
          max={MAX_SCALE}
          step={0.05}
          value={scale}
          onChange={(e) => onScale(parseFloat(e.target.value))}
        />
        <span className="hud-inspector-val">{Math.round(scale * 100)}%</span>
      </label>

      <div className="hud-inspector-actions">
        <button className="hud-inspector-btn" onClick={onToggleHidden}>
          {hidden ? "Show" : "Hide"}
        </button>
        <button className="hud-inspector-btn" onClick={onReset}>
          Reset
        </button>
      </div>
    </div>
  );
}
