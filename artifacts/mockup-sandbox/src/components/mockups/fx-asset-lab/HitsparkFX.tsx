type Sheet = {
  name: string;
  file: string;
  frameW: number;
  frameH: number;
  frames: number;
  fps: number;
};

const SHEETS: Sheet[] = [
  { name: "Star1", file: "Star1", frameW: 96, frameH: 96, frames: 6, fps: 18 },
  { name: "Star2", file: "Star2", frameW: 96, frameH: 96, frames: 6, fps: 18 },
  { name: "Star3", file: "Star3", frameW: 96, frameH: 96, frames: 7, fps: 18 },
  { name: "Star4", file: "Star4", frameW: 96, frameH: 96, frames: 7, fps: 18 },
  { name: "Star5", file: "Star5", frameW: 96, frameH: 96, frames: 8, fps: 18 },
  { name: "Line1", file: "Line1", frameW: 95, frameH: 96, frames: 6, fps: 18 },
  { name: "Line2", file: "Line2", frameW: 95, frameH: 96, frames: 6, fps: 18 },
  { name: "Line3", file: "Line3", frameW: 95, frameH: 96, frames: 7, fps: 18 },
  { name: "Line4", file: "Line4", frameW: 95, frameH: 96, frames: 7, fps: 18 },
  { name: "Line5", file: "Line5", frameW: 95, frameH: 96, frames: 8, fps: 18 },
];

const SCALE = 2;

function SpriteLoop({ s }: { s: Sheet }) {
  const anim = `hit_${s.name}`;
  const totalW = s.frameW * s.frames * SCALE;
  const w = s.frameW * SCALE;
  const h = s.frameH * SCALE;
  const dur = (s.frames / s.fps).toFixed(2);
  return (
    <div
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
      <style>{`@keyframes ${anim}{from{background-position:0 0}to{background-position:-${totalW}px 0}}`}</style>
      <div
        style={{
          width: w,
          height: h,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "radial-gradient(circle at 50% 50%, rgba(120,90,40,0.12), rgba(0,0,0,0.4))",
          borderRadius: 8,
        }}
      >
        <div
          style={{
            width: w,
            height: h,
            backgroundImage: `url(/__mockup/images/hitspark/${s.file}.png)`,
            backgroundRepeat: "no-repeat",
            backgroundSize: `${totalW}px ${h}px`,
            animation: `${anim} ${dur}s steps(${s.frames}) infinite`,
          }}
        />
      </div>
      <div style={{ color: "#aebbd0", fontSize: 13, fontWeight: 600 }}>
        {s.name} · {s.frames}f
      </div>
    </div>
  );
}

export function HitsparkFX() {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: "radial-gradient(circle at 50% 38%, #2a2018 0%, #0a0d12 72%)",
        padding: 28,
        fontFamily: "Inter, system-ui, sans-serif",
        boxSizing: "border-box",
      }}
    >
      <div style={{ color: "#ffe9cf", fontSize: 22, fontWeight: 700 }}>Hitspark FX — live loops</div>
      <div style={{ color: "#9a8a76", fontSize: 13, marginBottom: 22 }}>
        10 impact sheets · 96px frames · looping at 18fps · for melee/parry/crit hit-confirms
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 16 }}>
        {SHEETS.map((s) => (
          <SpriteLoop key={s.name} s={s} />
        ))}
      </div>
    </div>
  );
}
