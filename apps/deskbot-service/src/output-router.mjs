import { createHash } from 'node:crypto';

const ACK_STATUSES = new Set(['completed', 'failed']);

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }

  return JSON.stringify(value);
}

function fingerprint(value) {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}

function requireText(value, field) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new OutputRouterError(400, 'invalid_output', `${field} must be a non-empty string`);
  }
  return value.trim();
}

function normalizeDateTime(value, field) {
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw new OutputRouterError(400, 'invalid_output', `${field} must be an ISO date-time string`);
  }
  return value;
}

function clone(value) {
  return structuredClone(value);
}

function commandIdentity(command) {
  return {
    schema: command.schema ?? 'foundry.device-command.v0.1',
    command_id: command.command_id,
    source_event_id: command.source_event_id,
    type: command.type,
    target: command.target,
    device_id: command.device_id ?? null,
    character_id: command.character_id ?? null,
    shell_id: command.shell_id ?? null,
    role_revision: command.role_revision ?? null,
    correlation_id: command.correlation_id ?? null,
    priority: command.priority ?? 'normal',
    expires_at: command.expires_at ?? null,
    payload: command.payload ?? {},
  };
}

function commandFingerprint(command) {
  return fingerprint(commandIdentity(command));
}

function ackSemanticFingerprint(acknowledgment) {
  // Result payloads commonly contain non-deterministic telemetry (latency,
  // decoder counters, etc.).  They are useful for the first receipt but must
  // not turn a retransmitted ACK into a conflict.  The command outcome is
  // identified by its terminal status; the first error/result payload remains
  // the authoritative diagnostic returned to callers.
  return fingerprint({
    status: acknowledgment.status,
  });
}

function persistWithRollback(persistence, writes) {
  const noop = () => {};
  if (!persistence) return writes(noop);
  const put = (namespace, recordId, value) => persistence.put(namespace, recordId, value);
  if (typeof persistence.transaction === 'function') {
    return persistence.transaction(() => writes(put));
  }

  // Custom stores may not expose a transaction. Snapshot every touched record
  // before writing so a later failure can restore both inserts and updates.
  // This is still best-effort for a write-only adapter; such an adapter cannot
  // safely support multi-record atomicity and the error remains visible.
  const snapshots = [];
  const captured = new Set();
  const capture = (namespace, recordId) => {
    const key = `${namespace}\u0000${recordId}`;
    if (captured.has(key)) return;
    captured.add(key);
    if (typeof persistence.get !== 'function') {
      snapshots.push({ namespace, recordId, readable: false });
      return;
    }
    try {
      const previous = persistence.get(namespace, recordId);
      snapshots.push({
        namespace,
        recordId,
        readable: true,
        exists: previous !== null && previous !== undefined,
        value: previous === null || previous === undefined ? null : clone(previous),
      });
    } catch {
      snapshots.push({ namespace, recordId, readable: false });
    }
  };
  try {
    return writes((namespace, recordId, value) => {
      capture(namespace, recordId);
      persistence.put(namespace, recordId, value);
    });
  } catch (error) {
    for (const snapshot of snapshots.reverse()) {
      if (!snapshot.readable) continue;
      try {
        if (snapshot.exists) persistence.put(snapshot.namespace, snapshot.recordId, snapshot.value);
        else persistence.remove?.(snapshot.namespace, snapshot.recordId);
      } catch { /* best effort; preserve the original failure */ }
    }
    throw error;
  }
}

function isExpired(command, currentTime) {
  return command?.expires_at !== null
    && command?.expires_at !== undefined
    && !Number.isNaN(Date.parse(command.expires_at))
    && Date.parse(command.expires_at) <= currentTime;
}

function expiryAcknowledgment(command, now) {
  return {
    command_id: command.command_id,
    status: 'failed',
    source: 'deskbot-outbox-expirer',
    device_id: command.device_id ?? null,
    target: command.target ?? null,
    occurred_at: now().toISOString(),
    correlation_id: command.correlation_id ?? command.source_event_id ?? command.command_id,
    error: {
      code: 'command_expired',
      message: 'command expires_at has passed',
    },
    payload: { retryable: false },
  };
}

function normalizePlan(output, index) {
  if (!output || typeof output !== 'object' || Array.isArray(output)) {
    throw new OutputRouterError(400, 'invalid_output', `output_plan[${index}] must be an object`);
  }

  const type = requireText(output.type, `output_plan[${index}].type`);
  if (!Array.isArray(output.targets) || output.targets.length === 0) {
    throw new OutputRouterError(400, 'invalid_output', `output_plan[${index}].targets must be a non-empty array`);
  }

  const targets = [...new Set(output.targets.map((target, targetIndex) => (
    requireText(target, `output_plan[${index}].targets[${targetIndex}]`)
  )))];
  const {
    type: ignoredType,
    targets: ignoredTargets,
    status: ignoredStatus,
    payload: explicitPayload,
    priority = 'normal',
    expires_at: expiresAt = null,
    ...inlinePayload
  } = output;

  if (explicitPayload !== undefined && (!explicitPayload || typeof explicitPayload !== 'object' || Array.isArray(explicitPayload))) {
    throw new OutputRouterError(400, 'invalid_output', `output_plan[${index}].payload must be an object`);
  }
  if (expiresAt !== null) normalizeDateTime(expiresAt, `output_plan[${index}].expires_at`);

  return {
    type,
    targets,
    priority: requireText(priority, `output_plan[${index}].priority`),
    expires_at: expiresAt,
    payload: {
      ...inlinePayload,
      ...(explicitPayload ?? {}),
    },
  };
}

function normalizeRoute({ source_event: sourceEvent, output_plan: outputPlan } = {}) {
  if (!sourceEvent || typeof sourceEvent !== 'object' || Array.isArray(sourceEvent)) {
    throw new OutputRouterError(400, 'invalid_output', 'source_event must be an object');
  }
  if (!Array.isArray(outputPlan)) {
    throw new OutputRouterError(400, 'invalid_output', 'output_plan must be an array');
  }

  return {
    source_event: {
      event_id: requireText(sourceEvent.event_id, 'source_event.event_id'),
      character_id: sourceEvent.character_id ?? null,
      device_id: sourceEvent.device_id ?? null,
      shell_id: sourceEvent.shell_id ?? null,
      role_revision: sourceEvent.role_revision ?? null,
      correlation_id: sourceEvent.correlation_id ?? sourceEvent.event_id,
    },
    output_plan: outputPlan.map(normalizePlan),
  };
}

function commandIdFor(sourceEventId, planIndex, target, output) {
  const digest = fingerprint({ source_event_id: sourceEventId, plan_index: planIndex, target, output });
  return `cmd-${digest.slice(0, 24)}`;
}

export class OutputRouterError extends Error {
  constructor(statusCode, code, message) {
    super(message);
    this.name = 'OutputRouterError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function createOutputRouter({ now = () => new Date(), persistence = null } = {}) {
  const commands = new Map(
    (persistence?.list('output.commands') ?? []).map((command) => [command.command_id, {
      ...command,
      command_fingerprint: command.command_fingerprint ?? commandFingerprint(command),
    }]),
  );
  const routedEvents = new Map(
    (persistence?.list('output.routes') ?? []).map((route) => [route.event_id, route]),
  );

  function enqueue(routeInput) {
    const route = normalizeRoute(routeInput);
    const eventId = route.source_event.event_id;
    const routeFingerprint = fingerprint(route);
    const previous = routedEvents.get(eventId);

    if (previous) {
      if (previous.fingerprint !== routeFingerprint) {
        throw new OutputRouterError(409, 'output_event_conflict', `source event ${eventId} already has a different output plan`);
      }
      const previousCommands = previous.command_ids.map((commandId) => commands.get(commandId));
      if (previousCommands.some((command) => !command)) {
        throw new OutputRouterError(500, 'output_state_corrupt', `source event ${eventId} references a missing command`);
      }
      return {
        commands: clone(previousCommands),
        duplicate: true,
      };
    }

    const queuedAt = now().toISOString();
    const created = [];
    const newCommands = [];
    route.output_plan.forEach((output, planIndex) => {
      for (const target of output.targets) {
        const commandId = commandIdFor(eventId, planIndex, target, output);
        const command = {
          schema: 'foundry.device-command.v0.1',
          command_id: commandId,
          source_event_id: eventId,
          type: output.type,
          target,
          device_id: route.source_event.device_id,
          character_id: route.source_event.character_id,
          shell_id: route.source_event.shell_id,
          role_revision: route.source_event.role_revision,
          correlation_id: route.source_event.correlation_id,
          priority: output.priority,
          expires_at: output.expires_at,
          payload: clone(output.payload),
          status: 'queued',
          queued_at: queuedAt,
          acknowledgment: null,
        };
        command.command_fingerprint = commandFingerprint(command);
        const existing = commands.get(commandId);
        if (existing) {
          const existingFingerprint = existing.command_fingerprint ?? commandFingerprint(existing);
          if (existingFingerprint !== command.command_fingerprint) {
            throw new OutputRouterError(409, 'command_conflict', `command ${commandId} already contains different immutable data`);
          }
          created.push(existing);
        } else {
          created.push(command);
          newCommands.push(command);
        }
      }
    });

    const routedEvent = {
      event_id: eventId,
      fingerprint: routeFingerprint,
      command_ids: created.map((command) => command.command_id),
    };
    persistWithRollback(persistence, (put) => {
      for (const command of newCommands) put('output.commands', command.command_id, command);
      put('output.routes', eventId, routedEvent);
    });
    for (const command of newCommands) commands.set(command.command_id, command);
    routedEvents.set(eventId, routedEvent);
    return { commands: clone(created), duplicate: false };
  }

  function expireQueued() {
    const currentTime = now().getTime();
    let expiredCount = 0;
    for (const command of [...commands.values()]) {
      if (command.status !== 'queued' || !isExpired(command, currentTime)) continue;
      // Route expiry through the same ACK path as a device failure so the
      // terminal state is durable and every transport observes one outcome.
      ack(expiryAcknowledgment(command, now));
      expiredCount += 1;
    }
    return expiredCount;
  }

  function listQueued({ target = null, device_id: deviceId = null, limit = 50 } = {}) {
    const boundedLimit = Math.min(Math.max(Number.parseInt(limit, 10) || 50, 1), 200);
    expireQueued();
    const currentTime = now().getTime();
    return [...commands.values()]
      .filter((command) => command.status === 'queued')
      .filter((command) => command.expires_at === null
        || Number.isNaN(Date.parse(command.expires_at))
        || Date.parse(command.expires_at) > currentTime)
      .filter((command) => target === null || command.target === target)
      .filter((command) => deviceId === null || command.device_id === deviceId)
      .slice(0, boundedLimit)
      .map(clone);
  }

  function ack(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) {
      throw new OutputRouterError(400, 'invalid_ack', 'acknowledgment must be an object');
    }
    const commandId = requireText(input.command_id, 'command_id');
    const status = requireText(input.status, 'status');
    if (!ACK_STATUSES.has(status)) {
      throw new OutputRouterError(400, 'invalid_ack', 'status must be completed or failed');
    }

    const error = input.error === undefined || input.error === null
      ? null
      : input.error;
    if (status === 'failed'
      && (!error || typeof error !== 'object' || Array.isArray(error)
        || typeof error.code !== 'string' || error.code.trim() === '')) {
      throw new OutputRouterError(400, 'invalid_ack', 'failed ACK must include error.code');
    }

    const command = commands.get(commandId);
    if (!command) {
      throw new OutputRouterError(404, 'command_not_found', `command ${commandId} does not exist`);
    }
    const deviceId = input.device_id === undefined || input.device_id === null
      ? null
      : requireText(input.device_id, 'device_id');
    if (deviceId !== null && command.device_id !== null && command.device_id !== deviceId) {
      throw new OutputRouterError(409, 'command_device_mismatch', `command ${commandId} belongs to device ${command.device_id}`);
    }
    const target = input.target === undefined || input.target === null
      ? null
      : requireText(input.target, 'target');
    if (target !== null && command.target !== target) {
      throw new OutputRouterError(409, 'command_target_mismatch', `command ${commandId} belongs to target ${command.target}`);
    }

    const payload = input.result ?? input.payload ?? {};
    if (!isPlainObject(payload)) {
      throw new OutputRouterError(400, 'invalid_ack', 'ACK payload/result must be an object');
    }
    if (input.duplicate !== undefined && typeof input.duplicate !== 'boolean') {
      throw new OutputRouterError(400, 'invalid_ack', 'duplicate must be boolean');
    }
    if (input.role_revision !== undefined && input.role_revision !== null
      && (!Number.isInteger(input.role_revision) || input.role_revision < 0)) {
      throw new OutputRouterError(400, 'invalid_ack', 'role_revision must be a non-negative integer');
    }
    if (input.monotonic_ms !== undefined && input.monotonic_ms !== null
      && (!Number.isInteger(input.monotonic_ms) || input.monotonic_ms < 0)) {
      throw new OutputRouterError(400, 'invalid_ack', 'monotonic_ms must be a non-negative integer');
    }

    const occurredAt = input.occurred_at ?? now().toISOString();
    normalizeDateTime(occurredAt, 'occurred_at');
    const acknowledgment = {
      status,
      occurred_at: occurredAt,
      source: input.source ?? command.target,
      device_id: deviceId,
      target: target ?? command.target,
      correlation_id: input.correlation_id ?? command.correlation_id ?? null,
      role_revision: input.role_revision ?? command.role_revision ?? null,
      message_id: input.message_id ?? null,
      monotonic_ms: input.monotonic_ms ?? null,
      duplicate: input.duplicate === true,
      payload: clone(payload),
      ...(error === null ? {} : { error: clone(error) }),
    };
    acknowledgment.semantic_fingerprint = ackSemanticFingerprint(acknowledgment);

    if (command.acknowledgment) {
      const existingFingerprint = command.acknowledgment.semantic_fingerprint
        ?? ackSemanticFingerprint(command.acknowledgment);
      if (existingFingerprint !== acknowledgment.semantic_fingerprint) {
        throw new OutputRouterError(409, 'ack_conflict', `command ${commandId} was already acknowledged as ${command.acknowledgment.status}`);
      }
      return { command: clone(command), duplicate: true };
    }

    const nextCommand = clone(command);
    nextCommand.status = status;
    nextCommand.acknowledgment = acknowledgment;
    persistWithRollback(persistence, (put) => put('output.commands', commandId, nextCommand));
    commands.set(commandId, nextCommand);
    return { command: clone(nextCommand), duplicate: false };
  }

  return {
    ack,
    enqueue,
    expireQueued,
    get: (commandId) => {
      const command = commands.get(commandId);
      return command ? clone(command) : null;
    },
    listQueued,
    size: () => commands.size,
  };
}
