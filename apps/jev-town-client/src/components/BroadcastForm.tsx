import { useId, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { MAX_BROADCAST_LENGTH } from "@shared/protocol.ts";
import { PRESETS } from "../presets.ts";

export interface BroadcastFormProps {
  disabled: boolean;
  /** True while the town is deciding; changes the button copy. */
  busy: boolean;
  onSubmit: (broadcast: string) => void;
  /** Optional control shown beside the Broadcast button, e.g. "Next round". */
  nextRound?: ReactNode;
}

/** The floating broadcast bar along the bottom of the town stage. */
export function BroadcastForm({ disabled, busy, onSubmit, nextRound }: BroadcastFormProps) {
  const [text, setText] = useState("");
  const textareaId = useId();
  const counterId = useId();

  const trimmed = text.trim();
  const tooLong = trimmed.length > MAX_BROADCAST_LENGTH;
  const canSubmit = trimmed.length > 0 && !tooLong && !disabled;

  function submit(value: string) {
    const clean = value.trim();
    if (!clean || clean.length > MAX_BROADCAST_LENGTH || disabled) return;
    onSubmit(clean);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    submit(text);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends, like a chat box; Shift+Enter keeps a newline.
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      submit(text);
    }
  }

  return (
    <form className="broadcast-form" onSubmit={handleSubmit}>
      <label htmlFor={textareaId} className="sr-only">
        Broadcast to the whole town
      </label>
      <div className="broadcast-form__bar">
        <svg className="broadcast-form__speaker" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M3 10v4a1 1 0 0 0 1 1h2l5 4V5L6 9H4a1 1 0 0 0-1 1Zm13.5 2a4.5 4.5 0 0 0-2.5-4v8a4.5 4.5 0 0 0 2.5-4Zm-2.5-9v2.1a7 7 0 0 1 0 13.8V21a9 9 0 0 0 0-18Z" />
        </svg>
        <textarea
          id={textareaId}
          className="broadcast-form__textarea"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Tell the whole town something…"
          maxLength={MAX_BROADCAST_LENGTH * 2}
          rows={1}
          disabled={disabled}
          aria-describedby={counterId}
        />
        <span
          id={counterId}
          className={`broadcast-form__counter${tooLong ? " broadcast-form__counter--over" : ""}`}
          aria-label={`${trimmed.length} of ${MAX_BROADCAST_LENGTH} characters`}
        >
          {trimmed.length}/{MAX_BROADCAST_LENGTH}
        </span>
        <button type="submit" className="button button--primary broadcast-form__send" disabled={!canSubmit}>
          {busy ? "Deciding…" : "Broadcast"}
        </button>
        {nextRound}
      </div>

      <div className="broadcast-form__presets" role="group" aria-label="Preset broadcasts">
        {PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            className="chip"
            disabled={disabled}
            onClick={() => setText(preset.text)}
            title={preset.text}
          >
            {preset.label}
          </button>
        ))}
      </div>
    </form>
  );
}
