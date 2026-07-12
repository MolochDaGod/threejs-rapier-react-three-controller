import { useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import type { HudSnapshot, SlotBinding } from "../three/types";
import {
  getTargetPortrait,
  subscribeTargetPortraits,
  targetPortraitVersion,
} from "../three/targetPortraits";
import { WEAPON_ICON } from "../three/icons";
import { Icon } from "./Icon";
const tightBarArt = `${import.meta.env.BASE_URL}hud-tight-bar.png`;
import { UnitFrame } from "./hud/UnitFrame";
import type { HudEditApi, HudPanelBinding } from "../hud/useHudEditor";
import type { HudPanelId } from "../hud/hudConfig";
import {
  QUICK_ACTIONS,
  QUICK_SLOTS_PER_SIDE,
  type QuickActionId,
} from "../hud/quickActions";

interface Props {
  hud: HudSnapshot | null;
  /** Optional HUD-editor api: applies persisted layout and (when editing) drag/select. */
  edit?: HudEditApi;
}

/** Merge a panel's edit binding onto its base className + inline style. */
function applyBind(b: HudPanelBinding | undefined, baseClass: string, baseStyle?: CSSProperties) {
  if (!b) return { className: baseClass, style: baseStyle };
  return {
    "data-hud-panel": b["data-hud-panel"],
    className: `${baseClass} ${b.className}`.trim(),
    style: { ...baseStyle, ...b.style },
    onPointerDown: b.onPointerDown,
    onContextMenu: b.onContextMenu,
  };
}

const bindOf = (edit: HudEditApi | undefined, id: HudPanelId) => edit?.bind(id);

/** A single action-bar slot with icon, keybind and a radial cooldown sweep. */
function SkillSlot({
  keyLabel,
  name,
  icon,
  cd,
  cdMax,
  accent,
}: {
  keyLabel: string;
  name: string;
  icon: string;
  cd: number;
  cdMax: number;
  accent?: boolean;
}) {
  const onCd = cd > 0 && cdMax > 0;
  const frac = onCd ? Math.max(0, Math.min(1, cd / cdMax)) : 0;
  return (
    <div
      className={`act-slot ${accent ? "act-accent" : ""} ${onCd ? "on-cd" : "ready"}`}
      data-tip={keyLabel ? `${name} — press ${keyLabel}` : name}
    >
      <div className="act-icon">
        <Icon name={icon} size={30} />
        {onCd && (
          <div
            className="act-sweep"
            style={{ background: `conic-gradient(rgba(4,10,20,0.78) ${frac * 360}deg, transparent 0deg)` }}
          />
        )}
        {onCd && <span className="act-cd">{cd.toFixed(1)}</span>}
      </div>
      <span className="act-key">{keyLabel}</span>
      <span className="act-name">{name}</span>
    </div>
  );
}

/** Live slot data (label / key / icon / cooldown) for one bound quick action. */
function resolveQuickAction(
  id: QuickActionId,
  hud: HudSnapshot,
  slotByName: (slot: string) => SlotBinding | undefined,
): { keyLabel: string; name: string; icon: string; cd: number; cdMax: number; accent: boolean } {
  const def = QUICK_ACTIONS[id];
  switch (id) {
    case "primary": {
      const s = slotByName("primary");
      return {
        keyLabel: s?.key ?? def.key,
        name: s?.label ?? def.label,
        icon: WEAPON_ICON[hud.weapon],
        cd: 0,
        cdMax: 0,
        accent: false,
      };
    }
    case "fskill": {
      const s = slotByName("fskill");
      return {
        keyLabel: s?.key ?? def.key,
        name: hud.skillName || def.label,
        icon: WEAPON_ICON[hud.weapon],
        cd: hud.skillCooldown,
        cdMax: hud.skillCooldownMax,
        accent: false,
      };
    }
    case "sig1":
    case "sig2":
    case "sig3":
    case "sig4": {
      const i = Number(id.slice(3)) - 1;
      const s = slotByName(id);
      const sigCdMax = hud.sigCooldownMaxes[i] ?? 0;
      return {
        keyLabel: s?.key ?? def.key,
        name: s?.label ?? def.label,
        icon: def.icon,
        cd: sigCdMax > 0 ? (hud.sigCooldowns[i] ?? 0) : hud.skillCooldown,
        cdMax: sigCdMax > 0 ? sigCdMax : hud.skillCooldownMax,
        accent: false,
      };
    }
    case "heavy":
      return {
        keyLabel: def.key,
        name: def.label,
        icon: def.icon,
        cd: hud.skyfallCooldown,
        cdMax: hud.skyfallCooldownMax,
        accent: true,
      };
    default:
      // Static actions/items (parry, block, dodge, bomb, heal): no cooldown feed.
      return { keyLabel: def.key, name: def.label, icon: def.icon, cd: 0, cdMax: 0, accent: false };
  }
}

/* ------------------------------------------------------------------ *
 * HUD Tight bottom bar — the attached Diablo-style HUD art: a health
 * orb on the far left, a mana (stamina) orb on the far right, two
 * 3×2 quick-slot grids and the avatar arch in the middle. All overlay
 * geometry below is measured off the source art (3800×726 px) and
 * expressed as percentages so the bar scales as one piece.
 * ------------------------------------------------------------------ */

const TB_W = 3800;
const TB_H = 726;
const tbX = (px: number) => `${((px / TB_W) * 100).toFixed(3)}%`;
const tbY = (px: number) => `${((px / TB_H) * 100).toFixed(3)}%`;

/** Slot cell size in art pixels (scanline-measured off the cell interiors). */
const TB_CELL_W = 230;
const TB_CELL_H = 132;
/** Column left edges: 3 cells in the left grid, 3 in the right grid. */
const TB_COLS = [776, 1028, 1274, 2276, 2526, 2772];
/** Row top edges (2 rows per grid). */
const TB_ROWS = [378, 548];
/** Orb liquid circles (center / radius, art px — the glass sphere only). */
const TB_ORB_R = 150;
const TB_ORB_HP = { cx: 354, cy: 360 };
const TB_ORB_MP = { cx: 3446, cy: 360 };

/** Position style for quick slot i (0..5 = left grid, 6..11 = right grid, row-major). */
function tbSlotStyle(i: number): CSSProperties {
  const grid = i < QUICK_SLOTS_PER_SIDE ? 0 : 1;
  const j = i % QUICK_SLOTS_PER_SIDE;
  const col = grid * 3 + (j % 3);
  const row = Math.floor(j / 3);
  return {
    left: tbX(TB_COLS[col]),
    top: tbY(TB_ROWS[row]),
    width: tbX(TB_CELL_W),
    height: tbY(TB_CELL_H),
  };
}

function tbOrbStyle(orb: { cx: number; cy: number }): CSSProperties {
  return {
    left: tbX(orb.cx - TB_ORB_R),
    top: tbY(orb.cy - TB_ORB_R),
    width: tbX(TB_ORB_R * 2),
    height: tbY(TB_ORB_R * 2),
  };
}

/** A vital orb: the art's liquid globe with a top-down "drain" cover. */
function TightOrb({
  kind,
  value,
  max,
}: {
  kind: "hp" | "mp";
  value: number;
  max: number;
}) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  const label = kind === "hp" ? "Health" : "Stamina";
  return (
    <div
      className={`tb-orb tb-orb-${kind}`}
      style={tbOrbStyle(kind === "hp" ? TB_ORB_HP : TB_ORB_MP)}
      data-tip={`${label} — ${Math.round(value)}/${Math.round(max)}`}
    >
      <div className="tb-orb-drain" style={{ height: `${100 - pct}%` }} />
      <span className="tb-orb-val">{Math.round(value)}</span>
    </div>
  );
}

/**
 * The full HUD Tight bottom bar. Replaces the on-foot action bar when the
 * "tight" layout is selected (the mech cockpit keeps its own bar while
 * piloting). Binds to the `tightbar` editor panel as a single piece.
 */
function TightBar({
  hud,
  slots,
  bind,
}: {
  hud: HudSnapshot;
  slots: (QuickActionId | null)[];
  bind?: HudPanelBinding;
}) {
  const slotByName = (slot: string): SlotBinding | undefined =>
    hud.slots.find((s) => s.slot === slot);
  const poisePct =
    hud.maxPoise > 0 ? Math.max(0, Math.min(100, (hud.poise / hud.maxPoise) * 100)) : 0;
  return (
    <div {...applyBind(bind, "tightbar", { backgroundImage: `url(${tightBarArt})` })}>
      {/* Health orb (left) + stamina orb (right) */}
      <TightOrb kind="hp" value={hud.health} max={hud.maxHealth} />
      <TightOrb kind="mp" value={hud.stamina} max={hud.maxStamina} />

      {/* 6 + 6 quick slots over the art's grid cells */}
      {slots.map((id, i) => {
        const style = tbSlotStyle(i);
        if (!id) {
          return (
            <div
              key={i}
              className="tb-slot tb-empty"
              style={style}
              data-tip="Empty slot — no action bound"
            >
              <span className="tb-key">·</span>
            </div>
          );
        }
        const r = resolveQuickAction(id, hud, slotByName);
        const onCd = r.cd > 0 && r.cdMax > 0;
        const frac = onCd ? Math.max(0, Math.min(1, r.cd / r.cdMax)) : 0;
        return (
          <div
            key={`${id}-${i}`}
            className={`tb-slot ${r.accent ? "tb-accent" : ""} ${onCd ? "on-cd" : "ready"}`}
            style={style}
            data-tip={r.keyLabel ? `${r.name} — press ${r.keyLabel}` : r.name}
          >
            <Icon name={r.icon} size={30} />
            {onCd && (
              <div
                className="tb-sweep"
                style={{
                  background: `conic-gradient(rgba(4,10,20,0.78) ${frac * 360}deg, transparent 0deg)`,
                }}
              />
            )}
            {onCd && <span className="tb-cd">{r.cd.toFixed(1)}</span>}
            <span className="tb-key">{r.keyLabel}</span>
          </div>
        );
      })}

      {/* Avatar portrait in the centre arch */}
      <div className="tb-avatar">
        <FramePortrait
          portraitKey={hud.playerPortraitKey}
          name={hud.character}
          fallback={<Icon name={WEAPON_ICON[hud.weapon]} size={44} />}
        />
        <span className="tb-avatar-name">{hud.character}</span>
      </div>

      {/* Poise strip on the planks under the arch */}
      <div className="tb-poise" data-tip={`Poise — ${Math.round(hud.poise)}/${hud.maxPoise}`}>
        <div
          className={`tb-poise-fill${hud.critWindow > 0 ? " crit" : ""}`}
          style={{ width: `${poisePct}%` }}
        />
      </div>
    </div>
  );
}

/**
 * Lock-on health frame, anchored up-and-left of the projected head. Styled via
 * the `.tframe` classes (see index.css) so the HUD Tight layout can reskin it
 * with the iron/wood fantasy chrome without touching the stock look.
 */
function TargetFrame({
  target,
  accent = "hostile",
}: {
  // Typed off the ally shape (no `id`/`portraitKey`): this frame is stateless,
  // so it accepts both the hostile target (which carries extra fields for
  // tween keying and portraits) and allies.
  target: NonNullable<HudSnapshot["selectedAllyTarget"]>;
  accent?: "hostile" | "ally";
}) {
  const pct = Math.max(0, Math.min(100, (target.health / target.maxHealth) * 100));
  return (
    <div
      className={`tframe tframe-${accent}`}
      style={{ left: `${target.x}px`, top: `${target.y}px` }}
    >
      <div className="tframe-head">
        <span className="tframe-name">{target.name}</span>
        <span className="tframe-val">
          {Math.round(target.health)}/{target.maxHealth}
        </span>
      </div>
      <div className="tframe-track">
        <div className="tframe-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/** A compact bar used for poise (no number label on small versions). */
function PoiseBar({ value, max, crit }: { value: number; max: number; crit: boolean }) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className="vital vital-poise">
      <span className="vital-label">POI</span>
      <div className="vital-track">
        <div
          className="vital-fill"
          style={{
            width: `${pct}%`,
            background: crit ? "linear-gradient(90deg,#ffcc22,#ff6600)" : "linear-gradient(90deg,#6490ff,#3060cc)",
          }}
        />
      </div>
    </div>
  );
}

/** Chip showing the active combat state when it is anything other than idle. */
function CombatStateChip({ state, critWindow }: { state: string; critWindow: number }) {
  if (state === "idle" && critWindow <= 0) return null;
  const isNeutral = state === "parry" || state === "block" || state === "dodge";
  const isHurt = state === "stagger" || state === "stunned" || state === "fallen" || state === "getUp";
  const isCrit = critWindow > 0;
  let bg = "#3060cc88";
  let label = state.toUpperCase();
  if (isCrit) { bg = "#ff660099"; label = "CRIT OPEN"; }
  else if (isHurt) bg = "#aa222288";
  else if (isNeutral) bg = "#22aa6688";

  return (
    <span
      style={{
        display: "inline-block",
        marginTop: 2,
        padding: "1px 7px",
        borderRadius: 4,
        background: bg,
        color: isCrit ? "#ffcc22" : isHurt ? "#ff8888" : "#88ffcc",
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        border: isCrit ? "1px solid #ff660066" : "1px solid rgba(255,255,255,0.1)",
        animation: isCrit ? "combat-crit-pulse 0.6s ease-in-out infinite alternate" : undefined,
      }}
    >
      {label}
    </span>
  );
}

/** Compact poise readout used inside the target frame's footer (right-anchored). */
function EnemyPoiseBar({ value, max, crit }: { value: number; max: number; crit: boolean }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className="vital vital-poise" style={{ width: 150 }}>
      <span className="vital-label">POI</span>
      <div className="vital-track" style={{ height: 8 }}>
        <div
          className="vital-fill"
          style={{
            width: `${pct}%`,
            background: crit ? "linear-gradient(90deg,#ffcc22,#ff6600)" : "linear-gradient(90deg,#6490ff,#3060cc)",
          }}
        />
      </div>
    </div>
  );
}

/**
 * A status-frame portrait ring content: the rendered face thumbnail when the
 * portrait store has (or finishes) a capture for this key, else the given
 * fallback (initial letter for enemies, weapon icon for the player).
 * Subscribes to the store so the fallback swaps to the image the moment a
 * deferred capture lands.
 */
function FramePortrait({
  portraitKey,
  name,
  fallback,
}: {
  portraitKey: string | null;
  name: string;
  fallback?: ReactNode;
}) {
  useSyncExternalStore(subscribeTargetPortraits, targetPortraitVersion);
  const url = portraitKey ? getTargetPortrait(portraitKey) : null;
  if (url) return <img className="uf-portrait-img" src={url} alt={name} draggable={false} />;
  if (fallback !== undefined) return <>{fallback}</>;
  return <span className="uf-portrait-letter">{(name[0] ?? "?").toUpperCase()}</span>;
}

/**
 * Ornate target status frame (top-right, mirrored) — appears only while a
 * hostile is Tab-locked. Bars come from the focused-enemy combat readout,
 * which tracks the locked target while a selection exists.
 */
function TargetStatusFrame({ hud, edit }: { hud: HudSnapshot; edit?: HudEditApi }) {
  const bind = bindOf(edit, "enemy");
  const editing = !!bind && bind.className.includes("hud-editable");
  // Visible only while a target is locked — but force-render a placeholder in
  // HUD-edit mode so the panel can still be selected / moved.
  if (!hud.selectedTarget && !editing) return null;
  const name = hud.selectedTarget?.name ?? "Target";
  const isCrit = hud.enemyCritWindow > 0;
  const state = hud.enemyCombatState;
  const isDown = state === "stunned" || state === "fallen" || state === "stagger";
  return (
    <div {...applyBind(bind, "uf-panel uf-panel-target")}>
      <UnitFrame
        // Key by the enemy's unique id, not its name: dummies wielding the same
        // weapon share a display name, and a same-name swap must still remount
        // so the tween/ghost state resets instead of animating across units.
        key={hud.selectedTarget?.id ?? "edit-placeholder"}
        side="right"
        variant="target"
        name={name}
        sub="Hostile"
        portrait={
          <FramePortrait portraitKey={hud.selectedTarget?.portraitKey ?? null} name={name} />
        }
        badge={<span>☠</span>}
        hp={{ value: hud.enemyHealth, max: hud.enemyMaxHealth }}
        energy={{ value: hud.enemyStamina, max: hud.enemyMaxStamina }}
      />
      <div className="uf-footer uf-flip-footer">
        <EnemyPoiseBar value={hud.enemyPoise} max={hud.enemyMaxPoise} crit={isCrit} />
        {(isDown || isCrit) && (
          <span
            style={{
              fontSize: 10,
              fontWeight: 800,
              letterSpacing: "0.1em",
              fontFamily: "monospace",
              color: isCrit ? "#ffcc22" : "#ff8888",
              textShadow: "0 1px 2px rgba(0,0,0,0.9)",
              animation: isCrit ? "combat-crit-pulse 0.6s ease-in-out infinite alternate" : undefined,
            }}
          >
            {isCrit ? "✦ CRIT OPEN" : `↯ ${state.toUpperCase()}`}
          </span>
        )}
      </div>
    </div>
  );
}

/** Per-zone presentation for the dungeon depth cue. */
const ZONE_META: Record<
  NonNullable<HudSnapshot["zone"]>,
  { label: string; sub: string; icon: string; color: string }
> = {
  surface: { label: "SURFACE", sub: "Forge Map", icon: "⛰", color: "#9fd3ff" },
  underwater: { label: "UNDERWATER", sub: "The Descent", icon: "≋", color: "#4fc7e8" },
  pit: { label: "THE PIT", sub: "Sealed Depths", icon: "▼", color: "#ff7a5c" },
};

/** Top-center dungeon zone cue (surface / underwater / pit). */
function ZoneIndicator({ zone }: { zone: NonNullable<HudSnapshot["zone"]> }) {
  const meta = ZONE_META[zone];
  return (
    <div
      style={{
        position: "absolute",
        top: 14,
        left: "50%",
        transform: "translateX(-50%)",
        display: "flex",
        alignItems: "center",
        gap: 8,
        background: "rgba(4,8,20,0.72)",
        border: `1px solid ${meta.color}55`,
        borderRadius: 999,
        padding: "5px 14px",
        fontFamily: "monospace",
        color: meta.color,
        backdropFilter: "blur(6px)",
        pointerEvents: "none",
        textShadow: "0 1px 3px rgba(0,0,0,0.6)",
      }}
    >
      <span style={{ fontSize: 14, lineHeight: 1 }}>{meta.icon}</span>
      <span style={{ fontWeight: 700, fontSize: 12, letterSpacing: "0.14em" }}>{meta.label}</span>
      <span style={{ fontSize: 10, opacity: 0.7, letterSpacing: "0.06em" }}>{meta.sub}</span>
    </div>
  );
}

/** Distinct boss health bar (bottom-center) for the locked boss-tier hostile. */
function BossBar({ boss }: { boss: NonNullable<HudSnapshot["boss"]> }) {
  const hp = Math.max(0, Math.min(100, (boss.health / boss.maxHealth) * 100));
  return (
    <div
      style={{
        position: "absolute",
        bottom: 92,
        left: "50%",
        transform: "translateX(-50%)",
        width: "min(560px, 60vw)",
        textAlign: "center",
        fontFamily: "monospace",
        pointerEvents: "none",
      }}
    >
      <div
        style={{
          fontSize: 15,
          fontWeight: 800,
          letterSpacing: "0.22em",
          color: "#ffd9c2",
          textShadow: "0 0 10px rgba(255,80,40,0.7), 0 1px 3px rgba(0,0,0,0.8)",
          marginBottom: 5,
        }}
      >
        {boss.name.toUpperCase()}
      </div>
      <div
        style={{
          height: 14,
          background: "rgba(8,4,6,0.82)",
          border: "1px solid rgba(255,90,60,0.55)",
          borderRadius: 4,
          overflow: "hidden",
          boxShadow: "0 0 14px rgba(255,60,30,0.35)",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${hp}%`,
            background: "linear-gradient(90deg,#ff3b1f,#a30d0d)",
            boxShadow: "0 0 12px rgba(255,70,40,0.6) inset",
            transition: "width 0.25s",
          }}
        />
      </div>
      <div style={{ fontSize: 10, color: "#ffb59c", opacity: 0.85, marginTop: 3 }}>
        {boss.health} / {boss.maxHealth}
      </div>
      {boss.hint && (
        <div
          style={{
            marginTop: 6,
            display: "inline-block",
            padding: "3px 12px",
            background: "rgba(8,4,6,0.7)",
            border: "1px solid rgba(255,210,63,0.45)",
            borderRadius: 4,
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            color: "#ffd23f",
            textShadow: "0 0 8px rgba(255,180,40,0.55), 0 1px 2px rgba(0,0,0,0.8)",
          }}
        >
          {boss.hint}
        </div>
      )}
    </div>
  );
}

/** Center-screen event flash (PERFECT PARRY!, SHIELD BREAK!, etc.). */
function CombatFlash({ text }: { text: string }) {
  if (!text) return null;
  return (
    <div
      style={{
        position: "absolute",
        top: "28%",
        left: "50%",
        transform: "translateX(-50%)",
        pointerEvents: "none",
        textAlign: "center",
        zIndex: 100,
      }}
    >
      <span
        style={{
          display: "inline-block",
          padding: "6px 20px",
          background: "rgba(4,8,20,0.8)",
          border: "1px solid rgba(255,220,60,0.6)",
          borderRadius: 8,
          color: "#ffe060",
          fontSize: 22,
          fontWeight: 900,
          fontFamily: "monospace",
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          textShadow: "0 0 12px #ffaa00aa",
          animation: "combat-flash-in 0.18s ease-out",
        }}
      >
        {text}
      </span>
    </div>
  );
}

export function Hud({ hud, edit }: Props) {
  if (!hud) return null;

  const slotByName = (slot: string): SlotBinding | undefined => hud.slots.find((s) => s.slot === slot);
  const primary = slotByName("primary");
  const fskill = slotByName("fskill");
  const sigs = (["sig1", "sig2", "sig3", "sig4"] as const)
    .map((id) => slotByName(id))
    .filter((s): s is SlotBinding => !!s);

  // HUD_tight layout: the on-foot bottom bar is replaced by the Diablo-style
  // tight bar. The mech cockpit kit keeps the bottom bar while piloting.
  const tight = edit?.config.layout === "tight";
  const quickSlots = edit?.config.quickSlots ?? [];
  const showTightBar = tight && !hud.mech;
  const showActionBar = !tight || !!hud.mech;

  return (
    <>
      {/* Fire-tinted pulsing rim while the Striker hovers */}
      {hud.hovering && <div className="hover-vignette" />}

      {/* Red rim that fades after taking a hit */}
      {hud.hurt > 0 && (
        <div className="hurt-vignette" style={{ opacity: Math.min(1, hud.hurt / 0.4) }} />
      )}

      {/* Floating health frame for the Tab-locked enemy, up-and-left of its head */}
      {hud.selectedTarget && <TargetFrame target={hud.selectedTarget} accent="hostile" />}

      {/* Green health frame for the Shift+Tab-selected ally */}
      {hud.selectedAllyTarget && <TargetFrame target={hud.selectedAllyTarget} accent="ally" />}

      {/* Dungeon zone cue (surface / underwater / pit) */}
      {hud.zone && <ZoneIndicator zone={hud.zone} />}

      {/* Distinct boss health bar when the boss is the locked hostile */}
      {hud.boss && <BossBar boss={hud.boss} />}

      {/* Contextual interaction prompt (e.g. the dungeon door portal) */}
      {hud.prompt && <div className="interact-prompt">{hud.prompt}</div>}

      {/* Defeated overlay */}
      {hud.defeated && (
        <div className="defeat-overlay">
          <span className="defeat-title">DEFEATED</span>
          <span className="defeat-sub">Respawning…</span>
        </div>
      )}

      {/* Center-screen event flash */}
      <CombatFlash text={hud.combatFlash} />

      {/* Player status frame (top-left) — animated HP/energy unit frame */}
      <div {...applyBind(bindOf(edit, "vitals"), "uf-panel uf-panel-player")}>
        <UnitFrame
          side="left"
          variant="player"
          name={hud.character}
          sub={hud.weaponLabel}
          portrait={
            <FramePortrait
              portraitKey={hud.playerPortraitKey}
              name={hud.character}
              fallback={<Icon name={WEAPON_ICON[hud.weapon]} size={46} />}
            />
          }
          badge={<Icon name={WEAPON_ICON[hud.weapon]} size={18} />}
          hp={{ value: hud.health, max: hud.maxHealth }}
          energy={{ value: hud.stamina, max: hud.maxStamina }}
        />
        <div className="uf-footer">
          <div style={{ width: 150 }}>
            <PoiseBar value={hud.poise} max={hud.maxPoise} crit={hud.critWindow > 0} />
          </div>
          <CombatStateChip state={hud.combatState} critWindow={hud.critWindow} />
          {/* Combat input hints */}
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap", maxWidth: 230 }}>
            {(["Q: Parry", "E: Block", "X: Dodge", "R: Heavy", "H: Bomb", "J: Heal"] as const).map((hint) => (
              <span
                key={hint}
                style={{
                  fontSize: 9,
                  opacity: 0.55,
                  color: "#dbe7ff",
                  background: "rgba(255,255,255,0.06)",
                  borderRadius: 3,
                  padding: "1px 5px",
                  fontFamily: "monospace",
                  letterSpacing: "0.05em",
                }}
              >
                {hint}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Target status frame (top-right) — only while a hostile is locked */}
      <TargetStatusFrame hud={hud} edit={edit} />

      {/* HUD_tight layout — Diablo-style bottom bar (orbs + 6+6 slots + avatar) */}
      {showTightBar && (
        <TightBar hud={hud} slots={quickSlots} bind={bindOf(edit, "tightbar")} />
      )}

      {/* Action bar — the mech's bespoke kit replaces the on-foot skills while piloting */}
      {showActionBar && (
      <div {...applyBind(bindOf(edit, "actionbar"), "rpg-actionbar")}>
        {hud.mech ? (
          <>
            <SkillSlot keyLabel="LMB" name="Power Smash" icon="attack" cd={0} cdMax={0} />
            {hud.mech.abilities.map((a) => (
              <SkillSlot
                key={a.key}
                keyLabel={a.key}
                name={a.name}
                icon={a.icon}
                cd={a.cd}
                cdMax={a.cdMax}
                accent
              />
            ))}
          </>
        ) : (
          <>
            {primary && (
              <SkillSlot
                keyLabel={primary.key}
                name={primary.label}
                icon={WEAPON_ICON[hud.weapon]}
                cd={0}
                cdMax={0}
              />
            )}
            {fskill && (
              <SkillSlot
                keyLabel={fskill.key}
                name={hud.skillName}
                icon={WEAPON_ICON[hud.weapon]}
                cd={hud.skillCooldown}
                cdMax={hud.skillCooldownMax}
              />
            )}
            {sigs.map((s, i) => {
              const sigCd = hud.sigCooldowns[i] ?? 0;
              const sigCdMax = hud.sigCooldownMaxes[i] ?? 0;
              const cd = sigCdMax > 0 ? sigCd : hud.skillCooldown;
              const cdMax = sigCdMax > 0 ? sigCdMax : hud.skillCooldownMax;
              return (
                <SkillSlot
                  key={s.slot}
                  keyLabel={s.key}
                  name={s.label}
                  icon={(["scout", "ambush", "siege", "skill-vfx-lab"] as const)[i] ?? "skill-vfx-lab"}
                  cd={cd}
                  cdMax={cdMax}
                />
              );
            })}
            <SkillSlot
              keyLabel="R"
              name="Heavy / Skyfall"
              icon="charge"
              cd={hud.skyfallCooldown}
              cdMax={hud.skyfallCooldownMax}
              accent
            />
          </>
        )}
      </div>
      )}

      {/* Combat readout */}
      <div {...applyBind(bindOf(edit, "stats"), "rpg-stats")}>
        <span className="now-playing" data-tip="Currently playing animation clip">
          ▶ {hud.clip || "idle"}
        </span>
        <span>
          <em>Targets</em> {hud.targetsAlive}
        </span>
        <span className={`spar-diff diff-${hud.difficulty}`}>
          <em>Spar</em> {hud.difficulty}
        </span>
        {hud.blocking && <span className="spar-block">▣ Block</span>}
        <span>
          <em>Jumps</em> {hud.jumpsLeft}
        </span>
        <span className="dim">{hud.fps} fps</span>
      </div>

      {/* CSS for new combat animations */}
      <style>{`
        @keyframes combat-crit-pulse {
          from { opacity: 1; }
          to   { opacity: 0.55; }
        }
        @keyframes combat-flash-in {
          from { opacity: 0; transform: translateX(-50%) scale(0.82); }
          to   { opacity: 1; transform: translateX(-50%) scale(1); }
        }
        .vital-poise .vital-fill {
          transition: width 0.25s, background 0.3s;
        }
      `}</style>
    </>
  );
}
