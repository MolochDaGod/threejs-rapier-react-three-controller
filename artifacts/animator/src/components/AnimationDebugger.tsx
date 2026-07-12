import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Activity, X } from "lucide-react";
import { animDebug, type AnimRecord } from "../three/debug/animDebug";

/** Human labels + accent hues per record kind. */
const KIND_META: Record<AnimRecord["kind"], { label: string; tone: string }> = {
  validate: { label: "check", tone: "#7dd3fc" },
  play: { label: "play", tone: "#a7f3d0" },
  verb: { label: "verb", tone: "#c4b5fd" },
  fail: { label: "FAIL", tone: "#fca5a5" },
};

function fmtTime(t: number): string {
  const s = t / 1000;
  return `${s.toFixed(2)}s`;
}

function fmtPos(p: { x: number; y: number; z: number }): string {
  const r = (n: number) => (Number.isFinite(n) ? n.toFixed(2) : "NaN");
  return `${r(p.x)}, ${r(p.y)}, ${r(p.z)}`;
}

/** Subscribe to the singleton via useSyncExternalStore so the feed stays live. */
function useAnimRecords(): readonly AnimRecord[] {
  return useSyncExternalStore(
    (cb) => animDebug.subscribe(cb),
    () => animDebug.getRecords(),
  );
}

interface Props {
  onClose?: () => void;
}

/**
 * Animation Debugger panel: a live, scrolling log of every animation the rig
 * plays, each validated against the active skeleton (bind coverage), the
 * character's XYZ location, and clip timing. Rows with problems (unbound tracks,
 * bad duration, missing clips, non-finite position) are flagged so animation
 * regressions are visible at a glance. Recording is opt-in (off by default) so
 * the instrumentation costs nothing until the panel turns it on.
 */
export function AnimationDebugger({ onClose }: Props) {
  const records = useAnimRecords();
  const enabled = useSyncExternalStore(
    (cb) => animDebug.subscribe(cb),
    () => animDebug.isEnabled(),
  );
  const [onlyIssues, setOnlyIssues] = useState(false);
  const [follow, setFollow] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Turn recording on while the panel is mounted; leave it as the user set it on
  // unmount only if they explicitly disabled it (so a stray remount doesn't spam).
  useEffect(() => {
    animDebug.setEnabled(true);
    return () => animDebug.setEnabled(false);
  }, []);

  const rows = onlyIssues ? records.filter((r) => r.issues.length > 0) : records;
  const issueCount = records.reduce((n, r) => n + (r.issues.length > 0 ? 1 : 0), 0);

  // Auto-scroll to the newest row when following.
  useEffect(() => {
    if (!follow) return;
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [rows.length, follow]);

  return (
    <div className="animdbg">
      <div className="animdbg-head">
        <div className="animdbg-title">
          <Activity size={13} />
          <span>Animation Debugger</span>
        </div>
        <div className="animdbg-head-actions">
          {onClose && (
            <button className="animdbg-x" onClick={onClose} title="Close">
              <X size={13} />
            </button>
          )}
        </div>
      </div>

      <div className="animdbg-toolbar">
        <button
          className={`animdbg-btn ${enabled ? "on" : ""}`}
          onClick={() => animDebug.setEnabled(!enabled)}
          title="Toggle recording"
        >
          <span className={`animdbg-dot ${enabled ? "live" : ""}`} />
          {enabled ? "Recording" : "Paused"}
        </button>
        <button
          className={`animdbg-btn ${onlyIssues ? "on" : ""}`}
          onClick={() => setOnlyIssues((v) => !v)}
          title="Show only rows with problems"
        >
          Issues{issueCount > 0 ? ` (${issueCount})` : ""}
        </button>
        <button
          className={`animdbg-btn ${follow ? "on" : ""}`}
          onClick={() => setFollow((v) => !v)}
          title="Auto-scroll to newest"
        >
          Follow
        </button>
        <button className="animdbg-btn" onClick={() => animDebug.clear()} title="Clear the log">
          Clear
        </button>
        <span className="animdbg-count">{records.length}</span>
      </div>

      <div className="animdbg-feed" ref={scrollRef}>
        {rows.length === 0 ? (
          <div className="animdbg-empty">
            {enabled
              ? "Waiting for animations… play a clip or fire a combat verb."
              : "Recording is paused."}
          </div>
        ) : (
          rows.map((r) => {
            const meta = KIND_META[r.kind];
            const bad = r.issues.length > 0;
            return (
              <div key={r.seq} className={`animdbg-row ${bad ? "bad" : ""}`}>
                <span className="animdbg-t">{fmtTime(r.t)}</span>
                <span className="animdbg-kind" style={{ color: meta.tone }}>
                  {meta.label}
                </span>
                <span className="animdbg-id" title={r.id}>
                  {r.id}
                </span>
                <span className="animdbg-meta">
                  {r.kind === "validate" && r.totalTracks != null && (
                    <span title="Tracks bound to the rig / total authored tracks">
                      {r.boundTracks}/{r.totalTracks} bound
                    </span>
                  )}
                  {r.kind === "play" && (
                    <span>{r.loop ? "loop" : "once"}</span>
                  )}
                  {r.duration != null && r.kind !== "play" && (
                    <span title="Clip duration">{r.duration.toFixed(2)}s</span>
                  )}
                  {r.kind === "play" && r.duration != null && (
                    <span title="Clip duration">{r.duration.toFixed(2)}s</span>
                  )}
                  {r.pos && (
                    <span className="animdbg-pos" title="Character world XYZ">
                      [{fmtPos(r.pos)}]
                    </span>
                  )}
                </span>
                {bad && (
                  <span className="animdbg-issues">
                    {r.issues.map((iss, i) => (
                      <span key={i} className="animdbg-issue">
                        {iss}
                      </span>
                    ))}
                  </span>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
