import type {
  AleCameraMode,
  AleFighterReport,
  AleRecap,
  AleReportData,
  AleReview,
  AleReviewBeat,
  Highlight,
} from "../types";

/**
 * A.L.E.'s "broadcast desk". Two pure, deterministic builders run once a duel
 * ends:
 *  - buildAleRecap  → A.L.E.'s narrative match recap (announcer commentary),
 *    deliberately foregrounding the parry/block/dodge/timing skill-meta that the
 *    ad-ready highlight videos are gated on.
 *  - buildAleReview → a ~10s narrated highlight reel (caption + spoken line +
 *    camera per beat) the UI plays back with browser text-to-speech.
 * Same duel always yields the same recap + reel; nothing here publishes anything.
 */

const FIGHTER_LABEL: Record<"A" | "B", string> = {
  A: "Player 1",
  B: "Player 2",
};

const KIND_LABEL: Record<Highlight["kind"], string> = {
  ko: "KNOCKOUT",
  crit: "CRITICAL",
  parry: "PARRY",
  bigHit: "BIG HIT",
  flurry: "FLURRY",
};

const r1 = (n: number) => Math.round(n * 10) / 10;

function avg(xs: number[]): number | null {
  if (xs.length === 0) return null;
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

/** Most postable first: KO > crit > parry > bigHit > flurry, score as tiebreak. */
function rankHighlights(highlights: Highlight[]): Highlight[] {
  const rank: Record<Highlight["kind"], number> = { ko: 5, crit: 4, parry: 3, bigHit: 2, flurry: 1 };
  return highlights
    .slice()
    .sort((a, b) => rank[b.kind] * 100 + b.score - (rank[a.kind] * 100 + a.score));
}

function winner(
  fighters: AleFighterReport[],
): { win: AleFighterReport; lose: AleFighterReport } | null {
  if (fighters.length < 2) return null;
  const [a, b] = fighters;
  if (a.kos !== b.kos) return a.kos > b.kos ? { win: a, lose: b } : { win: b, lose: a };
  if (a.damageDealt !== b.damageDealt) {
    return a.damageDealt > b.damageDealt ? { win: a, lose: b } : { win: b, lose: a };
  }
  return null;
}

/** Defensive reads + accuracy weigh more than raw damage — the skill we want on camera. */
function skillScore(f: AleFighterReport): number {
  return f.parries * 3 + f.dodges * 2 + f.blocks + f.accuracy * 4 + f.kos * 2;
}

function momentLine(h: Highlight | null): string {
  if (!h) return "Toe-to-toe the whole way \u2014 nobody blinked.";
  const who = FIGHTER_LABEL[h.fighter];
  switch (h.kind) {
    case "ko":
      return `${who} ended it with a round-${h.round} KNOCKOUT at ${r1(h.t)}s.`;
    case "crit":
      return `${who} landed a CRITICAL in round ${h.round} that swung the whole thing.`;
    case "parry":
      return `${who} pulled a frame-perfect PARRY in round ${h.round} \u2014 ice cold.`;
    case "bigHit":
      return `${who} cracked a massive hit in round ${h.round}.`;
    case "flurry":
      return `${who} opened a flurry in round ${h.round} and never let go.`;
  }
}

/** Compose A.L.E.'s narrative recap, or null before any duel has finished. */
export function buildAleRecap(report: AleReportData | null, highlights: Highlight[]): AleRecap | null {
  if (!report) return null;
  const [a, b] = report.fighters;
  const w = winner(report.fighters);
  const top = rankHighlights(highlights)[0] ?? null;
  const ttk = avg(report.timeToKill);

  const parries = a.parries + b.parries;
  const blocks = a.blocks + b.blocks;
  const dodges = a.dodges + b.dodges;
  // "Great skill timing": real defensive reads happened and it wasn't a coin-flip burst.
  const cleanTiming = parries + dodges > 0 && (ttk === null || ttk >= 3);

  let mvp: "A" | "B" | null = w ? w.win.fighter : null;
  if (!mvp) mvp = skillScore(a) === skillScore(b) ? null : skillScore(a) > skillScore(b) ? "A" : "B";

  const lines: string[] = [];
  lines.push("A.L.E. on the call, and GRUDOX, that was a show.");
  lines.push(
    `${report.rounds} round(s)${ttk !== null ? `, avg time-to-kill ${r1(ttk)}s` : ""}. ${momentLine(top)}`,
  );

  if (parries + blocks + dodges > 0) {
    const bits: string[] = [];
    if (parries) bits.push(`${parries} parr${parries === 1 ? "y" : "ies"}`);
    if (dodges) bits.push(`${dodges} dodge${dodges === 1 ? "" : "s"}`);
    if (blocks) bits.push(`${blocks} block${blocks === 1 ? "" : "s"}`);
    lines.push(
      `Defensive read of the night: ${bits.join(", ")}. ${
        cleanTiming
          ? "That is the skill ceiling we are chasing for the highlight reels."
          : "Sharp, but the timing window can go tighter before this goes to camera."
      }`,
    );
  } else {
    lines.push(
      "All offense, zero defense \u2014 the brains still need real parry, block and dodge reads before these clips are ad-ready.",
    );
  }

  if (mvp) {
    const m = mvp === "A" ? a : b;
    lines.push(
      `MVP: ${FIGHTER_LABEL[mvp]} \u2014 ${Math.round(m.accuracy * 100)}% accurate, ${m.kos} KO(s), ${
        m.parries + m.dodges
      } clean defensive play(s).`,
    );
  } else {
    lines.push("Too close to crown anyone \u2014 a genuine dead heat.");
  }

  lines.push("Run it back in the Danger Room and make me a better highlight.");

  const title = w
    ? `${FIGHTER_LABEL[w.win.fighter]} takes the GRUDOX duel`
    : "GRUDOX duel ends in a dead heat";
  return { title, lines, mvp, skill: { parries, blocks, dodges, cleanTiming } };
}

const REVIEW_MS = 10_000;
const INTRO_MS = 1600;
const OUTRO_MS = 2000;

function beatCamera(h: Highlight): AleCameraMode {
  return h.fighter === "A" ? "povA" : "povB";
}

function beatSpeak(h: Highlight): string {
  const who = FIGHTER_LABEL[h.fighter];
  switch (h.kind) {
    case "ko":
      return `${who}, knockout!`;
    case "crit":
      return `Critical from ${who}!`;
    case "parry":
      return `${who} parries! Clean read.`;
    case "bigHit":
      return `Big hit, ${who}!`;
    case "flurry":
      return `${who} on the flurry!`;
  }
}

function beatCaption(h: Highlight): string {
  return `${FIGHTER_LABEL[h.fighter]} \u00b7 ${KIND_LABEL[h.kind]} \u00b7 R${h.round} ${r1(h.t)}s`;
}

/** Assemble a ~10s narrated highlight reel, or null before any duel has finished. */
export function buildAleReview(report: AleReportData | null, highlights: Highlight[]): AleReview | null {
  if (!report) return null;
  const w = winner(report.fighters);
  const picks = rankHighlights(highlights).slice(0, 4);
  const result = w ? `${FIGHTER_LABEL[w.win.fighter]} takes it` : "a dead heat";

  const beats: AleReviewBeat[] = [
    {
      atMs: 0,
      durationMs: INTRO_MS,
      caption: "GRUDOX ARENA \u2014 A.L.E. HIGHLIGHTS",
      speak: "A.L.E. highlights, from the GRUDOX Arena.",
      camera: "director",
    },
  ];

  if (picks.length === 0) {
    beats.push({
      atMs: INTRO_MS,
      durationMs: REVIEW_MS - INTRO_MS - OUTRO_MS,
      caption: "PURE PRESSURE",
      speak: "Toe to toe the whole way.",
      camera: "orbit",
    });
  } else {
    const span = REVIEW_MS - INTRO_MS - OUTRO_MS;
    const each = Math.floor(span / picks.length);
    picks.forEach((h, i) => {
      beats.push({
        atMs: INTRO_MS + i * each,
        durationMs: each,
        caption: beatCaption(h),
        speak: beatSpeak(h),
        camera: beatCamera(h),
      });
    });
  }

  beats.push({
    atMs: REVIEW_MS - OUTRO_MS,
    durationMs: OUTRO_MS,
    caption: `${result.toUpperCase()} \u2014 GRUDOX`,
    speak: `${result}. GRUDOX.`,
    camera: "director",
  });

  return { totalMs: REVIEW_MS, beats };
}
