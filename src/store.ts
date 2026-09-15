/**
 * dsh-reactor — persistence layer (P0-1: rules survive restarts; P1-1: history log)
 *
 * - Rules are persisted as a JSON document. Runtime-only fields
 *   (lastTriggered / lastPayload / triggerCount) are stripped before writing
 *   and defaulted on load.
 * - History is appended as JSON Lines (one trigger per line), bounded by
 *   maxHistoryEntries. Rotation truncates the oldest entries.
 */
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import type { PersistedRule, PersistedState, ReactorRule, TriggerRecord } from './types.js'

function defaultHome(): string {
  return process.env.DSH_HOME ?? join(homedir(), '.dsh')
}

export function defaultStorePath(): string {
  return join(defaultHome(), 'reactor', 'rules.json')
}

export function defaultHistoryPath(): string {
  return join(defaultHome(), 'reactor', 'history.jsonl')
}

export function defaultWorkspaceDir(): string {
  return join(defaultHome(), 'reactor', 'workspaces')
}

/** Strip runtime-only fields from a live rule. */
function toPersisted(rule: ReactorRule): PersistedRule {
  const { lastTriggered: _lt, lastPayload: _lp, triggerCount: _tc, ...rest } = rule
  return rest
}

/** Rehydrate a persisted rule with default runtime state. */
function fromPersisted(p: PersistedRule): ReactorRule {
  return {
    ...p,
    lastTriggered: undefined,
    lastPayload: undefined,
    triggerCount: 0,
  }
}

export class RuleStore {
  private filePath: string
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(filePath?: string) {
    this.filePath = filePath ?? defaultStorePath()
  }

  /** Load persisted rules. Returns [] when no store exists yet. */
  async load(): Promise<ReactorRule[]> {
    try {
      const raw = await readFile(this.filePath, 'utf8')
      const parsed = JSON.parse(raw) as PersistedState
      if (!Array.isArray(parsed?.rules)) return []
      return parsed.rules.map(fromPersisted)
    } catch {
      // No store yet, or corrupt file — start fresh.
      return []
    }
  }

  /** Atomically persist all rules (write temp file, then rename). Serialized. */
  async save(rules: ReactorRule[]): Promise<void> {
    const state: PersistedState = {
      version: 1,
      rules: rules.map(toPersisted),
    }
    // Serialize writes: concurrent save() calls must not clobber each other's
    // temp file (rename would race and fail with ENOENT on Windows).
    this.writeQueue = this.writeQueue.then(() => this.write(state))
    await this.writeQueue
  }

  private async write(state: PersistedState): Promise<void> {
    try {
      await mkdir(dirname(this.filePath), { recursive: true })
      const tmp = `${this.filePath}.tmp`
      await writeFile(tmp, JSON.stringify(state, null, 2), 'utf8')
      await rename(tmp, this.filePath)
    } catch {
      // Best-effort: rule persistence failure must never crash the engine.
    }
  }
}

export class HistoryStore {
  private filePath: string
  private maxEntries: number
  private records: TriggerRecord[] = []
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(filePath?: string, maxEntries = 500) {
    this.filePath = filePath ?? defaultHistoryPath()
    this.maxEntries = maxEntries
  }

  /** Load history from disk (for reactor_history queries after restart). */
  async load(): Promise<void> {
    try {
      const raw = await readFile(this.filePath, 'utf8')
      const lines = raw.split('\n').filter((l) => l.trim().length > 0)
      this.records = lines
        .map((line) => {
          try {
            return JSON.parse(line) as TriggerRecord
          } catch {
            return null
          }
        })
        .filter((r): r is TriggerRecord => r !== null)
      // Keep only the newest maxEntries.
      if (this.records.length > this.maxEntries) {
        this.records = this.records.slice(this.records.length - this.maxEntries)
      }
    } catch {
      this.records = []
    }
  }

  list(): TriggerRecord[] {
    return [...this.records]
  }

  listForRule(ruleId: string): TriggerRecord[] {
    return this.records.filter((r) => r.ruleId === ruleId)
  }

  /** Append one record to memory and (fire-and-forget, serialized) to disk. */
  append(record: TriggerRecord): void {
    this.records.push(record)
    if (this.records.length > this.maxEntries) {
      this.records.splice(0, this.records.length - this.maxEntries)
    }
    // Serialized disk writes so concurrent triggers cannot interleave lines.
    this.writeQueue = this.writeQueue.then(() => this.persist())
  }

  private async persist(): Promise<void> {
    try {
      await mkdir(dirname(this.filePath), { recursive: true })
      const tmp = `${this.filePath}.tmp`
      const body = this.records.map((r) => JSON.stringify(r)).join('\n') + '\n'
      await writeFile(tmp, body, 'utf8')
      await rename(tmp, this.filePath)
    } catch {
      // History persistence is best-effort; losing a history write must never
      // break rule execution.
    }
  }

  /** Flush pending disk writes (called on plugin unload). */
  async flush(): Promise<void> {
    await this.writeQueue
  }
}
