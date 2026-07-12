import type {
  AleFighterReport,
  AlePlatform,
  AlePost,
  AleReportData,
  Highlight,
} from "../types";

/**
 * A.L.E.'s "social desk". A.L.E. is GRUDOX's attention-seeking entertainment AI:
 * after every duel it composes hype, platform-flavoured DRAFT posts (captions +
 * stats + the standout highlight) for the grudge-studio site, Discord, and the
 * socials. Pure + deterministic — same duel always yields the same drafts, and
 * nothing here publishes anything (the UI previews drafts only).
 */

const FIGHTER_LABEL: Record<"A" | "B", string> = {
  A: "Fighter A (left corner)",
  B: "Fighter B (right corner)",
};

/** Pick the single most postable moment: KO > crit > parry > highest score. */
function topHighlight(highlights: Highlight[]): Highlight | null {
  if (highlights.length === 0) return null;
  const rank: Record<Highlight["kind"], number> = {
    ko: 5,
    crit: 4,
    parry: 3,
    bigHit: 2,
    flurry: 1,
  };
  let best = highlights[0];
  for (const h of highlights) {
    const a = rank[h.kind] * 100 + h.score;
    const b = rank[best.kind] * 100 + best.score;
    if (a > b) best = h;
  }
  return best;
}

function winner(fighters: AleFighterReport[]): { win: AleFighterReport; lose: AleFighterReport } | null {
  if (fighters.length < 2) return null;
  const [a, b] = fighters;
  if (a.kos !== b.kos) return a.kos > b.kos ? { win: a, lose: b } : { win: b, lose: a };
  if (a.damageDealt !== b.damageDealt) {
    return a.damageDealt > b.damageDealt ? { win: a, lose: b } : { win: b, lose: a };
  }
  return null; // genuine draw
}

function avg(xs: number[]): number | null {
  if (xs.length === 0) return null;
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

const r1 = (n: number) => Math.round(n * 10) / 10;

function momentLine(h: Highlight | null): string {
  if (!h) return "Toe-to-toe the whole way — pure pressure.";
  const who = FIGHTER_LABEL[h.fighter];
  switch (h.kind) {
    case "ko":
      return `That round-${h.round} KNOCKOUT from ${who} at ${r1(h.t)}s? Lights out. Replay it.`;
    case "crit":
      return `${who} landed a CRITICAL in round ${h.round} that bent the whole match.`;
    case "parry":
      return `${who} pulled a frame-perfect PARRY in round ${h.round}. Ice cold.`;
    case "bigHit":
      return `${who} cracked a massive hit in round ${h.round} — you felt that one.`;
    case "flurry":
      return `${who} opened up a flurry in round ${h.round} and never let go.`;
  }
}

/**
 * Compose the draft feed from a finalised duel report + its highlights.
 * Returns [] when there's no report yet (mid-duel / before any duel).
 */
export function buildAleFeed(report: AleReportData | null, highlights: Highlight[]): AlePost[] {
  if (!report) return [];

  const top = topHighlight(highlights);
  const w = winner(report.fighters);
  const moment = momentLine(top);
  const ttk = avg(report.timeToKill);
  const ttkLine = ttk !== null ? `avg time-to-kill ${r1(ttk)}s` : "every exchange counted";
  const rounds = report.rounds;
  const result = w
    ? `${FIGHTER_LABEL[w.win.fighter]} takes it`
    : "and somehow it's a DEAD HEAT";
  const koLine = w ? `${w.win.kos}\u2013${w.lose.kos} on KOs` : "no clean finish";
  const hlLabel = top?.label;
  const topFinding = report.findings[0]?.text ?? null;

  const baseHype = top ? 0.55 + top.score * 0.45 : 0.5;
  const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

  const posts: AlePost[] = [
    {
      platform: "youtube",
      headline: `GRUDOX ARENA: ${rounds}-round WAR \u2014 ${result}!`,
      caption: `A.L.E. on the call. ${moment} ${result} (${koLine}). The Danger Room never sleeps \u2014 subscribe and pick who steps in next.`,
      tags: ["GRUDOX", "DangerRoom", "FightHighlights", "AIvsAI"],
      highlight: hlLabel,
      hype: clamp01(baseHype + 0.05),
    },
    {
      platform: "twitter",
      caption: `${moment} ${result}, ${koLine}. Who's next in the GRUDOX Arena?`,
      headline: "",
      tags: ["GRUDOX", "Arena", "ggwp"],
      highlight: hlLabel,
      hype: clamp01(baseHype),
    },
    {
      platform: "instagram",
      headline: "ARENA DROP",
      caption: `${moment} ${rounds} rounds, ${ttkLine}. ${result}. Tap in \u2014 GRUDOX runs the realest AI brawls in the game.`,
      tags: ["GRUDOX", "fightgram", "gamedev", "dangerroom"],
      highlight: hlLabel,
      hype: clamp01(baseHype - 0.03),
    },
    {
      platform: "discord",
      headline: "New Arena Drop",
      caption: `@here fresh GRUDOX duel just wrapped. ${moment} ${result} over ${rounds} round(s). Boot the Danger Room and run your own matchup.`,
      tags: ["arena-drops", "grudox"],
      highlight: hlLabel,
      hype: clamp01(baseHype - 0.05),
    },
    {
      platform: "grudge-studio",
      headline: `Match Recap: ${rounds}-round duel \u2014 ${result}`,
      caption: `A.L.E.'s recap: ${rounds} round(s), ${ttkLine}, ${koLine}. ${moment}${
        topFinding ? ` Balance note for the lab: ${topFinding}` : ""
      }`,
      tags: ["GRUDOX", "recap", "balance"],
      highlight: hlLabel,
      hype: clamp01(baseHype - 0.08),
    },
    {
      platform: "forum",
      headline: `[GRUDOX Showcase] AI duel breakdown \u2014 ${rounds} rounds, ${ttkLine}`,
      caption: `Bringing this to the next gaming festival floor. ${moment} ${result} (${koLine}). Live, tunable AI-vs-AI brawls in a browser Danger Room \u2014 come throw your own matchup at A.L.E.`,
      tags: ["GRUDOX", "indiedev", "showcase", "fightingAI"],
      highlight: hlLabel,
      hype: clamp01(baseHype - 0.1),
    },
  ];

  posts.sort((x, y) => y.hype - x.hype);
  return posts;
}
