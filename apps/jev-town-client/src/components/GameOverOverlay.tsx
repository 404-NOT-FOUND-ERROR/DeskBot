export interface GameOverOverlayProps {
  reason: string;
  totalScore: number;
  bestStreak: number;
  round: number;
  onRestart: () => void;
}

export function GameOverOverlay({ reason, totalScore, bestStreak, round, onRestart }: GameOverOverlayProps) {
  return (
    <div className="overlay" role="alertdialog" aria-labelledby="gameover-title" aria-describedby="gameover-desc">
      <div className="overlay__panel">
        <h2 id="gameover-title">The broadcast ends here</h2>
        <p id="gameover-desc">{reason}</p>
        <dl className="overlay__stats">
          <div>
            <dt>Rounds survived</dt>
            <dd>{round}</dd>
          </div>
          <div>
            <dt>Best streak</dt>
            <dd>{bestStreak}</dd>
          </div>
          <div>
            <dt>Final score</dt>
            <dd>{totalScore}</dd>
          </div>
        </dl>
        <button type="button" className="button button--primary" onClick={onRestart} autoFocus>
          Broadcast again
        </button>
      </div>
    </div>
  );
}
