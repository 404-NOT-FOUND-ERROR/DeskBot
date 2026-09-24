import { ACTIONS, ACTION_LABEL, emptyTally, type Action } from "@shared/actions.ts";
import { CITIZEN_COUNT } from "@shared/citizens.ts";
import { meanOf } from "@shared/decisions.ts";
import type { Decision } from "@shared/protocol.ts";
import { MAX_TRUST, MAX_UNREST } from "@shared/scoring.ts";

export interface StatsPanelProps {
  decisions: Decision[] | null;
  trust: number;
  unrest: number;
  streak: number;
  bestStreak: number;
  totalScore: number;
  lastScore: number | null;
  focusedAction: Action | null;
  onFocusAction: (action: Action | null) => void;
}

function tallyDecisions(decisions: Decision[] | null): Record<Action, number> {
  const counts = emptyTally();
  if (!decisions) return counts;
  for (const d of decisions) counts[d.action] += 1;
  return counts;
}

function meanConfidenceFor(decisions: Decision[] | null, action: Action): number | null {
  if (!decisions) return null;
  const pool = decisions.filter((d) => d.action === action);
  if (pool.length === 0) return null;
  return pool.reduce((sum, d) => sum + d.confidence, 0) / pool.length;
}

/**
 * Two judgements Jev makes alongside the action itself: a Noul per citizen for
 * whether they believe the broadcast, and a Score for how alarmed they are.
 * Belief explains rounds where a true warning is shrugged off; alarm is what
 * now drives unrest, so it is shown next to it.
 */
function MoodReadout({ decisions }: { decisions: Decision[] }) {
  const believers = decisions.filter((d) => typeof d.belief === "number" && d.belief >= 0.5).length;
  const scored = decisions.filter((d) => typeof d.belief === "number").length;
  const alarm = meanOf(decisions, "alarm");
  if (scored === 0 && alarm === null) return null;

  return (
    <div className="mood">
      {scored > 0 ? (
        <p className="mood__line">
          <span className="mood__label">Believed it</span>
          <span className="mood__value">
            {believers} <small>of {scored}</small>
          </span>
        </p>
      ) : null}
      {alarm !== null ? (
        <p className="mood__line">
          <span className="mood__label">Town alarm</span>
          <span className="mood__value">{Math.round(alarm * 100)}%</span>
        </p>
      ) : null}
    </div>
  );
}

export function StatsPanel({
  decisions,
  trust,
  unrest,
  streak,
  bestStreak,
  totalScore,
  lastScore,
  focusedAction,
  onFocusAction,
}: StatsPanelProps) {
  const counts = tallyDecisions(decisions);

  return (
    <section className="card stats-panel" aria-label="Round statistics">
      <div className="stats-panel__vitals">
        <div className="vital" title={`${trust} of ${MAX_TRUST} trust remaining`}>
          <span className="vital__label">Council trust</span>
          <span className="vital__hearts" aria-hidden="true">
            {Array.from({ length: MAX_TRUST }, (_, i) => (i < trust ? "♥" : "♡")).join(" ")}
          </span>
        </div>
        <div className="vital">
          <span className="vital__label">Unrest</span>
          <div className="meter" role="meter" aria-valuenow={unrest} aria-valuemin={0} aria-valuemax={MAX_UNREST}>
            <div
              className={`meter__fill${unrest > 70 ? " meter__fill--danger" : unrest > 40 ? " meter__fill--warn" : ""}`}
              style={{ width: `${unrest}%` }}
            />
          </div>
        </div>
        <div className="vital">
          <span className="vital__label">Streak</span>
          <span className="vital__value">
            {streak}
            <small> (best {bestStreak})</small>
          </span>
        </div>
        <div className="vital">
          <span className="vital__label">Score</span>
          <span className="vital__value">
            {totalScore}
            {lastScore !== null ? <small> (+{lastScore})</small> : null}
          </span>
        </div>
      </div>

      {decisions ? <MoodReadout decisions={decisions} /> : null}

      <h3 className="stats-panel__heading">Reactions right now</h3>
      <ul className="reaction-bars">
        {ACTIONS.map((action) => {
          const count = counts[action];
          const pct = decisions ? Math.round((count / CITIZEN_COUNT) * 100) : 0;
          const confidence = meanConfidenceFor(decisions, action);
          return (
            <li key={action}>
              <button
                type="button"
                className={`reaction-bar reaction-bar--${action.toLowerCase()}${
                  focusedAction === action ? " reaction-bar--focused" : ""
                }`}
                onClick={() => onFocusAction(focusedAction === action ? null : action)}
                aria-pressed={focusedAction === action}
              >
                <span className="reaction-bar__label">{ACTION_LABEL[action]}</span>
                <span className="reaction-bar__track">
                  <span className="reaction-bar__fill" style={{ width: `${pct}%` }} />
                </span>
                <span className="reaction-bar__count">
                  {count}
                  {confidence !== null ? (
                    <small> · {Math.round(confidence * 100)}% conf.</small>
                  ) : null}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
