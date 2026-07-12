const RETICLES = [5, 6, 7, 8, 9, 11, 13, 17, 21, 56, 58, 59, 60, 61, 62];

export function Crosshairs() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "radial-gradient(circle at 50% 38%, #18222f 0%, #0a0d12 72%)",
        padding: 28,
        fontFamily: "Inter, system-ui, sans-serif",
        boxSizing: "border-box",
      }}
    >
      <div style={{ color: "#eaf2ff", fontSize: 22, fontWeight: 700 }}>
        Crosshair / Reticle Gallery
      </div>
      <div style={{ color: "#7e8aa0", fontSize: 13, marginBottom: 22 }}>
        15 white-linework candidates · 1080×1080 source · pick the cleanest read at HUD scale
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 16 }}>
        {RETICLES.map((n) => (
          <div
            key={n}
            style={{
              background: "rgba(255,255,255,0.025)",
              border: "1px solid rgba(255,255,255,0.07)",
              borderRadius: 12,
              padding: 14,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 10,
            }}
          >
            <div
              style={{
                width: 150,
                height: 150,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background:
                  "radial-gradient(circle at 50% 50%, rgba(80,110,150,0.10), rgba(0,0,0,0.35))",
                borderRadius: 8,
              }}
            >
              <img
                src={`/__mockup/images/reticles/reticle-${n}.png`}
                alt={`reticle ${n}`}
                style={{
                  maxWidth: "100%",
                  maxHeight: "100%",
                  objectFit: "contain",
                  filter: "drop-shadow(0 0 5px rgba(140,190,255,0.25))",
                }}
              />
            </div>
            <div style={{ color: "#aebbd0", fontSize: 13, fontWeight: 600 }}>#{n}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
