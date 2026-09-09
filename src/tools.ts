import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ReactorEngine } from './engine.js'
import type { ReactorRule } from './types.js'

/**
 * Register all model-visible tools for dsh-reactor.
 * The agent uses these tools to create, inspect, and manage ECA rules
 * through natural language conversation.
 *
 * Note: parameter/output schemas use `as any` where the dsh-tools type
 * definitions are stricter than the runtime accepts (nested object
 * additionalProperties, oneOf unions for free-form values).
 */
export function registerTools(ctx: Context, engine: ReactorEngine): void {
  // ─── reactor_define ─────────────────────────────────────────
  ctx.tools.register(
    defineTool({
      name: 'reactor_define',
      description:
        'Create an event-driven automation rule (ECA: Event-Condition-Action). ' +
        'When the event source produces data that matches the conditions, the actions execute automatically. ' +
        'Event sources: http-poll (poll a URL), file-watch (read a file), command (run a shell command and parse output), webhook (receive pushed HTTP events). ' +
        'Actions: shell (run a command), webhook (POST JSON to a URL), agent-talk (inject a prompt into a real isolated agent session). ' +
        'Conditions use JSONPath (e.g. "$.status") to extract values from the event payload, then compare with operators. ' +
        'Use this when the user wants to monitor something and react automatically.',
      parameters: {
        name: {
          type: 'string',
          required: true,
          description: 'Human-readable rule name',
        },
        description: {
          type: 'string',
          description: 'Optional description of what the rule does',
        },
        source_kind: {
          type: 'string',
          required: true,
          enum: ['http-poll', 'file-watch', 'command', 'webhook'],
          description:
            'Type of event source. "webhook" means the rule is triggered by external HTTP POST events pushed to the reactor webhook endpoint.',
        },
        source_target: {
          type: 'string',
          required: true,
          description:
            'Event source target: URL (http-poll), file path (file-watch), shell command (command), or webhook path filter (webhook, optional, e.g. "/reactor/webhook")',
        },
        source_interval_ms: {
          type: 'number',
          description: 'Polling interval in milliseconds. Default 60000 (1 minute).',
        },
        conditions: {
          type: 'array',
          required: true,
          description:
            'List of conditions. Each condition has: field (JSONPath like "$.status"), op (comparison operator), value (comparison target).',
          items: {
            type: 'object',
            additionalProperties: true,
            properties: {
              field: {
                type: 'string',
                required: true,
                description: 'JSONPath expression, e.g. "$.tag_name", "$.data.count"',
              },
              op: {
                type: 'string',
                required: true,
                enum: [
                  'eq', 'ne', 'gt', 'lt', 'gte', 'lte',
                  'contains', 'matches', 'exists', 'changed',
                ],
                description:
                  'Comparison operator. "changed" compares against the previous payload. "exists" checks if field is present.',
              },
              value: {
                oneOf: [
                  { type: 'string' },
                  { type: 'number' },
                  { type: 'boolean' },
                  { type: 'object', additionalProperties: true },
                  { type: 'array' },
                ],
                description: 'Value to compare against. Not needed for "exists" or "changed".',
              },
            },
          },
        } as any,
        condition_logic: {
          type: 'string',
          enum: ['AND', 'OR'],
          description: 'How to combine multiple conditions. Default AND.',
        },
        actions: {
          type: 'array',
          required: true,
          description:
            'List of actions to execute when conditions match. Each action has: kind (shell/webhook/agent-talk), target.',
          items: {
            type: 'object',
            additionalProperties: true,
            properties: {
              kind: {
                type: 'string',
                required: true,
                enum: ['shell', 'webhook', 'agent-talk'],
                description: 'Action type',
              },
              target: {
                type: 'string',
                required: true,
                description:
                  'shell: command to run; webhook: URL to POST; agent-talk: prompt text to inject. Supports {{payload.field}} placeholders.',
              },
              payload: {
                type: 'object',
                additionalProperties: true,
                description: 'webhook only: extra JSON fields to include in POST body',
              },
              session: {
                type: 'string',
                enum: ['current', 'new'],
                description: 'agent-talk only: which session to inject into. Default new.',
              },
            },
          },
        } as any,
        cooldown_ms: {
          type: 'number',
          description:
            'Cooldown in milliseconds after a trigger before the rule can fire again. Default 0 (no cooldown).',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: true,
          properties: {
            rule_id: { type: 'string' },
            name: { type: 'string' },
          },
        },
        render: (_args, value) => [
          {
            type: 'text',
            text: `Rule created: "${(value as { name: string }).name}" (ID: ${(value as { rule_id: string }).rule_id})`,
          },
        ],
      },
      async execute(args: any) {
        const id = `reactor_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
        const rule: ReactorRule = {
          id,
          name: args.name,
          description: args.description,
          source: {
            kind: args.source_kind,
            target: args.source_target,
            intervalMs: args.source_interval_ms,
          },
          conditions: args.conditions as unknown as ReactorRule['conditions'],
          conditionLogic: args.condition_logic,
          actions: args.actions as unknown as ReactorRule['actions'],
          cooldownMs: args.cooldown_ms,
          enabled: true,
          triggerCount: 0,
        }
        engine.addRule(rule)
        return { rule_id: id, name: rule.name } as any
      },
    }),
  )

  // ─── reactor_list ───────────────────────────────────────────
  ctx.tools.register(
    defineTool({
      name: 'reactor_list',
      description:
        'List all reactor automation rules with their runtime status: enabled/disabled, trigger count, last trigger time, event source type.',
      parameters: {},
      output: {
        schema: { type: 'array' },
        render: (_args, value) => {
          const rules = value as unknown as ReactorRule[]
          if (rules.length === 0) {
            return [{ type: 'text', text: 'No reactor rules currently defined.' }]
          }
          const lines = rules.map((r) => {
            const last = r.lastTriggered
              ? new Date(r.lastTriggered).toLocaleString()
              : 'never'
            return [
              `- [${r.enabled ? 'ACTIVE' : 'DISABLED'}] ${r.name} (${r.id})`,
              `  Source: ${r.source.kind} → ${r.source.target}`,
              `  Conditions: ${r.conditions.length} (${r.conditionLogic ?? 'AND'})`,
              `  Actions: ${r.actions.map((a) => a.kind).join(', ')}`,
              `  Triggers: ${r.triggerCount ?? 0}, Last: ${last}`,
            ].join('\n')
          })
          return [{ type: 'text', text: lines.join('\n\n') }]
        },
      },
      async execute() {
        return engine.listRules() as unknown as any[]
      },
    }),
  )

  // ─── reactor_status ─────────────────────────────────────────
  ctx.tools.register(
    defineTool({
      name: 'reactor_status',
      description:
        'Get detailed status of a specific reactor rule, including the last event payload captured.',
      parameters: {
        rule_id: {
          type: 'string',
          required: true,
          description: 'The rule ID (from reactor_list)',
        },
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (_args, value) => {
          const r = value as Record<string, unknown>
          return [
            {
              type: 'text',
              text:
                `Rule: ${r.name} (${r.id})\n` +
                `Enabled: ${r.enabled}\n` +
                `Triggers: ${r.triggerCount}, Last: ${r.lastTriggered ?? 'never'}\n` +
                `Last payload: ${JSON.stringify(r.lastPayload).slice(0, 200)}`,
            },
          ]
        },
      },
      async execute(args: any) {
        const rule = engine.getRule(args.rule_id)
        if (!rule) {
          throw new Error(`rule not found: ${args.rule_id}`)
        }
        return {
          id: rule.id,
          name: rule.name,
          enabled: rule.enabled,
          source: rule.source,
          conditions: rule.conditions,
          conditionLogic: rule.conditionLogic ?? 'AND',
          actions: rule.actions,
          cooldownMs: rule.cooldownMs ?? 0,
          triggerCount: rule.triggerCount ?? 0,
          lastTriggered: rule.lastTriggered
            ? new Date(rule.lastTriggered).toISOString()
            : null,
          lastPayload: rule.lastPayload ?? null,
        } as any
      },
    }),
  )

  // ─── reactor_remove ─────────────────────────────────────────
  ctx.tools.register(
    defineTool({
      name: 'reactor_remove',
      description:
        'Remove a reactor rule. Stops its event source polling immediately and deletes it.',
      parameters: {
        rule_id: {
          type: 'string',
          required: true,
          description: 'The rule ID to remove (from reactor_list)',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: true,
          properties: {
            removed: { type: 'boolean' },
          },
        },
        render: (_args, value) => [
          {
            type: 'text',
            text: (value as { removed: boolean }).removed
              ? 'Rule removed successfully.'
              : 'Failed to remove rule.',
          },
        ],
      },
      async execute(args: any) {
        const removed = engine.removeRule(args.rule_id)
        if (!removed) {
          throw new Error(`rule not found: ${args.rule_id}`)
        }
        return { removed: true } as any
      },
    }),
  )

  // ─── reactor_test ───────────────────────────────────────────
  ctx.tools.register(
    defineTool({
      name: 'reactor_test',
      description:
        'Manually test a reactor rule with a simulated event payload. ' +
        'Evaluates conditions and executes actions if matched. Useful for verifying a rule works before relying on it.',
      parameters: {
        rule_id: {
          type: 'string',
          required: true,
          description: 'The rule ID to test (from reactor_list)',
        },
        payload: {
          type: 'object',
          additionalProperties: true,
          required: true,
          description: 'Simulated event payload JSON to evaluate conditions against',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: true,
          properties: {
            matched: { type: 'boolean' },
            actionsRun: { type: 'number' },
          },
        },
        render: (_args, value) => {
          const v = value as { matched: boolean; actionsRun: number }
          return [
            {
              type: 'text',
              text: v.matched
                ? `Conditions matched. ${v.actionsRun} action(s) executed.`
                : 'Conditions did not match. No actions executed.',
            },
          ]
        },
      },
      async execute(args: any) {
        return engine.testRule(args.rule_id, args.payload) as any
      },
    }),
  )

  // ─── reactor_history (P1-1) ─────────────────────────────────
  ctx.tools.register(
    defineTool({
      name: 'reactor_history',
      description:
        'Show the execution history of reactor rules: every trigger with matched result, per-action outcome, duration, and agent session result. ' +
        'Optionally filter by rule_id. Useful for auditing what the automation did and diagnosing failures.',
      parameters: {
        rule_id: {
          type: 'string',
          description: 'Optional rule ID to filter by (from reactor_list)',
        },
        limit: {
          type: 'number',
          description: 'Maximum number of records to show. Default 10.',
        },
      },
      output: {
        schema: { type: 'array' },
        render: (_args, value) => {
          const records = value as unknown as {
            id: string
            ruleId: string
            ruleName: string
            at: number
            matched: boolean
            actions?: { kind: string; target: string; ok: boolean; error?: string; ms: number }[]
            sessionResult?: { sessionId?: string; workspacePath?: string; ok: boolean; error?: string; ms: number }
          }[]
          if (records.length === 0) {
            return [{ type: 'text', text: 'No execution history records.' }]
          }
          const lines = records.map((r) => {
            const time = new Date(r.at).toLocaleString()
            const actionLines = (r.actions ?? [])
              .map((a) => {
                const status = a.ok ? 'OK' : `FAILED${a.error ? ` (${a.error})` : ''}`
                return `    - ${a.kind} → ${a.target} [${status}, ${a.ms}ms]`
              })
              .join('\n')
            const sessionLine = r.sessionResult
              ? r.sessionResult.ok
                ? `    Session: ${r.sessionResult.sessionId ?? '?'} (${r.sessionResult.ms}ms)`
                : `    Session FAILED: ${r.sessionResult.error ?? '?'} (${r.sessionResult.ms}ms)`
              : ''
            return [
              `- [${r.matched ? 'MATCH' : 'NO-MATCH'}] ${r.ruleName} (${r.ruleId}) @ ${time}`,
              ...(actionLines ? [actionLines] : []),
              ...(sessionLine ? [sessionLine] : []),
            ].join('\n')
          })
          return [{ type: 'text', text: lines.join('\n\n') }]
        },
      },
      async execute(args: any) {
        const records = engine.listHistory(args.rule_id)
        const limit = Math.max(1, Math.min(args.limit ?? 10, 100))
        return records.slice(-limit) as unknown as any[]
      },
    }),
  )
}
