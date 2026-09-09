/**
 * End-to-end demo: watch a GitHub repo for NEW RELEASES and act on them.
 *
 * Real behavior, no mocks:
 *   1. defines an http-poll rule against the GitHub releases API
 *   2. fetches the REAL latest-release payload
 *   3. evaluates the `changed` condition against it (first run = baseline,
 *      second run with the same payload = no match -> state-aware)
 *   4. runs the shell action when matched
 *
 * Run:  node examples/github-release-watcher.mjs
 */
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execa } from 'execa'
import { ReactorEngine } from '../lib/engine.js'

const log = {
  logger: {
    info: (...a) => console.log('[INFO]', ...a),
    warn: (...a) => console.log('[WARN]', ...a),
    debug: () => {},
  },
}

const REPO = 'vercel/next.js'
const API = `https://api.github.com/repos/${REPO}/releases/latest`

const tmp = await mkdtemp(join(tmpdir(), 'reactor-demo-'))
const engine = new ReactorEngine(log, {
  allowShell: true,
  maxConcurrentActions: 3,
  storePath: join(tmp, 'rules.json'),
  historyPath: join(tmp, 'history.jsonl'),
})

// ─── Step 1: define the rule ─────────────────────────────────────
console.log('\n▶ 定义规则：监控 GitHub Release，新版本发布即执行')
engine.addRule({
  id: 'gh-release-demo',
  name: 'GitHub Release Watcher',
  description: `Poll ${API}, fire shell action when tag_name changes`,
  source: { kind: 'http-poll', target: API, intervalMs: 300000 },
  conditions: [{ field: '$.tag_name', op: 'changed' }],
  actions: [
    {
      kind: 'shell',
      // in a real setup you would clone/pull + build + test here;
      // {{payload.tag_name}} is interpolated from the real payload
      target: 'echo "new release detected: {{payload.tag_name}} ({{payload.published_at}})"',
    },
  ],
  cooldownMs: 0,
  // Demo drives evaluations manually via testRule(); in real use set enabled: true
  // and the rule polls on its own interval (startSource).
  enabled: false,
  triggerCount: 0,
})

// ─── Step 2: fetch the REAL payload (what the poller would do) ───
console.log(`\n▶ 真实请求 GitHub: GET ${API}`)

/** Probe the HTML endpoint for the latest tag (not subject to API rate limits). */
async function htmlProbe(repo) {
  const { stdout } = await execa('curl.exe', [
    '-sI', '-o', 'NUL', '-w', '%{redirect_url}',
    `https://github.com/${repo}/releases/latest`,
  ])
  const tag = (stdout.trim() || '').split('/').pop()
  if (tag) {
    return { tag_name: tag, published_at: new Date().toISOString() }
  }
  return null
}

async function fetchLatestPayload(repo) {
  const api = `https://api.github.com/repos/${repo}/releases/latest`
  // 1) primary: GitHub REST API (rate-limited at 60 req/h unauthenticated)
  try {
    const { stdout } = await execa('curl.exe', [
      '-s', '-w', '\n%{http_code}',
      '-H', 'User-Agent: dsh-reactor-demo',
      '-H', 'Accept: application/vnd.github+json',
      api,
    ])
    const lines = stdout.trim().split('\n')
    const code = lines.pop()
    if (code === '200') {
      const j = JSON.parse(lines.join('\n'))
      return { payload: j, source: `api.github.com (HTTP ${code})` }
    }
    // 2) fallback: HTML redirect probe
    const reason = (lines.join('\n').match(/"message":"([^"]+)"/) || [])[1] || `HTTP ${code}`
    const probe = await htmlProbe(repo)
    if (probe) return { payload: probe, source: `github.com releases/latest redirect (API failed: ${reason})` }
  } catch (err) {
    const probe = await htmlProbe(repo)
    if (probe) return { payload: probe, source: `github.com releases/latest redirect (API error: ${err.message})` }
  }
  throw new Error('cannot resolve latest release tag (network unreachable)')
}
const { payload, source } = await fetchLatestPayload(REPO)
console.log(`  数据来源: ${source}`)
console.log(`  latest tag: ${payload.tag_name}${payload.published_at ? `, published: ${payload.published_at}` : ''}`)

// ─── Step 3: first evaluation (baseline) ─────────────────────────
console.log('\n▶ 第一次评估（基线，prev 为空 → changed 为 true → 触发）')
const run1 = await engine.testRule('gh-release-demo', payload)
console.log(`  条件匹配: ${run1.matched}，动作执行: ${run1.actionsRun}`)

// ─── Step 4: second evaluation with the SAME payload ─────────────
console.log('\n▶ 第二次评估（同一 tag，prev 相同 → changed 为 false → 不触发）')
const run2 = await engine.testRule('gh-release-demo', payload)
console.log(`  条件匹配: ${run2.matched}，动作执行: ${run2.actionsRun}`)

// ─── Step 5: simulated NEW release ───────────────────────────────
console.log('\n▶ 模拟新版本发布（tag_name 变化 → 再次触发）')
const next = { ...payload, tag_name: `${payload.tag_name}-demo-new`, published_at: new Date().toISOString() }
const run3 = await engine.testRule('gh-release-demo', next)
console.log(`  条件匹配: ${run3.matched}，动作执行: ${run3.actionsRun}`)

// ─── Step 6: audit trail ─────────────────────────────────────────
console.log('\n▶ 执行历史（reactor_history 的数据来源）')
for (const h of engine.listHistory('gh-release-demo')) {
  const act = (h.actions ?? []).map((a) => `[${a.ok ? 'OK' : 'FAIL'}] ${a.kind}: ${a.target} (${a.ms}ms)`).join('; ')
  console.log(`  ${new Date(h.at).toISOString()} matched=${h.matched} ${act}`)
}

await engine.dispose()
await rm(tmp, { recursive: true, force: true }).catch(() => {})
console.log('\n演示完成 ✅')
