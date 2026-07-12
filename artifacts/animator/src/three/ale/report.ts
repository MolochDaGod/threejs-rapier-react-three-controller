import type { AleFinding, AleFighterReport, AleReportData } from "../types";

/** Raw running counters the AleBot accumulates over a duel (per fighter A/B). */
export interface FighterTelemetry {
  swings: number;
  hits: number;
  whiffs: number;
  blocks: number;
  parries: number;
  dodges: number;
  missingColliderFlags: number;
  forceSpikes: number;
  peakForce: number;
  damageDealt: number;
  kos: number;
}

/** Everything `buildAleReport` needs — pure data, no engine refs. */
export interface AleTelemetry {
  rounds: number;
  timeToKill: number[];
  a: FighterTelemetry;
  b: FighterTelemetry;
}

export function emptyFighterTelemetry(): FighterTelemetry {
  return {
    swings: 0,
    hits: 0,
    whiffs: 0,
    blocks: 0,
    parries: 0,
    dodges: 0,
    missingColliderFlags: 0,
    forceSpikes: 0,
    peakForce: 0,
    damageDealt: 0,
    kos: 0,
  };
}

function toReport(f: FighterTelemetry, fighter: "A" | "B"): AleFighterReport {
  const accuracy = f.swings > 0 ? f.hits / f.swings : 0;
  return {
    fighter,
    swings: f.swings,
    hits: f.hits,
    whiffs: f.whiffs,
    accuracy,
    blocks: f.blocks,
    parries: f.parries,
    dodges: f.dodges,
    missingColliderFlags: f.missingColliderFlags,
    forceSpikes: f.forceSpikes,
    peakForce: f.peakForce,
    damageDealt: f.damageDealt,
    kos: f.kos,
  };
}

const pct = (n: number) => `${Math.round(n * 100)}%`;
const r1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Aggregate raw duel telemetry into a ranked, human-readable balance / timing /
 * physics report. Pure: same input always yields the same findings.
 */
export function buildAleReport(tel: AleTelemetry): AleReportData {
  const a = toReport(tel.a, "A");
  const b = toReport(tel.b, "B");
  const findings: AleFinding[] = [];

  // ── Balance ───────────────────────────────────────────────────────────────
  const dmgTotal = a.damageDealt + b.damageDealt;
  if (dmgTotal > 0) {
    const share = a.damageDealt / dmgTotal;
    const skew = Math.abs(share - 0.5);
    if (skew > 0.2) {
      const lead = share > 0.5 ? "A" : "B";
      findings.push({
        severity: 40 + skew * 80,
        category: "balance",
        text: `Damage output is lopsided — fighter ${lead} dealt ${pct(
          share > 0.5 ? share : 1 - share,
        )} of all damage. Consider tuning weapon/move values toward parity.`,
      });
    }
  }
  if (a.kos !== b.kos && tel.rounds >= 2) {
    const lead = a.kos > b.kos ? "A" : "B";
    findings.push({
      severity: 30 + Math.abs(a.kos - b.kos) * 12,
      category: "balance",
      text: `Round wins favour fighter ${lead} (${a.kos}–${b.kos} KOs across ${tel.rounds} rounds).`,
    });
  }

  // ── Timing ────────────────────────────────────────────────────────────────
  for (const f of [a, b]) {
    if (f.swings >= 4 && f.accuracy < 0.35) {
      findings.push({
        severity: 25 + (0.35 - f.accuracy) * 100,
        category: "timing",
        text: `Fighter ${f.fighter} whiffed heavily (${pct(
          f.accuracy,
        )} of ${f.swings} swings landed) — attack reach or active frames may be too short.`,
      });
    }
    if (f.missingColliderFlags > 0) {
      findings.push({
        severity: 35 + Math.min(40, f.missingColliderFlags),
        category: "timing",
        text: `Fighter ${f.fighter} had ${f.missingColliderFlags} fast weapon-motion frame(s) with no active hit volume — visual swings without a collider window (animation/contact-frame mismatch).`,
      });
    }
  }
  if (tel.timeToKill.length > 0) {
    const avg = tel.timeToKill.reduce((s, x) => s + x, 0) / tel.timeToKill.length;
    if (avg < 3) {
      findings.push({
        severity: 45,
        category: "timing",
        text: `Rounds end very fast (avg ${r1(avg)}s time-to-kill) — fights may feel swingy; consider more health or lower damage.`,
      });
    } else if (avg > 25) {
      findings.push({
        severity: 28,
        category: "timing",
        text: `Rounds drag on (avg ${r1(avg)}s time-to-kill) — damage may be too low or defenses too strong.`,
      });
    }
  }

  // ── Physics ───────────────────────────────────────────────────────────────
  for (const f of [a, b]) {
    if (f.peakForce > 8) {
      findings.push({
        severity: 20 + Math.min(40, f.peakForce),
        category: "physics",
        text: `Fighter ${f.fighter} produced a force spike of ${r1(
          f.peakForce,
        )} (${f.forceSpikes} spike[s] total) — knockback impulses may be exaggerated.`,
      });
    }
  }

  findings.sort((x, y) => y.severity - x.severity);
  if (findings.length === 0) {
    findings.push({
      severity: 0,
      category: "balance",
      text: "No balance, timing, or physics outliers detected — this matchup reads clean.",
    });
  }

  return { rounds: tel.rounds, timeToKill: tel.timeToKill.slice(), fighters: [a, b], findings };
}
