import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createFighterBrain,
  type FighterActions,
  type FighterAgent,
  type FighterBias,
  type FighterPerception,
} from "./FighterBrain";

function mockActions(): FighterActions {
  return {
    face: vi.fn(),
    advance: vi.fn(),
    retreat: vi.fn(),
    strafe: vi.fn(),
    gapClose: vi.fn(),
    returnHome: vi.fn(),
    beginWindup: vi.fn(),
    tickWindup: vi.fn(() => false),
    releaseStrike: vi.fn(),
    cancelWindup: vi.fn(),
    continueCombo: vi.fn(() => false),
    defend: vi.fn(),
    beginCast: vi.fn(),
    tickCast: vi.fn(() => false),
    releaseCast: vi.fn(),
    cancelCast: vi.fn(),
  };
}

function makeAgent(
  overrides: Partial<FighterPerception> = {},
  bias: Partial<FighterBias> = {},
  reactionDelay = 0,
): FighterAgent {
  const perception: FighterPerception = {
    hasTarget: true,
    distance: 1,
    engageRange: 2,
    innerRange: 0.8,
    lungeRange: 4,
    targetWindingUp: false,
    targetRecovering: false,
    attackReady: true,
    spellReady: false,
    spellRange: 17,
    canDefend: true,
    health01: 1,
    stamina01: 1,
    poise01: 1,
    ...overrides,
  };
  return {
    bias: { aggression: 1, caution: 1, skillFrequency: 0.2, ...bias },
    reactionDelay,
    perception,
    actions: mockActions(),
  };
}

describe("FighterBrain goal selection", () => {
  it("idles + drifts home when there is no target", () => {
    const agent = makeAgent({ hasTarget: false, distance: Infinity });
    const brain = createFighterBrain(agent);
    brain.process(0.1);
    expect(brain.activeTag).toBe("idle");
    expect(agent.actions.returnHome).toHaveBeenCalled();
  });

  it("engages (closes distance) when the target is out of range", () => {
    const agent = makeAgent({ distance: 5, engageRange: 2, attackReady: true });
    const brain = createFighterBrain(agent);
    brain.process(0.1);
    expect(brain.activeTag).toBe("engage");
    expect(agent.actions.advance).toHaveBeenCalled();
  });

  it("attacks when in range, ready, and aggressive", () => {
    const agent = makeAgent({ distance: 1, engageRange: 2, attackReady: true });
    const brain = createFighterBrain(agent);
    brain.process(0.016);
    expect(brain.activeTag).toBe("attack");
  });

  it("prefers defending over attacking against a telegraph when cautious", () => {
    // reactionDelay > 0 so the DefendGoal stays active (doesn't complete same tick).
    const agent = makeAgent(
      { distance: 1, engageRange: 2, targetWindingUp: true, canDefend: true },
      { aggression: 1, caution: 1.4 },
      0.2,
    );
    const brain = createFighterBrain(agent);
    brain.process(0.016);
    expect(brain.activeTag).toBe("defend");
    expect(agent.actions.beginWindup).not.toHaveBeenCalled();
  });

  it("repositions when in range but the attack is on cooldown", () => {
    const agent = makeAgent({ distance: 1, engageRange: 2, attackReady: false });
    const brain = createFighterBrain(agent);
    brain.process(0.016);
    expect(brain.activeTag).toBe("reposition");
    expect(agent.actions.face).toHaveBeenCalled();
  });
});

describe("smarter duel behaviours", () => {
  it("gap-closes (dashes) when the target is just out of reach, ready and aggressive", () => {
    const agent = makeAgent({ distance: 3, engageRange: 2, lungeRange: 4, attackReady: true });
    const brain = createFighterBrain(agent);
    brain.process(0.016);
    expect(brain.activeTag).toBe("gapClose");
    expect(agent.actions.gapClose).toHaveBeenCalledTimes(1);
    expect(agent.actions.advance).toHaveBeenCalled();
  });

  it("just walks in (engage) when the target is beyond dash range", () => {
    const agent = makeAgent({ distance: 6, engageRange: 2, lungeRange: 4, attackReady: true });
    const brain = createFighterBrain(agent);
    brain.process(0.016);
    expect(brain.activeTag).toBe("engage");
    expect(agent.actions.gapClose).not.toHaveBeenCalled();
  });

  it("prioritises attacking a recovering / whiffing target (punish window)", () => {
    // Even mid-cooldown wind-down the recovering flag pushes attack desirability
    // above reposition.
    const agent = makeAgent({ distance: 1, engageRange: 2, targetRecovering: true, attackReady: true });
    const brain = createFighterBrain(agent);
    brain.process(0.016);
    expect(brain.activeTag).toBe("attack");
  });

  it("chains a combo string when the host gate allows it", () => {
    const agent = makeAgent({ distance: 1, engageRange: 2, attackReady: true }, { aggression: 1 });
    let ready = false;
    (agent.actions.tickWindup as ReturnType<typeof vi.fn>).mockImplementation(() => ready);
    (agent.actions.continueCombo as ReturnType<typeof vi.fn>).mockReturnValue(true);
    const brain = createFighterBrain(agent);
    brain.process(0.016); // reactionDelay 0 → beginWindup
    ready = true;
    brain.process(0.016); // first strike lands → continueCombo true → re-windup
    expect(agent.actions.releaseStrike).toHaveBeenCalledTimes(1);
    expect(agent.actions.beginWindup).toHaveBeenCalledTimes(2);
    brain.process(0.016); // second strike lands → cap (aggression 1 → maxHits 2) → done
    expect(agent.actions.releaseStrike).toHaveBeenCalledTimes(2);
  });

  it("circle-strafes (not pure backpedal) while repositioning at a safe range", () => {
    const agent = makeAgent({ distance: 1.5, innerRange: 0.8, engageRange: 2, attackReady: false });
    const brain = createFighterBrain(agent);
    brain.process(0.016);
    expect(brain.activeTag).toBe("reposition");
    expect(agent.actions.strafe).toHaveBeenCalled();
    expect(agent.actions.retreat).not.toHaveBeenCalled();
  });
});

describe("spacing + kiting (warrior's distance)", () => {
  it("opens space (retreats while circling) when crowded inside the comfort band", () => {
    // distance 1.2 is inside engageRange*0.7 (1.4) but outside innerRange (0.8):
    // the fighter should drift out AND strafe rather than crowd in.
    const agent = makeAgent({
      distance: 1.2,
      innerRange: 0.8,
      engageRange: 2,
      attackReady: false,
      spellReady: false,
    });
    const brain = createFighterBrain(agent);
    brain.process(0.016);
    expect(brain.activeTag).toBe("reposition");
    expect(agent.actions.retreat).toHaveBeenCalled();
    expect(agent.actions.strafe).toHaveBeenCalled();
  });

  it("kites (backs off) when ranged-capable and the target presses into melee", () => {
    const agent = makeAgent(
      { distance: 1.4, engageRange: 2, spellReady: true, attackReady: false },
      { aggression: 0.6 },
    );
    const brain = createFighterBrain(agent);
    brain.process(0.016);
    expect(brain.activeTag).toBe("kite");
    expect(agent.actions.retreat).toHaveBeenCalled();
    expect(agent.actions.strafe).toHaveBeenCalled();
  });

  it("does not kite without a ranged option (melee-only holds via reposition)", () => {
    const agent = makeAgent({
      distance: 1.4,
      engageRange: 2,
      spellReady: false,
      attackReady: false,
    });
    const brain = createFighterBrain(agent);
    brain.process(0.016);
    expect(brain.activeTag).not.toBe("kite");
  });

  it("casts (not kite) when already at poke range", () => {
    const agent = makeAgent({ distance: 9, engageRange: 2, spellReady: true, spellRange: 17 });
    const brain = createFighterBrain(agent);
    brain.process(0.016);
    expect(brain.activeTag).toBe("cast");
  });

  it("an aggressive ranged bruiser still commits a ready melee attack over kiting", () => {
    const agent = makeAgent(
      { distance: 1, engageRange: 2, attackReady: true, spellReady: true },
      { aggression: 1.35 },
    );
    const brain = createFighterBrain(agent);
    brain.process(0.016);
    expect(brain.activeTag).toBe("attack");
  });

  it("even a cautious easy-tier caster commits a ready melee swing over kiting", () => {
    // Easy difficulty aggression is 0.7 — the razor-thin tier where kite must
    // still stay below a ready melee Attack so no fighter flees a free swing.
    const agent = makeAgent(
      { distance: 1, engageRange: 2, attackReady: true, spellReady: true },
      { aggression: 0.7 },
    );
    const brain = createFighterBrain(agent);
    brain.process(0.016);
    expect(brain.activeTag).toBe("attack");
  });
});

describe("reaction-latency gating", () => {
  it("waits the reaction delay before beginning the attack wind-up", () => {
    const agent = makeAgent({ distance: 1, engageRange: 2, attackReady: true }, {}, 0.3);
    const brain = createFighterBrain(agent);
    // First tick installs AttackGoal but is still in the wait phase.
    brain.process(0.1);
    expect(brain.activeTag).toBe("attack");
    expect(agent.actions.beginWindup).not.toHaveBeenCalled();
    brain.process(0.1); // 0.2 elapsed, still waiting
    expect(agent.actions.beginWindup).not.toHaveBeenCalled();
    brain.process(0.15); // 0.35 elapsed → latency passed
    expect(agent.actions.beginWindup).toHaveBeenCalledTimes(1);
  });

  it("waits the reaction delay before committing a defense", () => {
    const agent = makeAgent(
      { distance: 1, engageRange: 2, targetWindingUp: true, canDefend: true },
      { caution: 1.4 },
      0.25,
    );
    const brain = createFighterBrain(agent);
    brain.process(0.1);
    expect(brain.activeTag).toBe("defend");
    expect(agent.actions.defend).not.toHaveBeenCalled();
    brain.process(0.2); // 0.3 elapsed → past latency
    expect(agent.actions.defend).toHaveBeenCalledTimes(1);
  });

  it("releases the strike once the wind-up reports ready", () => {
    const agent = makeAgent({ distance: 1, engageRange: 2, attackReady: true });
    let ready = false;
    (agent.actions.tickWindup as ReturnType<typeof vi.fn>).mockImplementation(() => ready);
    const brain = createFighterBrain(agent);
    brain.process(0.016); // wait phase elapses instantly (reactionDelay 0) → beginWindup
    expect(agent.actions.beginWindup).toHaveBeenCalled();
    brain.process(0.016); // tickWindup → false, still winding
    expect(agent.actions.releaseStrike).not.toHaveBeenCalled();
    ready = true;
    brain.process(0.016);
    expect(agent.actions.releaseStrike).toHaveBeenCalledTimes(1);
  });
});

describe("ranged spell casting", () => {
  it("does not cast when the spell is not ready", () => {
    const agent = makeAgent({ distance: 8, engageRange: 2, spellReady: false, spellRange: 17 });
    const brain = createFighterBrain(agent);
    brain.process(0.016);
    expect(brain.activeTag).not.toBe("cast");
    expect(agent.actions.beginCast).not.toHaveBeenCalled();
  });

  it("prefers casting over walking in when ready and at range", () => {
    const agent = makeAgent({ distance: 10, engageRange: 2, spellReady: true, spellRange: 17 });
    const brain = createFighterBrain(agent);
    brain.process(0.016);
    expect(brain.activeTag).toBe("cast");
  });

  it("does not cast a target beyond spell range", () => {
    const agent = makeAgent({ distance: 25, engageRange: 2, spellReady: true, spellRange: 17 });
    const brain = createFighterBrain(agent);
    brain.process(0.016);
    expect(brain.activeTag).not.toBe("cast");
  });

  it("charges then releases the spell once the charge reports ready", () => {
    const agent = makeAgent({ distance: 10, engageRange: 2, spellReady: true, spellRange: 17 });
    let ready = false;
    (agent.actions.tickCast as ReturnType<typeof vi.fn>).mockImplementation(() => ready);
    const brain = createFighterBrain(agent);
    brain.process(0.016); // reactionDelay 0 → beginCast (charge phase)
    expect(agent.actions.beginCast).toHaveBeenCalledTimes(1);
    brain.process(0.016); // tickCast false → still charging
    expect(agent.actions.releaseCast).not.toHaveBeenCalled();
    ready = true;
    brain.process(0.016);
    expect(agent.actions.releaseCast).toHaveBeenCalledTimes(1);
  });

  it("cancels a half-charged cast when interrupted (hitstun)", () => {
    const agent = makeAgent({ distance: 10, engageRange: 2, spellReady: true, spellRange: 17 });
    const brain = createFighterBrain(agent);
    brain.process(0.016); // enters charge phase
    expect(agent.actions.beginCast).toHaveBeenCalledTimes(1);
    brain.reset(); // host drops intent mid-charge
    expect(agent.actions.cancelCast).toHaveBeenCalledTimes(1);
    expect(agent.actions.releaseCast).not.toHaveBeenCalled();
  });

  it("still attacks (melee) over casting when in melee range and ready", () => {
    const agent = makeAgent({ distance: 1, engageRange: 2, attackReady: true, spellReady: true, spellRange: 17 });
    const brain = createFighterBrain(agent);
    brain.process(0.016);
    expect(brain.activeTag).toBe("attack");
  });
});

describe("brain reset", () => {
  let agent: FighterAgent;
  beforeEach(() => {
    agent = makeAgent();
  });
  it("clears the active goal so the next tick re-arbitrates fresh", () => {
    const brain = createFighterBrain(agent);
    brain.process(0.016);
    expect(brain.activeTag).not.toBeNull();
    brain.reset();
    expect(brain.activeTag).toBeNull();
  });

  it("unwinds a half-committed wind-up when interrupted (hitstun) and re-telegraphs from scratch", () => {
    // Simulates Targets.updateAi calling brain.reset() when the fighter enters a
    // busy CC state (stagger/stunned/...) mid-wind-up: the strike must NOT resume
    // from the stale timer — it must cancel, then re-telegraph on the next free frame.
    const interrupted = makeAgent({ distance: 1, engageRange: 2, attackReady: true });
    const brain = createFighterBrain(interrupted);
    brain.process(0.016); // reactionDelay 0 → enters wind-up + telegraphs once
    expect(interrupted.actions.beginWindup).toHaveBeenCalledTimes(1);
    expect(brain.activeTag).toBe("attack");

    // Hitstun: host drops the intent. The abandoned wind-up must be unwound...
    brain.reset();
    expect(interrupted.actions.cancelWindup).toHaveBeenCalledTimes(1);
    expect(interrupted.actions.releaseStrike).not.toHaveBeenCalled();
    expect(brain.activeTag).toBeNull();

    // ...and a fresh attack must re-telegraph rather than resume the old wind-up.
    brain.process(0.016);
    expect(brain.activeTag).toBe("attack");
    expect(interrupted.actions.beginWindup).toHaveBeenCalledTimes(2);
    expect(interrupted.actions.releaseStrike).not.toHaveBeenCalled();
  });
});
