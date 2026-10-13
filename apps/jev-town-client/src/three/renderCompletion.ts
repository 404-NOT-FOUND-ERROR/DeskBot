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
  onFailure?: (error: Error) => void,
) {
  try {
    renderWorld();
    renderLabels();
  } catch (value) {
    // A failed WebGL/CSS2D frame is never a render receipt. The owner can
    // commit its real text fallback and acknowledge that view afterwards.
    if (!onFailure) throw value;
    onFailure(value instanceof Error ? value : new Error('小镇画面暂不可呈现'));
    return false;
  }
  completion.complete();
  return true;
}
