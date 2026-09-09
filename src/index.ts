import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { ReactorEngine } from './engine.js'
import { registerTools } from './tools.js'
import { registerWebhookIngress } from './webhook-server.js'
import type { ReactorConfig } from './types.js'

/**
 * dsh-reactor — Event-Condition-Action rule engine for DeepSeek Harness.
 *
 * v0.2.0:
 *   - P0-1 rules persist across restarts (RuleStore)
 *   - P0-2 agent-talk creates real isolated Agent Sessions
 *   - P1-1 every trigger is recorded to a bounded history log
 *   - P1-2 webhook ingress endpoint lets external systems push events
 */

export const name = 'dsh-reactor'

export const inject = ['tools']

export const Config = z.object({
  allowShell: z.boolean().default(true),
  maxConcurrentActions: z.number().default(3),
  defaultIntervalMs: z.number().default(60000),
  rules: z.array(z.any()).default([]),
  storePath: z.string(),
  historyPath: z.string(),
  maxHistoryEntries: z.number().default(500),
  webhookPath: z.string().default('/reactor/webhook'),
  webhookToken: z.string(),
  allowAgentSession: z.boolean().default(true),
  agentWorkspaceDir: z.string(),
  agentPreset: z.string().default('standard'),
  permissionPreset: z.string().default('workspace-write'),
})

export function apply(ctx: Context, config: ReactorConfig): void {
  ctx.logger.info('[dsh-reactor] plugin loading...')

  const engine = new ReactorEngine(ctx, config)

  // P0-1: restore persisted rules before anything else.
  void engine.loadPersisted().then((restored) => {
    if (restored === 0) {
      // First boot (or empty store): load static rules from config if any.
      if (config.rules && config.rules.length > 0) {
        for (const rule of config.rules) {
          engine.addRule(rule)
        }
        ctx.logger.info(`[dsh-reactor] loaded ${config.rules.length} static rule(s) from config`)
      }
    }
  })

  // Register model-visible tools so the agent can manage rules via conversation
  registerTools(ctx, engine)

  // P1-2: webhook ingress — external systems push events to the engine.
  const disposers: Array<() => void> = []
  const ingressPath = config.webhookPath ?? '/reactor/webhook'
  const ingress = registerWebhookIngress(
    ctx,
    {
      path: ingressPath,
      token: config.webhookToken,
    },
    (payload) => {
      engine.dispatchWebhook(payload, ingressPath)
    },
  )
  if (ingress) disposers.push(ingress)

  // Reversible cleanup: when the plugin unloads (HMR / profile switch / shutdown),
  // stop all polling timers, clear rules, flush history, remove the webhook route.
  ctx.effect(() => {
    return () => {
      for (const d of disposers) d()
      void engine.dispose()
    }
  })

  ctx.logger.info('[dsh-reactor] plugin loaded successfully')
}
