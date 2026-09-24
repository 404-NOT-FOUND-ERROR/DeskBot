import type { DecisionSource } from "@shared/protocol.ts";

export interface ModeBadgeProps {
  jevConfigured: boolean | null;
  lastMode: DecisionSource | null;
  lastReason?: string;
  lastLatencyMs?: number;
}

export function ModeBadge({ jevConfigured, lastMode, lastReason, lastLatencyMs }: ModeBadgeProps) {
  const mode = lastMode ?? (jevConfigured ? "jev" : jevConfigured === false ? "simulation" : null);

  if (mode === null) {
    return <span className="mode-badge mode-badge--pending">Checking Jev…</span>;
  }

  if (mode === "jev") {
    return (
      <span className="mode-badge mode-badge--live" title={lastLatencyMs !== undefined ? `Last round: ${lastLatencyMs}ms` : undefined}>
        <span className="mode-badge__dot" aria-hidden="true" />
        Live Jev{lastLatencyMs !== undefined ? ` · ${lastLatencyMs}ms` : ""}
      </span>
    );
  }

  return (
    <span className="mode-badge mode-badge--sim" title={lastReason}>
      <span className="mode-badge__dot" aria-hidden="true" />
      Local simulation{lastReason ? " (Jev unavailable)" : ""}
    </span>
  );
}
