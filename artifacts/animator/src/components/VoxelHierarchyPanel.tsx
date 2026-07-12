import type { DeployableKind, DeployableNode } from "../three/voxel/types";

const KIND_GLYPH: Record<DeployableKind, string> = {
  npc: "☻",
  heavyBag: "▮",
  physicsBag: "⬤",
  prop: "⚗",
  start: "✦",
};

interface Props {
  tree: DeployableNode[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onDelete: (id: string) => void;
  onFocus: (id: string) => void;
}

/**
 * The Voxel Editor object hierarchy: every placed deployable (NPCs, bags, props,
 * the player start) as a selectable row. Mirrors the engine's selection so the
 * gizmo and this list stay in sync. Blocks are grid-locked and not listed here.
 */
export function VoxelHierarchyPanel({ tree, selectedId, onSelect, onDelete, onFocus }: Props) {
  return (
    <div className="ve-hierarchy">
      <div className="ve-hierarchy-head">
        <h4>Hierarchy</h4>
        <span className="dim">{tree.length}</span>
      </div>
      {tree.length === 0 ? (
        <p className="dim ve-hierarchy-empty">No objects yet. Deploy NPCs, bags or props to fill the scene.</p>
      ) : (
        <ul className="ve-hierarchy-list">
          {tree.map((n) => (
            <li
              key={n.id}
              className={`ve-hierarchy-row ${n.id === selectedId ? "active" : ""}`}
              onClick={() => onSelect(n.id)}
            >
              <span className="ve-glyph">{KIND_GLYPH[n.kind]}</span>
              <span className="ve-hierarchy-label">{n.label}</span>
              <span className="ve-hierarchy-actions">
                <button
                  className="ve-mini"
                  title="Frame camera"
                  onClick={(e) => {
                    e.stopPropagation();
                    onFocus(n.id);
                  }}
                >
                  ◎
                </button>
                <button
                  className="ve-mini ve-mini-danger"
                  title="Delete"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(n.id);
                  }}
                >
                  ✕
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
