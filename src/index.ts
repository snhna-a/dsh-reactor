import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ReactorEngine } from './engine.js'
import { registerTools } from './tools.js'
import { registerWebhookIngress } from './webhook-server.js'
import { registerApiServer } from './api-server.js'
import type { ReactorConfig } from './types.js'

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MASCOT_CANDIDATES = [
  path.join(PACKAGE_ROOT, 'docs', 'assets', 'reactor-mascot.png'),
  path.join(PACKAGE_ROOT, 'assets', 'reactor-mascot.png'),
]

function loadMascot(): Buffer | null {
  for (const p of MASCOT_CANDIDATES) {
    try {
      const bytes = fs.readFileSync(p)
      if (bytes && bytes.length > 0) return bytes
    } catch {
      /* try next candidate */
    }
  }
  return null
}

/**
 * dsh-reactor — Event-Condition-Action rule engine for DeepSeek Harness.
 *
 * v0.2.0:
 *   - P0-1 rules persist across restarts (RuleStore)
 *   - P0-2 agent-talk creates real isolated Agent Sessions
 *   - P1-1 every trigger is recorded to a bounded history log
 *   - P1-2 webhook ingress endpoint lets external systems push events
 * v0.3.0:
 *   - floating widget UI (shell.overlay) with rule management + notifications
 *   - REST API (same-origin loopback) backing the widget
 *   - action retry with exponential backoff (maxRetries / retryDelayMs)
 *   - incremental event stream for widget bubble notifications
 *   - aggregated stats endpoint
 * v0.3.1:
 *   - redesigned widget UI (whale-style: squishy press, SVG bubble, edge snap, mirror flip, hamburger menu, frosted panel)
 *   - local mascot image served by host plugin (no external CDN dependency)
 */

export const name = 'dsh-reactor'

/**
 * Hard dependencies. `tools` gives the model-visible tool registry; `webServer`
 * gives the HTTP carrier for the webhook ingress and the widget REST API.
 * Declaring webServer here (like dsh-cron-panel does) is required: cordis
 * hides undeclared services from a plugin's ctx.get().
 */
export const inject = ['tools', 'webServer']

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
  maxRetries: z.number().default(3),
  retryDelayMs: z.number().default(1000),
  apiPath: z.string().default('/reactor/api'),
  uiEnabled: z.boolean().default(true),
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

  // v0.3: widget REST API — same-origin loopback routes the browser polls.
  if (config.uiEnabled !== false) {
    const api = registerApiServer(ctx, engine, {
      path: config.apiPath ?? '/reactor/api',
      token: config.webhookToken,
    })
    if (api) disposers.push(api)

    // v0.3.1: serve local mascot image (no external CDN dependency).
    try {
      const mascotDisposer = ctx.webServer.register({
        kind: 'exact',
        path: '/reactor/mascot.png',
        handler: (_req, res) => {
          const bytes = loadMascot()
          if (!bytes) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
            res.end('mascot not found')
            return
          }
          res.writeHead(200, {
            'Content-Type': 'image/png',
            'Cache-Control': 'public, max-age=86400',
            'Content-Length': String(bytes.length),
          })
          res.end(bytes as unknown as string)
        },
      })
      disposers.push(mascotDisposer)
    } catch (e) {
      ctx.logger.warn(`[dsh-reactor] mascot route failed: ${String(e)}`)
    }
  }

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
