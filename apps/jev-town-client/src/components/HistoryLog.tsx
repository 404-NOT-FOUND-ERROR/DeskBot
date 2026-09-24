import type { HistoryEntry } from "../state/gameReducer.ts";

export interface HistoryLogProps {
  history: HistoryEntry[];
}

export function HistoryLog({ history }: HistoryLogProps) {
  return (
    <section className="card history-log" aria-label="Broadcast history">
      <h3 className="stats-panel__heading">Event history</h3>
      {history.length === 0 ? (
        <p className="history-log__empty">No broadcasts sent yet. The town is quiet.</p>
      ) : (
        <ol className="history-log__list">
          {history.map((entry, index) => (
            <li key={`${entry.round}-${index}`} className={entry.result.success ? "history-log__entry--success" : "history-log__entry--fail"}>
              <div className="history-log__meta">
                <span className="history-log__round">R{entry.round}</span>
                <span className={`badge badge--${entry.mode}`}>{entry.mode === "jev" ? "Jev" : "Sim"}</span>
                <span className="history-log__outcome">{entry.result.success ? "Success" : "Missed"}</span>
                <span className="history-log__score">+{entry.result.score.total}</span>
              </div>
              <p className="history-log__text">“{entry.broadcast}”</p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
