"""Shared ownership of feedback fields, separate from planning and world facts."""
import json
from pathlib import Path

CONTRACT = json.loads((Path(__file__).resolve().parents[2] / 'contracts/cognitive-followup-phases.v1.json').read_text(encoding='utf-8'))
FEEDBACK = CONTRACT['feedback']
FEEDBACK_PROMPT = (FEEDBACK['rule'] + FEEDBACK['closure_rule']
                   + '反馈JSON只允许这些字段：' + '、'.join(FEEDBACK['allowed_fields']) + '。')


def feedback_field_errors(value):
    if not isinstance(value, dict):
        return ['结果反馈必须是JSON对象']
    unexpected = sorted(set(value) - set(FEEDBACK['allowed_fields']))
    if not unexpected:
        return []
    return ['当前是feedback结果反馈，不是plan计划。请删除不属于反馈的字段：' + '、'.join(unexpected)
            + '（不要补全这些字段，也不要填null）。' + FEEDBACK_PROMPT]


def feedback_error_code(value):
    return FEEDBACK['invalid_code'] if feedback_field_errors(value) else 'semantic_contract_rejected_after_retry'
