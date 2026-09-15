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

// ─── Goal-driven ReAct Mode (v0.5) ──────────────────────────────

/**
 * Constraints for a goal-driven Agent execution.
 * The Agent runs in ReAct mode inside an isolated DSH Session; these
 * constraints bound its autonomy so it doesn't run forever or touch
 * resources outside the intended scope.
 */
export interface GoalConstraints {
  /** Working directory for the Agent (shell cwd). Default: rule workspace. */
  workingDir?: string
  /** Maximum ReAct steps before the Agent is asked to wrap up. Default 20. */
  maxSteps?: number
  /** Wall-clock timeout in minutes. Default 30. */
  timeoutMinutes?: number
  /** Tool kinds the Agent is allowed to use. Default: all available. */
  allowedTools?: string[]
  /** v0.9: Budget gate — max agent runs & tokens, retry limit. */
  budget?: BudgetConstraints
  /** v0.12.3: capabilities this run requires; preflight blocks if host lacks them. */
  requiredCapabilities?: CapabilityKind[]
  /** v0.16: deterministic verification checks (not LLM self-judgment). */
  verify?: VerifyCheck
}

/** v0.16: deterministic post-run verification. */
export type VerifyCheck =
  | { type: 'file-exists'; path: string }
  | { type: 'command'; cmd: string; timeoutMs?: number }

/** v0.17: failure classification for recovery decisions. */
export type FailureClass = 'transient' | 'repairable' | 'dangerous'

/** v0.9 §8/§10: cost & retry guardrails. */
export interface BudgetConstraints {
  /** Max total tokens per single run (hard stop after settle). Default 0 = no cap. */
  maxTokensPerRun?: number
  /** Max agent runs per calendar day. Default 0 = no cap. */
  maxRunsPerDay?: number
  /** Max retry attempts on failure (0 = no retry). Default 0. */
  maxRetries?: number
  /** Wall-clock hard cap per run in ms. Default 0 = use timeoutMinutes. */
  maxRuntimeMs?: number
}

// ─── Runtime Capability Preflight (v0.12.3) ───────────────────

/** Capabilities the host must provide for a goal run to be meaningful. */
export type CapabilityKind =
  | 'workspace'
  | 'filesystemRead'
  | 'filesystemWrite'
  | 'shell'
  | 'git'
  | 'network'

/** Snapshot of what the host can actually do right now. */
export interface RuntimeCapabilities {
  workspace: boolean
  filesystemRead: boolean
  filesystemWrite: boolean
  shell: boolean
  git: boolean
  network: boolean
  /** Human-readable notes per failed capability. */
  notes?: Partial<Record<CapabilityKind, string>>
}

/** Result of a preflight check: either pass or block with missing caps. */
export interface PreflightResult {
  ok: boolean
  /** Present when ok=false — capabilities the rule needs but host lacks. */
  missing?: CapabilityKind[]
  /** Present when ok=false — machine-readable reason code. */
  reason?: string
  /** Full capability snapshot for the run trace. */
  caps?: RuntimeCapabilities
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
  /**
   * Execution mode.
   * - 'action' (default): run the preset `actions` list (legacy mode).
   * - 'goal': ignore `actions`; instead spawn an isolated Agent Session,
   *   inject the event payload + `goal` description, and let the Agent
   *   run ReAct autonomously until the goal is reached or constraints hit.
   */
  mode?: 'action' | 'goal'
  /** Actions to execute when conditions match (action mode only) */
  actions: Action[]
  /** Goal description for goal mode (natural language, e.g. "pull code and run tests") */
  goal?: string
  /** Constraints for goal-mode Agent execution */
  constraints?: GoalConstraints
  /** Cooldown in ms after a trigger before next can fire. Default 0 */
  cooldownMs?: number
  /** v0.11: aggregation window in ms — multiple matches within this window coalesce into one run using the latest payload. Default 0 = off. */
  aggregationWindowMs?: number
  /** v0.12: risk level — high-risk rules require explicit approval before the Agent runs. */
  riskLevel?: 'low' | 'medium' | 'high'
  /** v0.12: when true, a matched rule enters blocked/awaiting_approval instead of running the Agent. */
  requireApproval?: boolean
  /** Whether the rule is active */
  enabled: boolean
  // ── runtime state (not persisted) ──
  lastTriggered?: number
  lastPayload?: unknown
  triggerCount?: number
  /** v0.10: persisted per-rule run history for stateful Agent resume. */
  ruleState?: ReactorRuleState
}

/** v0.10 §11: per-rule state visible to the next Agent run. */
export interface ReactorRuleState {
  lastSuccessAt?: number
  lastSuccessRunId?: string
  lastFailureAt?: number
  lastFailureReason?: string
  consecutiveFailures: number
  failureCount: number
  successCount: number
  /** v0.15: summary of the last run (what the Agent reported) — injected on re-trigger for resume. */
  lastSummary?: string
  /** v0.15: status of the last run (succeeded/failed/timeout/blocked). */
  lastRunStatus?: 'succeeded' | 'failed' | 'timeout' | 'blocked'
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
  /** Execution phase for goal mode (v0.7): running → completed/failed. */
  phase?: 'matched' | 'running' | 'completed' | 'failed' | 'skipped'
  /** AgentRun lifecycle status (v0.8): every run must end in succeeded/failed/blocked/cancelled. */
  status?: AgentRunStatus
  /** Unique AgentRun id (v0.8). */
  runId?: string
  /** Snapshot of the event payload that triggered this. */
  payload?: unknown
  /** Only when matched. */
  actions?: ActionRunRecord[]
  /** Result of an agent session execution, when the action was agent-talk. */
  sessionResult?: SessionRunResult
  /** Ordered run steps explaining why and how this run happened (v0.8). */
  steps?: RunStep[]
  /** v0.17: failure classification for recovery decisions. */
  failureClass?: 'transient' | 'repairable' | 'dangerous'
}

/** AgentRun lifecycle status (v0.8 §6). */
export type AgentRunStatus =
  | 'created'
  | 'queued'
  | 'running'
  | 'verifying'
  | 'succeeded'
  | 'failed'
  | 'blocked'
  | 'cancelled'

/** A single step in a run trace (v0.8 §16.1). */
export interface RunStep {
  stepId: string
  type: 'trigger' | 'decision' | 'agent' | 'tool' | 'verify' | 'retry' | 'approval' | 'result'
  status: 'started' | 'succeeded' | 'failed' | 'skipped'
  /** ISO timestamp. */
  startedAt: string
  finishedAt?: string
  durationMs?: number
  summary?: string
  error?: string
  /** Token usage for agent/verify steps. */
  tokenUsage?: { inputTokens: number; outputTokens: number; cachedTokens: number; reasoningTokens: number; totalTokens: number }
}

/** Outcome of a real agent session execution. */
export interface SessionRunResult {
  sessionId?: string
  workspacePath?: string
  ok: boolean
  error?: string
  ms: number
  /** Token usage when the host session exposes it. (v0.3) */
  tokens?: { inputTokens: number; outputTokens: number; cachedTokens: number; reasoningTokens: number; totalTokens: number }
  /** Settled run status (v0.6): 'ok' | 'failed' | 'timeout' */
  status?: 'ok' | 'failed' | 'timeout'
  /** Final assistant message summary (v0.6) */
  summary?: string
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
  | 'rule-completed'
  | 'rule-error'
  | 'rule-skipped'
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
