"""Shared job diagnostics. No world mutation, memory or retry authority."""
import json
from pathlib import Path
import re

CONTRACT = json.loads((Path(__file__).resolve().parents[2] / 'contracts/cognitive-failure.v1.json').read_text(encoding='utf-8'))
CATEGORIES = {code: layer for layer, codes in CONTRACT['layers'].items() for code in codes}


def symbol(value):
    return value if isinstance(value, str) and re.fullmatch(r'[A-Za-z0-9_.:-]{1,160}', value) else None


def cognitive_failure(code, *, cause_code=None, phase=None, stage=None, job_id=None, actor_id=None, retryable=False):
    code = symbol(code) or 'unknown_error'
    cause_code = symbol(cause_code)
    return {'schema': CONTRACT['report_schema'], 'layer': CATEGORIES.get(cause_code, CATEGORIES.get(code, 'unknown')),
            'code': code, 'cause_code': cause_code, 'phase': symbol(phase), 'stage': symbol(stage),
            'job_id': symbol(job_id), 'actor_id': symbol(actor_id), 'retryable': retryable is True, 'record_as_experience': False}


def error_frame(error, context, stage=None):
    context = context if isinstance(context, dict) else {}
    actor = context.get('actor') if isinstance(context.get('actor'), dict) else {}
    report = cognitive_failure(str(error), phase=context.get('phase'), stage=stage, actor_id=actor.get('actor_id'))
    # The legacy error field remains available; the shared report never copies prose.
    return {'type': 'error', 'error': str(error)[:500], 'failure': report}
