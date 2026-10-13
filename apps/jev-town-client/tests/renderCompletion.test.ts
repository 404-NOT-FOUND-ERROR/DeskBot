import { describe, expect, it, vi } from 'vitest';
import { createSnapshotRenderCompletion, renderSnapshotFrame } from '../src/three/renderCompletion.ts';
import { createWorldSnapshotRenderGate, type WorldObserverSnapshot } from '../src/deskbot/worldObserver.ts';

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

  it.each(['world', 'labels'])('recovers from an asynchronous %s renderer error only after the fallback is presented', failedRenderer => {
    const snapshot = (sequence: number): WorldObserverSnapshot => ({
      schema: 'deskbot.world-observer-snapshot.v1', world_id: 'w', world_revision: sequence, sequence,
      snapshot_id: `s-${sequence}`, captured_at: '2026-10-13T00:00:00Z',
      map: { world_revision: sequence }, life: { world_revision: sequence },
      feed: { world_revision: sequence }, role_wishes: { world_revision: sequence },
    });
    const presented: number[] = [], failure = vi.fn();
    const gate = createWorldSnapshotRenderGate({ publish: frame => presented.push(frame.sequence) });
    const acknowledge = vi.fn((id: string) => gate.rendered(id));
    const webgl = createSnapshotRenderCompletion(), textView = createSnapshotRenderCompletion();
    gate.offer(snapshot(1)); webgl.prepare('s-1', acknowledge);
    gate.offer(snapshot(2));
    const fail = () => { throw new Error('render unavailable'); };
    expect(renderSnapshotFrame(webgl, failedRenderer === 'world' ? fail : () => {},
      failedRenderer === 'labels' ? fail : () => {}, failure)).toBe(false);
    expect(failure).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ message: 'render unavailable' }));
    expect(acknowledge).not.toHaveBeenCalled();
    expect(presented).toEqual([1]);
    expect(gate.state().rendering).toBe('s-1');
    // The scene is unmounted, then React commits a real text view. Neither
    // failure detection nor the transport's newer snapshot may fabricate ACK.
    webgl.cancel(); textView.prepare('s-1', acknowledge); textView.complete();
    expect(presented).toEqual([1, 2]);
    expect(gate.state().rendering).toBe('s-2');
    webgl.complete(); expect(acknowledge).toHaveBeenCalledTimes(1);
    textView.prepare('s-2', acknowledge); textView.complete();
    expect(gate.state().rendering).toBeNull();
    expect(gate.state().pending).toBe(0);
    gate.close();
  });
});
