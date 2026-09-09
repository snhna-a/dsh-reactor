import type { Condition } from './types.js'

/**
 * Minimal JSONPath extractor.
 * Supports $.a.b.c, $.a[0].b, $.a["key"].b
 */
export function jsonPath(obj: unknown, path: string): unknown {
  if (!path.startsWith('$')) return undefined
  // Normalize: split on . or [ or ]
  const parts = path
    .slice(1)
    .split(/[.[\]]/)
    .filter((p) => p.length > 0 && p !== '"' && p !== "'")
  // Remove surrounding quotes from bracketed keys
  const cleaned = parts.map((p) => p.replace(/^["']|["']$/g, ''))
  let cur: unknown = obj
  for (const p of cleaned) {
    if (cur == null) return undefined
    cur = (cur as Record<string, unknown>)[p]
  }
  return cur
}

/** Evaluate a single condition against a payload (with optional previous payload for 'changed'). */
export function evaluateCondition(
  cond: Condition,
  payload: unknown,
  prev?: unknown,
): boolean {
  const actual = jsonPath(payload, cond.field)
  switch (cond.op) {
    case 'exists':
      return actual !== undefined && actual !== null
    case 'changed':
      return actual !== jsonPath(prev ?? {}, cond.field)
    case 'eq':
      return actual === cond.value
    case 'ne':
      return actual !== cond.value
    case 'gt':
      return Number(actual) > Number(cond.value)
    case 'lt':
      return Number(actual) < Number(cond.value)
    case 'gte':
      return Number(actual) >= Number(cond.value)
    case 'lte':
      return Number(actual) <= Number(cond.value)
    case 'contains':
      return String(actual).includes(String(cond.value))
    case 'matches':
      return new RegExp(String(cond.value)).test(String(actual))
    default:
      return false
  }
}

/** Evaluate all conditions with AND/OR logic. */
export function evaluateAll(
  conditions: Condition[],
  logic: 'AND' | 'OR',
  payload: unknown,
  prev?: unknown,
): boolean {
  if (conditions.length === 0) return true
  const results = conditions.map((c) => evaluateCondition(c, payload, prev))
  return logic === 'OR' ? results.some(Boolean) : results.every(Boolean)
}
