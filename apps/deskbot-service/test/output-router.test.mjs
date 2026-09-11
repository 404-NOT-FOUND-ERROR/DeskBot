import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createOutputRouter, OutputRouterError } from '../src/output-router.mjs';

const fixedTime = new Date('2026-08-21T00:00:00.000Z');

function routeInput(overrides = {}) {
  return {
    source_event: {
      event_id: 'reply-turn-001',
      character_id: 'ember-001',
      device_id: 'vocat-001',
      shell_id: 'shell-001',
      role_revision: 3,
      correlation_id: 'turn-001',
    },
    output_plan: [
      {
        type: 'render.expression',
        expression: 'concerned',
        status: 'planned',
        targets: ['web', 'fake-device', 'vocat'],
      },
      {
        type: 'speak',
        text: '先慢一点。',
        tts_style: 'gentle',
        status: 'planned',
        targets: ['fake-device', 'vocat'],
      },
    ],
    ...overrides,
  };
}

test('enqueue expands an output plan into stable device commands', () => {
  const router = createOutputRouter({ now: () => fixedTime });
  const first = router.enqueue(routeInput());

  assert.equal(first.duplicate, false);
  assert.equal(first.commands.length, 5);
  assert.deepEqual(first.commands.map((command) => command.target), [
    'web', 'fake-device', 'vocat', 'fake-device', 'vocat',
  ]);
  assert.ok(first.commands.every((command) => /^cmd-[a-f0-9]{24}$/.test(command.command_id)));
  assert.ok(first.commands.every((command) => command.status === 'queued'));
  assert.equal(first.commands[0].payload.expression, 'concerned');
  assert.equal(first.commands[3].payload.text, '先慢一点。');
  assert.equal(first.commands[0].queued_at, fixedTime.toISOString());

  const second = router.enqueue(routeInput());
  assert.equal(second.duplicate, true);
  assert.deepEqual(second.commands.map((command) => command.command_id), first.commands.map((command) => command.command_id));
  assert.equal(router.size(), 5);
});

test('reusing a source event with a different plan is rejected', () => {
  const router = createOutputRouter({ now: () => fixedTime });
  router.enqueue(routeInput());

  assert.throws(
    () => router.enqueue(routeInput({ output_plan: [{ type: 'presence', targets: ['vocat'], text: 'changed' }] })),
    (error) => error instanceof OutputRouterError
      && error.statusCode === 409
      && error.code === 'output_event_conflict',
  );
});

test('queued listing filters commands and ACK is idempotent', () => {
  const router = createOutputRouter({ now: () => fixedTime });
  const { commands } = router.enqueue(routeInput());
  const vocatQueued = router.listQueued({ target: 'vocat', device_id: 'vocat-001' });

  assert.equal(vocatQueued.length, 2);
  assert.ok(vocatQueued.every((command) => command.target === 'vocat'));

  const firstAck = router.ack({
    command_id: commands[0].command_id,
    status: 'completed',
    source: 'fake-device',
    payload: { latency_ms: 42 },
  });
  assert.equal(firstAck.duplicate, false);
  assert.equal(firstAck.command.status, 'completed');
  assert.equal(router.listQueued().length, 4);

  const duplicateAck = router.ack({
    command_id: commands[0].command_id,
    status: 'completed',
    source: 'fake-device',
    payload: { latency_ms: 999 },
  });
  assert.equal(duplicateAck.duplicate, true);
  assert.equal(duplicateAck.command.acknowledgment.payload.latency_ms, 42);

  assert.throws(
    () => router.ack({
      command_id: commands[0].command_id,
      status: 'failed',
      error: { code: 'test_failure' },
    }),
    (error) => error instanceof OutputRouterError
      && error.statusCode === 409
      && error.code === 'ack_conflict',
  );
});

test('ACK validates command existence and status', () => {
  const router = createOutputRouter({ now: () => fixedTime });

  assert.throws(
    () => router.ack({ command_id: 'cmd-missing', status: 'completed' }),
    (error) => error instanceof OutputRouterError && error.statusCode === 404,
  );
  assert.throws(
    () => router.ack({ command_id: 'cmd-missing', status: 'queued' }),
    (error) => error instanceof OutputRouterError && error.code === 'invalid_ack',
  );
});

test('failed ACK requires and persists a machine-readable error', () => {
  const router = createOutputRouter({ now: () => fixedTime });
  const { commands } = router.enqueue(routeInput({
    output_plan: [{ type: 'audio.play', targets: ['fake-device'], audio_id: 'audio-missing' }],
  }));
  const commandId = commands[0].command_id;

  assert.throws(
    () => router.ack({ command_id: commandId, status: 'failed' }),
    (error) => error instanceof OutputRouterError
      && error.statusCode === 400
      && error.code === 'invalid_ack',
  );

  const first = router.ack({
    command_id: commandId,
    status: 'failed',
    source: 'fake-device',
    error: { code: 'audio_artifact_not_found', message: 'missing artifact' },
    payload: { retryable: false },
  });
  assert.equal(first.duplicate, false);
  assert.equal(first.command.status, 'failed');
  assert.deepEqual(first.command.acknowledgment.error, {
    code: 'audio_artifact_not_found',
    message: 'missing artifact',
  });

  const duplicate = router.ack({
    command_id: commandId,
    status: 'failed',
    error: { code: 'different_code' },
  });
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.command.acknowledgment.error.code, 'audio_artifact_not_found');
});
