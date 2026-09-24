import type { Directive } from "@shared/directives.ts";
import type { GoalResult } from "@shared/scoring.ts";

export interface DirectiveCardProps {
  round: number;
  directive: Directive;
  /** Present once this round has been scored. */
  goals: GoalResult[] | null;
}

export function DirectiveCard({ round, directive, goals }: DirectiveCardProps) {
  return (
    <section className="card directive-card" aria-labelledby="directive-title">
      <div className="directive-card__header">
        <span className="directive-card__round">Round {round}</span>
        <h2 id="directive-title">{directive.title}</h2>
      </div>
      <p className="directive-card__brief">{directive.brief}</p>

      {goals ? (
        <ul className="directive-card__goals">
          {goals.map((goal, index) => (
            <li
              key={index}
              className={`directive-card__goal${goal.met ? " directive-card__goal--met" : " directive-card__goal--missed"}`}
            >
              <span aria-hidden="true">{goal.met ? "✓" : "✗"}</span>
              <span>
                {goal.label} <em>({goal.actual}/{goal.required})</em>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="directive-card__goals directive-card__goals--pending">
          {directive.goals.map((_, index) => (
            <li key={index} className="directive-card__goal">
              <span aria-hidden="true">•</span>
              <span>Awaiting broadcast…</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
