/** A snapshot is complete only after both renderers have produced its frame. */
export function createSnapshotRenderCompletion() {
  let pending: { id: string; complete?: (id: string) => void } | null = null;
  let completed: { id: string; complete?: (id: string) => void } | null = null;
  return {
    prepare(id?: string, complete?: (id: string) => void) {
      pending = id && (id !== completed?.id || complete !== completed?.complete) ? { id, complete } : null;
    },
    complete() {
      if (!pending) return;
      const frame = pending;
      pending = null;
      completed = frame;
      frame.complete?.(frame.id);
    },
    cancel() { pending = null; },
  };
}

export function renderSnapshotFrame(
  completion: ReturnType<typeof createSnapshotRenderCompletion>,
  renderWorld: () => void,
  renderLabels: () => void,
) {
  renderWorld();
  renderLabels();
  completion.complete();
}
