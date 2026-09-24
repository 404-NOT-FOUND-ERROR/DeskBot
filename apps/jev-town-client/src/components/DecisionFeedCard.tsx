import { useEffect, useState } from "react";
import type { Phase } from "../state/gameReducer.ts";

export interface DecisionFeedCardProps {
  phase: Phase;
  citizenCount: number;
  decisionCount: number | null;
  lastLatencyMs?: number;
}

/** How long the card holds its reading before receding, in ms. Long enough to read the number. */
const HOLD_MS = 2600;

/**
 * The floating "LIVE DECISION FEED" card that overlaps the top of the town
 * map: it turns the round's raw latency number and per-citizen decision
 * count into the same watch-the-number-land beat the reference demo builds
 * its whole pitch around.
 *
 * Once the round has settled and the number has been read, the card recedes.
 * It sits over the north of the map, and now that citizens gather at whatever
 * place was announced rather than always at the fountain, a bakery or school
 * event would otherwise leave its crowd hidden behind this card. Hovering
 * brings it back.
 */
export function DecisionFeedCard({ phase, citizenCount, decisionCount, lastLatencyMs }: DecisionFeedCardProps) {
  const settled = phase === "result" || phase === "gameover";
  const deciding = phase === "loading";
  const filled = settled ? citizenCount : 0;

  // Recede a beat after the town stops moving, so the crowd is never hidden.
  const [receded, setReceded] = useState(false);
  useEffect(() => {
    if (!settled) {
      setReceded(false);
      return;
    }
    const timer = setTimeout(() => setReceded(true), HOLD_MS);
    return () => clearTimeout(timer);
  }, [settled, decisionCount, lastLatencyMs]);

  const headline = settled
    ? `${decisionCount ?? citizenCount} citizens chose what to do`
    : `One announcement. ${citizenCount} decisions.`;

  const seconds = settled && lastLatencyMs !== undefined ? (lastLatencyMs / 1000).toFixed(2) : null;

  return (
    <div
      className={`decision-feed${receded ? " decision-feed--receded" : ""}`}
      role="status"
      aria-live="polite"
    >
      <p className="decision-feed__eyebrow">Live decision feed</p>
      <p className="decision-feed__headline">{headline}</p>

      {seconds !== null ? (
        <p className="decision-feed__reading">
          <span className="decision-feed__number">{seconds}</span>
          <span className="decision-feed__unit">seconds</span>
        </p>
      ) : (
        <p className="decision-feed__reading decision-feed__reading--waiting">
          <span className={`decision-feed__number${deciding ? " decision-feed__number--pulsing" : ""}`}>
            {deciding ? "…" : "—"}
          </span>
          <span className="decision-feed__unit">{deciding ? "deciding" : "seconds"}</span>
        </p>
      )}

      <div className={`decision-feed__grid${deciding ? " decision-feed__grid--deciding" : ""}`}>
        {Array.from({ length: citizenCount }, (_, i) => (
          <span
            key={i}
            className={`decision-feed__cell${i < filled ? " decision-feed__cell--filled" : ""}`}
            style={{ transitionDelay: `${Math.min(i * 12, 300)}ms` }}
          />
        ))}
      </div>

      <p className="decision-feed__caption">
        {settled
          ? lastLatencyMs !== undefined && lastLatencyMs < 1000
            ? "Less than a second for the whole town."
            : "One batched call for the whole town."
          : "One light for every citizen."}
      </p>
    </div>
  );
}
