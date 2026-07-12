import type { CreatePostPayload } from "@workspace/api-client-react";
import { WEAPONS } from "../three/assets";
import type { WeaponId } from "../three/types";
import {
  PROP_LIST,
  type BrushState,
  type DeployableKind,
  type DeployableNode,
  type Difficulty,
  type EditorStats,
  type GizmoMode,
  type PieceShape,
} from "../three/voxel/types";
import { PostToGallery } from "./PostToGallery";
import { VoxelHierarchyPanel } from "./VoxelHierarchyPanel";

const GIZMO_MODES: { id: GizmoMode; label: string; glyph: string; key: string }[] = [
  { id: "translate", label: "Move", glyph: "✥", key: "G" },
  { id: "rotate", label: "Rotate", glyph: "↻", key: "R" },
  { id: "scale", label: "Scale", glyph: "⤢", key: "E" },
];

const SHAPES: { id: PieceShape; label: string; glyph: string; hint: string }[] = [
  { id: "block", label: "Block", glyph: "▦", hint: "Full cube — the basic building block" },
  { id: "slab", label: "Slab", glyph: "▭", hint: "Half-height piece — floors & steps" },
  { id: "wall", label: "Wall", glyph: "▯", hint: "Thin vertical panel — rooms & barriers" },
  { id: "pillar", label: "Pillar", glyph: "❘", hint: "Tall slim column — supports & accents" },
  { id: "ramp", label: "Ramp", glyph: "◣", hint: "Sloped wedge — walkable inclines" },
];

export const PALETTE: { hex: number; css: string; name: string }[] = [
  { hex: 0x6ea8ff, css: "#6ea8ff", name: "Sky Blue" },
  { hex: 0x57d977, css: "#57d977", name: "Leaf Green" },
  { hex: 0xffb24d, css: "#ffb24d", name: "Amber" },
  { hex: 0xff5470, css: "#ff5470", name: "Crimson" },
  { hex: 0xc79bff, css: "#c79bff", name: "Violet" },
  { hex: 0xf4f1e8, css: "#f4f1e8", name: "Bone White" },
  { hex: 0x9aa3b2, css: "#9aa3b2", name: "Steel Grey" },
  { hex: 0x2c3340, css: "#2c3340", name: "Charcoal" },
];

const DEPLOYABLES: { id: DeployableKind; label: string; glyph: string; hint: string }[] = [
  { id: "npc", label: "NPC", glyph: "☻", hint: "Combat NPC — pick its weapon below" },
  { id: "heavyBag", label: "Heavy Bag", glyph: "▮", hint: "Static training bag — soaks up hits" },
  { id: "physicsBag", label: "Physics Bag", glyph: "⬤", hint: "Physics-driven bag — swings when struck" },
  { id: "start", label: "Player Start", glyph: "✦", hint: "Spawn point — required before you can Test" },
];

const DIFFICULTIES: { id: Difficulty; label: string; hint: string }[] = [
  { id: "easy", label: "Easy", hint: "Gentle NPCs — slow, light hits" },
  { id: "normal", label: "Normal", hint: "Balanced NPC stats" },
  { id: "hard", label: "Hard", hint: "Tough NPCs — faster, harder hits" },
  { id: "elite", label: "Elite", hint: "Max-threat NPCs — bigger and deadlier" },
];

interface Props {
  brush: BrushState;
  stats: EditorStats | null;
  dungeon: boolean;
  mapsOpen: boolean;
  onBrush: (patch: Partial<BrushState>) => void;
  onDungeon: (on: boolean) => void;
  onToggleMaps: () => void;
  onNew: () => void;
  onClear: () => void;
  onTest: () => void;
  onExit: () => void;
  /** Serialize the current map for posting to the gallery (null = empty). */
  getMapPayload: () => CreatePostPayload | null;
  // ── Select tool / hierarchy ──
  tree: DeployableNode[];
  selectedId: string | null;
  gizmoMode: GizmoMode;
  snap: boolean;
  onSelect: (id: string | null) => void;
  onGizmoMode: (mode: GizmoMode) => void;
  onSnap: (on: boolean) => void;
  onDeleteSelected: () => void;
  onDuplicateSelected: () => void;
  onFocusSelected: () => void;
}

export function VoxelEditorUI({
  brush,
  stats,
  dungeon,
  mapsOpen,
  onBrush,
  onDungeon,
  onToggleMaps,
  onNew,
  onClear,
  onTest,
  onExit,
  getMapPayload,
  tree,
  selectedId,
  gizmoMode,
  snap,
  onSelect,
  onGizmoMode,
  onSnap,
  onDeleteSelected,
  onDuplicateSelected,
  onFocusSelected,
}: Props) {
  const canTest = !!stats?.hasStart;
  const selectedNode = tree.find((n) => n.id === selectedId) ?? null;
  return (
    <>
      <div className="ve-topbar">
        <span className="brand">
          VOXEL<span className="brand-accent">EDITOR</span>
        </span>
        <label
          className={`ve-dungeon ${dungeon ? "on" : ""}`}
          data-tip="Dungeon rules on Test — NPC difficulty tiers, XP & death"
        >
          <input type="checkbox" checked={dungeon} onChange={(e) => onDungeon(e.target.checked)} />
          Custom Dungeon
        </label>
        <div className="ve-top-actions">
          <button className="ve-btn" onClick={onNew} data-tip="Pick a starting map template">
            New
          </button>
          <button
            className={`ve-btn ${mapsOpen ? "on" : ""}`}
            onClick={onToggleMaps}
            data-tip="Saved maps — load, rename, delete"
          >
            Maps
          </button>
          <button className="ve-btn ve-danger" onClick={onClear} data-tip="Wipe the whole map">
            Clear
          </button>
          <PostToGallery
            kind="dungeon"
            getPayload={getMapPayload}
            defaultName="My Map"
            label="Post"
            className="ve-btn"
          />
          <button
            className="ve-btn ve-play"
            onClick={onTest}
            disabled={!canTest}
            data-tip={canTest ? "Play this map in the Danger Room" : "Place a Player Start first"}
          >
            ▶ Test
          </button>
          <button className="ve-btn" onClick={onExit} data-tip="Back to the doors">
            ⬑ Doors
          </button>
        </div>
      </div>

      <div className="ve-panel">
        <div className="ve-tabs">
          <button
            className={`ve-tab ${brush.tool === "block" ? "on" : ""}`}
            onClick={() => onBrush({ tool: "block" })}
            data-tip="Place blocks — LMB drag builds, RMB erases"
          >
            Build
          </button>
          <button
            className={`ve-tab ${brush.tool === "deploy" ? "on" : ""}`}
            onClick={() => onBrush({ tool: "deploy" })}
            data-tip="Drop NPCs, bags, props & the player start"
          >
            Deploy
          </button>
          <button
            className={`ve-tab ${brush.tool === "select" ? "on" : ""}`}
            onClick={() => onBrush({ tool: "select" })}
            data-tip="Select & transform placed objects"
          >
            Select
          </button>
        </div>

        {brush.tool === "block" && (
          <>
            <div className="ve-section">
              <h4>Shape</h4>
              <div className="ve-grid">
                {SHAPES.map((s) => (
                  <button
                    key={s.id}
                    className={`ve-opt ${brush.shape === s.id ? "active" : ""}`}
                    onClick={() => onBrush({ shape: s.id })}
                    data-tip={s.hint}
                  >
                    <span className="ve-glyph">{s.glyph}</span>
                    {s.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="ve-section">
              <h4>Colour</h4>
              <div className="ve-swatches">
                {PALETTE.map((c) => (
                  <button
                    key={c.hex}
                    className={`ve-swatch ${brush.color === c.hex ? "active" : ""}`}
                    style={{ background: c.css }}
                    onClick={() => onBrush({ color: c.hex })}
                    aria-label={c.name}
                    data-tip={c.name}
                  />
                ))}
              </div>
            </div>
          </>
        )}

        {brush.tool === "deploy" && (
          <>
            <div className="ve-section">
              <h4>Deployable</h4>
              <div className="ve-grid">
                {DEPLOYABLES.map((d) => (
                  <button
                    key={d.id}
                    className={`ve-opt ${brush.deployKind === d.id ? "active" : ""}`}
                    onClick={() => onBrush({ deployKind: d.id })}
                    data-tip={d.hint}
                  >
                    <span className="ve-glyph">{d.glyph}</span>
                    {d.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="ve-section">
              <h4>Benches</h4>
              <div className="ve-grid">
                {PROP_LIST.filter((p) => p.category === "bench").map((p) => (
                  <button
                    key={p.id}
                    className={`ve-opt ${
                      brush.deployKind === "prop" && brush.prop === p.id ? "active" : ""
                    }`}
                    onClick={() => onBrush({ deployKind: "prop", prop: p.id })}
                    data-tip={`${p.label} — decorative bench prop${p.collide ? " (solid)" : ""}`}
                  >
                    <span className="ve-glyph">{p.glyph}</span>
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="ve-section">
              <h4>Build Helpers</h4>
              <div className="ve-grid">
                {PROP_LIST.filter((p) => p.category === "build").map((p) => (
                  <button
                    key={p.id}
                    className={`ve-opt ${
                      brush.deployKind === "prop" && brush.prop === p.id ? "active" : ""
                    }`}
                    onClick={() => onBrush({ deployKind: "prop", prop: p.id })}
                    data-tip={`${p.label} — large structure prop${p.collide ? " (solid)" : ""}`}
                  >
                    <span className="ve-glyph">{p.glyph}</span>
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            {brush.deployKind === "npc" && (
              <>
                <div className="ve-section">
                  <h4>Weapon</h4>
                  <div className="ve-grid ve-grid-3">
                    {WEAPONS.map((w) => (
                      <button
                        key={w.id}
                        className={`ve-opt ve-opt-sm ${brush.weapon === (w.id as WeaponId) ? "active" : ""}`}
                        onClick={() => onBrush({ weapon: w.id as WeaponId })}
                        data-tip={`Arm placed NPCs with ${w.label}`}
                      >
                        {w.label}
                      </button>
                    ))}
                  </div>
                </div>
                {dungeon && (
                  <div className="ve-section">
                    <h4>Difficulty</h4>
                    <div className="ve-grid">
                      {DIFFICULTIES.map((d) => (
                        <button
                          key={d.id}
                          className={`ve-opt ve-diff ve-diff-${d.id} ${
                            brush.difficulty === d.id ? "active" : ""
                          }`}
                          onClick={() => onBrush({ difficulty: d.id })}
                          data-tip={d.hint}
                        >
                          {d.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        )}

        {brush.tool === "select" && (
          <>
            <div className="ve-section">
              <h4>Transform</h4>
              <div className="ve-grid ve-grid-3">
                {GIZMO_MODES.map((m) => (
                  <button
                    key={m.id}
                    className={`ve-opt ve-opt-sm ${gizmoMode === m.id ? "active" : ""}`}
                    onClick={() => onGizmoMode(m.id)}
                    disabled={!selectedNode}
                    data-tip={`${m.label} the selection — press ${m.key}`}
                  >
                    <span className="ve-glyph">{m.glyph}</span>
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="ve-section">
              <label className={`ve-snap ${snap ? "on" : ""}`}>
                <input type="checkbox" checked={snap} onChange={(e) => onSnap(e.target.checked)} />
                Snap to grid
              </label>
            </div>
            <div className="ve-section">
              <h4>Selection</h4>
              {selectedNode ? (
                <>
                  <p className="ve-sel-name">{selectedNode.label}</p>
                  <div className="ve-grid ve-grid-3">
                    <button
                      className="ve-opt ve-opt-sm"
                      onClick={onFocusSelected}
                      data-tip="Frame the camera on this object"
                    >
                      Focus
                    </button>
                    <button
                      className="ve-opt ve-opt-sm"
                      onClick={onDuplicateSelected}
                      disabled={selectedNode.kind === "start"}
                      data-tip="Clone this object"
                    >
                      Clone
                    </button>
                    <button
                      className="ve-opt ve-opt-sm ve-diff-elite"
                      onClick={onDeleteSelected}
                      data-tip="Delete this object — press Del"
                    >
                      Delete
                    </button>
                  </div>
                </>
              ) : (
                <p className="dim">Click an object in the scene to select it.</p>
              )}
            </div>
          </>
        )}

        <div className="ve-hint">
          {brush.tool === "select" ? (
            <>
              <p>
                <b>LMB</b> select · drag the gizmo to move/rotate/scale · <b>RMB drag</b> orbit · <b>wheel</b> zoom
              </p>
              <p className="dim">
                <b>G</b> move · <b>R</b> rotate · <b>E</b> scale · <b>Del</b> delete · <b>Esc</b> deselect
              </p>
            </>
          ) : (
            <>
              <p>
                <b>LMB</b> build (hold to stack/wall/ramp) · <b>RMB drag</b> orbit · <b>RMB click</b> erase · <b>wheel</b> zoom
              </p>
              <p className="dim">
                <b>R</b> rotate piece · <b>WASD</b> pan · <b>Shift+drag</b> / middle-drag pan
              </p>
            </>
          )}
        </div>
      </div>

      {brush.tool === "select" && (
        <VoxelHierarchyPanel
          tree={tree}
          selectedId={selectedId}
          onSelect={onSelect}
          onDelete={(id) => {
            onSelect(id);
            onDeleteSelected();
          }}
          onFocus={(id) => {
            onSelect(id);
            onFocusSelected();
          }}
        />
      )}

      {stats && (
        <div className="ve-stats">
          <span>▦ {stats.blocks}</span>
          <span>☻ {stats.npcs}</span>
          <span>▮ {stats.bags}</span>
          <span>⚗ {stats.props}</span>
          <span className={stats.hasStart ? "ok" : "warn"}>✦ {stats.hasStart ? "set" : "none"}</span>
        </div>
      )}
    </>
  );
}
