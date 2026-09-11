import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createDeviceRegistry, DeviceRegistryError } from '../src/device-registry.mjs';

const fixedTime = new Date('2026-08-21T00:00:00.000Z');

function hello(overrides = {}) {
  return {
    device_id: 'vocat-001',
    hardware: 'esp-vocat-v1.2',
    firmware: 'esp-claw-adapter-0.1.0',
    shell_interface: 'shell-interface.v1',
    character_id: 'ember-001',
    capabilities: {
      'audio.capture': true,
      'audio.playback': true,
      'display.expression': true,
      'orientation.base_yaw': true,
      'orientation.head_yaw': false,
    },
    ...overrides,
  };
}

test('device hello is registered idempotently and updates last seen', () => {
  const registry = createDeviceRegistry({ now: () => fixedTime });
  const first = registry.register(hello());
  const second = registry.register(hello());

  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.equal(registry.size(), 1);
  assert.equal(registry.get('vocat-001').hardware, 'esp-vocat-v1.2');
});

test('device hello accepts firmware/capability updates for the same device', () => {
  const registry = createDeviceRegistry({ now: () => fixedTime });
  registry.register(hello());
  const updated = registry.register(hello({
    firmware: 'esp-claw-adapter-0.2.0',
    capabilities: { 'audio.playback': true, 'display.expression': true },
  }));

  assert.equal(updated.duplicate, false);
  assert.equal(updated.device.firmware, 'esp-claw-adapter-0.2.0');
  assert.equal(updated.device.first_seen_at, fixedTime.toISOString());
});

test('device hello validates capability values', () => {
  const registry = createDeviceRegistry({ now: () => fixedTime });
  assert.throws(
    () => registry.register(hello({ capabilities: { 'audio.playback': 'yes' } })),
    (error) => error instanceof DeviceRegistryError && error.code === 'invalid_device_hello',
  );
});

test('device cannot silently switch its character binding', () => {
  const registry = createDeviceRegistry({ now: () => fixedTime });
  registry.register(hello());

  assert.throws(
    () => registry.register(hello({ character_id: 'another-character' })),
    (error) => error instanceof DeviceRegistryError
      && error.statusCode === 409
      && error.code === 'device_character_conflict',
  );
  assert.equal(registry.get('vocat-001').character_id, 'ember-001');
});
