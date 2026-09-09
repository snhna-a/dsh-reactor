/**
 * dsh-reactor — real Agent session execution (P0-2)
 *
 * agent-talk actions are upgraded from "emit an event" to creating a real,
 * isolated Workspace-backed root Session whose Agent runs the prompt in a
 * clean boundary (fresh cwd, chosen agent preset, chosen permission preset).
 *
 * Implementation mirrors the official `@deepseek-ai/dsh-webhook` runtime
 * (`createWebhookSession`), but all host services are resolved optionally:
 * when the host profile does not mount them (e.g. headless without the web
 * stack), the action degrades to a logged warning instead of failing the
 * plugin boot.
 */
import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { SessionRunResult } from './types.js'
import { defaultWorkspaceDir } from './store.js'

/** Minimal shape of the services we consume; resolved via ctx.get(). */
interface AgentSessionHost {
  agents?: {
    create: (options: {
      sessionId: string
      signal?: AbortSignal
      meta?: { cwd?: string; agentPreset?: string; origin?: 'subagent' }
      agentOptions?: { provider?: string; model?: string; maxTokens?: number }
      setup?: (agentCtx: Context) => void | Promise<void>
    }) => Promise<{ agent: { session: string; followup: (msg: unknown) => void }; dispose: () => Promise<void> }>
  }
  workspaceRegistry?: {
    create: (path: string) => Promise<{ path: string; attachSession: (id: string) => Promise<void>; detachSession: (id: string) => Promise<void> }>
  }
  agentPresets?: {
    resolve: (id: string) => Promise<{ id: string }>
    mount: (agentCtx: Context, id: string) => Promise<unknown>
  }
  permissionPresets?: {
    set: (session: string, preset: string) => void
    resolve: (preset: string) => unknown
  }
  sessionTitle?: {
    rename: (session: string, title: string) => void
  }
  agentDefaultModel?: {
    currentSelection: () => { provider: string; model: string }
  }
}

function userMessage(text: string): { role: 'user'; content: { type: 'text'; text: string }[] } {
  return { role: 'user', content: [{ type: 'text', text }] }
}

/**
 * Create a real isolated session that runs `prompt`.
 * Returns a run record; never throws (errors are captured in the record).
 */
export async function runAgentSession(
  ctx: Context,
  options: {
    prompt: string
    title?: string
    workspaceDir?: string
    agentPreset?: string
    permissionPreset?: string
    ruleId?: string
    ruleName?: string
  },
): Promise<SessionRunResult> {
  const started = Date.now()
  const host = ctx as unknown as AgentSessionHost
  const agents = host.agents
  const registry = host.workspaceRegistry
  const presets = host.agentPresets

  if (!agents || !registry || !presets) {
    return {
      ok: false,
      ms: Date.now() - started,
      error:
        'agent session services unavailable in this profile (need agents/workspaceRegistry/agentPresets)',
    }
  }

  const agentPreset = options.agentPreset ?? 'standard'
  const permissionPreset = options.permissionPreset ?? 'workspace-write'
  const workspaceBase = options.workspaceDir ?? defaultWorkspaceDir()
  const workspacePath = join(workspaceBase, options.ruleId ?? `session-${Date.now()}`)

  try {
    // Validate presets before doing any work.
    const preset = await presets.resolve(agentPreset)
    host.permissionPresets?.resolve?.(permissionPreset)

    // Ensure workspace directory exists.
    await mkdir(workspacePath, { recursive: true })

    const workspace = await registry.create(workspacePath)
    const sessionId = `reactor-${randomUUID()}`
    const selection = host.agentDefaultModel?.currentSelection?.()

    const handle = await agents.create({
      sessionId,
      meta: {
        cwd: workspace.path,
        agentPreset: preset.id,
        origin: 'subagent',
      },
      ...(selection ? { agentOptions: { provider: selection.provider, model: selection.model } } : {}),
      setup: async (agentCtx) => {
        await presets.mount(agentCtx, preset.id)
      },
    })

    let attached = false
    try {
      await workspace.attachSession(sessionId)
      attached = true
      host.permissionPresets?.set(handle.agent.session, permissionPreset)
      host.sessionTitle?.rename(handle.agent.session, options.title ?? `reactor: ${options.ruleName ?? 'rule'}`)
      handle.agent.followup(userMessage(options.prompt))
    } catch (error) {
      if (attached) {
        try {
          await workspace.detachSession(sessionId)
        } catch {
          // best-effort rollback
        }
      }
      try {
        await handle.dispose()
      } catch {
        // best-effort rollback
      }
      throw error
    }

    return {
      sessionId,
      workspacePath,
      ok: true,
      ms: Date.now() - started,
    }
  } catch (error) {
    return {
      ok: false,
      ms: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}
