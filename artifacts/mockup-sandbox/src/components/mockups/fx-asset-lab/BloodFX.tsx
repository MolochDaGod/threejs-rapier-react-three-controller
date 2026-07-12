const SPLATS = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const SCALE = 3;

export function BloodFX() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "radial-gradient(circle at 50% 38%, #281216 0%, #0a0d12 72%)",
        padding: 28,
        fontFamily: "Inter, system-ui, sans-serif",
        boxSizing: "border-box",
      }}
    >
      <div style={{ color: "#ffd7d7", fontSize: 22, fontWeight: 700 }}>Blood FX — live loops</div>
      <div style={{ color: "#a07c80", fontSize: 13, marginBottom: 22 }}>
        9 splatter animations · 110×93 source (×{SCALE}) · for damage / death hit reactions
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
        {SPLATS.map((n) => (
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
                width: 110 * SCALE,
                height: 93 * SCALE,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "radial-gradient(circle at 50% 50%, rgba(120,40,40,0.12), rgba(0,0,0,0.4))",
                borderRadius: 8,
              }}
            >
              <img
                src={`/__mockup/images/blood/splat-${n}.gif`}
                alt={`blood splat ${n}`}
                style={{
                  width: 110 * SCALE,
                  height: 93 * SCALE,
                  imageRendering: "pixelated",
                }}
              />
            </div>
            <div style={{ color: "#d0aeb2", fontSize: 13, fontWeight: 600 }}>splat #{n}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
