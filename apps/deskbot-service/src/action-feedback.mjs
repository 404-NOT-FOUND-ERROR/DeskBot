/**
 * A small, JSON-native action receipt for autonomous-life.
 *
 * This is the DeskBot equivalent of Asamana's ActionResult boundary: intent,
 * an attempted execution, a canonical task outcome, and a plan decision are
 * deliberately different states.  The receipt is audit/read-model metadata;
 * it never authorizes a world mutation and never infers success from prose.
 */
export const ACTION_FEEDBACK_VERSION = 'deskbot.action-feedback.v1';

const KINDS = new Set(['decided', 'started', 'transfer', 'completed', 'plan_completed', 'replan', 'cancelled', 'control']);
const TASK_STATUSES = new Set(['planned', 'running', 'paused', 'completed', 'failed', 'cancelled']);

function text(value) { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function statusFor(kind, taskStatus, canonicalTask) {
  if (canonicalTask) return taskStatus;
  if (kind === 'decided') return 'planned';
  if (kind === 'started') return 'running';
  if (kind === 'plan_completed' || kind === 'transfer') return 'completed';
  if (kind === 'cancelled') return 'cancelled';
  if (kind === 'replan') return 'failed';
  return null;
}
function executionFor(kind, status, canonicalTask) {
  if (kind === 'decided') return 'not_started';
  if (kind === 'transfer') return 'settled_success';
  if (kind === 'plan_completed') return 'plan_completed';
  if (!canonicalTask) return kind === 'replan' ? 'not_executed' : 'unknown';
  if (status === 'running' || status === 'paused') return 'started';
  if (status === 'completed') return 'settled_success';
  if (status === 'failed') return 'settled_failure';
  if (status === 'cancelled') return 'settled_cancelled';
  return 'unknown';
}

/**
 * Normalize a life feedback seam without reading or parsing the narrative.
 * `task_status` must come from the canonical task when one exists.
 */
export function createActionFeedbackReceipt({
  actorId, planId = null, taskId = null, eventId = null, kind, at,
  taskStatus = null, causeEventId = null, failureReason = null, failureCode = null, failureClassification = null, locationId = null,
} = {}) {
  if (!text(actorId)) throw new TypeError('actor_id is required');
  if (!text(kind) || !KINDS.has(kind)) throw new TypeError('unsupported action feedback kind');
  if (!text(at) || !Number.isFinite(Date.parse(at))) throw new TypeError('at must be an ISO timestamp');
  const canonicalTask = Boolean(text(taskId) && TASK_STATUSES.has(taskStatus));
  const status = statusFor(kind, taskStatus, canonicalTask);
  const outcome = status === 'completed' ? 'success'
    : status === 'failed' ? 'failure'
      : status === 'cancelled' ? 'cancelled'
        : status === 'running' || status === 'paused' ? 'in_progress'
          : kind === 'decided' ? 'planned' : 'unknown';
  const execution = executionFor(kind, status, canonicalTask);
  return {
    schema: ACTION_FEEDBACK_VERSION,
    receipt_id: `action-feedback:${text(eventId) ?? at}:${actorId}:${kind}:${text(taskId) ?? text(planId) ?? 'none'}`,
    authority: 'audit_only',
    basis: canonicalTask ? 'canonical_task' : 'life_planner',
    actor_id: actorId,
    plan_id: text(planId),
    task_id: text(taskId),
    event_id: text(eventId),
    cause_event_id: text(causeEventId),
    at: new Date(at).toISOString(),
    kind,
    status,
    outcome,
    execution,
    attempted: canonicalTask || kind === 'transfer',
    // occurred means an action was actually adjudicated/settled; a failed
    // attempt is still an experience, while a replan without a task is not.
    occurred: execution === 'settled_success' || execution === 'settled_failure',
    location_id: text(locationId),
    ...(text(failureReason) ? { failure_reason: text(failureReason) } : {}),
    ...(text(failureCode) ? { failure_code: text(failureCode) } : {}),
    ...(text(failureClassification) ? { failure_classification: text(failureClassification) } : {}),
  };
}
