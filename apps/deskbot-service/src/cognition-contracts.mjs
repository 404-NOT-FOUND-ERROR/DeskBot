import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

export const cognitionRoot = fileURLToPath(new URL('../../../services/deskbot-cognition/', import.meta.url));
const schemas = new Map(['context', 'proposal', 'result', 'memory-commit'].map(kind => [kind,
  JSON.parse(readFileSync(new URL(`../../../services/deskbot-cognition/contracts/${kind}.v1.json`, import.meta.url), 'utf8'))]));
export function digest(value) { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
export function fail(code, message = code) { throw Object.assign(new Error(message), { code }); }
// The service and the Python worker support the same small JSON Schema vocabulary.
// A diagnostic contains a field path and a type or constraint, never the rejected text.
export function jsonType(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (typeof value === 'number' && !Number.isFinite(value)) return 'non-finite number';
  if (Number.isSafeInteger(value)) return 'integer';
  return typeof value;
}

export function schemaDiagnostic(schema, value, path = '$') {
  function visit(rule, item, field) {
    if (rule.$ref) return visit(schema.$defs[rule.$ref.split('/').at(-1)], item, field);
    const actual = jsonType(item);
    const problem = (rule, expected) => ({path: field, rule, expected, actual});
    const types = Array.isArray(rule.type) ? rule.type : [rule.type];
    if (rule.type && !types.includes(actual) && !(actual === 'integer' && types.includes('number')))
      return problem('type', types.join('|'));
    if (Object.hasOwn(rule, 'const') && item !== rule.const) return problem('const', String(rule.const));
    if (rule.enum && !rule.enum.includes(item)) return problem('enum', rule.enum.join('|'));
    if (actual === 'object') {
      const properties = rule.properties ?? {};
      for (const key of rule.required ?? []) {
        if (!Object.hasOwn(item, key)) return {path: field+'.'+key, rule:'required', expected:'present', actual:'missing'};
      }
      for (const key of Object.keys(item)) {
        if (!Object.hasOwn(properties, key)) {
          if (rule.additionalProperties === false) return {path:field+'.'+key, rule:'additionalProperties', expected:'declared field', actual:'extra field'};
          continue;
        }
        const issue = visit(properties[key], item[key], field+'.'+key);
        if (issue) return issue;
      }
    } else if (actual === 'array') {
      if (item.length > rule.maxItems) return problem('maxItems', String(rule.maxItems));
      for (const [index, element] of item.entries()) {
        const issue = visit(rule.items, element, field+'['+index+']');
        if (issue) return issue;
      }
    } else if (actual === 'string') {
      const length = [...item].length;
      if (length < rule.minLength) return problem('minLength', String(rule.minLength));
      if (length > rule.maxLength) return problem('maxLength', String(rule.maxLength));
      if (rule.pattern && !new RegExp(rule.pattern, 'u').test(item)) return problem('pattern', rule.pattern);
      if (rule.format === 'date-time' && (!/T.*(?:Z|[+-]\d\d:\d\d)$/.test(item) || !Number.isFinite(Date.parse(item))))
        return problem('format', rule.format);
    } else if (actual === 'integer' || actual === 'number') {
      if (item < rule.minimum) return problem('minimum', String(rule.minimum));
      if (item > rule.maximum) return problem('maximum', String(rule.maximum));
    }
    return null;
  }
  return visit(schema, value, path);
}

export function validateContract(kind, value) {
  if (!schemas.has(kind)) fail('unknown_contract');
  const issue = schemaDiagnostic(schemas.get(kind), value, kind);
  if (issue) fail('invalid_contract', issue.path+': '+issue.rule);
  return value;
}
