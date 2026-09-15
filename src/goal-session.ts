/**
 * dsh-reactor — Goal-driven ReAct Agent execution (v0.7)
 *
 * Follows dsh-cron/agent-task.js verbatim (the @deepseek-ai/dsh-headless
 * one-shot recipe): create a fresh persisted agent, send prompt, wait for
 * quiescence, flush, summarize, dispose. No temporary workspace, no preset
 * resolution, no default permission preset — match what dsh-cron does.
 */
import { randomUUID } from 'node:crypto'
import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { GoalConstraints } from './types.js'
import { importHostPackage } from './host-modules.js'
import { runPreflight } from './preflight.js'

const SUMMARY_LIMIT = 8192

function tail(text: string, limit = SUMMARY_LIMIT): string {
  return text.length <= limit ? text : '…' + text.slice(text.length - limit + 1)
}

/** Debug trace to disk so headless runs can be diagnosed without a TTY. */
function dbg(msg: string): void {
  try {
    const line = `[${new Date().toISOString()}] ${msg}\n`
    const file = 'C:/Users/Administrator/.dsh/reactor-goal-debug.log'
    mkdirSync(dirname(file), { recursive: true })
    appendFileSync(file, line, 'utf8')
  } catch { /* best-effort */ }
}

/**
 * Extract the last non-empty assistant text and final turn reason from an
 * event interval (same fold as dsh-cron/executor.js).
 */
function summarize(events: unknown[], firstSeq: number): { text: string; reason?: { kind?: string; error?: { code?: string; message?: string } } } {
  let started = false
  let text = ''
  let reason: { kind?: string; error?: { code?: string; message?: string } } | undefined
  for (const ev of events as Array<{ seq: number; type: string; data: any }>) {
    if (ev.seq < firstSeq) continue
    if (ev.type === 'turn/start') { started = true; continue }
    if (!started) continue
    if (ev.type === 'assistant/message') {
      const blocks = ev.data?.message?.content ?? []
      const joined = blocks
        .filter((b: any) => b.type === 'text')
        .map((b: any) => b.text)
        .join('')
      if (joined) text = joined
    }
    if (ev.type === 'turn/end') reason = ev.data?.reason
  }
  return { text, reason }
}

function formatPayload(payload: unknown, maxLen = 4000): string {
  try {
    const s = JSON.stringify(payload, null, 2)
    return s.length > maxLen ? s.slice(0, maxLen) + '\n... (truncated)' : s
  } catch {
    return String(payload).slice(0, maxLen)
  }
}

function buildUnattendedFraming(ruleName: string, triggeredAt: string): string {
  return [
    '[REACTOR RUN]',
    `rule: ${JSON.stringify(ruleName)}`,
    `triggered_at: ${triggeredAt}`,
    'This is an unattended event-driven run. No user is watching and nobody can answer questions — never ask, never wait for confirmation. Do the task, then end with a concise report of what happened and the outcome.',
  ].join('\n')
}

function buildGoalPrompt(opts: {
  ruleName: string
  payload: unknown
  goal: string
  constraints?: GoalConstraints
}): string {
  const { ruleName, payload, goal, constraints } = opts
  const maxSteps = constraints?.maxSteps ?? 20
  const timeoutMin = constraints?.timeoutMinutes ?? 30
  const workingDir = constraints?.workingDir ?? '(explore the working directory to find the project)'
  const allowedTools = constraints?.allowedTools?.length
    ? constraints.allowedTools.join(', ')
    : 'all available tools'

  return [
    `## Triggered Event`,
    `Rule "${ruleName}" conditions matched. Payload:`,
    '```json',
    formatPayload(payload),
    '```',
    ``,
    `## Goal`,
    goal,
    ``,
    `## Constraints`,
    `- Working directory: ${workingDir}`,
    `- Max steps: ${maxSteps}`,
    `- Timeout: ${timeoutMin} minutes`,
    `- Available tools: ${allowedTools}`,
    ``,
    `When done, briefly report: what you did, the result, and any problems.`,
  ].join('\n')
}

/** Result of a settled goal run. */
export interface GoalRunResult {
  sessionId: string
  workspacePath: string
  status: 'ok' | 'failed' | 'timeout'
  summary: string
  error?: string
  tokens?: { inputTokens: number; outputTokens: number; cachedTokens: number; reasoningTokens: number; totalTokens: number }
  ms: number
  ok: boolean
}

/**
 * Run one goal to settlement — mirrors dsh-cron/runAgentTask exactly.
 */
export async function runGoalSession(
  ctx: Context,
  options: {
    ruleName: string
    ruleId: string
    seq: number
    payload: unknown
    goal: string
    constraints?: GoalConstraints
  },
): Promise<GoalRunResult> {
  const started = Date.now()
  const startedIso = new Date().toISOString()
  const seq = options.seq

  // Lazy imports via the robust host resolver (works for both normal install
  // and linked development layouts where bare imports can't find host packages).
  let installModelSelection: any
  let createUserMessage: any
  let SessionId: any
  try {
    const [dshAgent, dshLlm, dshSession] = await Promise.all([
      importHostPackage('@deepseek-ai/dsh-agent'),
      importHostPackage('@deepseek-ai/dsh-llm'),
      importHostPackage('@deepseek-ai/dsh-session'),
    ])
    installModelSelection = dshAgent.installModelSelection
    createUserMessage = dshLlm.createUserMessage
    SessionId = dshSession.SessionId
  } catch (err) {
    return {
      sessionId: '',
      workspacePath: '',
      status: 'failed',
      summary: '',
      error: `failed to load dsh agent dependencies: ${err instanceof Error ? err.message : String(err)}`,
      ms: Date.now() - started,
      ok: false,
    }
  }

  const optional = (name: string): any => (typeof ctx.get === 'function' ? ctx.get(name as never) : undefined)
  const agents: any = optional('agents')
  if (!agents) {
    return {
      sessionId: '',
      workspacePath: '',
      status: 'failed',
      summary: '',
      error: 'agents service unavailable',
      ms: Date.now() - started,
      ok: false,
    }
  }

  // Use current model selection (same as dsh-cron). Accessed via ctx.get to
  // avoid Cordis "without inject" guards across plugin/host boundaries.
  const modelSvc: any = optional('agentDefaultModel')
  const selection = modelSvc?.currentSelection?.() ?? { provider: '', model: '' }
  const provider = selection.provider
  const model = selection.model
  const cwd = options.constraints?.workingDir ?? process.cwd()
  const sessionId = `reactor-goal-${randomUUID()}`
  const timeoutMs = (options.constraints?.timeoutMinutes ?? 30) * 60_000
  dbg(`runGoalSession start sessionId=${sessionId} provider=${JSON.stringify(provider)} model=${JSON.stringify(model)} cwd=${cwd}`)
  const presets = optional('agentPresets')
  const presetId = (options.constraints as any)?.agentPreset

  // Token accounting: accumulate usage from host session/event for this session.
  const tokenAgg = { inputTokens: 0, outputTokens: 0, cachedTokens: 0, reasoningTokens: 0 }
  let sessionEventOff: (() => void) | undefined
  try {
    sessionEventOff = (ctx as any).on('session/event', (session: any, event: any) => {
      try {
        if (String(session?.id ?? '') !== sessionId) return
        if (event?.type !== 'assistant/message') return
        const u = event?.data?.usage
        if (!u) return
        tokenAgg.inputTokens += Number(u.inputTokens) || 0
        tokenAgg.outputTokens += Number(u.outputTokens) || 0
        tokenAgg.cachedTokens += Number(u.cacheReadTokens) || 0
        tokenAgg.reasoningTokens += Number(u.reasoningTokens) || 0
      } catch { /* ignore */ }
    })
  } catch (e: any) { dbg('usage listener failed: ' + (e?.message ?? e)) }

  let framingInstalled = false
  let lastAssistantText = ''

  // v0.12.3 Runtime Preflight: check workspace + required capabilities
  // before spinning up Agent. Block with 0 tokens if host lacks them.
  try {
    const pf = await runPreflight(cwd, options.constraints?.requiredCapabilities)
    if (!pf.ok) {
      const missing = (pf.missing ?? []).join(', ')
      const msg = `preflight-blocked: ${pf.reason} missing=[${missing}]`
      dbg('PREFLIGHT BLOCKED: ' + msg)
      return {
        sessionId,
        workspacePath: cwd,
        status: 'failed',
        summary: '',
        error: msg,
        tokens: { inputTokens: 0, outputTokens: 0, cachedTokens: 0, reasoningTokens: 0, totalTokens: 0 },
        ms: Date.now() - started,
        ok: false,
      }
    }
    dbg('PREFLIGHT OK caps=' + JSON.stringify(pf.caps))
  } catch (e: any) { dbg('preflight error: ' + (e?.message ?? e)) }

  try {
    dbg('agents.create() calling...')
    const handle = await agents.create({
      sessionId: SessionId(sessionId),
      meta: { cwd, origin: 'subagent' },
      agentOptions: { provider, model },
      setup: async (agentCtx: Context) => {
        dbg('setup callback running, presets=' + (presets ? typeof presets.mount : 'UNDEFINED') + ' presetId=' + String(presetId))
        installModelSelection(agentCtx, {
          current: { provider, model, ...(selection.reasoningEffort ? { reasoningEffort: selection.reasoningEffort } : {}) },
          assembled: undefined,
        })
        if (presets !== undefined) {
          try { await presets.mount(agentCtx, presetId); dbg('presets.mount OK') } catch (e) { dbg('presets.mount failed: ' + (e as Error).message) }
        } else {
          dbg('agentPresets service NOT AVAILABLE — no tools mounted')
        }
        const systemPrompt = typeof agentCtx.get === 'function' ? agentCtx.get('systemPrompt') as any : undefined
        if (systemPrompt) {
          systemPrompt.section({
            name: 'reactor:unattended',
            order: 900,
            text: buildUnattendedFraming(options.ruleName, startedIso),
          })
          framingInstalled = true
        }
        dbg('setup callback done, framingInstalled=' + framingInstalled)
        // --- Model-layer error capture (keep errors, drop per-chunk spam) ---
        try {
          agentCtx.on('agent/request-error', (p: any, next: any) => {
            try { dbg('[request-error] ' + String(JSON.stringify(p).slice(0, 300))) } catch {}
            return next()
          })
          agentCtx.on('agent/error', (p: any) => { try { dbg('[agent-error] ' + String(JSON.stringify(p).slice(0, 300))) } catch {} })
          // Keep assistant text for summary fallback (history events array is often empty).
          const ac: any = agentCtx
          let streamBuf = ''
          ac.on('agent/assistant-stream', (p: any) => {
            try {
              const fr = p?.frame ?? p
              const kind = fr?.type ?? fr?.kind ?? '?'
              if (kind === 'chunk' || fr?.chunk) {
                const c = fr?.chunk ?? {}
                const txt = c.text ?? c.delta ?? c.content ?? ''
                if (txt) streamBuf += String(txt)
              } else if (kind === 'end' || kind === 'finish' || fr?.outcome !== undefined) {
                if (streamBuf.trim()) lastAssistantText = streamBuf
                streamBuf = ''
              }
            } catch { /* ignore */ }
          })
        } catch (e: any) { dbg('subscribe failed: ' + (e?.message ?? e)) }
      },
    })
    dbg('agents.create() returned handle, agent=' + (typeof handle.agent))

    const { agent } = handle
    try {
      // Deterministic title.
      const titles = optional('sessionTitle')
      if (titles !== undefined) {
        try { titles.rename(agent.session, `${options.ruleName} #${seq}`) } catch { /* best-effort */ }
      }

      // Permission preset (only if user specified one).
      const accessPreset = (options.constraints as any)?.permissionPreset
      if (accessPreset) {
        const permissions = optional('permissionPresets')
        if (permissions !== undefined) {
          try { permissions.set(agent.session, accessPreset) } catch { /* best-effort */ }
        }
      }

      // Wait for initial idle (mirrors dsh-cron: await directly; overall
      // timeoutMs below is the backstop so this can never hang forever).
      const idleBackstop = new Promise<'idle-timeout'>((r) => setTimeout(() => r('idle-timeout'), 120_000))
      const initRace = await Promise.race([
        agent.whenIdle().then(() => 'idle' as const),
        idleBackstop,
      ])
      dbg('initial whenIdle resolved: ' + initRace)

      const firstSeq = agent.session.seq ?? 0
      dbg('firstSeq=' + firstSeq)
      const prompt = buildGoalPrompt({
        ruleName: options.ruleName,
        payload: options.payload,
        goal: options.goal,
        constraints: options.constraints,
      })

      dbg('followup sending prompt, len=' + prompt.length)
      try {
        agent.followup(
          createUserMessage({
            content: [{ type: 'text', text: framingInstalled ? prompt : buildUnattendedFraming(options.ruleName, startedIso) + '\n\n' + prompt }],
            source: { kind: 'user' },
          }),
        )
        dbg('followup returned')
      } catch (e) {
        dbg('followup THREW: ' + (e as Error).message)
        throw e
      }

      // Sample agent state every 5s so a silent hang is diagnosable.
      let sampled = 0
      let sawModelEvent = false
      const sampler = setInterval(() => {
        try {
          sampled++
          const evs = (agent.session?.events ?? []) as any[]
          const last = evs[evs.length - 1]
          dbg(`sample#${sampled} agent.status=${agent.status} events.len=${evs.length} lastType=${last?.type ?? '?'} lastSeq=${last?.seq ?? '?'}`)
          // v0.13 silence watchdog: if no model event at all after 12 samples (60s),
          // the model layer likely hung — end early instead of waiting 30min.
          if (sampled === 12 && evs.length === 0) {
            dbg('SILENCE WATCHDOG: no model events after 60s, aborting run')
            try { agent.cancel?.() } catch {}
          }
        } catch (e) {
          dbg('sample error: ' + (e as Error).message)
        }
      }, 5000)

      // Race: idle or timeout.
      let timer: NodeJS.Timeout | undefined
      const timedOut = new Promise<{ winner: 'timeout' }>((resolve) => {
        timer = setTimeout(() => resolve({ winner: 'timeout' }), timeoutMs)
      })
      const idleResult = agent.whenIdle().then(() => ({ winner: 'idle' as const }))
      const result = await Promise.race([idleResult, timedOut])
      clearInterval(sampler)
      if (timer) clearTimeout(timer)
      dbg('settled winner=' + result.winner)

      if (result.winner === 'timeout') {
        return {
          sessionId,
          workspacePath: cwd,
          status: 'timeout',
          summary: '',
          error: `goal run exceeded ${Math.round(timeoutMs / 60000)} minutes`,
          ms: Date.now() - started,
          ok: false,
        }
      }

      // Flush and summarize.
      const sessionsSvc: any = optional('sessions')
      try { await sessionsSvc?.flush?.(agent.session) } catch { /* best-effort */ }
      const events = agent.session.events ?? []
      const outcome = summarize(events, firstSeq)
      const failed = outcome.reason?.kind === 'error'
      const summary = tail(outcome.text || lastAssistantText)

      ;(ctx as any).logger?.info?.(`[reactor] goal settled: ${sessionId} status=${failed ? 'failed' : 'ok'} ms=${Date.now() - started}`)

      dbg(`goal settled tokens=${JSON.stringify(tokenAgg)}`)
      return {
        sessionId,
        workspacePath: cwd,
        status: failed ? 'failed' : 'ok',
        summary,
        ...(failed ? { error: `${outcome.reason?.error?.code ?? 'error'}: ${outcome.reason?.error?.message ?? ''}` } : {}),
        tokens: { ...tokenAgg, totalTokens: tokenAgg.inputTokens + tokenAgg.outputTokens + tokenAgg.cachedTokens + tokenAgg.reasoningTokens },
        ms: Date.now() - started,
        ok: !failed,
      }
    } finally {
      if (sessionEventOff) { try { sessionEventOff() } catch { /* ignore */ } }
      await handle.dispose().catch(() => {})
    }
  } catch (error) {
    return {
      sessionId,
      workspacePath: cwd,
      status: 'failed',
      summary: '',
      error: error instanceof Error ? error.message : String(error),
      tokens: { ...tokenAgg, totalTokens: tokenAgg.inputTokens + tokenAgg.outputTokens + tokenAgg.cachedTokens + tokenAgg.reasoningTokens },
      ms: Date.now() - started,
      ok: false,
    }
  }
}
