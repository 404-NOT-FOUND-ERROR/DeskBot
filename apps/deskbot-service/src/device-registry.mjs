import { createHash } from 'node:crypto';
import { characterIdsEqual } from './world-definition.mjs';

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function fingerprint(value) {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function clone(value) {
  return structuredClone(value);
}

function requireText(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new DeviceRegistryError(400, 'invalid_device_hello', `${field} must be a non-empty string`);
  }
  return value.trim();
}

function normalizeCapabilities(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new DeviceRegistryError(400, 'invalid_device_hello', 'capabilities must be an object');
  }

  return Object.fromEntries(Object.entries(value).map(([key, enabled]) => {
    if (typeof enabled !== 'boolean') {
      throw new DeviceRegistryError(400, 'invalid_device_hello', `capabilities.${key} must be boolean`);
    }
    return [requireText(key, 'capability name'), enabled];
  }));
}

export class DeviceRegistryError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.name = 'DeviceRegistryError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function normalizeDeviceHello(input, { now = () => new Date() } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new DeviceRegistryError(400, 'invalid_device_hello', 'device hello must be an object');
  }

  const hello = input.hello && typeof input.hello === 'object' && !Array.isArray(input.hello)
    ? input.hello
    : input;
  const lastSeenAt = hello.last_seen_at ?? now().toISOString();
  if (typeof lastSeenAt !== 'string' || Number.isNaN(Date.parse(lastSeenAt))) {
    throw new DeviceRegistryError(400, 'invalid_device_hello', 'last_seen_at must be an ISO date-time string');
  }

  return {
    schema: 'foundry.device-hello.v0.1',
    device_id: requireText(hello.device_id, 'device_id'),
    hardware: requireText(hello.hardware, 'hardware'),
    firmware: requireText(hello.firmware, 'firmware'),
    shell_interface: requireText(hello.shell_interface ?? 'shell-interface.v1', 'shell_interface'),
    capabilities: normalizeCapabilities(hello.capabilities ?? {}),
    character_id: hello.character_id ?? null,
    shell_id: hello.shell_id ?? null,
    last_seen_at: lastSeenAt,
  };
}

export function createDeviceRegistry({ now = () => new Date(), persistence = null } = {}) {
  const devices = new Map(
    (persistence?.list('devices.records') ?? []).map((device) => [device.device_id, device]),
  );

  function register(input) {
    const hello = normalizeDeviceHello(input, { now });
    const identity = { ...hello, last_seen_at: undefined };
    const identityFingerprint = fingerprint(identity);
    const existing = devices.get(hello.device_id);

    if (existing) {
      if (existing.character_id && hello.character_id && !characterIdsEqual(existing.character_id, hello.character_id)) {
        throw new DeviceRegistryError(
          409,
          'device_character_conflict',
          `device ${hello.device_id} is already bound to character ${existing.character_id}`,
        );
      }
      const duplicate = existing.identity_fingerprint === identityFingerprint;
      const device = {
        ...existing,
        ...clone(hello),
        character_id: hello.character_id ?? existing.character_id,
        shell_id: hello.shell_id ?? existing.shell_id,
        first_seen_at: existing.first_seen_at,
        last_seen_at: now().toISOString(),
        identity_fingerprint: identityFingerprint,
      };
      persistence?.put('devices.records', hello.device_id, device);
      // Publish to the in-memory registry only after durable storage accepts
      // the update.  A failing adapter must not expose a device that cannot
      // be restored after restart.
      devices.set(hello.device_id, device);
      return { device: clone(device), duplicate };
    }

    const device = {
      ...clone(hello),
      first_seen_at: now().toISOString(),
      last_seen_at: now().toISOString(),
      identity_fingerprint: identityFingerprint,
    };
    persistence?.put('devices.records', hello.device_id, device);
    devices.set(hello.device_id, device);
    return { device: clone(device), duplicate: false };
  }

  return {
    get: (deviceId) => {
      const device = devices.get(deviceId);
      return device ? clone(device) : null;
    },
    list: () => [...devices.values()].map(clone),
    register,
    size: () => devices.size,
  };
}
