import { useState } from "react";
import { readVisitorKey, storeVisitorKey } from "../api.ts";

export interface KeyPanelProps {
  /** True when the deployment carries its own key, so no visitor key is needed. */
  serverHasKey: boolean | null;
  onChange: (hasKey: boolean) => void;
}

/**
 * Lets a visitor play with their own Jev key on a deployment that carries none.
 *
 * The key is held in `sessionStorage` for this tab only, is sent to this app's
 * own API and forwarded once to Jev, and is never stored, logged, or shared.
 * Anyone who would rather not paste a key into a website can clone the repo and
 * run it locally instead, which the README explains.
 */
export function KeyPanel({ serverHasKey, onChange }: KeyPanelProps) {
  const [key, setKey] = useState("");
  const [saved, setSaved] = useState(() => readVisitorKey() !== null);
  const [open, setOpen] = useState(false);

  if (serverHasKey !== false) return null;

  function save(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = key.trim();
    if (trimmed.length < 16) return;
    storeVisitorKey(trimmed);
    setKey("");
    setSaved(true);
    setOpen(false);
    onChange(true);
  }

  function clear() {
    storeVisitorKey(null);
    setSaved(false);
    onChange(false);
  }

  if (saved) {
    return (
      <div className="key-panel key-panel--active">
        <span>Playing on your own Jev key, for this tab only.</span>
        <button type="button" onClick={clear}>
          Forget key
        </button>
      </div>
    );
  }

  if (!open) {
    return (
      <div className="key-panel">
        <span>This demo runs on a local simulation. Use your own Jev key for live decisions.</span>
        <button type="button" onClick={() => setOpen(true)}>
          Add key
        </button>
      </div>
    );
  }

  return (
    <form className="key-panel key-panel--form" onSubmit={save}>
      <label htmlFor="jev-key">Your Jev API key</label>
      <input
        id="jev-key"
        type="password"
        autoComplete="off"
        spellCheck={false}
        value={key}
        placeholder="Paste key"
        onChange={(event) => setKey(event.target.value)}
      />
      <button type="submit">Use key</button>
      <button type="button" onClick={() => setOpen(false)}>
        Cancel
      </button>
      <p className="key-panel__note">
        Kept in this tab only and forwarded straight to Jev. Never stored or logged. Get a key at{" "}
        <a href="https://typesafe.ai" target="_blank" rel="noreferrer noopener">
          typesafe.ai
        </a>
        , or run the repo locally instead.
      </p>
    </form>
  );
}
