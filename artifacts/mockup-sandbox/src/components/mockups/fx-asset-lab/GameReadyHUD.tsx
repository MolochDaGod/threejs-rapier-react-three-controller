function Bar({
  label,
  pct,
  color,
  glow,
}: {
  label: string;
  pct: number;
  color: string;
  glow: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, width: 280 }}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <span style={{ color: "#cfd8e6", fontSize: 11, fontWeight: 700, letterSpacing: 1 }}>
          {label}
        </span>
        <span style={{ color: "#8190a6", fontSize: 11, fontWeight: 600 }}>{pct}%</span>
      </div>
      <div
        style={{
          height: 12,
          borderRadius: 7,
          background: "rgba(0,0,0,0.45)",
          border: "1px solid rgba(255,255,255,0.12)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: "100%",
            background: color,
            boxShadow: `0 0 10px ${glow}`,
          }}
        />
      </div>
    </div>
  );
}

export function GameReadyHUD() {
  return (
    <div
      style={{
        position: "relative",
        minHeight: "100vh",
        overflow: "hidden",
        fontFamily: "Inter, system-ui, sans-serif",
        background:
          "linear-gradient(160deg, #243042 0%, #161d28 45%, #0c1118 100%)",
      }}
    >
      {/* faux scene depth */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background:
            "radial-gradient(120% 80% at 50% 120%, rgba(90,130,180,0.18), transparent 60%)",
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: "38%",
          background: "linear-gradient(to top, rgba(10,14,20,0.85), transparent)",
        }}
      />

      {/* title strip */}
      <div style={{ position: "absolute", top: 18, left: 24 }}>
        <div style={{ color: "#eaf2ff", fontSize: 18, fontWeight: 800, letterSpacing: 1 }}>
          GAME-READY HUD
        </div>
        <div style={{ color: "#7e8aa0", fontSize: 12 }}>
          reticle #58 + bars + hit-confirm spark
        </div>
      </div>

      {/* top-left vitals */}
      <div
        style={{
          position: "absolute",
          top: 70,
          left: 24,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <Bar label="HEALTH" pct={72} color="linear-gradient(90deg,#ff5a5a,#ff8f6b)" glow="rgba(255,90,90,0.6)" />
        <Bar label="STAMINA" pct={48} color="linear-gradient(90deg,#5ad17a,#a6e85a)" glow="rgba(90,209,122,0.55)" />
        <Bar label="FOCUS" pct={90} color="linear-gradient(90deg,#5aa6ff,#7fd0ff)" glow="rgba(90,166,255,0.55)" />
      </div>

      {/* center crosshair + hit spark */}
      <div
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%,-50%)",
          width: 180,
          height: 180,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <img
          src="/__mockup/images/reticles/reticle-58.png"
          alt="crosshair"
          style={{
            width: 150,
            height: 150,
            objectFit: "contain",
            filter: "drop-shadow(0 0 6px rgba(150,200,255,0.45))",
          }}
        />
        <style>{`@keyframes hud_spark{from{background-position:0 0}to{background-position:-${96 * 8 * 1.6}px 0}}`}</style>
        <div
          style={{
            position: "absolute",
            width: 96 * 1.6,
            height: 96 * 1.6,
            backgroundImage: "url(/__mockup/images/hitspark/Star5.png)",
            backgroundRepeat: "no-repeat",
            backgroundSize: `${96 * 8 * 1.6}px ${96 * 1.6}px`,
            animation: "hud_spark 0.9s steps(8) infinite",
            pointerEvents: "none",
          }}
        />
      </div>

      {/* bottom-right ammo / weapon */}
      <div
        style={{
          position: "absolute",
          right: 28,
          bottom: 26,
          textAlign: "right",
          color: "#eaf2ff",
        }}
      >
        <div style={{ fontSize: 13, color: "#8190a6", fontWeight: 600, letterSpacing: 2 }}>
          GREATSWORD
        </div>
        <div style={{ fontSize: 40, fontWeight: 800, lineHeight: 1 }}>
          ∞ <span style={{ fontSize: 16, color: "#7e8aa0" }}>combo ×3</span>
        </div>
      </div>

      {/* bottom-left objective */}
      <div
        style={{
          position: "absolute",
          left: 28,
          bottom: 26,
          color: "#cfd8e6",
          fontSize: 12,
          maxWidth: 320,
        }}
      >
        <div style={{ color: "#ffcf6b", fontWeight: 700, marginBottom: 3 }}>DUEL · ROUND 2</div>
        <div style={{ color: "#8190a6" }}>Best of 3 — opponent: Longbow</div>
      </div>
    </div>
  );
}
