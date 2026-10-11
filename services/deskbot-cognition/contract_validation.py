"""Strict Stage 1 schema subset; no third-party runtime dependencies."""
from datetime import datetime
import json
from pathlib import Path

def validate(kind, value):
    schema=json.loads((Path(__file__).parent/'contracts'/f'{kind}.v1.json').read_text(encoding='utf-8'))
    def check(rule, data, path):
        if 'const' in rule and data != rule['const']: raise ValueError(f'{path}: const')
        if 'enum' in rule and data not in rule['enum']: raise ValueError(f'{path}: enum')
        t=rule.get('type')
        valid={'object':lambda:isinstance(data,dict),'array':lambda:isinstance(data,list),'string':lambda:isinstance(data,str),'integer':lambda:isinstance(data,int) and not isinstance(data,bool),'number':lambda:isinstance(data,(float,int)) and not isinstance(data,bool)}
        if t and not valid[t](): raise ValueError(f'{path}: type')
        if t=='object':
            props=rule['properties']
            if set(rule['required'])-set(data): raise ValueError(f'{path}: required')
            if rule.get('additionalProperties') is False and set(data)-set(props): raise ValueError(f'{path}: extra fields')
            for key,item in data.items(): check(props[key],item,f'{path}.{key}')
        if t=='array':
            if len(data)>rule['maxItems']: raise ValueError(f'{path}: array limit')
            for i,item in enumerate(data): check(rule['items'],item,f'{path}[{i}]')
        if t=='string':
            if len(data)<rule.get('minLength',0) or len(data)>rule.get('maxLength',100000): raise ValueError(f'{path}: string length')
            if rule.get('format')=='date-time':
                if datetime.fromisoformat(data.replace('Z','+00:00')).tzinfo is None: raise ValueError(f'{path}: timezone required')
        if t in ('number','integer'):
            if data<rule.get('minimum',float('-inf')) or data>rule.get('maximum',float('inf')): raise ValueError(f'{path}: range')
    check(schema,value,kind)
    return value
