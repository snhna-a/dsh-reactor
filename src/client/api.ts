/**
 * dsh-reactor — browser REST client (v0.3 widget)
 *
 * Talks to the same-origin loopback API mounted by the host half
 * (default base /reactor/api). All payloads are plain JSON.
 */

export interface RuleSource {
  kind: 'http-poll' | 'file-watch' | 'command' | 'webhook'
  target: string
  intervalMs?: number
}

export interface RuleCondition {
  field: string
  op: 'eq' | 'ne' | 'gt' | 'lt' | 'gte' | 'lte' | 'contains' | 'matches' | 'exists' | 'changed'
  value?: unknown
}

export interface RuleAction {
  kind: 'shell' | 'webhook' | 'agent-talk'
  target: string
  session?: 'current' | 'new'
}

export interface Rule {
  id: string
  name: string
  description?: string
  source: RuleSource
  conditions: RuleCondition[]
  conditionLogic?: 'AND' | 'OR'
  actions: RuleAction[]
  cooldownMs?: number
  enabled: boolean
  lastTriggered?: number
  triggerCount?: number
  lastPayload?: unknown
}

export interface ActionAttempt {
  at: number
  ok: boolean
  error?: string
  ms: number
  sessionResult?: SessionResult
}

export interface ActionRun {
  kind: string
  target: string
  ok: boolean
  error?: string
  ms: number
  attempts?: number
  attemptLog?: ActionAttempt[]
}

export interface SessionResult {
  sessionId?: string
  workspacePath?: string
  ok: boolean
  error?: string
  ms: number
  tokens?: { input?: number; output?: number }
}

export interface TriggerRecord {
  id: string
  ruleId: string
  ruleName: string
  at: number
  matched: boolean
  actions?: ActionRun[]
  sessionResult?: SessionResult
}

export interface ReactorEvent {
  seq: number
  type: string
  at: number
  ruleId: string
  ruleName?: string
  matched?: boolean
  error?: string
  triggerCount?: number
  detail?: Record<string, unknown>
}

export interface Stats {
  totalRules: number
  enabledRules: number
  totalTriggers: number
  totalActions: number
  failedActions: number
  lastTriggerAt?: number
}

export interface RuleInput {
  name: string
  description?: string
  source_kind: RuleSource['kind']
  source_target: string
  source_interval_ms?: number
  conditions: RuleCondition[]
  condition_logic?: 'AND' | 'OR'
  actions: RuleAction[]
  cooldown_ms?: number
  enabled?: boolean
}

export class ReactorApi {
  constructor(private readonly base = '/reactor/api') {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.base}${path}`, {
      headers: { 'content-type': 'application/json' },
      ...init,
    })
    const text = await res.text()
    let body: unknown = {}
    if (text) {
      try {
        body = JSON.parse(text)
      } catch {
        body = { error: text.slice(0, 200) }
      }
    }
    if (!res.ok) {
      const msg = (body as { error?: string }).error ?? `HTTP ${res.status}`
      throw new Error(msg)
    }
    return body as T
  }

  listRules(): Promise<{ rules: Rule[] }> {
    return this.request('/rules')
  }

  createRule(input: RuleInput): Promise<{ rule_id: string; name: string }> {
    return this.request('/rules', { method: 'POST', body: JSON.stringify(input) })
  }

  updateRule(id: string, patch: Partial<Rule>): Promise<{ ok: boolean; rule?: Rule }> {
    return this.request('/rules', { method: 'PATCH', body: JSON.stringify({ id, patch }) })
  }

  deleteRule(id: string): Promise<{ removed: boolean }> {
    return this.request(`/rules?ruleId=${encodeURIComponent(id)}`, { method: 'DELETE' })
  }

  history(ruleId?: string, limit = 100): Promise<{ records: TriggerRecord[] }> {
    const q = new URLSearchParams()
    if (ruleId) q.set('ruleId', ruleId)
    q.set('limit', String(limit))
    return this.request(`/history?${q.toString()}`)
  }

  stats(): Promise<{ stats: Stats }> {
    return this.request('/stats')
  }

  events(since: number): Promise<{ seq: number; events: ReactorEvent[] }> {
    return this.request(`/events?since=${since}`)
  }
}
