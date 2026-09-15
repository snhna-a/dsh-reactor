/**
 * Boot check for dsh-reactor against a REAL Cordis runtime.
 *
 * Validates that the plugin's apply() loads without throwing in both
 * scenarios the host can present:
 *   1. no webServer service  -> webhook ingress disabled (graceful degrade)
 *   2. with webServer        -> webhook route registered
 *
 * This catches "cannot get property X without inject" class failures that
 * smoke tests (which never boot the plugin) cannot see.
 */
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { apply, Config } from '../lib/index.js'

const tmp = await mkdtemp(join(tmpdir(), 'reactor-boot-'))
let failures = 0

function check(name, ok) {
  if (ok) {
    console.log(`  ✓ ${name}`)
  } else {
    failures++
    console.error(`  ✗ ${name}`)
  }
}

// Minimal tools service: register() is what registerTools() calls.
const tools = { register: () => {} }

// Minimal webServer service capturing registered routes.
const routes = []
const webServer = {
  register(route) {
    routes.push(route)
    return () => {}
  },
}

const mkCfg = (tag) =>
  Config({
    allowShell: false,
    maxConcurrentActions: 3,
    defaultIntervalMs: 60000,
    storePath: join(tmp, `${tag}-rules.json`),
    historyPath: join(tmp, `${tag}-history.jsonl`),
    maxHistoryEntries: 50,
  })

// ─── Scenario 1: no webServer ────────────────────────────────────
console.log('\nScenario 1: plugin loads without webServer (headless-ish):')
{
  const ctx = new Context()
  ctx.provide('tools', tools)
  let loaded = true
  let errMsg = ''
  let fiber
  try {
    fiber = ctx.plugin(
      { name: 'dsh-reactor', inject: ['tools'], Config, apply },
      mkCfg('s1'),
    )
    await fiber
    // give the async loadPersisted() a beat to run
    await new Promise((r) => setTimeout(r, 100))
  } catch (err) {
    loaded = false
    errMsg = err?.message ?? String(err)
  } finally {
    if (fiber) await fiber.dispose()
    else await ctx.dispose?.()
  }
  check('plugin apply() completed without throwing', loaded)
  if (!loaded) console.error(`    error: ${errMsg}`)
  check('no webhook routes registered', routes.length === 0)
}

// ─── Scenario 2: with webServer ──────────────────────────────────
console.log('\nScenario 2: plugin loads with webServer (web profile):')
{
  const ctx = new Context()
  ctx.provide('tools', tools)
  ctx.provide('webServer', webServer)
  let loaded = true
  let errMsg = ''
  let fiber
  try {
    fiber = ctx.plugin(
      { name: 'dsh-reactor', inject: ['tools'], Config, apply },
      mkCfg('s2'),
    )
    await fiber
    await new Promise((r) => setTimeout(r, 100))
  } catch (err) {
    loaded = false
    errMsg = err?.message ?? String(err)
  } finally {
    if (fiber) await fiber.dispose()
    else await ctx.dispose?.()
  }
  check('plugin apply() completed without throwing', loaded)
  if (!loaded) console.error(`    error: ${errMsg}`)
  check('webhook route registered at /reactor/webhook', routes.length === 1)
}

try {
  await rm(tmp, { recursive: true, force: true })
} catch {
  // best-effort cleanup; leftover temp dir is harmless
}

console.log(`\n${'='.repeat(40)}`)
console.log(`Boot check: ${failures === 0 ? 'ALL PASSED' : `${failures} FAILED`}`)
process.exit(failures > 0 ? 1 : 0)
