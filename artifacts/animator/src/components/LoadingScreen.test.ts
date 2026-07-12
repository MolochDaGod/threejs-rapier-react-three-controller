import { createElement, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ReadinessSnapshot } from "../three/loading/readiness";
import { LoadingScreen } from "./LoadingScreen";

// LoadingScreen is a pure render of a ReadinessSnapshot. These tests guard the
// recovery escape hatch: when a play/danger load fails the overlay must offer
// Retry / Back-to-menu so a player is never trapped. The test env is `node`
// (no jsdom) so handler wiring is checked by walking the returned React element
// tree rather than dispatching real DOM clicks.
function snapshot(partial: Partial<ReadinessSnapshot>): ReadinessSnapshot {
  return {
    items: [],
    progress: 0,
    ready: false,
    failed: false,
    error: null,
    current: "Loading character…",
    slow: false,
    ...partial,
  };
}

const FAILED = snapshot({ failed: true, error: "Arena failed to load", progress: 0.5 });
const SLOW = snapshot({ slow: true, current: "Loading arena…", progress: 0.3 });

// Collect every plain <button> element in a rendered tree so we can read its
// label and invoke its onClick without a DOM.
function findButtons(node: ReactNode): ReactElement[] {
  const out: ReactElement[] = [];
  const visit = (n: ReactNode) => {
    if (Array.isArray(n)) {
      n.forEach(visit);
      return;
    }
    if (!isValidElement(n)) return;
    if (n.type === "button") out.push(n);
    const children = (n.props as { children?: ReactNode }).children;
    if (children !== undefined) visit(children);
  };
  visit(node);
  return out;
}

function buttonByText(node: ReactNode, text: string): ReactElement | undefined {
  return findButtons(node).find(
    (b) => (b.props as { children?: ReactNode }).children === text,
  );
}

describe("LoadingScreen", () => {
  it("shows Retry and Back-to-menu buttons when the load fails", () => {
    const html = renderToStaticMarkup(
      createElement(LoadingScreen, { snapshot: FAILED, onRetry: () => {}, onBack: () => {} }),
    );
    expect(html).toContain("start the match");
    expect(html).toContain("Arena failed to load");
    expect(html).toContain("Retry");
    expect(html).toContain("Back to menu");
  });

  it("invokes onRetry and onBack when their buttons are clicked", () => {
    const onRetry = vi.fn();
    const onBack = vi.fn();
    const tree = LoadingScreen({ snapshot: FAILED, onRetry, onBack });

    const retry = buttonByText(tree, "Retry");
    const back = buttonByText(tree, "Back to menu");
    expect(retry).toBeDefined();
    expect(back).toBeDefined();

    (retry!.props as { onClick: () => void }).onClick();
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onBack).not.toHaveBeenCalled();

    (back!.props as { onClick: () => void }).onClick();
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("shows no recovery buttons in the normal pending state", () => {
    const html = renderToStaticMarkup(
      createElement(LoadingScreen, {
        snapshot: snapshot({ current: "Loading arena…" }),
        onRetry: () => {},
        onBack: () => {},
      }),
    );
    expect(html).toContain("Entering the Danger Room");
    expect(html).not.toContain("Retry");
    expect(html).not.toContain("Back to menu");
  });

  it("shows no recovery buttons once the session is ready", () => {
    const tree = LoadingScreen({
      snapshot: snapshot({ ready: true, progress: 1, current: null }),
      onRetry: () => {},
      onBack: () => {},
    });
    expect(findButtons(tree)).toHaveLength(0);
  });

  it("shows a non-alarming notice and an early Back when the load is slow", () => {
    const html = renderToStaticMarkup(
      createElement(LoadingScreen, { snapshot: SLOW, onRetry: () => {}, onBack: () => {} }),
    );
    // Still the normal (non-failure) loader, not the error state.
    expect(html).toContain("Entering the Danger Room");
    expect(html).not.toContain("start the match");
    expect(html).toContain("taking longer than usual");
    // Early escape, but no Retry (that's reserved for the hard-failure state).
    expect(html).toContain("Back to menu");
    expect(html).not.toContain("Retry");
  });

  it("invokes onBack from the early (slow) escape button", () => {
    const onBack = vi.fn();
    const tree = LoadingScreen({ snapshot: SLOW, onBack });
    const back = buttonByText(tree, "Back to menu");
    expect(back).toBeDefined();
    (back!.props as { onClick: () => void }).onClick();
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("omits the early escape button when no onBack handler is wired", () => {
    const tree = LoadingScreen({ snapshot: SLOW });
    expect(findButtons(tree)).toHaveLength(0);
  });

  it("does not show the slow notice once the load fails (failure UI takes over)", () => {
    const html = renderToStaticMarkup(
      createElement(LoadingScreen, {
        snapshot: snapshot({ failed: true, slow: true, error: "Arena failed to load", progress: 0.5 }),
        onRetry: () => {},
        onBack: () => {},
      }),
    );
    expect(html).not.toContain("taking longer than usual");
    expect(html).toContain("start the match");
    expect(html).toContain("Retry");
  });

  it("still renders the failed loader when no recovery handlers are passed", () => {
    const html = renderToStaticMarkup(createElement(LoadingScreen, { snapshot: FAILED }));
    expect(html).toContain("start the match");
    expect(html).toContain("Arena failed to load");
    expect(html).not.toContain("Retry");
    expect(html).not.toContain("Back to menu");
  });
});
