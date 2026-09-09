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
} from './types.js'
import { evaluateAll } from './conditions.js'
import { runShellAction } from './actions/shell.js'
import { runWebhookAction } from './actions/webhook.js'
import { runAgentTalkAction } from './actions/agent-talk.js'
import { RuleStore, HistoryStore } from './store.js'

/**
 * Core ECA (Event-Condition-Action) engine.
 *
 * Lifecycle:
 *   addRule → startSource (polling timer / webhook registration) → collectPayload → evaluate → executeActions
 *   removeRule → stopSource → persist
 *   dispose → persist + stop all sources + flush history
 */
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

  constructor(ctx: Context, config: ReactorConfig) {
    this.ctx = ctx
    this.config = config
    this.ruleStore = new RuleStore(config.storePath)
    this.historyStore = new HistoryStore(config.historyPath, config.maxHistoryEntries ?? 500)
  }

  // ─── Widget Event Stream (v0.3) ────────────────────────────────────────────

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

  // ─── Aggregated Stats (v0.3) ───────────────────────────────────────────────

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

  // ─── Persistence (P0-1) ────────────────────────────────────────────────────

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

  // ─── Rule Management ───────────────────────────────────────────────────────

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

  // ─── History (P1-1) ────────────────────────────────────────────────────────

  listHistory(ruleId?: string): TriggerRecord[] {
    return ruleId ? this.historyStore.listForRule(ruleId) : this.historyStore.list()
  }

  // ─── Webhook Event Source (P1-2) ───────────────────────────────────────────

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
      const record = await this.executeActions(rule, payload)
      actionsRun = record.actions.filter((a) => a.ok).length
      this.record(rule, true, record.actions, record.sessionResult)
    } else {
      this.record(rule, false)
    }
    return { matched, actionsRun }
  }

  // ─── Event Source Lifecycle ────────────────────────────────────────────────

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
        try {
          return JSON.parse(content)
        } catch {
          return content
        }
      }
      default:
        throw new Error(`unsupported source kind: ${(source as EventSource).kind}`)
    }
  }

  // ─── Evaluation & Action Execution ─────────────────────────────────────────

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

    await this.fire(rule, payload)
  }

  /** A matched rule: update runtime state, execute actions, record history. */
  private async fire(rule: ReactorRule, payload: unknown): Promise<void> {
    rule.lastTriggered = Date.now()
    rule.lastPayload = payload
    rule.triggerCount = (rule.triggerCount ?? 0) + 1

    this.ctx.logger.info(
      `[reactor] rule "${rule.name}" triggered (count=${rule.triggerCount})`,
    )
    this.emitEvent('rule-triggered', {
      ruleId: rule.id,
      ruleName: rule.name,
      matched: true,
      triggerCount: rule.triggerCount,
    })

    const run = await this.executeActions(rule, payload)
    this.record(rule, true, run.actions, run.sessionResult)
    void this.persist()
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
  ): void {
    this.historyStore.append({
      id: `trig_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      ruleId: rule.id,
      ruleName: rule.name,
      at: Date.now(),
      matched,
      ...(actions && actions.length > 0 ? { actions } : {}),
      ...(sessionResult ? { sessionResult } : {}),
    })
  }

  // ─── Disposal ──────────────────────────────────────────────────────────────

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
