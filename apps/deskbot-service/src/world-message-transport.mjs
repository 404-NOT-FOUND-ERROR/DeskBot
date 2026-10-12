/** Canonical social records produce messages; transport only routes their exact
 * content. Delivery is knowledge, never a new task result or growth evidence. */
export const WORLD_MESSAGE_SCHEMA = 'deskbot.world-message-transport.v1';
const MINUTE = 60000, DAY = 86400000;
const INVITATION_ACTIVE = new Set(['proposed', 'accepted', 'meeting', 'working']);
const copy = value => structuredClone(value);
const actors = w => [w.protagonist?.character_id, ...(w.npcs ?? []).map(n => n.npc_id)].filter(Boolean);
const person = (w, id) => w.protagonist?.character_id === id ? w.protagonist : (w.npcs ?? []).find(n => n.npc_id === id);
const inTransit = (w, id) => (w.tasks ?? []).some(t => t.actor_id === id && t.kind === 'travel' && ['running', 'paused'].includes(t.status));
const strings = items => Array.isArray(items) ? [...new Set(items.filter(id => typeof id === 'string' && id))] : [];

/** The recipient/location intersection never falls back to a broadcast when a
 * location is missing. Sender and original participants do not hear themselves. */
export function resolveWorldMessageRecipients(w, message) {
  const existing = new Set(actors(w));
  const excluded = new Set([message.sender_id, ...strings(message.actor_ids)]);
  const candidates = message.recipients === null ? [...existing] : strings(message.recipients);
  return candidates.filter(id => existing.has(id) && !excluded.has(id)
    && (!message.location_scope || (!inTransit(w, id) && person(w, id)?.location_id === message.location_scope)));
}

function append(w, state, message) {
  if (state.records.some(m => m.id === message.id)) return false;
  if (typeof message.content !== 'string' || !message.content || message.content.length > 2000) return false;
  // Backfill is bounded to still-live invitations / one day of public news.
  if (![message.created_at, message.deliver_at, message.expires_at].every(value => Number.isFinite(Date.parse(value)))) return false;
  state.records.push({ schema: WORLD_MESSAGE_SCHEMA, ...message, status: 'queued', delivered_at: null,
    delivered_to: [], independent_evidence: false, authority: 'message_transport' });
  return true;
}

function collectCanonicalSources(w, state, at) {
  let queued = 0; const time = Date.parse(at);
  for (const c of w.social?.commitments ?? []) {
    const created = Date.parse(c.created_at), deadline = Date.parse(c.deadline_at);
    if (!INVITATION_ACTIVE.has(c.status) || !Number.isFinite(created) || !Number.isFinite(deadline)
      || !Array.isArray(c.actors) || !c.actors.length || !c.id || !c.title || created > time || deadline <= time) continue;
    const sender = c.actors[0];
    // Co-present information uses observation, not an external message pipe.
    const recipients = c.actors.slice(1).filter(id => inTransit(w, id) || inTransit(w, sender)
      || person(w, id)?.location_id !== person(w, sender)?.location_id);
    if (!recipients.length) continue;
    queued += append(w, state, { id: `world-message:invitation:${c.id}`, sender_id: sender,
      recipients, actor_ids: [], location_scope: null, content: `${person(w, sender)?.display_name ?? sender}邀请你：${c.title}。${c.reason ?? ''}`,
      created_at: c.created_at, deliver_at: new Date(created + MINUTE).toISOString(),
      expires_at: c.deadline_at, urgency: 'normal', source: { kind: 'canonical_commitment', id: c.id, state: 'invited' },
      source_state_history: [{ state: c.status, at }] }) ? 1 : 0;
  }
  for (const n of w.social?.notices ?? []) {
    const c = (w.social.commitments ?? []).find(item => item.id === n.source_commitment_id), created = Date.parse(n.at);
    // A notice may only travel if its original completed commitment still
    // exists. Model-authored prose cannot impersonate this canonical source.
    if (!c || c.status !== 'completed' || n.verified_by !== 'canonical_world_record'
      || n.audience !== 'public' || !n.id || !n.text || !Number.isFinite(created) || created > time
      || created < time - DAY) continue;
    queued += append(w, state, { id: `world-message:notice:${n.id}`, sender_id: n.author_id ?? null,
      recipients: null, actor_ids: strings(c.actors), location_scope: null, content: n.text,
      created_at: n.at, deliver_at: new Date(created + MINUTE).toISOString(),
      expires_at: new Date(created + DAY).toISOString(), urgency: 'normal',
      source: { kind: 'canonical_notice', id: n.id, commitment_id: c.id, task_ids: strings(n.source_task_ids) } }) ? 1 : 0;
  }
  return queued;
}

/** Called only inside the social-life canonical mutation. No LLM, relation,
 * memory, task, resource or role-stage writes occur here. */
export function advanceWorldMessages(w, at) {
  if (!w.social || !Number.isFinite(Date.parse(at))) return { changed: false, queued: 0, delivered: 0 };
  const state = w.social.message_transport ??= { schema: WORLD_MESSAGE_SCHEMA, installed_at: at, revision: 0, records: [] };
  const queued = collectCanonicalSources(w, state, at);
  let delivered = 0, expired = 0, withdrawn = 0, updated = 0;
  for (const message of state.records) {
    // Preserve the original delivered invitation, while exposing later source
    // changes separately. A cancelled invitation is history, not a live offer.
    if (message.source.kind === 'canonical_commitment' && ['queued', 'delivered'].includes(message.status)) {
      const current = (w.social.commitments ?? []).find(item => item.id === message.source.id)?.status ?? 'unavailable';
      const history = message.source_state_history ??= [];
      if (history.at(-1)?.state !== current) { history.push({ state: current, at }); updated++; }
    }
    if (message.status !== 'queued') continue;
    if (Date.parse(message.expires_at) <= Date.parse(at)) { message.status = 'expired'; expired++; continue; }
    if (message.source.kind === 'canonical_commitment') {
      const c = (w.social.commitments ?? []).find(item => item.id === message.source.id);
      if (!c || !INVITATION_ACTIVE.has(c.status)) {
        message.status = 'withdrawn'; withdrawn++; continue;
      }
    }
    if (Date.parse(message.deliver_at) > Date.parse(at)) continue;
    message.delivered_to = resolveWorldMessageRecipients(w, message);
    message.status = message.delivered_to.length ? 'delivered' : 'undeliverable';
    message.delivered_at = at; delivered++;
  }
  // Existing canonical sources outlive this retention horizon; they expire or
  // settle before they can be rediscovered. No per-run log files are produced.
  const cutoff = Date.parse(at) - 7 * DAY;
  state.records = state.records.filter(m => m.status === 'queued' || Date.parse(m.expires_at) >= cutoff).slice(-512);
  const changed = queued + delivered + expired + withdrawn + updated > 0;
  if (changed) state.revision++;
  return { changed, queued, delivered, expired, withdrawn, updated };
}

/** Actor-scoped read model. The observer's full queue is never passed to an
 * agent. Message content and source references are preserved losslessly. */
export function worldMessageInbox(w, actorId, at = w.clock?.synced_at ?? w.updated_at) {
  return (w.social?.message_transport?.records ?? []).filter(m => m.status === 'delivered'
    && m.delivered_to.includes(actorId) && (!at || (m.delivered_at <= at && m.expires_at > at)))
    .slice(-24).map(m => ({ id: m.id, sender_id: m.sender_id, content: m.content, at: m.delivered_at,
      ...(m.source.kind === 'canonical_commitment' ? (() => {
        const state = (m.source_state_history ?? []).filter(item => !at || item.at <= at).at(-1)?.state ?? 'proposed';
        return { invitation_state: state, actionable: INVITATION_ACTIVE.has(state), historical_only: !INVITATION_ACTIVE.has(state) };
      })() : {}),
      source: copy(m.source), urgency: m.urgency, independent_evidence: false, authority: 'delivered_information',
      perception: { visibility: 'delivered', witnessed: false, delivered: true, public: m.recipients === null, observed: false } }));
}
