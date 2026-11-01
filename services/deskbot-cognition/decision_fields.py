"""Shared decision fields. A need state is not an action's source category."""
import json
from pathlib import Path

CONTRACT = json.loads((Path(__file__).resolve().parents[2] / 'contracts/cognitive-decision-fields.v1.json').read_text(encoding='utf-8'))
_MOTIVATION = CONTRACT['motivation']
MOTIVATIONS = tuple(_MOTIVATION['allowed'])
MOTIVATION_PROMPT = ('motivation 字段合同：' + '；'.join(
    key + '=' + _MOTIVATION['meanings'][key] for key in MOTIVATIONS)
    + '。' + _MOTIVATION['boundary'])


class DecisionFieldError(ValueError):
    def __init__(self, value):
        self.code = _MOTIVATION['invalid_code']
        received = json.dumps(value, ensure_ascii=False)[:80]
        super().__init__('motivation 收到非法值 ' + received + '；允许值：'
                         + '|'.join(MOTIVATIONS) + '。' + _MOTIVATION['boundary'])


def validate_motivation(value):
    if not isinstance(value, str) or value not in MOTIVATIONS:
        raise DecisionFieldError(value)
    return value
