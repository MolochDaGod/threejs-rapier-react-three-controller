import type { ReactNode } from "react";
import * as Menubar from "@radix-ui/react-menubar";
import * as Tooltip from "@radix-ui/react-tooltip";
import { Check } from "lucide-react";

export type ToolMenuEntry =
  | { kind: "item"; label: string; onSelect: () => void; disabled?: boolean; shortcut?: string; icon?: ReactNode; danger?: boolean }
  | {
      kind: "check";
      label: string;
      checked: boolean;
      onSelect: (next: boolean) => void;
      icon?: ReactNode;
      /** Optional second line shown beneath the label. */
      subtitle?: string;
      /** Optional small preview rendered in place of the icon. */
      thumbnail?: ReactNode;
    }
  | { kind: "sep" }
  | { kind: "label"; label: string }
  | { kind: "custom"; render: () => ReactNode };

export interface ToolMenu {
  label: string;
  icon?: ReactNode;
  entries: ToolMenuEntry[];
}

/** Tooltip wrapper for consistently-scaled icon buttons. */
export function Tip({ label, children, side = "bottom" }: { label: string; children: ReactNode; side?: "top" | "bottom" | "left" | "right" }) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className="tm-tip" side={side} sideOffset={6}>
          {label}
          <Tooltip.Arrow className="tm-tip-arrow" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

export function TipProvider({ children }: { children: ReactNode }) {
  return (
    <Tooltip.Provider delayDuration={350} skipDelayDuration={120}>
      {children}
    </Tooltip.Provider>
  );
}

function Entry({ entry }: { entry: ToolMenuEntry }) {
  if (entry.kind === "sep") return <Menubar.Separator className="tm-sep" />;
  if (entry.kind === "label") return <Menubar.Label className="tm-menu-label">{entry.label}</Menubar.Label>;
  if (entry.kind === "custom") return <div className="tm-custom">{entry.render()}</div>;
  if (entry.kind === "check") {
    const rich = !!(entry.subtitle || entry.thumbnail);
    return (
      <Menubar.CheckboxItem
        className={`tm-item ${rich ? "tm-item-rich" : ""}`}
        checked={entry.checked}
        onCheckedChange={(v) => entry.onSelect(!!v)}
        onSelect={(e) => e.preventDefault()}
      >
        <span className="tm-item-indicator">
          <Menubar.ItemIndicator>
            <Check size={13} />
          </Menubar.ItemIndicator>
        </span>
        {entry.thumbnail ? (
          <span className="tm-item-thumb">{entry.thumbnail}</span>
        ) : (
          entry.icon && <span className="tm-item-icon">{entry.icon}</span>
        )}
        {rich ? (
          <span className="tm-item-text">
            <span className="tm-item-label">{entry.label}</span>
            {entry.subtitle && <span className="tm-item-subtitle">{entry.subtitle}</span>}
          </span>
        ) : (
          <span className="tm-item-label">{entry.label}</span>
        )}
      </Menubar.CheckboxItem>
    );
  }
  return (
    <Menubar.Item className={`tm-item ${entry.danger ? "danger" : ""}`} disabled={entry.disabled} onSelect={entry.onSelect}>
      <span className="tm-item-indicator" />
      {entry.icon && <span className="tm-item-icon">{entry.icon}</span>}
      <span className="tm-item-label">{entry.label}</span>
      {entry.shortcut && <span className="tm-item-shortcut">{entry.shortcut}</span>}
    </Menubar.Item>
  );
}

export function ToolMenubar({ brand, menus, right }: { brand?: ReactNode; menus: ToolMenu[]; right?: ReactNode }) {
  return (
    <div className="tm-bar">
      {brand && <span className="tm-brand">{brand}</span>}
      <Menubar.Root className="tm-root">
        {menus.map((m) => (
          <Menubar.Menu key={m.label}>
            <Menubar.Trigger className="tm-trigger">
              {m.icon && <span className="tm-trigger-icon">{m.icon}</span>}
              {m.label}
            </Menubar.Trigger>
            <Menubar.Portal>
              <Menubar.Content className="tm-content" align="start" sideOffset={6} alignOffset={-2}>
                {m.entries.map((e, i) => (
                  <Entry key={i} entry={e} />
                ))}
              </Menubar.Content>
            </Menubar.Portal>
          </Menubar.Menu>
        ))}
      </Menubar.Root>
      {right && <div className="tm-right">{right}</div>}
    </div>
  );
}
