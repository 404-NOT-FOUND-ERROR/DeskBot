import { lazy, Suspense, useCallback, useRef, useState } from "react";
import { ACTIONS, ACTION_GLYPH, ACTION_LABEL, type Action } from "@shared/actions.ts";
import { CITIZENS } from "@shared/citizens.ts";
import { PLACES } from "@shared/town.ts";
import type { Point } from "@shared/positions.ts";
import type { Citizen } from "@shared/citizens.ts";
import type { LabelSpec } from "../three/sceneSpec.ts";
import type { TownScene3DHandle } from "../three/TownScene3D.tsx";
import { isWebglAvailable } from "../three/webgl.ts";
import { CitizenSprite } from "./CitizenSprite.tsx";

export interface TownMapProps {
  citizens?: readonly Citizen[];
  labels?: readonly LabelSpec[];
  positions: Map<number, Point>;
  durations: Map<number, number>;
  actions: Map<number, Action | null>;
  confidences: Map<number, number | null>;
  focusedAction: Action | null;
  onFocusAction: (action: Action | null) => void;
}

// Three.js is most of the bundle; load it separately so the rest of the page paints immediately.
const TownScene3D = lazy(() => import("../three/TownScene3D.tsx").then((m) => ({ default: m.TownScene3D })));

function TownFallback() {
  return (
    <div className="town-map__fallback" role="group" aria-label="Town status, text view">
      <p className="town-map__fallback-title">3D view unavailable</p>
      <p className="town-map__fallback-copy">
        This browser or device doesn&apos;t support WebGL, so the 3D town can&apos;t be shown. Broadcasting, scoring and
        the reaction tallies still work normally.
      </p>
    </div>
  );
}

export function TownMap({ citizens = CITIZENS, labels, positions, durations, actions, confidences, focusedAction, onFocusAction }: TownMapProps) {
  const [supportsWebgl, setSupportsWebgl] = useState<boolean>(() => isWebglAvailable());
  const [zoom, setZoom] = useState(1);
  const [showDecisions, setShowDecisions] = useState(true);
  const sceneRef = useRef<TownScene3DHandle | null>(null);
  const hotspotsRef = useRef(new Map<number, HTMLButtonElement>());

  const registerHotspot = useCallback((citizenId: number, element: HTMLButtonElement | null) => {
    if (element) hotspotsRef.current.set(citizenId, element);
    else hotspotsRef.current.delete(citizenId);
  }, []);
  const getHotspot = useCallback((citizenId: number) => hotspotsRef.current.get(citizenId) ?? null, []);
  const handleContextLost = useCallback(() => setSupportsWebgl(false), []);

  const counts = new Map<Action, number>(ACTIONS.map((a) => [a, 0]));
  for (const action of actions.values()) if (action) counts.set(action, (counts.get(action) ?? 0) + 1);
  const anyDecisions = [...actions.values()].some((a) => a !== null);

  return (
    <div className="town-map" role="group" aria-label={`Interactive 3D town map with ${citizens.length} citizens`}>
      {supportsWebgl ? (
        <div className="town-map__scene">
          <Suspense fallback={<p className="town-map__loading">Building Cloverfield…</p>}>
            <TownScene3D
              ref={sceneRef}
              citizens={citizens}
              labels={labels}
              positions={positions}
              durations={durations}
              actions={actions}
              focusedAction={focusedAction}
              showDecisions={showDecisions}
              getHotspot={getHotspot}
              onZoomChange={setZoom}
              onContextLost={handleContextLost}
            />
          </Suspense>

          <div className="town-map__citizens-layer">
            {citizens.map((citizen) => {
              const action = actions.get(citizen.id) ?? null;
              return (
                <CitizenSprite
                  key={citizen.id}
                  citizen={citizen}
                  action={action}
                  confidence={confidences.get(citizen.id) ?? null}
                  highlighted={focusedAction !== null && action === focusedAction}
                  registerHotspot={registerHotspot}
                />
              );
            })}
          </div>

          <div className="map-legend" role="group" aria-label="Reactions. Select one to highlight those citizens.">
            {ACTIONS.map((action) => (
              <button
                key={action}
                type="button"
                className={`map-legend__item map-legend__item--${action.toLowerCase()}${
                  focusedAction === action ? " map-legend__item--active" : ""
                }`}
                aria-pressed={focusedAction === action}
                disabled={!anyDecisions}
                onClick={() => onFocusAction(focusedAction === action ? null : action)}
              >
                <span className="map-legend__glyph" aria-hidden="true">
                  {ACTION_GLYPH[action]}
                </span>
                <span className="map-legend__label">{ACTION_LABEL[action]}</span>
                {anyDecisions ? <span className="map-legend__count">{counts.get(action)}</span> : null}
              </button>
            ))}
          </div>

          <div className="map-controls" role="group" aria-label="Map view">
            <div className="map-controls__zoom">
              <button type="button" aria-label="Zoom out" onClick={() => sceneRef.current?.zoomBy(1 / 1.3)}>
                −
              </button>
              <span className="map-controls__zoom-value" aria-live="polite">
                {Math.round(zoom * 100)}%
              </span>
              <button type="button" aria-label="Zoom in" onClick={() => sceneRef.current?.zoomBy(1.3)}>
                +
              </button>
            </div>
            <button type="button" aria-label="Rotate left" onClick={() => sceneRef.current?.rotateBy(-Math.PI / 2)}>
              ⟲
            </button>
            <button type="button" aria-label="Rotate right" onClick={() => sceneRef.current?.rotateBy(Math.PI / 2)}>
              ⟳
            </button>
            <button type="button" className="map-controls__text" aria-label="Fit town" title="Fit town" onClick={() => sceneRef.current?.fitTown()}>
              Fit town
            </button>
            <button type="button" className="map-controls__text" aria-label="Reset view" title="Reset view" onClick={() => sceneRef.current?.resetView()}>
              Reset
            </button>
            <button
              type="button"
              className="map-controls__text"
              aria-label="Show decisions"
              title="Show decisions"
              aria-pressed={showDecisions}
              onClick={() => setShowDecisions((v) => !v)}
            >
              Show decisions
            </button>
          </div>
        </div>
      ) : (
        <TownFallback />
      )}

      <p className="sr-only">
        {`Town map: ${citizens.length} visible figures across ${labels?.length ?? PLACES.length} labelled places, rendered as an interactive 3D scene. Drag to pan, right-drag or Shift-drag to rotate, scroll or pinch to zoom.`}
      </p>
    </div>
  );
}
