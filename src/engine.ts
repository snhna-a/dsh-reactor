import type { Context } from '@deepseek-ai/cordis'
import { readFile } from 'node:fs/promises'
import { execa } from 'execa'
import type {
  ReactorRule,
  ReactorConfig,
  EventSource,
  Action,
  ActionAttempt,
  TriggerRecord,
  ActionRunRecord,
  ReactorEvent,
  ReactorStats,
  RunStep,
  AgentRunStatus,
} from './types.js'
import { evaluateAll } from './conditions.js'
import { runShellAction } from './actions/shell.js'
import { runWebhookAction } from './actions/webhook.js'
import { runAgentTalkAction } from './actions/agent-talk.js'
import { runGoalSession } from './goal-session.js'
import { RuleStore, HistoryStore } from './store.js'

/**
 * Core ECA (Event-Condition-Action) engine.
 *
 * Lifecycle:
 *   addRule → startSource (polling timer / webhook registration) → collectPayload → evaluate → executeActions
 *   removeRule → stopSource → persist
 *   dispose → persist + stop all sources + flush history
 *
 * v0.2.0 upgrades:
 *   - P0-1 rules persist to disk (survive restart)
 *   - P0-2 agent-talk creates a real isolated Agent Session
 *   - P1-1 every trigger is recorded to history
 *   - P1-2 webhook event source (push) added alongside polling sources
 */
/** v0.17 §10.3: classify failure for recovery decisions. */
function classifyFailure(err: string | undefined): 'transient' | 'repairable' | 'dangerous' {
  const e = (err ?? '').toLowerCase()
  if (/timeout|etimedout|econnreset|econnrefused|network|fetch failed|temporarily|overload|503|502|429/.test(e)) return 'transient'
  if (/security|policy|permission denied|unauthorized|forbidden|sandbox|danger|approval/.test(e)) return 'dangerous'
  return 'repairable'
}

export class ReactorEngine {
  private rules = new Map<string, ReactorRule>()
  private timers = new Map<string, NodeJS.Timeout>()
  private prevPayloads = new Map<string, unknown>()
  private ctx: Context
  private config: ReactorConfig
  private runningActions = 0
  private ruleStore: RuleStore
  private historyStore: HistoryStore
  private closed = false
  // v0.3: widget event stream (bounded ring buffer, monotonic seq).
  private eventSeq = 0
  private events: ReactorEvent[] = []
  // v0.6: overlap protection — one running goal/action per rule.
  private runningRules = new Set<string>()
  // v0.6: per-rule goal trigger sequence number (for session titles).
  private ruleSeq = new Map<string, number>()
  // v0.11: pending aggregation timers — ruleId -> { timer, latestPayload }
  private pendingAggregations = new Map<string, { timer: NodeJS.Timeout; payload: unknown }>()
  // v0.12: ruleIds whose high-risk approval has been granted (one-shot).
  private approvedRuns = new Set<string>()

  constructor(ctx: Context, config: ReactorConfig) {
    this.ctx = ctx
    this.config = config
    this.ruleStore = new RuleStore(config.storePath)
    this.historyStore = new HistoryStore(config.historyPath, config.maxHistoryEntries ?? 500)
  }

  // ─── Widget Event Stream (v0.3) ─────────────────────────────

  /** Append an event and return its sequence number. */
  private emitEvent(
    type: ReactorEvent['type'],
    data: { ruleId: string; ruleName?: string; matched?: boolean; error?: string; triggerCount?: number; detail?: Record<string, unknown> },
  ): number {
    const ev: ReactorEvent = {
      seq: ++this.eventSeq,
      type,
      at: Date.now(),
      ...data,
    }
    this.events.push(ev)
    if (this.events.length > 200) this.events.splice(0, this.events.length - 200)
    return ev.seq
  }

  /** Events after the given sequence (for incremental widget polling). */
  listEvents(since = 0): ReactorEvent[] {
    return this.events.filter((e) => e.seq > since)
  }

  /** Current event stream head sequence. */
  getEventSeq(): number {
    return this.eventSeq
  }

  // ─── Aggregated Stats (v0.3) ────────────────────────────────

  getStats(): ReactorStats {
    const rules = [...this.rules.values()]
    const history = this.historyStore.list()
    const triggered = history.filter((h) => h.matched)
    let totalActions = 0
    let failedActions = 0
    let lastTriggerAt: number | undefined
    for (const rec of triggered) {
      if (lastTriggerAt === undefined || rec.at > lastTriggerAt) lastTriggerAt = rec.at
      totalActions += rec.actions?.length ?? 0
      failedActions += rec.actions?.filter((a) => !a.ok).length ?? 0
    }
    return {
      totalRules: rules.length,
      enabledRules: rules.filter((r) => r.enabled).length,
      totalTriggers: triggered.length,
      totalActions,
      failedActions,
      lastTriggerAt,
    }
  }

  // ─── Persistence (P0-1) ─────────────────────────────────────

  /** Load persisted rules and (re)start their sources. */
  async loadPersisted(): Promise<number> {
    const rules = await this.ruleStore.load()
    for (const rule of rules) {
      this.rules.set(rule.id, rule)
      if (rule.enabled) this.startSource(rule)
    }
    await this.historyStore.load()
    if (rules.length > 0) {
      this.ctx.logger.info(`[reactor] restored ${rules.length} persisted rule(s)`)
    }
    return rules.length
  }

  private async persist(): Promise<void> {
    try {
      await this.ruleStore.save([...this.rules.values()])
    } catch (err) {
      this.ctx.logger.warn(`[reactor] rule persistence failed: ${err}`)
    }
  }

  // ─── Rule Management ────────────────────────────────────────

  addRule(rule: ReactorRule): void {
    this.rules.set(rule.id, rule)
    if (rule.enabled) {
      this.startSource(rule)
    }
    this.ctx.logger.info(`[reactor] rule added: ${rule.name} (${rule.id})`)
    this.emitEvent('rule-added', { ruleId: rule.id, ruleName: rule.name })
    void this.persist()
  }

  removeRule(id: string): boolean {
    const rule = this.rules.get(id)
    if (!rule) return false
    this.stopSource(id)
    this.rules.delete(id)
    this.prevPayloads.delete(id)
    this.ctx.logger.info(`[reactor] rule removed: ${id}`)
    this.emitEvent('rule-removed', { ruleId: id, ruleName: rule.name })
    void this.persist()
    return true
  }

  /**
   * Update a rule in place (enable/disable or edit definition).
   * The event source is restarted so interval/path changes take effect.
   * (v0.3)
   */
  updateRule(id: string, patch: Partial<ReactorRule>): boolean {
    const existing = this.rules.get(id)
    if (!existing) return false
    this.stopSource(id)
    const next: ReactorRule = {
      ...existing,
      ...patch,
      // never overwrite runtime state from the caller
      lastTriggered: existing.lastTriggered,
      lastPayload: existing.lastPayload,
      triggerCount: existing.triggerCount,
    }
    this.rules.set(id, next)
    if (next.enabled) this.startSource(next)
    this.ctx.logger.info(`[reactor] rule updated: ${next.name} (${id})`)
    this.emitEvent('rule-updated', { ruleId: id, ruleName: next.name })
    void this.persist()
    return true
  }

  listRules(): ReactorRule[] {
    return [...this.rules.values()]
  }

  getRule(id: string): ReactorRule | undefined {
    return this.rules.get(id)
  }

  /** v0.12: grant one-shot approval for a high-risk rule's next run. */
  approveRule(id: string): boolean {
    if (!this.rules.has(id)) return false
    this.approvedRuns.add(id)
    return true
  }

  // ─── History (P1-1) ─────────────────────────────────────────

  listHistory(ruleId?: string): TriggerRecord[] {
    return ruleId ? this.historyStore.listForRule(ruleId) : this.historyStore.list()
  }

  // ─── Webhook Event Source (P1-2) ────────────────────────────

  /**
   * Deliver an externally pushed payload (from the webhook ingress).
   * Only rules whose source.kind === 'webhook' are considered; their
   * source.target may optionally filter by path.
   */
  dispatchWebhook(payload: unknown, path?: string): number {
    let matched = 0
    for (const rule of this.rules.values()) {
      if (!rule.enabled || rule.source.kind !== 'webhook') continue
      if (path && rule.source.target && rule.source.target !== '/' && rule.source.target !== path) {
        continue
      }
      const prev = this.prevPayloads.get(rule.id)
      const ok = evaluateAll(
        rule.conditions,
        rule.conditionLogic ?? 'AND',
        payload,
        prev,
      )
      this.prevPayloads.set(rule.id, payload)
      if (ok) {
        void this.fire(rule, payload)
        matched++
      }
    }
    return matched
  }

  /**
   * Manually evaluate a rule with a given payload (for testing).
   * Returns whether conditions matched and how many actions ran.
   *
   * Mirrors the live poll path: the payload is remembered so the `changed`
   * operator compares against the previous test payload.
   */
  async testRule(
    id: string,
    payload: unknown,
  ): Promise<{ matched: boolean; actionsRun: number }> {
    const rule = this.rules.get(id)
    if (!rule) throw new Error(`rule not found: ${id}`)
    const matched = evaluateAll(
      rule.conditions,
      rule.conditionLogic ?? 'AND',
      payload,
      this.prevPayloads.get(id),
    )
    this.prevPayloads.set(id, payload)
    let actionsRun = 0
    if (matched) {
      if (rule.mode === 'goal' && rule.goal) {
        const testSeq = (this.ruleSeq.get(rule.id) ?? 0) + 1
        this.ruleSeq.set(rule.id, testSeq)
        const sessionResult = await this.executeGoal(rule, payload, testSeq)
        this.record(rule, true, [], sessionResult)
        actionsRun = sessionResult?.ok ? 1 : 0
      } else {
        const record = await this.executeActions(rule, payload)
        actionsRun = record.actions.filter((a) => a.ok).length
        this.record(rule, true, record.actions, record.sessionResult)
      }
    } else {
      this.record(rule, false)
    }
    return { matched, actionsRun }
  }

  // ─── Event Source Lifecycle ─────────────────────────────────

  private startSource(rule: ReactorRule): void {
    const { source } = rule
    // Webhook sources have no timer; they are driven by dispatchWebhook.
    if (source.kind === 'webhook') return

    const interval = source.intervalMs ?? this.config.defaultIntervalMs ?? 60_000

    const tick = async () => {
      if (this.closed) return
      try {
        const payload = await this.collectPayload(source)
        if (this.closed) return
        await this.evaluate(rule, payload)
      } catch (err) {
        this.ctx.logger.warn(
          `[reactor] rule "${rule.name}" (${rule.id}) source error: ${err}`,
        )
        this.emitEvent('rule-error', {
          ruleId: rule.id,
          ruleName: rule.name,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    // Fire immediately once, then on interval
    tick()
    const timer = setInterval(tick, interval)
    this.timers.set(rule.id, timer)
  }

  private stopSource(id: string): void {
    const timer = this.timers.get(id)
    if (timer) {
      clearInterval(timer)
      this.timers.delete(id)
    }
  }

  /** Collect data from a polling event source and return parsed payload. */
  private async collectPayload(source: EventSource): Promise<unknown> {
    switch (source.kind) {
      case 'http-poll': {
        const res = await fetch(source.target, {
          method: source.method ?? 'GET',
          headers: source.headers,
        })
        const contentType = res.headers.get('content-type') ?? ''
        if (contentType.includes('json')) {
          return res.json()
        }
        return res.text()
      }
      case 'command': {
        const { stdout } = await execa(source.target, { shell: true })
        try {
          return JSON.parse(stdout)
        } catch {
          return stdout
        }
      }
      case 'file-watch': {
        const content = await readFile(source.target, 'utf8')
        // Strip UTF-8 BOM (Windows PowerShell writes it by default).
        const clean = content.charCodeAt(0) === 0xFEFF ? content.slice(1) : content
        try {
          return JSON.parse(clean)
        } catch {
          return clean
        }
      }
      default:
        throw new Error(`unsupported source kind: ${(source as EventSource).kind}`)
    }
  }

  // ─── Evaluation & Action Execution ──────────────────────────

  private async evaluate(rule: ReactorRule, payload: unknown): Promise<void> {
    const prev = this.prevPayloads.get(rule.id)
    const matched = evaluateAll(
      rule.conditions,
      rule.conditionLogic ?? 'AND',
      payload,
      prev,
    )
    this.prevPayloads.set(rule.id, payload)

    if (!matched) {
      this.record(rule, false)
      return
    }

    // v0.11: event aggregation — coalesce multiple matches within a window.
    const aggWindow = rule.aggregationWindowMs ?? 0
    if (aggWindow > 0 && !this.runningRules.has(rule.id)) {
      const pending = this.pendingAggregations.get(rule.id)
      if (pending) {
        clearTimeout(pending.timer)
        pending.payload = payload
        return // wait for the window to fire with latest payload
      }
      const timer = setTimeout(() => {
        const pending = this.pendingAggregations.get(rule.id)
        this.pendingAggregations.delete(rule.id)
        void this.fire(rule, pending?.payload ?? payload)
      }, aggWindow)
      this.pendingAggregations.set(rule.id, { timer, payload })
      return
    }

    // Cooldown check
    const cooldown = rule.cooldownMs ?? 0
    if (cooldown > 0 && rule.lastTriggered) {
      if (Date.now() - rule.lastTriggered < cooldown) {
        this.ctx.logger.debug(
          `[reactor] rule "${rule.name}" suppressed by cooldown`,
        )
        this.record(rule, false)
        return
      }
    }

    // v0.12: approval gate — high-risk rules pause before running the Agent.
    if (rule.requireApproval && rule.riskLevel === 'high' && !this.approvedRuns.has(rule.id)) {
      const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      const nowIso = new Date().toISOString()
      const steps: RunStep[] = [
        { stepId: `${runId}_trigger`, type: 'trigger', status: 'succeeded', startedAt: nowIso, finishedAt: nowIso },
        { stepId: `${runId}_decision`, type: 'decision', status: 'succeeded', startedAt: nowIso, finishedAt: nowIso, summary: 'conditions matched, cooldown passed' },
        { stepId: `${runId}_approval`, type: 'approval', status: 'skipped', startedAt: nowIso, finishedAt: nowIso, summary: 'awaiting_approval: high-risk rule requires explicit approval' },
        { stepId: `${runId}_result`, type: 'result', status: 'skipped', startedAt: nowIso, finishedAt: nowIso, summary: 'blocked pending approval' },
      ]
      this.record(rule, true, [], { ok: false, ms: 0, status: 'failed', summary: 'awaiting_approval' }, 'skipped', payload, { runId, status: 'blocked', steps })
      this.emitEvent('rule-skipped', { ruleId: rule.id, ruleName: rule.name, detail: { reason: 'awaiting_approval', runId } })
      return
    }

    // v0.6: overlap protection — skip if this rule is already running.
    if (this.runningRules.has(rule.id)) {
      this.ctx.logger.debug(
        `[reactor] rule "${rule.name}" skipped (overlap: already running)`,
      )
      this.record(rule, false)
      this.emitEvent('rule-error', {
        ruleId: rule.id,
        ruleName: rule.name,
        error: 'skipped: previous run still in progress',
      })
      return
    }

    await this.fire(rule, payload)
  }

  /** A matched rule: update runtime state, execute actions or goal agent, record history. */
  private async fire(rule: ReactorRule, payload: unknown): Promise<void> {
    rule.lastTriggered = Date.now()
    rule.lastPayload = payload
    rule.triggerCount = (rule.triggerCount ?? 0) + 1
    // v0.6: increment per-rule seq for deterministic session titles.
    const seq = (this.ruleSeq.get(rule.id) ?? 0) + 1
    this.ruleSeq.set(rule.id, seq)
    // v0.6: mark as running for overlap protection.
    this.runningRules.add(rule.id)

    this.ctx.logger.info(
      `[reactor] rule "${rule.name}" triggered (count=${rule.triggerCount}, seq=${seq}, mode=${rule.mode ?? 'action'})`,
    )
    // v0.7: record the "running" milestone with the triggering payload so the
    // history shows exactly what event started this run.
    this.record(rule, true, [], undefined, 'running', payload)
    this.emitEvent('rule-triggered', {
      ruleId: rule.id,
      ruleName: rule.name,
      matched: true,
      triggerCount: rule.triggerCount,
      detail: rule.mode === 'goal' ? { mode: 'goal', goal: rule.goal?.slice(0, 100) } : undefined,
    })

    try {
      // v0.5: goal mode — spawn an isolated Agent Session that runs ReAct
      // autonomously to achieve the goal, instead of executing preset actions.
      if (rule.mode === 'goal' && rule.goal) {
        const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
        const startedIso = new Date().toISOString()
        const budget = rule.constraints?.budget ?? {}

        // v0.9 §8 Cost Router: cheap budget gate before spawning the Agent.
        const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0)
        const todayRuns = this.historyStore.list()
          .filter((r) => r.ruleId === rule.id && r.status === 'succeeded' && r.at >= dayStart.getTime()).length
        if (budget.maxRunsPerDay && todayRuns >= budget.maxRunsPerDay) {
          const steps: RunStep[] = [
            { stepId: `${runId}_trigger`, type: 'trigger', status: 'succeeded', startedAt: startedIso, finishedAt: startedIso },
            { stepId: `${runId}_decision`, type: 'decision', status: 'succeeded', startedAt: startedIso, finishedAt: startedIso, summary: 'conditions matched, cooldown passed' },
            { stepId: `${runId}_approval`, type: 'approval', status: 'succeeded', startedAt: startedIso, finishedAt: startedIso, summary: 'no approval required' },
            { stepId: `${runId}_budget`, type: 'decision', status: 'failed', startedAt: startedIso, finishedAt: startedIso, summary: `budget_exceeded: todayRuns=${todayRuns} >= max=${budget.maxRunsPerDay}` },
            { stepId: `${runId}_result`, type: 'result', status: 'skipped', startedAt: startedIso, finishedAt: startedIso, summary: 'blocked by budget gate' },
          ]
          this.record(rule, true, [], { ok: false, ms: 0, status: 'failed', summary: 'skipped: budget_exceeded' }, 'skipped', payload, { runId, status: 'blocked', steps })
          this.emitEvent('rule-skipped', { ruleId: rule.id, ruleName: rule.name, detail: { reason: 'budget_exceeded' } })
          return
        }

        // v0.9 §10 retry loop: up to maxRetries on failure.
        // v0.18: transient errors get one free auto-retry even when maxRetries=0.
        const maxRetries = budget.maxRetries ?? 0
        let sessionResult: Awaited<ReturnType<typeof this.executeGoal>> | undefined
        let attempt = 0
        let lastError: string | undefined
        let transientRetried = false
        const retrySteps: RunStep[] = []
        do {
          sessionResult = await this.executeGoal(rule, payload, seq)
          if (sessionResult?.ok) break
          lastError = sessionResult?.error ?? sessionResult?.summary?.slice(0, 200) ?? 'unknown'
          if (attempt < maxRetries) {
            retrySteps.push({ stepId: `${runId}_retry_${attempt}`, type: 'retry', status: 'failed', startedAt: new Date().toISOString(), summary: `attempt ${attempt + 1} failed: ${lastError.slice(0, 120)}` })
          } else if (!transientRetried && classifyFailure(lastError) === 'transient') {
            // v0.18: free retry for transient errors (network blip, timeout).
            transientRetried = true
            retrySteps.push({ stepId: `${runId}_retry_transient`, type: 'retry', status: 'failed', startedAt: new Date().toISOString(), summary: `transient error, auto-retry: ${lastError.slice(0, 100)}` })
          }
          attempt++
        } while (attempt <= maxRetries || (!transientRetried && classifyFailure(lastError ?? '') === 'transient' && !sessionResult?.ok))

        const ok = sessionResult?.ok ?? false
        const endedIso = new Date().toISOString()

        // v0.16 §10.2: deterministic verification (not LLM self-judgment).
        let verifyStep: RunStep | undefined
        let verified = ok
        if (ok && rule.constraints?.verify) {
          const v = rule.constraints.verify
          const vStart = Date.now()
          try {
            if (v.type === 'file-exists') {
              const fs = await import('node:fs')
              const cwd = rule.constraints?.workingDir ?? process.cwd()
              const resolved = require('node:path').resolve(cwd, v.path)
              const exists = fs.existsSync(resolved)
              verified = exists
              verifyStep = {
                stepId: `${runId}_verify`, type: 'verify',
                status: exists ? 'succeeded' : 'failed',
                startedAt: new Date(vStart).toISOString(), finishedAt: new Date().toISOString(),
                durationMs: Date.now() - vStart,
                summary: exists ? `file exists: ${v.path}` : `file MISSING: ${v.path}`,
              }
            } else if (v.type === 'command') {
              const { execa } = await import('execa')
              const r = await execa(v.cmd, { shell: true, timeout: v.timeoutMs ?? 15000, reject: false })
              verified = r.exitCode === 0
              verifyStep = {
                stepId: `${runId}_verify`, type: 'verify',
                status: r.exitCode === 0 ? 'succeeded' : 'failed',
                startedAt: new Date(vStart).toISOString(), finishedAt: new Date().toISOString(),
                durationMs: Date.now() - vStart,
                summary: verified ? `verify cmd exit 0` : `verify cmd exit ${r.exitCode}: ${(r.stderr ?? r.stdout ?? '').slice(0, 150)}`,
              }
            }
          } catch (e: any) {
            verified = false
            verifyStep = {
              stepId: `${runId}_verify`, type: 'verify', status: 'failed',
              startedAt: new Date(vStart).toISOString(), finishedAt: new Date().toISOString(),
              summary: 'verify error: ' + String(e?.message ?? e).slice(0, 150),
            }
          }
        }

        const steps: RunStep[] = [
          { stepId: `${runId}_trigger`, type: 'trigger', status: 'succeeded', startedAt: startedIso, finishedAt: startedIso },
          { stepId: `${runId}_decision`, type: 'decision', status: 'succeeded', startedAt: startedIso, finishedAt: startedIso, summary: 'conditions matched, cooldown passed' },
          { stepId: `${runId}_approval`, type: 'approval', status: 'succeeded', startedAt: startedIso, finishedAt: startedIso, summary: rule.requireApproval && rule.riskLevel === 'high' ? 'pre-approved' : 'no approval required' },
          { stepId: `${runId}_budget`, type: 'decision', status: 'succeeded', startedAt: startedIso, finishedAt: startedIso, summary: `within budget (todayRuns=${todayRuns}${budget.maxRunsPerDay ? `/${budget.maxRunsPerDay}` : '/∞'})` },
          ...retrySteps,
          { stepId: `${runId}_agent`, type: 'agent', status: ok ? 'succeeded' : 'failed', startedAt: startedIso, finishedAt: endedIso, durationMs: sessionResult?.ms, summary: sessionResult?.summary?.slice(0, 200), error: sessionResult?.error, tokenUsage: sessionResult?.tokens },
          ...(verifyStep ? [verifyStep] : []),
          { stepId: `${runId}_result`, type: 'result', status: verified ? 'succeeded' : 'failed', startedAt: endedIso, finishedAt: endedIso, summary: !verified && verifyStep ? 'failed verification' : undefined },
        ]
        const failClass = !verified ? classifyFailure(verifyStep && !ok ? verifyStep.summary : (sessionResult?.error ?? lastError)) : undefined
        this.record(rule, true, [], sessionResult, verified ? 'completed' : 'failed', payload, { runId, status: verified ? 'succeeded' : 'failed', steps, ...(failClass ? { failureClass: failClass } : {}) })
        // v0.10: update per-rule state for the next Agent run.
        const now = Date.now()
        const st = rule.ruleState ?? { consecutiveFailures: 0, failureCount: 0, successCount: 0 }
        if (verified) {
          st.lastSuccessAt = now
          st.lastSuccessRunId = runId
          st.consecutiveFailures = 0
          st.successCount = (st.successCount ?? 0) + 1
          st.lastSummary = sessionResult?.summary?.slice(0, 500)
          st.lastRunStatus = 'succeeded'
        } else {
          st.lastFailureAt = now
          st.lastFailureReason = verifyStep && !ok ? (verifyStep.summary ?? 'verification failed') : (lastError ?? sessionResult?.summary?.slice(0, 200) ?? 'unknown')
          st.consecutiveFailures = (st.consecutiveFailures ?? 0) + 1
          st.failureCount = (st.failureCount ?? 0) + 1
          st.lastSummary = sessionResult?.summary?.slice(0, 500)
          st.lastRunStatus = sessionResult?.error?.includes('timeout') ? 'timeout' : 'failed'
        }
        rule.ruleState = st
        this.emitEvent(verified ? 'rule-completed' : 'rule-error', {
          ruleId: rule.id,
          ruleName: rule.name,
          detail: {
            sessionId: sessionResult?.sessionId,
            summary: sessionResult?.summary?.slice(0, 200),
            error: sessionResult?.error,
            ms: sessionResult?.ms,
            retries: attempt,
          },
        })
      } else {
        const run = await this.executeActions(rule, payload)
        const ok = run.actions.every((a) => a.ok)
        this.record(rule, true, run.actions, run.sessionResult, ok ? 'completed' : 'failed')
      }
    } catch (err) {
      this.ctx.logger.error(`[reactor] rule "${rule.name}" execution error: ${String(err)}`)
      this.record(rule, true, [], {
        ok: false,
        sessionId: '',
        workspacePath: '',
        status: 'failed' as const,
        summary: '',
        error: err instanceof Error ? err.message : String(err),
        ms: Date.now() - rule.lastTriggered,
      }, 'failed')
    } finally {
      this.runningRules.delete(rule.id)
    }
    void this.persist()
  }

  /**
   * Goal-mode execution: spawn an isolated Agent Session with the goal
   * prompt + event payload + constraints. Waits for the Agent to settle
   * (idle or timeout), then returns the summary.
   */
  private async executeGoal(
    rule: ReactorRule,
    payload: unknown,
    seq: number,
  ): Promise<TriggerRecord['sessionResult']> {
    if (this.config.allowAgentSession === false) {
      return {
        ok: false,
        ms: 0,
        error: 'goal mode blocked by config (allowAgentSession=false)',
      }
    }
    if (!rule.goal) {
      return {
        ok: false,
        ms: 0,
        error: 'goal mode requires a non-empty goal field',
      }
    }
    // v0.10: inject per-rule run history so the Agent is stateful.
    // v0.15: also inject lastSummary so the Agent knows what it did last time (resume).
    const st = rule.ruleState
    let goalPrompt = rule.goal
    if (st && ((st.consecutiveFailures ?? 0) > 0 || st.lastFailureReason || st.lastSuccessAt || st.lastSummary)) {
      const hist = [
        st.lastSuccessAt ? `上次成功: ${new Date(st.lastSuccessAt).toISOString()} (run ${st.lastSuccessRunId ?? '?'})` : null,
        st.lastFailureReason ? `上次失败: ${st.lastFailureReason.slice(0, 200)}` : null,
        (st.consecutiveFailures ?? 0) > 0 ? `连续失败次数: ${st.consecutiveFailures}` : null,
        st.lastSummary ? `上次执行摘要: ${st.lastSummary.slice(0, 400)}` : null,
        st.lastRunStatus ? `上次状态: ${st.lastRunStatus}` : null,
      ].filter(Boolean).join('\n')
      goalPrompt = `${rule.goal}\n\n---\n历史运行状态（上次执行情况，供你判断是否需要换策略或继续未完成的工作）:\n${hist}`
    }
    const result = await runGoalSession(this.ctx, {
      ruleName: rule.name,
      ruleId: rule.id,
      seq,
      payload,
      goal: goalPrompt,
      constraints: rule.constraints,
    })
    // Adapt GoalRunResult → SessionRunResult.
    return {
      sessionId: result.sessionId || undefined,
      workspacePath: result.workspacePath || undefined,
      ok: result.status === 'ok',
      status: result.status,
      summary: result.summary || undefined,
      error: result.error,
      tokens: result.tokens,
      ms: result.ms,
    }
  }

  private async executeActions(
    rule: ReactorRule,
    payload: unknown,
  ): Promise<{ actions: ActionRunRecord[]; sessionResult?: TriggerRecord['sessionResult'] }> {
    const maxConcurrent = this.config.maxConcurrentActions ?? 3
    const records: ActionRunRecord[] = []
    let sessionResult: TriggerRecord['sessionResult']

    if (this.runningActions >= maxConcurrent) {
      this.ctx.logger.warn(
        `[reactor] rule "${rule.name}" actions skipped: max concurrent (${maxConcurrent}) reached`,
      )
      return { actions: records }
    }

    const maxRetries = this.config.maxRetries ?? 3
    const baseDelay = this.config.retryDelayMs ?? 1000

    for (const action of rule.actions) {
      this.runningActions++
      const started = Date.now()
      const attemptLog: ActionAttempt[] = []
      try {
        // v0.3: retry with exponential backoff until success or maxRetries exhausted.
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
          const once = await this.runActionOnce(rule, action, payload)
          attemptLog.push({ at: attempt, ...once })
          if (once.ok) break
          if (attempt < maxRetries) {
            const delay = baseDelay * 2 ** attempt
            await new Promise((resolve) => setTimeout(resolve, delay))
          }
        }
        const last = attemptLog[attemptLog.length - 1]
        const record: ActionRunRecord = {
          kind: action.kind,
          target: action.target,
          ok: last.ok,
          error: last.error,
          ms: Date.now() - started,
          attempts: attemptLog.length,
          ...(attemptLog.length > 1 || !last.ok ? { attemptLog } : {}),
        }
        records.push(record)
        if (!record.ok) {
          this.emitEvent('action-failed', {
            ruleId: rule.id,
            ruleName: rule.name,
            error: record.error,
          })
        }
        if (action.kind === 'agent-talk' && sessionResult === undefined && last.sessionResult) {
          sessionResult = last.sessionResult
        }
      } finally {
        this.runningActions--
      }
    }
    return { actions: records, sessionResult }
  }

  /** Run one action once. Returns ok/error/duration (+ agent session result). */
  private async runActionOnce(
    rule: ReactorRule,
    action: Action,
    payload: unknown,
  ): Promise<{ ok: boolean; error?: string; ms: number; sessionResult?: TriggerRecord['sessionResult'] }> {
    const started = Date.now()
    try {
      switch (action.kind) {
        case 'shell':
          if (this.config.allowShell !== false) {
            await runShellAction(action, payload)
          } else {
            return { ok: false, error: 'shell action blocked by config (allowShell=false)', ms: Date.now() - started }
          }
          break
        case 'webhook':
          await runWebhookAction(action, payload)
          break
        case 'agent-talk':
          // P0-2: real isolated session when allowed & services present;
          // otherwise falls back to event broadcast.
          if (this.config.allowAgentSession !== false) {
            const result = await runAgentTalkAction(this.ctx, action, payload, {
              workspaceDir: this.config.agentWorkspaceDir,
              agentPreset: this.config.agentPreset,
              permissionPreset: this.config.permissionPreset,
              ruleName: rule.name,
              ruleId: rule.id,
            })
            return { ok: result.ok, error: result.error, ms: result.ms, sessionResult: result }
          }
          await runAgentTalkAction(this.ctx, action, payload, { enableSession: false })
          break
      }
      return { ok: true, ms: Date.now() - started }
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        ms: Date.now() - started,
      }
    }
  }

  /** Append one trigger to the history store. */
  private record(
    rule: ReactorRule,
    matched: boolean,
    actions?: ActionRunRecord[],
    sessionResult?: TriggerRecord['sessionResult'],
    phase?: TriggerRecord['phase'],
    payload?: unknown,
    extra?: { runId?: string; status?: AgentRunStatus; steps?: RunStep[]; failureClass?: 'transient' | 'repairable' | 'dangerous' },
  ): void {
    this.historyStore.append({
      id: `trig_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      ruleId: rule.id,
      ruleName: rule.name,
      at: Date.now(),
      matched,
      ...(phase ? { phase } : {}),
      ...(extra?.runId ? { runId: extra.runId } : {}),
      ...(extra?.status ? { status: extra.status } : {}),
      ...(extra?.steps ? { steps: extra.steps } : {}),
      ...(extra?.failureClass ? { failureClass: extra.failureClass } : {}),
      ...(payload !== undefined ? { payload: this.truncatePayload(payload) } : {}),
      ...(actions && actions.length > 0 ? { actions } : {}),
      ...(sessionResult ? { sessionResult } : {}),
    })
  }

  /** Keep stored payloads compact for history. */
  private truncatePayload(payload: unknown): unknown {
    try {
      const s = JSON.stringify(payload)
      if (s.length <= 2000) return payload
      return { _truncated: true, preview: s.slice(0, 2000) }
    } catch {
      return String(payload).slice(0, 500)
    }
  }

  // ─── Disposal ───────────────────────────────────────────────

  /** Stop all timers, clear rules, flush pending writes. Called on unload. */
  async dispose(): Promise<void> {
    this.closed = true
    for (const timer of this.timers.values()) {
      clearInterval(timer)
    }
    this.timers.clear()
    // Persist current rules BEFORE clearing them, so a stop/restart restores them.
    try {
      await this.persist()
      await this.historyStore.flush()
    } catch {
      // best-effort
    }
    this.rules.clear()
    this.prevPayloads.clear()
    this.events = []
    this.ctx.logger.info('[reactor] engine disposed, all rules and timers cleared')
  }
}
