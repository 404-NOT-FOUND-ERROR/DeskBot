import { memo } from "react";
import { ACTION_LABEL, type Action } from "@shared/actions.ts";
import type { Citizen } from "@shared/citizens.ts";

export interface CitizenSpriteProps {
  citizen: Citizen;
  action: Action | null;
  confidence: number | null;
  highlighted: boolean;
  /** Receives the button so the 3D scene can position it over the citizen's figure each frame. */
  registerHotspot: (citizenId: number, element: HTMLButtonElement | null) => void;
}

/**
 * An invisible, keyboard-focusable hit target laid over the 3D canvas at the
 * citizen's projected screen position. The visible figure lives in the
 * Three.js scene (see `TownScene3D.tsx`); this button exists so pointer,
 * keyboard and screen-reader users all get a real element with a name, role
 * and hover/focus tooltip. The scene writes its `transform` directly, so
 * camera movement never re-renders React.
 */
function CitizenSpriteImpl({ citizen, action, confidence, highlighted, registerHotspot }: CitizenSpriteProps) {
  const pct = confidence !== null ? Math.round(confidence * 100) : null;

  return (
    <button
      type="button"
      ref={(element) => registerHotspot(citizen.id, element)}
      className={`citizen-hotspot${highlighted ? " citizen-hotspot--highlighted" : ""}`}
      aria-label={`${citizen.name}, ${citizen.role}. ${
        action ? `Last decision: ${ACTION_LABEL[action]}${pct !== null ? ` at ${pct}% confidence` : ""}.` : "Has not reacted yet."
      }`}
    >
      <span className="citizen-hotspot__tooltip" role="tooltip">
        <strong>{citizen.name}</strong>
        <span className="citizen-hotspot__tooltip-role">{citizen.role}</span>
        <span className="citizen-hotspot__tooltip-personality">{citizen.personality}</span>
        {action ? (
          <span className="citizen-hotspot__tooltip-action">
            {ACTION_LABEL[action]}
            {pct !== null ? ` - ${pct}% confident` : ""}
          </span>
        ) : null}
      </span>
    </button>
  );
}

export const CitizenSprite = memo(CitizenSpriteImpl);
