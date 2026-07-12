export function PixelUI() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "radial-gradient(circle at 50% 35%, #1c1c28 0%, #0a0d12 72%)",
        padding: 28,
        fontFamily: "Inter, system-ui, sans-serif",
        boxSizing: "border-box",
      }}
    >
      <div style={{ color: "#e6e0ff", fontSize: 22, fontWeight: 700 }}>Pixel UI Atlas</div>
      <div style={{ color: "#8a86a0", fontSize: 13, marginBottom: 22 }}>
        960×480 source atlas · pixel-art HUD frames / panels / buttons · slice into 9-patch frames
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          background: "rgba(255,255,255,0.025)",
          border: "1px solid rgba(255,255,255,0.07)",
          borderRadius: 12,
          padding: 18,
        }}
      >
        <img
          src="/__mockup/images/pixelui/atlas.png"
          alt="pixel UI atlas"
          style={{
            width: 900,
            height: "auto",
            imageRendering: "pixelated",
            borderRadius: 6,
          }}
        />
      </div>
      <div style={{ color: "#6f6b85", fontSize: 12, marginTop: 14, lineHeight: 1.5 }}>
        Note: this is a single sprite atlas. The frames/panels here are 9-patch candidates for
        diegetic HUD windows (inventory, dialogue, stat panels). Crisp at integer scales only.
      </div>
    </div>
  );
}
