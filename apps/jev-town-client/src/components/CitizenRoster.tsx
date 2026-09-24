import type { Action } from "@shared/actions.ts";
import { ACTION_LABEL } from "@shared/actions.ts";
import type { Citizen } from "@shared/citizens.ts";

export interface CitizenRosterProps {
  citizens: readonly Citizen[];
  lastActions: Map<number, Action | null>;
}

const VISIBLE_FACES = 12;

/** A short row of portrait chips under the town name, with a count for the rest. */
export function CitizenRoster({ citizens, lastActions }: CitizenRosterProps) {
  const hidden = citizens.length - VISIBLE_FACES;
  return (
    <div className="roster" role="group" aria-label={`${citizens.length} citizens`}>
      {citizens.slice(0, VISIBLE_FACES).map((citizen) => {
        const action = lastActions.get(citizen.id) ?? null;
        return (
          <span
            key={citizen.id}
            className={`roster__chip palette-${citizen.palette}`}
            title={`${citizen.name} — ${citizen.role}${action ? ` — last: ${ACTION_LABEL[action]}` : ""}`}
          >
            <span className="roster__face" aria-hidden="true">
              <span className="roster__eye" />
              <span className="roster__eye" />
            </span>
          </span>
        );
      })}
      {hidden > 0 ? <span className="roster__more">+{hidden}</span> : null}
    </div>
  );
}
