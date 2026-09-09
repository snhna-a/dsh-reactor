/**
 * Quick smoke test for dsh-reactor core logic.
 * Runs without a full dsh environment — tests the condition evaluator
 * and engine rule matching directly.
 */
import { evaluateCondition, evaluateAll, jsonPath } from '../lib/conditions.js'
import { ReactorEngine } from '../lib/engine.js'

// Mock context that satisfies the engine's minimal needs
const mockCtx = {
  logger: {
    info: (...args) => console.log('[INFO]', ...args),
    warn: (...args) => console.log('[WARN]', ...args),
    debug: () => {},
  },
  effect: (fn) => {
    const cleanup = fn()
    return cleanup
  },
  emit: () => {},
}

let passed = 0
let failed = 0

function assert(cond, msg) {
  if (cond) {
    passed++
    console.log(`  ✓ ${msg}`)
  } else {
    failed++
    console.error(`  ✗ ${msg}`)
  }
}

// ─── jsonPath tests ────────────────────────────────────────────
console.log('\njsonPath:')
assert(jsonPath({ a: { b: 42 } }, '$.a.b') === 42, 'extracts nested value')
assert(jsonPath({ a: [{ b: 'x' }] }, '$.a[0].b') === 'x', 'extracts array index value')
assert(jsonPath({ a: 1 }, '$.missing') === undefined, 'returns undefined for missing path')

// ─── condition tests ───────────────────────────────────────────
console.log('\nconditions:')
assert(evaluateCondition({ field: '$.status', op: 'eq', value: 'ok' }, { status: 'ok' }), 'eq matches')
assert(!evaluateCondition({ field: '$.status', op: 'eq', value: 'ok' }, { status: 'error' }), 'eq rejects mismatch')
assert(evaluateCondition({ field: '$.count', op: 'gt', value: 5 }, { count: 10 }), 'gt matches')
assert(evaluateCondition({ field: '$.name', op: 'contains', value: 'hello' }, { name: 'hello world' }), 'contains matches')
assert(evaluateCondition({ field: '$.code', op: 'matches', value: '^\\d+$' }, { code: '12345' }), 'matches regex')
assert(evaluateCondition({ field: '$.x', op: 'exists' }, { x: 0 }), 'exists matches even for falsy value')
assert(!evaluateCondition({ field: '$.y', op: 'exists' }, {}), 'exists rejects missing')
assert(
  evaluateCondition({ field: '$.v', op: 'changed' }, { v: 2 }, { v: 1 }),
  'changed detects difference',
)
assert(
  !evaluateCondition({ field: '$.v', op: 'changed' }, { v: 1 }, { v: 1 }),
  'changed rejects same value',
)

// ─── evaluateAll (AND/OR) ──────────────────────────────────────
console.log('\nevaluateAll:')
assert(
  evaluateAll(
    [{ field: '$.a', op: 'eq', value: 1 }, { field: '$.b', op: 'eq', value: 2 }],
    'AND',
    { a: 1, b: 2 },
  ),
  'AND matches when all true',
)
assert(
  !evaluateAll(
    [{ field: '$.a', op: 'eq', value: 1 }, { field: '$.b', op: 'eq', value: 2 }],
    'AND',
    { a: 1, b: 99 },
  ),
  'AND rejects when one false',
)
assert(
  evaluateAll(
    [{ field: '$.a', op: 'eq', value: 1 }, { field: '$.b', op: 'eq', value: 2 }],
    'OR',
    { a: 1, b: 99 },
  ),
  'OR matches when any true',
)

// ─── engine tests ──────────────────────────────────────────────
console.log('\nengine:')
const engine = new ReactorEngine(mockCtx, { allowShell: false, maxConcurrentActions: 3 })

// Add a rule with a webhook action (we won't actually hit a real URL)
engine.addRule({
  id: 'test-rule-1',
  name: 'Test Rule',
  source: { kind: 'http-poll', target: 'http://example.com', intervalMs: 999999 },
  conditions: [{ field: '$.status', op: 'eq', value: 'error' }],
  actions: [{ kind: 'webhook', target: 'http://localhost:9999/test' }],
  enabled: true,
  triggerCount: 0,
})

assert(engine.listRules().length === 1, 'addRule registers rule')
assert(engine.getRule('test-rule-1')?.name === 'Test Rule', 'getRule returns rule')

// Test rule with matching payload (webhook will fail silently since no server)
const result = await engine.testRule('test-rule-1', { status: 'error' })
assert(result.matched === true, 'testRule matches when conditions met')
assert(result.actionsRun >= 0, 'testRule reports actions count')

// Test rule with non-matching payload
const result2 = await engine.testRule('test-rule-1', { status: 'ok' })
assert(result2.matched === false, 'testRule does not match when conditions fail')

// Remove rule
engine.removeRule('test-rule-1')
assert(engine.listRules().length === 0, 'removeRule deletes rule')

// Dispose cleans up
engine.addRule({
  id: 'temp',
  name: 'Temp',
  source: { kind: 'command', target: 'echo hi', intervalMs: 999999 },
  conditions: [],
  actions: [],
  enabled: true,
  triggerCount: 0,
})
await engine.dispose()
assert(engine.listRules().length === 0, 'dispose clears all rules')

// ─── persistence (P0-1) ────────────────────────────────────────
console.log('\npersistence:')
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const tmpDir = await mkdtemp(join(tmpdir(), 'reactor-test-'))
try {
  const storePath = join(tmpDir, 'rules.json')
  const historyPath = join(tmpDir, 'history.jsonl')
  const e1 = new ReactorEngine(mockCtx, {
    allowShell: false,
    storePath,
    historyPath,
  })
  e1.addRule({
    id: 'persist-1',
    name: 'Persisted Rule',
    source: { kind: 'command', target: 'echo ok', intervalMs: 999999 },
    conditions: [{ field: '$.status', op: 'eq', value: 'error' }],
    actions: [{ kind: 'webhook', target: 'http://localhost:9999/p' }],
    enabled: true,
    triggerCount: 0,
  })
  await e1.dispose()

  // New engine over the same store path should restore the rule.
  const e2 = new ReactorEngine(mockCtx, {
    allowShell: false,
    storePath,
    historyPath,
  })
  const restored = await e2.loadPersisted()
  assert(restored === 1, 'persisted rule restored after restart')
  assert(e2.getRule('persist-1')?.name === 'Persisted Rule', 'restored rule keeps name')
  assert(e2.getRule('persist-1')?.triggerCount === 0, 'runtime state stripped on persist')

  // History: testRule records matched + unmatched triggers.
  const r1 = await e2.testRule('persist-1', { status: 'error' })
  assert(r1.matched === true, 'persisted rule still matches')
  const r2 = await e2.testRule('persist-1', { status: 'ok' })
  assert(r2.matched === false, 'persisted rule rejects non-match')
  const history = e2.listHistory('persist-1')
  assert(history.length >= 2, 'history records triggers')
  const matched = history.find((h) => h.matched)
  assert(matched && Array.isArray(matched.actions), 'matched history entry has action records')
  assert(matched && typeof matched.actions[0].ms === 'number', 'action record has duration')

  // History survives restart too.
  await e2.dispose()
  const e3 = new ReactorEngine(mockCtx, { allowShell: false, storePath, historyPath })
  await e3.loadPersisted()
  const hist2 = e3.listHistory()
  assert(hist2.length >= 2, 'history restored after restart')
  await e3.dispose()
} finally {
  await rm(tmpDir, { recursive: true, force: true })
}

// ─── webhook event source (P1-2) ───────────────────────────────
console.log('\nwebhook dispatch:')
const e4 = new ReactorEngine(mockCtx, { allowShell: false, storePath: join(tmpdir(), 'r4.json'), historyPath: join(tmpdir(), 'h4.jsonl') })
await e4.loadPersisted()
e4.addRule({
  id: 'web-1',
  name: 'Webhook Rule',
  source: { kind: 'webhook', target: '/reactor/webhook' },
  conditions: [{ field: '$.status', op: 'eq', value: 'error' }],
  actions: [{ kind: 'webhook', target: 'http://localhost:9999/w' }],
  enabled: true,
  triggerCount: 0,
})
e4.addRule({
  id: 'web-2',
  name: 'Webhook Rule (path filter)',
  source: { kind: 'webhook', target: '/other' },
  conditions: [],
  actions: [],
  enabled: true,
  triggerCount: 0,
})
const matchedCount = e4.dispatchWebhook({ status: 'error' }, '/reactor/webhook')
assert(matchedCount === 1, 'webhook dispatch triggers only rules matching path & conditions')
const noMatch = e4.dispatchWebhook({ status: 'ok' }, '/reactor/webhook')
assert(noMatch === 0, 'webhook dispatch respects conditions')
await e4.dispose()

// ─── summary ───────────────────────────────────────────────────
console.log(`\n${'='.repeat(40)}`)
console.log(`Results: ${passed} passed, ${failed} failed`)
console.log(`${'='.repeat(40)}`)
process.exit(failed > 0 ? 1 : 0)
