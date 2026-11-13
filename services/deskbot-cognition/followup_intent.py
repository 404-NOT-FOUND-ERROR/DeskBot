"""Validate the actor's command. Only the engine writes factual summaries and evidence labels."""
import json
from copy import deepcopy
from pathlib import Path
from contract_validation import schema_diagnostic

CONTRACT = json.loads((Path(__file__).resolve().parents[2]/'contracts/cognitive-followup-intent.v1.json').read_text(encoding='utf-8'))


class IntentCommandError(ValueError):
    def __init__(self, diagnostic):
        super().__init__(CONTRACT['error'])
        self.diagnostic = diagnostic

    def repair_hint(self):
        details = json.dumps(self.diagnostic, ensure_ascii=False, separators=(',', ':'))
        return f'字段校验 {details}。按 command_schema 修复该字段，保留原意后返回完整 JSON。'


def invalid(path, rule, expected, actual):
    raise IntentCommandError({'path': path, 'rule': rule, 'expected': expected, 'actual': actual})


def selected_option(ref, rows, field):
    if ref is None:
        return None
    for row in rows:
        if (ref['kind'], ref['id']) == (row['kind'], row['id']):
            return row
    invalid('$.'+field, 'reference', 'listed option', 'unavailable')


def check_closure(raw, current, versioned):
    closure = raw.get('closure')
    if closure is not None and current is None:
        invalid('$.closure', 'reference', 'current issue', 'missing')
    if current is None or not versioned:
        return
    ending = raw['status'] in ('drop', 'none')
    if raw['status'] == 'drop' and closure is None:
        invalid('$.closure', 'required', 'closure for current issue', 'missing')
    if not ending and closure is not None:
        invalid('$.status', 'transition', 'drop|none with closure', raw['status'])
    if closure is not None and closure['kind'] == 'resolved':
        proof = current.get('resolution_evidence_ids', [])
        if not closure['evidence_ids'] or any(item not in proof for item in closure['evidence_ids']):
            invalid('$.closure.evidence_ids', 'evidence', 'current resolution evidence', 'unproved')


def compile_intent(raw, context):
    view = context.get('followup_intent', {})
    if view.get('schema') != CONTRACT['schema'] or not view.get('bases'):
        invalid('$.basis_ids', 'context', 'verified result basis', 'missing')
    diagnostic = schema_diagnostic(CONTRACT['command'], raw)
    if diagnostic:
        raise IntentCommandError(diagnostic)
    if raw['basis_ids'] != [basis['id'] for basis in view['bases']]:
        invalid('$.basis_ids', 'evidence', 'all verified basis IDs in order', 'mismatch')
    step = selected_option(raw['next_step'], view['next_options'], 'next_step')
    wait = selected_option(raw.get('wait_for'), view['wait_options'], 'wait_for')
    current = context['continuation'].get('current')
    if raw.get('followup_id') is not None and raw['followup_id'] != (current or {}).get('followup_id'):
        invalid('$.followup_id', 'reference', 'current issue ID', 'unavailable')
    check_closure(raw, current, view.get('prompt_version') == CONTRACT['prompt_version'])
    receipt = next((basis for basis in view['bases'] if basis['kind'] == 'receipt'), None)
    templates = CONTRACT['questions']
    question = templates[raw['status']]
    if raw['status'] not in ('drop', 'none') and (step or wait):
        row = step or wait
        title = row.get('title', row.get('label', row['id']))
        question = templates['next' if step else 'wait'].replace('{title}', title)
    result = {'status': raw['status'], 'question': question, 'reason': (receipt or view['bases'][0])['summary'],
              'delay_hours': int(raw['delay_hours']), 'next_step': deepcopy(raw['next_step'])}
    for key in ('wait_for', 'review_after_minutes', 'followup_id'):
        if key in raw:
            result[key] = int(raw[key]) if key == 'review_after_minutes' else deepcopy(raw[key])
    if receipt:
        result['communication_evidence_id'] = receipt['id']
    if raw.get('closure') is not None:
        closure = raw['closure']
        result['followup_closure'] = {'followup_id': current['followup_id'], 'kind': closure['kind'],
                                      'reason': CONTRACT['closures'][closure['kind']], 'evidence_ids': list(closure['evidence_ids'])}
    return result
