import { useEffect, useMemo, useReducer, useState } from "react";
import type { Action } from "@shared/actions.ts";
import { CITIZENS } from "@shared/citizens.ts";
import { locationOrDefault } from "@shared/locations.ts";
import { destinationFor, postPosition, travelDurationMs, type Point } from "@shared/positions.ts";
import { fetchStatus, postBroadcast } from "./api.ts";
import { BroadcastForm } from "./components/BroadcastForm.tsx";
import { CitizenRoster } from "./components/CitizenRoster.tsx";
import { DecisionFeedCard } from "./components/DecisionFeedCard.tsx";
import { DirectiveCard } from "./components/DirectiveCard.tsx";
import { GameOverOverlay } from "./components/GameOverOverlay.tsx";
import { HistoryLog } from "./components/HistoryLog.tsx";
import { KeyPanel } from "./components/KeyPanel.tsx";
import { ModeBadge } from "./components/ModeBadge.tsx";
import { StatsPanel } from "./components/StatsPanel.tsx";
import { TownMap } from "./components/TownMap.tsx";
import { gameReducer, initGame } from "./state/gameReducer.ts";

const INITIAL_SEED = Date.now();

function initialPositions(): Map<number, Point> {
  return new Map(CITIZENS.map((c) => [c.id, postPosition(c)]));
}

function initialDurations(): Map<number, number> {
  return new Map(CITIZENS.map((c) => [c.id, 900]));
}

export default function App() {
  const [state, dispatch] = useReducer(gameReducer, INITIAL_SEED, initGame);
  const [jevConfigured, setJevConfigured] = useState<boolean | null>(null);
  const [visitorKey, setVisitorKey] = useState(false);
  const [positions, setPositions] = useState<Map<number, Point>>(initialPositions);
  const [durations, setDurations] = useState<Map<number, number>>(initialDurations);
  const [focusedAction, setFocusedAction] = useState<Action | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchStatus()
      .then((status) => {
        if (!cancelled) setJevConfigured(status.jevConfigured);
      })
      .catch(() => {
        if (!cancelled) setJevConfigured(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const decisionById = useMemo(
    () => new Map((state.decisions ?? []).map((d) => [d.citizenId, d])),
    [state.decisions],
  );

  const actionsMap = useMemo(
    () => new Map(CITIZENS.map((c) => [c.id, decisionById.get(c.id)?.action ?? null])),
    [decisionById],
  );

  const confidencesMap = useMemo(
    () => new Map(CITIZENS.map((c) => [c.id, decisionById.get(c.id)?.confidence ?? null])),
    [decisionById],
  );

  const lastRoundScore = state.history[0]?.result.score.total ?? null;
  const lastBroadcast = state.history[0] ?? null;
  const currentGoals = state.history[0]?.round === state.round ? state.history[0].result.goals : null;

  async function handleBroadcast(broadcast: string) {
    dispatch({ type: "BROADCAST_START" });

    try {
      const history = state.history
        .slice(0, 4)
        .reverse()
        .map((h) => h.broadcast);

      const response = await postBroadcast({
        broadcast,
        round: state.round,
        unrest: state.unrest,
        history,
        citizens: CITIZENS.map((c) => ({ id: c.id, lastAction: state.lastActions.get(c.id) ?? null })),
      });

      setPositions((prev) => {
        const next = new Map(prev);
        const nextDurations = new Map(durations);
        for (const citizen of CITIZENS) {
          const decision = response.decisions.find((d) => d.citizenId === citizen.id);
          if (!decision) continue;
          const from = prev.get(citizen.id) ?? postPosition(citizen);
          const to = destinationFor(citizen, decision.action, locationOrDefault(response.locationId));
          next.set(citizen.id, to);
          // An alarmed citizen hurries: Jev's alarm Score shortens the walk by up
          // to a third, so a frightened town visibly moves faster than a curious one.
          const hurry = 1 - (decision.alarm ?? 0) * 0.34;
          nextDurations.set(citizen.id, Math.round(travelDurationMs(from, to) * hurry));
        }
        setDurations(nextDurations);
        return next;
      });

      dispatch({ type: "BROADCAST_SUCCESS", broadcast, response });
    } catch (err) {
      dispatch({
        type: "BROADCAST_ERROR",
        message: err instanceof Error ? err.message : "Something went wrong reaching the server.",
      });
    }
  }

  function handleNextRound() {
    setPositions((prev) => {
      const next = new Map(prev);
      const nextDurations = new Map(durations);
      for (const citizen of CITIZENS) {
        const from = prev.get(citizen.id) ?? postPosition(citizen);
        const to = postPosition(citizen);
        next.set(citizen.id, to);
        nextDurations.set(citizen.id, travelDurationMs(from, to));
      }
      setDurations(nextDurations);
      return next;
    });
    setFocusedAction(null);
    dispatch({ type: "NEXT_ROUND" });
  }

  function handleRestart() {
    setPositions(initialPositions());
    setDurations(initialDurations());
    setFocusedAction(null);
    dispatch({ type: "RESTART", seed: Date.now() });
  }

  return (
    <div className="app">
      <header className="app__header">
        <div>
          <h1>Jev Town</h1>
          <p className="app__tagline">Broadcast one line. {CITIZENS.length} citizens decide, in parallel, what to do about it.</p>
        </div>
        <ModeBadge
          jevConfigured={jevConfigured || visitorKey}
          lastMode={state.lastMode}
          lastReason={state.lastReason}
          lastLatencyMs={state.lastLatencyMs}
        />
        <KeyPanel serverHasKey={jevConfigured} onChange={setVisitorKey} />
      </header>

      <main className="app__layout">
        <div className="app__map-column">
          <div className="town-stage">
            <TownMap
              positions={positions}
              durations={durations}
              actions={actionsMap}
              confidences={confidencesMap}
              focusedAction={focusedAction}
              onFocusAction={setFocusedAction}
            />

            <div className="town-stage__top">
              <div className="town-stage__town">
                <div className="town-stage__title">
                  <span className="town-stage__name">Cloverfield</span>
                  <span className="town-stage__population">{CITIZENS.length} citizens</span>
                </div>
                <CitizenRoster citizens={CITIZENS} lastActions={state.lastActions} />
                {lastBroadcast ? (
                  <div className="town-stage__last-broadcast">
                    <span className="town-stage__eyebrow">Town crier · round {lastBroadcast.round}</span>
                    <p>{lastBroadcast.broadcast}</p>
                  </div>
                ) : null}
              </div>
              <DecisionFeedCard
                phase={state.phase}
                citizenCount={CITIZENS.length}
                decisionCount={state.decisions?.length ?? null}
                lastLatencyMs={state.lastLatencyMs}
              />
            </div>

            <div className="town-stage__bottom">
              {state.error ? (
                <p className="app__error" role="alert">
                  {state.error}
                </p>
              ) : null}
              <BroadcastForm
                disabled={state.phase === "loading" || state.phase === "gameover"}
                busy={state.phase === "loading"}
                onSubmit={handleBroadcast}
                nextRound={
                  state.phase === "result" ? (
                    <button type="button" className="button button--secondary" onClick={handleNextRound}>
                      Next round →
                    </button>
                  ) : null
                }
              />
            </div>
          </div>
        </div>

        <div className="app__side-column">
          <DirectiveCard round={state.round} directive={state.directive} goals={currentGoals} />
          <StatsPanel
            decisions={state.decisions}
            trust={state.trust}
            unrest={state.unrest}
            streak={state.streak}
            bestStreak={state.bestStreak}
            totalScore={state.totalScore}
            lastScore={lastRoundScore}
            focusedAction={focusedAction}
            onFocusAction={setFocusedAction}
          />
          <HistoryLog history={state.history} />
        </div>
      </main>

      {state.phase === "gameover" ? (
        <GameOverOverlay
          reason={state.history[0]?.result.gameOverReason ?? "The town has had enough."}
          totalScore={state.totalScore}
          bestStreak={state.bestStreak}
          round={state.round}
          onRestart={handleRestart}
        />
      ) : null}
    </div>
  );
}
