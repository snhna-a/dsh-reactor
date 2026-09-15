import type { Context } from '@deepseek-ai/cordis'
import type { Action, SessionRunResult } from '../types.js'
import { runAgentSession } from '../agent-session.js'

/**
 * Replace {{payload.field}} / {{field}} placeholders in a template string.
 * Local copy to avoid cross-module type resolution issues.
 * The leading `payload.` prefix is stripped when present.
 */
function interpolate(template: string, payload: unknown): string {
  return template.replace(/\{\{\s*([^}]+)\s*\}\}/g, (_, path: string) => {
    let p = path.trim()
    if (p.startsWith('payload.')) p = p.slice('payload.'.length)
    const parts = p.split('.')
    let cur: unknown = payload
    for (const part of parts) {
      if (cur == null) return ''
      cur = (cur as Record<string, unknown>)[part]
    }
    return String(cur ?? '')
  })
}

/**
 * agent-talk action.
 *
 * v0.2.0 (P0-2): when `opts.enableSession` is true, this creates a REAL
 * isolated Workspace-backed Agent Session that runs the prompt in a clean
 * boundary and returns a SessionRunResult. When session execution is not
 * configured (or host services are missing), it degrades to emitting the
 * `reactor/agent-talk` event so downstream listeners can pick it up.
 */
export async function runAgentTalkAction(
  ctx: Context,
  action: Action,
  payload: unknown,
  opts: {
    enableSession?: boolean
    workspaceDir?: string
    agentPreset?: string
    permissionPreset?: string
    ruleName?: string
    ruleId?: string
  },
): Promise<SessionRunResult> {
  const promptText: string = interpolate(action.target, payload)

  if (opts.enableSession !== false) {
    return runAgentSession(ctx, {
      prompt: promptText,
      title: `reactor: ${opts.ruleName ?? 'task'}`,
      workspaceDir: opts.workspaceDir,
      agentPreset: opts.agentPreset,
      permissionPreset: opts.permissionPreset,
      ruleId: opts.ruleId,
      ruleName: opts.ruleName,
    })
  }

  // Fallback: legacy event broadcast.
  const emitter = ctx as unknown as {
    emit: (name: string, ...args: unknown[]) => void
  }
  emitter.emit('reactor/agent-talk', {
    session: action.session ?? 'new',
    prompt: promptText,
    payload,
  })
  ctx.logger.info(`[reactor] agent-talk emitted (session=${action.session ?? 'new'})`)
  return { ok: true, ms: 0 }
}
