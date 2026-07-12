import { useEffect, useRef, useState } from "react";
import {
  Bone,
  Box,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Folder,
  Layers,
  Package,
  PersonStanding,
  Shapes,
} from "lucide-react";
import type { EditorScene } from "../../three/editor/EditorScene";
import type { EditorObjectSnapshot, EditorSnapshot } from "../../three/editor/types";

interface Props {
  engine: EditorScene;
  snap: EditorSnapshot;
}

/** Per-kind glyph so meshes, groups, bones and rigs are scannable at a glance. */
const KIND_ICON: Record<string, typeof Box> = {
  model: Package,
  rig: PersonStanding,
  group: Folder,
  mesh: Box,
  skinnedMesh: Shapes,
  bone: Bone,
};

/** Compact kind badge shown after the name ("skinnedMesh" → "skin"). */
const KIND_LABEL: Record<string, string> = {
  model: "model",
  rig: "rig",
  group: "group",
  mesh: "mesh",
  skinnedMesh: "skin",
  bone: "bone",
};

/** Bone chains explode the tree, so collapse them by default — meshes stay visible. */
const defaultCollapsed = (o: EditorObjectSnapshot) => o.kind === "bone";

/**
 * The scene outliner. Renders the engine's DFS-ordered object graph as a tree in
 * which every loaded asset's meshes, groups and bones appear as selectable child
 * nodes. Clicking a node selects it (attaching the transform gizmo); selection
 * made in the viewport is mirrored back here (ancestors revealed + scrolled into
 * view). Supports expand/collapse, per-node visibility, rename, and drag-to-reparent.
 */
export function HierarchyPanel({ engine, snap }: Props) {
  const objects = snap.objects;
  const byId = new Map(objects.map((o) => [o.id, o] as const));

  // Explicit user overrides on top of the default-collapse rule (bone chains).
  const [userExpanded, setUserExpanded] = useState<Set<string>>(() => new Set());
  const [userCollapsed, setUserCollapsed] = useState<Set<string>>(() => new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropId, setDropId] = useState<string | null>(null);
  const [rootDrop, setRootDrop] = useState(false);

  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  // Fresh snapshot for the window-level F2 listener (bound once; avoids stale closures).
  const snapRef = useRef(snap);
  snapRef.current = snap;
  // Row to scroll to once it has actually mounted (i.e. after ancestors expand).
  const pendingScroll = useRef<string | null>(null);

  const isCollapsed = (id: string) => {
    if (userExpanded.has(id)) return false;
    if (userCollapsed.has(id)) return true;
    const o = byId.get(id);
    return o ? defaultCollapsed(o) : false;
  };

  const ancestorsOf = (id: string): string[] => {
    const out: string[] = [];
    let p = byId.get(id)?.parentId ?? null;
    while (p) {
      out.push(p);
      p = byId.get(p)?.parentId ?? null;
    }
    return out;
  };

  const rowVisible = (o: EditorObjectSnapshot) => ancestorsOf(o.id).every((a) => !isCollapsed(a));

  // Reveal the active selection when it changes — keeps the tree in sync with
  // clicks made directly in the viewport. Expansion happens here; the actual
  // scroll waits for the row to mount (handled by the scroll effect below).
  useEffect(() => {
    const id = snap.selectedId;
    if (!id) return;
    pendingScroll.current = id;
    const anc = ancestorsOf(id);
    if (anc.length) {
      setUserExpanded((prev) => {
        const n = new Set(prev);
        for (const a of anc) n.add(a);
        return n;
      });
      setUserCollapsed((prev) => {
        if (!anc.some((a) => prev.has(a))) return prev;
        const n = new Set(prev);
        for (const a of anc) n.delete(a);
        return n;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snap.selectedId]);

  // Scroll the pending selection into view once its row exists. Runs after every
  // render (cheap, self-clearing) so it fires once any ancestor expansion lands.
  useEffect(() => {
    const id = pendingScroll.current;
    if (!id) return;
    const el = rowRefs.current.get(id);
    if (el) {
      el.scrollIntoView({ block: "nearest" });
      pendingScroll.current = null;
    }
  });

  // F2 renames the active selection (ignored while typing in a field). Bound once
  // and reads the live snapshot via a ref so it never renames with stale data.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== "F2") return;
      const s = snapRef.current;
      if (!s.selectedId) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      const o = s.objects.find((x) => x.id === s.selectedId);
      if (o) {
        setEditingId(o.id);
        setEditValue(o.name);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const toggleCollapse = (o: EditorObjectSnapshot) => {
    const collapsed = isCollapsed(o.id);
    setUserExpanded((prev) => {
      const n = new Set(prev);
      if (collapsed) n.add(o.id);
      else n.delete(o.id);
      return n;
    });
    setUserCollapsed((prev) => {
      const n = new Set(prev);
      if (collapsed) n.delete(o.id);
      else n.add(o.id);
      return n;
    });
  };

  const commitRename = () => {
    if (editingId) {
      const v = editValue.trim();
      if (v) engine.rename(editingId, v);
    }
    setEditingId(null);
  };

  const expandAll = () => {
    setUserExpanded(new Set(objects.map((o) => o.id)));
    setUserCollapsed(new Set());
  };
  const collapseAll = () => {
    setUserCollapsed(new Set(objects.filter((o) => o.hasChildren).map((o) => o.id)));
    setUserExpanded(new Set());
  };

  const onRowClick = (e: React.MouseEvent, o: EditorObjectSnapshot) => {
    if (e.shiftKey || e.ctrlKey || e.metaKey) engine.toggleSelect(o.id);
    else engine.select(o.id);
  };

  const clearDrag = () => {
    setDragId(null);
    setDropId(null);
    setRootDrop(false);
  };

  const rows = objects.filter(rowVisible);

  return (
    <div className="ed-panel grow">
      <div className="ed-panel-head">
        <span>Hierarchy</span>
        <span className="ed-tree-tools">
          <span style={{ opacity: 0.55, fontWeight: 400 }}>{objects.length}</span>
          <button className="ed-tw" title="Expand all" onClick={expandAll}>
            ＋
          </button>
          <button className="ed-tw" title="Collapse all" onClick={collapseAll}>
            －
          </button>
        </span>
      </div>
      <div className="ed-panel-body">
        {objects.length === 0 ? (
          <div className="ed-empty">
            Load a rig in Animations or drag-import a model — every mesh, group and bone shows up here as a selectable,
            transformable node.
          </div>
        ) : (
          <div className="ed-tree">
            {/* Synthetic scene root: drop a node here to un-parent it back to the scene. */}
            <div
              className={`ed-row ${rootDrop ? "drop" : ""}`}
              onDragOver={(e) => {
                if (dragId) {
                  e.preventDefault();
                  setRootDrop(true);
                }
              }}
              onDragLeave={() => setRootDrop(false)}
              onDrop={(e) => {
                e.preventDefault();
                if (dragId) engine.reparent(dragId, null);
                clearDrag();
              }}
            >
              <span className="ed-tw spacer" />
              <Layers size={13} className="ed-ico" />
              <span className="nm" style={{ fontWeight: 700, opacity: 0.85 }}>
                Scene
              </span>
            </div>

            {rows.map((o) => {
              const Ico = KIND_ICON[o.kind] ?? Box;
              const collapsed = isCollapsed(o.id);
              const editing = editingId === o.id;
              return (
                <div
                  key={o.id}
                  ref={(el) => {
                    if (el) rowRefs.current.set(o.id, el);
                    else rowRefs.current.delete(o.id);
                  }}
                  className={`ed-row ${o.selected ? "on" : ""} ${dropId === o.id ? "drop" : ""} ${
                    o.visible ? "" : "dim"
                  }`}
                  draggable={!editing}
                  onClick={(e) => onRowClick(e, o)}
                  onDoubleClick={() => {
                    setEditingId(o.id);
                    setEditValue(o.name);
                  }}
                  onDragStart={(e) => {
                    setDragId(o.id);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onDragOver={(e) => {
                    if (dragId && dragId !== o.id) {
                      e.preventDefault();
                      setDropId(o.id);
                    }
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragId && dragId !== o.id) engine.reparent(dragId, o.id);
                    clearDrag();
                  }}
                  onDragEnd={clearDrag}
                >
                  <span className="ed-tree-indent" style={{ width: (o.depth + 1) * 12 }} />
                  {o.hasChildren ? (
                    <button
                      className="ed-tw"
                      title={collapsed ? "Expand" : "Collapse"}
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleCollapse(o);
                      }}
                    >
                      {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                    </button>
                  ) : (
                    <span className="ed-tw spacer" />
                  )}
                  <Ico size={13} className="ed-ico" />
                  {editing ? (
                    <input
                      className="ed-tree-rename"
                      autoFocus
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      onBlur={commitRename}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitRename();
                        else if (e.key === "Escape") setEditingId(null);
                      }}
                    />
                  ) : (
                    <span className="nm" title={o.name}>
                      {o.name}
                    </span>
                  )}
                  <span className="ed-kind">{KIND_LABEL[o.kind] ?? o.kind}</span>
                  <button
                    className="eye"
                    title={o.visible ? "Hide" : "Show"}
                    onClick={(e) => {
                      e.stopPropagation();
                      engine.setObjectVisible(o.id, !o.visible);
                    }}
                  >
                    {o.visible ? <Eye size={13} /> : <EyeOff size={13} />}
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
