/**
 * dsh-reactor — Event-Condition-Action rule engine for DeepSeek Harness
 * Type definitions for the entire plugin.
 */

// ─── Event Source ───────────────────────────────────────────────

export type EventSourceKind = 'http-poll' | 'file-watch' | 'command' | 'webhook'

export interface EventSource {
  kind: EventSourceKind
  /** http-poll: URL to poll; file-watch: file path; command: shell command; webhook: endpoint path */
  target: string
  /** Poll interval in ms (http-poll / command only). Default 60000. */
  intervalMs?: number
  /** Optional HTTP headers for http-poll. */
  headers?: Record<string, string>
  /** Optional HTTP method for http-poll. Default GET. */
  method?: 'GET' | 'POST'
}

// ─── Condition ──────────────────────────────────────────────────

export type ConditionOp =
  | 'eq' | 'ne' | 'gt' | 'lt' | 'gte' | 'lte'
  | 'contains' | 'matches' | 'exists' | 'changed'

export interface Condition {
  /** JSONPath expression to extract value from event payload, e.g. "$.status" */
  field: string
  op: ConditionOp
  /** Comparison value; not needed for 'exists' / 'changed' */
  value?: unknown
}

// ─── Action ─────────────────────────────────────────────────────

export type ActionKind = 'shell' | 'webhook' | 'agent-talk'

export interface Action {
  kind: ActionKind
  /** shell: command; webhook: URL; agent-talk: prompt text */
  target: string
  /** webhook: extra JSON payload fields; shell: not used */
  payload?: Record<string, unknown>
  /** agent-talk: which session to inject into */
  session?: 'current' | 'new'
}

// ─── Rule ───────────────────────────────────────────────────────

export interface ReactorRule {
  id: string
  name: string
  description?: string
  source: EventSource
  /** List of conditions; combined by conditionLogic */
  conditions: Condition[]
  /** How to combine multiple conditions. Default 'AND' */
  conditionLogic?: 'AND' | 'OR'
  /** Actions to execute when conditions match */
  actions: Action[]
  /** Cooldown in ms after a trigger before next can fire. Default 0 */
  cooldownMs?: number
  /** Whether the rule is active */
  enabled: boolean
  // ── runtime state (not persisted) ──
  lastTriggered?: number
  lastPayload?: unknown
  triggerCount?: number
}

// ─── Execution History ──────────────────────────────────────────

/** One attempt of an action (present when an action retried or failed). */
export interface ActionAttempt {
  /** 0-based attempt index. */
  at: number
  ok: boolean
  /** Error message when this attempt failed. */
  error?: string
  /** Duration of this attempt in milliseconds. */
  ms: number
  /** Agent session result, only on the final attempt of an agent-talk action. */
  sessionResult?: SessionRunResult
}

/** Outcome of one action within a rule trigger. */
export interface ActionRunRecord {
  kind: ActionKind
  target: string
  ok: boolean
  /** Error message when the action failed; omitted on success. */
  error?: string
  /** Action duration in milliseconds. */
  ms: number
  /** Total attempts taken (1 = first try, >1 = retried). (v0.3) */
  attempts?: number
  /** Per-attempt details, present when the action retried or failed. (v0.3) */
  attemptLog?: ActionAttempt[]
}

/** One recorded rule trigger. */
export interface TriggerRecord {
  id: string
  ruleId: string
  ruleName: string
  /** Unix epoch milliseconds. */
  at: number
  matched: boolean
  /** Only when matched. */
  actions?: ActionRunRecord[]
  /** Result of an agent session execution, when the action was agent-talk. */
  sessionResult?: SessionRunResult
}

/** Outcome of a real agent session execution (agent-talk upgraded). */
export interface SessionRunResult {
  sessionId?: string
  workspacePath?: string
  ok: boolean
  error?: string
  ms: number
  /** Token usage when the host session exposes it. (v0.3) */
  tokens?: { input?: number; output?: number }
}

// ─── Persistence ────────────────────────────────────────────────

export interface PersistedState {
  version: 1
  /** Durable rule definitions. Runtime state fields are stripped. */
  rules: PersistedRule[]
}

/** A rule as stored on disk: no runtime state. */
export type PersistedRule = Omit<ReactorRule, 'lastTriggered' | 'lastPayload' | 'triggerCount'>

// ─── Plugin Config ──────────────────────────────────────────────

export interface ReactorConfig {
  /** Whether shell actions are allowed. Default true. */
  allowShell?: boolean
  /** Maximum number of concurrent actions across all rules. Default 3. */
  maxConcurrentActions?: number
  /** Default poll interval in ms for sources that don't specify one. Default 60000. */
  defaultIntervalMs?: number
  /** Static rules defined in config (loaded at startup). */
  rules?: ReactorRule[]
  /** Rules store file path. Default $DSH_HOME/reactor/rules.json */
  storePath?: string
  /** History store file path. Default $DSH_HOME/reactor/history.jsonl */
  historyPath?: string
  /** Max history entries kept in memory & on disk. Default 500. */
  maxHistoryEntries?: number
  /** Webhook ingress path. Default /reactor/webhook */
  webhookPath?: string
  /** Shared token required in x-reactor-token header when set. */
  webhookToken?: string
  /** Whether agent-talk actions create real sessions. Default true. */
  allowAgentSession?: boolean
  /** Workspace directory for agent sessions created by agent-talk. Default $DSH_HOME/reactor/workspaces/<ruleId> */
  agentWorkspaceDir?: string
  /** Agent preset for created sessions. Default 'standard'. */
  agentPreset?: string
  /** Permission preset for created sessions. Default 'workspace-write'. */
  permissionPreset?: string
  /** Max retries for a failed action before it is recorded as failed. Default 3. (v0.3) */
  maxRetries?: number
  /** Base delay between retries (exponential backoff: 2^n * retryDelayMs). Default 1000. (v0.3) */
  retryDelayMs?: number
  /** REST API path prefix exposed to the widget. Default /reactor/api. (v0.3) */
  apiPath?: string
  /** Whether the widget UI + REST API are enabled. Default true. (v0.3) */
  uiEnabled?: boolean
}

// ─── Widget / API (v0.3) ────────────────────────────────────────

export type ReactorEventType =
  | 'rule-added'
  | 'rule-updated'
  | 'rule-removed'
  | 'rule-triggered'
  | 'rule-error'
  | 'action-failed'

/** One entry in the engine's event stream (drives widget notifications). */
export interface ReactorEvent {
  /** Monotonic sequence number for incremental polling. */
  seq: number
  type: ReactorEventType
  /** Unix epoch milliseconds. */
  at: number
  ruleId: string
  ruleName?: string
  /** Whether the rule conditions matched (rule-triggered only). */
  matched?: boolean
  /** Error message (rule-error / action-failed). */
  error?: string
  /** Trigger count after this event (rule-triggered only). */
  triggerCount?: number
  /** Extra safe detail (never the raw event payload). */
  detail?: Record<string, unknown>
}

/** Aggregated usage numbers for the widget overview tab. */
export interface ReactorStats {
  totalRules: number
  enabledRules: number
  totalTriggers: number
  totalActions: number
  failedActions: number
  lastTriggerAt?: number
}
