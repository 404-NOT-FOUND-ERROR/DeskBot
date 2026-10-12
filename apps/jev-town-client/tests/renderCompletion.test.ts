import { describe, expect, it, vi } from 'vitest';
import { createSnapshotRenderCompletion, renderSnapshotFrame } from '../src/three/renderCompletion.ts';

describe('snapshot render completion', () => {
  it('acknowledges only after both renderers finish', () => {
    const order: string[] = [];
    const complete = vi.fn(() => order.push('ack'));
    const lifecycle = createSnapshotRenderCompletion();
    lifecycle.prepare('snapshot-1', complete);
    renderSnapshotFrame(lifecycle, () => order.push('webgl'), () => order.push('labels'));
    expect(order).toEqual(['webgl', 'labels', 'ack']);
    expect(complete).toHaveBeenCalledWith('snapshot-1');
  });

  it('does not acknowledge an old frame after a newer frame replaces it', () => {
    const complete = vi.fn();
    const lifecycle = createSnapshotRenderCompletion();
    lifecycle.prepare('old', complete);
    lifecycle.prepare('new', complete);
    lifecycle.complete();
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenCalledWith('new');
  });

  it('keeps a frame pending when either renderer fails and a later retry can finish', () => {
    const complete = vi.fn(), lifecycle = createSnapshotRenderCompletion();
    lifecycle.prepare('snapshot-1', complete);
    expect(() => renderSnapshotFrame(lifecycle, () => {}, () => { throw new Error('labels unavailable'); })).toThrow();
    expect(complete).not.toHaveBeenCalled();
    renderSnapshotFrame(lifecycle, () => {}, () => {});
    renderSnapshotFrame(lifecycle, () => {}, () => {});
    expect(complete).toHaveBeenCalledTimes(1);
  });

  it('lets a committed WebGL fallback finish once and cancels on unmount', () => {
    const complete = vi.fn(), lifecycle = createSnapshotRenderCompletion();
    lifecycle.prepare('fallback-1', complete);
    lifecycle.complete(); lifecycle.complete();
    expect(complete).toHaveBeenCalledOnce();
    lifecycle.prepare('fallback-2', complete);
    lifecycle.cancel(); lifecycle.complete();
    expect(complete).toHaveBeenCalledOnce();
  });

  it('acknowledges the same canonical snapshot for a fresh lifecycle queue', () => {
    const previous = vi.fn(), current = vi.fn(), lifecycle = createSnapshotRenderCompletion();
    lifecycle.prepare('same', previous); lifecycle.complete();
    lifecycle.prepare('same', previous); lifecycle.complete();
    lifecycle.prepare('same', current); lifecycle.complete();
    expect(previous).toHaveBeenCalledOnce();
    expect(current).toHaveBeenCalledOnce();
  });
});
