import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

export const cognitionRoot = fileURLToPath(new URL('../../../services/deskbot-cognition/', import.meta.url));
const schemas = new Map(['context', 'proposal', 'result', 'memory-commit'].map(kind => [kind,
  JSON.parse(readFileSync(new URL(`../../../services/deskbot-cognition/contracts/${kind}.v1.json`, import.meta.url), 'utf8'))]));
export function digest(value) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
export function fail(code, message = code) { throw Object.assign(new Error(message), { code }); }
export function validateContract(kind, value) {
  function check(rule, item, path) {
    const reject = reason => fail('invalid_contract', `${path}: ${reason}`);
    if ('const' in rule && item !== rule.const) reject('const');
    if (rule.enum && !rule.enum.includes(item)) reject('enum');
    const type = rule.type;
    const valid = { object: () => item !== null && typeof item === 'object' && !Array.isArray(item), array: () => Array.isArray(item),
      string: () => typeof item === 'string', integer: () => Number.isSafeInteger(item), number: () => typeof item === 'number' && Number.isFinite(item) };
    if (type && !valid[type]()) reject('type');
    if (type === 'object') {
      if (rule.required.some(key => !(key in item))) reject('required');
      for (const key of Object.keys(item)) {
        if (!(key in rule.properties)) reject('extra fields');
        check(rule.properties[key], item[key], `${path}.${key}`);
      }
    }
    if (type === 'array') {
      if (item.length > rule.maxItems) reject('array limit');
      item.forEach((v, i) => check(rule.items, v, `${path}[${i}]`));
    }
    if (type === 'string') {
      if (item.length < (rule.minLength ?? 0) || item.length > (rule.maxLength ?? Infinity)) reject('string length');
      if (rule.format === 'date-time' && (!/T.*(?:Z|[+-]\d\d:\d\d)$/.test(item) || !Number.isFinite(Date.parse(item)))) reject('timestamp');
    }
    if (['number', 'integer'].includes(type) && (item < (rule.minimum ?? -Infinity) || item > (rule.maximum ?? Infinity))) reject('range');
  }
  if (!schemas.has(kind)) fail('unknown_contract');
  check(schemas.get(kind), value, kind);
  return value;
}
