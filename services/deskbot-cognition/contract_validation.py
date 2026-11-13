"""Shared subset of JSON Schema used by the local worker contracts."""
from datetime import datetime
from pathlib import Path
import json
import math
import re


def json_type(value):
    if value is None:
        return 'null'
    if isinstance(value, bool):
        return 'boolean'
    if isinstance(value, float) and not math.isfinite(value):
        return 'non-finite number'
    if isinstance(value, (int, float)):
        return 'integer' if abs(value) <= 2**53 - 1 and int(value) == value else 'number'
    return {str: 'string', list: 'array', dict: 'object'}[type(value)]


def schema_diagnostic(schema, value, path='$'):
    def visit(rule, item, field):
        if '$ref' in rule:
            return visit(schema['$defs'][rule['$ref'].split('/')[-1]], item, field)
        actual = json_type(item)

        def problem(check, expected):
            return {'path': field, 'rule': check, 'expected': str(expected), 'actual': actual}

        types = rule.get('type', [])
        types = [types] if isinstance(types, str) else types
        if types and actual not in types and not (actual == 'integer' and 'number' in types):
            return problem('type', '|'.join(types))
        if 'const' in rule and (item != rule['const'] or actual != json_type(rule['const'])):
            return problem('const', rule['const'])
        if 'enum' in rule and item not in rule['enum']:
            return problem('enum', '|'.join(map(str, rule['enum'])))
        if actual == 'object':
            properties = rule.get('properties', {})
            for key in rule.get('required', []):
                if key not in item:
                    return {'path': field+'.'+key, 'rule': 'required', 'expected': 'present', 'actual': 'missing'}
            for key, entry in item.items():
                if key not in properties:
                    if rule.get('additionalProperties') is False:
                        return {'path': field+'.'+key, 'rule': 'additionalProperties', 'expected': 'declared field', 'actual': 'extra field'}
                    continue
                issue = visit(properties[key], entry, field+'.'+key)
                if issue:
                    return issue
        elif actual == 'array':
            if 'maxItems' in rule and len(item) > rule['maxItems']:
                return problem('maxItems', rule['maxItems'])
            for index, entry in enumerate(item):
                issue = visit(rule['items'], entry, f'{field}[{index}]')
                if issue:
                    return issue
        elif actual == 'string':
            if 'minLength' in rule and len(item) < rule['minLength']:
                return problem('minLength', rule['minLength'])
            if 'maxLength' in rule and len(item) > rule['maxLength']:
                return problem('maxLength', rule['maxLength'])
            if 'pattern' in rule and not re.search(rule['pattern'], item):
                return problem('pattern', rule['pattern'])
            if rule.get('format') == 'date-time':
                try:
                    if 'T' not in item or datetime.fromisoformat(item.replace('Z', '+00:00')).tzinfo is None:
                        return problem('format', 'date-time')
                except ValueError:
                    return problem('format', 'date-time')
        elif actual in ('integer', 'number'):
            if 'minimum' in rule and item < rule['minimum']:
                return problem('minimum', rule['minimum'])
            if 'maximum' in rule and item > rule['maximum']:
                return problem('maximum', rule['maximum'])
        return None

    return visit(schema, value, path)


def validate(kind, value):
    schema = json.loads((Path(__file__).parent/'contracts'/f'{kind}.v1.json').read_text(encoding='utf-8'))
    issue = schema_diagnostic(schema, value, kind)
    if issue:
        raise ValueError(f"{issue['path']}: {issue['rule']}")
    return value
