/**
 * Minimal JSONPath extractor.
 * Supports $.a.b.c, $.a[0].b, $.a["key"].b
 */
export function jsonPath(obj, path) {
    if (!path.startsWith('$'))
        return undefined;
    const parts = path
        .slice(1)
        .split(/[.[\]]/)
        .filter((p) => p.length > 0 && p !== '"' && p !== "'");
    const cleaned = parts.map((p) => p.replace(/^["']|["']$/g, ''));
    let cur = obj;
    for (const p of cleaned) {
        if (cur == null)
            return undefined;
        cur = cur[p];
    }
    return cur;
}
export function evaluateCondition(cond, payload, prev) {
    const actual = jsonPath(payload, cond.field);
    switch (cond.op) {
        case 'exists':
            return actual !== undefined && actual !== null;
        case 'changed':
            return actual !== jsonPath(prev ?? {}, cond.field);
        case 'eq':
            return actual === cond.value;
        case 'ne':
            return actual !== cond.value;
        case 'gt':
            return Number(actual) > Number(cond.value);
        case 'lt':
            return Number(actual) < Number(cond.value);
        case 'gte':
            return Number(actual) >= Number(cond.value);
        case 'lte':
            return Number(actual) <= Number(cond.value);
        case 'contains':
            return String(actual).includes(String(cond.value));
        case 'matches':
            return new RegExp(String(cond.value)).test(String(actual));
        default:
            return false;
    }
}
export function evaluateAll(conditions, logic, payload, prev) {
    if (conditions.length === 0)
        return true;
    const results = conditions.map((c) => evaluateCondition(c, payload, prev));
    return logic === 'OR' ? results.some(Boolean) : results.every(Boolean);
}
