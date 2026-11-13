import {readFileSync} from 'node:fs';
import {isDeepStrictEqual} from 'node:util';
import {schemaDiagnostic} from './cognition-contracts.mjs';

export const FOLLOWUP_INTENT = JSON.parse(readFileSync(new URL('../../../contracts/cognitive-followup-intent.v1.json', import.meta.url), 'utf8'));
const contract = FOLLOWUP_INTENT;
function reject(code, diagnostic) {
  throw Object.assign(new Error(code), {code, statusCode:409, ...(diagnostic ? {diagnostic} : {})});
}

export function followupIntentContext(context, result) {
  const receipt = result.effects?.communication;
  const labels = contract.result_labels;
  const summary = result.not_executed ? labels.not_executed : result.success ? labels.completed : labels.unfinished;
  const bases = [{id:result.root_outcome_id, kind:'outcome', summary}];
  if (receipt) bases.push({id:receipt.id, kind:'receipt', summary:receipt.summary});
  return {schema:contract.schema, prompt_version:contract.prompt_version, rule:contract.prompt_rule, bases,
    next_options:structuredClone(context.continuation.next_options ?? []),
    wait_options:structuredClone(context.continuation.wait_options ?? [])};
}

function invalid(field, rule, expected, actual) {
  reject(contract.error, {path:field, rule, expected, actual});
}

function selectedOption(ref, rows, field) {
  if (ref == null) return null;
  const row = rows.find(option => option.kind === ref.kind && option.id === ref.id);
  if (!row) invalid('$.'+field, 'reference', 'listed option', 'unavailable');
  return row;
}

function checkClosure(raw, current, versioned) {
  if (raw.closure && !current) invalid('$.closure', 'reference', 'current issue', 'missing');
  if (!current || !versioned) return;
  const ending = ['drop', 'none'].includes(raw.status);
  if (raw.status === 'drop' && !raw.closure) invalid('$.closure', 'required', 'closure for current issue', 'missing');
  if (!ending && raw.closure) invalid('$.status', 'transition', 'drop|none with closure', raw.status);
  if (raw.closure?.kind === 'resolved') {
    const proof = current.resolution_evidence_ids ?? [];
    if (!raw.closure.evidence_ids.length || raw.closure.evidence_ids.some(id => !proof.includes(id)))
      invalid('$.closure.evidence_ids', 'evidence', 'current resolution evidence', 'unproved');
  }
}

/** Compile the actor's command into a server-authored question and result summary. */
export function compileFollowupIntent(raw, context) {
  const view = context.followup_intent;
  if (view?.schema !== contract.schema || !view.bases?.length)
    invalid('$.basis_ids', 'context', 'verified result basis', 'missing');
  const issue = schemaDiagnostic(contract.command, raw);
  if (issue) reject(contract.error, issue);
  if (!isDeepStrictEqual(raw.basis_ids, view.bases.map(basis => basis.id)))
    invalid('$.basis_ids', 'evidence', 'all verified basis IDs in order', 'mismatch');

  const next = selectedOption(raw.next_step, view.next_options, 'next_step');
  const wait = selectedOption(raw.wait_for, view.wait_options, 'wait_for');
  const current = context.continuation.current;
  if (raw.followup_id != null && raw.followup_id !== current?.followup_id)
    invalid('$.followup_id', 'reference', 'current issue ID', 'unavailable');
  checkClosure(raw, current, view.prompt_version === contract.prompt_version);

  const receipt = view.bases.find(basis => basis.kind === 'receipt');
  const template = contract.questions;
  let question = template[raw.status];
  if (!['drop','none'].includes(raw.status) && (next || wait)) {
    const row = next ?? wait;
    question = template[next ? 'next' : 'wait'].replace('{title}', () => row.title ?? row.label ?? row.id);
  }
  const output = {status:raw.status, question, reason:(receipt ?? view.bases[0]).summary,
    delay_hours:raw.delay_hours, next_step:structuredClone(raw.next_step)};
  for (const field of ['wait_for','review_after_minutes','followup_id']) {
    if (Object.hasOwn(raw, field)) output[field] = structuredClone(raw[field]);
  }
  if (receipt) output.communication_evidence_id = receipt.id;
  if (raw.closure) output.followup_closure = {followup_id:current.followup_id, kind:raw.closure.kind,
    reason:contract.closures[raw.closure.kind], evidence_ids:[...raw.closure.evidence_ids]};
  return output;
}

export function validateFollowupIntent(proposal, context, refs) {
  if (refs.followup_intent?.schema !== contract.schema) return null;
  const binding = proposal.followup_binding;
  if (binding?.contract !== contract.schema) reject(contract.binding_error);
  const version = refs.followup_intent.prompt_version;
  if (version && (version !== contract.prompt_version || binding.prompt_version !== version)) reject(contract.binding_error);
  const frozen = {...context, continuation:refs.continuation ?? context.continuation, followup_intent:refs.followup_intent};
  const expected = compileFollowupIntent(binding.actor_payload, frozen);
  const current = compileFollowupIntent(binding.actor_payload, context);
  if (!isDeepStrictEqual(expected, current) || !isDeepStrictEqual(proposal.followup, expected)) reject(contract.binding_error);
  const evidence = {schema:contract.schema, ...(version ? {prompt_version:version} : {}), basis_ids:[...binding.actor_payload.basis_ids]};
  if (binding.actor_payload.unverified_idea)
    evidence.unverified_idea = {text:binding.actor_payload.unverified_idea, epistemic:'unverified', label:'未验证设想'};
  return evidence;
}
