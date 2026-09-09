import { defineTool } from '@deepseek-ai/dsh-tools';
export function registerTools(ctx, engine) {
    ctx.tools.register(defineTool({
        name: 'reactor_define',
        description: 'Create an event-driven automation rule (ECA: Event-Condition-Action). Event sources: http-poll, file-watch, command, webhook. Actions: shell, webhook, agent-talk. Conditions use JSONPath.',
        parameters: {
            name: { type: 'string', required: true, description: 'Human-readable rule name' },
            description: { type: 'string', description: 'Optional description' },
            source_kind: { type: 'string', required: true, enum: ['http-poll', 'file-watch', 'command', 'webhook'], description: 'Type of event source' },
            source_target: { type: 'string', required: true, description: 'Event source target: URL/file path/command/webhook path filter' },
            source_interval_ms: { type: 'number', description: 'Polling interval in ms. Default 60000.' },
            conditions: { type: 'array', required: true, description: 'List of conditions: field (JSONPath), op, value', items: { type: 'object', additionalProperties: true, properties: { field: { type: 'string', required: true }, op: { type: 'string', required: true, enum: ['eq','ne','gt','lt','gte','lte','contains','matches','exists','changed'] }, value: { oneOf: [{type:'string'},{type:'number'},{type:'boolean'},{type:'object',additionalProperties:true},{type:'array'}] } } } },
            condition_logic: { type: 'string', enum: ['AND', 'OR'], description: 'Combine multiple conditions. Default AND.' },
            actions: { type: 'array', required: true, description: 'List of actions: kind (shell/webhook/agent-talk), target', items: { type: 'object', additionalProperties: true, properties: { kind: { type: 'string', required: true, enum: ['shell','webhook','agent-talk'] }, target: { type: 'string', required: true, description: 'shell: command; webhook: URL; agent-talk: prompt. Supports {{payload.field}}' }, payload: { type: 'object', additionalProperties: true, description: 'webhook only: extra JSON fields' }, session: { type: 'string', enum: ['current','new'], description: 'agent-talk only: session target. Default new.' } } } },
            cooldown_ms: { type: 'number', description: 'Cooldown ms after trigger. Default 0.' },
        },
        output: { schema: { type: 'object', additionalProperties: true, properties: { rule_id: { type: 'string' }, name: { type: 'string' } } }, render: (_args, value) => [{ type: 'text', text: `Rule created: "${value.name}" (ID: ${value.rule_id})` }] },
        async execute(args) {
            const id = `reactor_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            const rule = { id, name: args.name, description: args.description, source: { kind: args.source_kind, target: args.source_target, intervalMs: args.source_interval_ms }, conditions: args.conditions, conditionLogic: args.condition_logic, actions: args.actions, cooldownMs: args.cooldown_ms, enabled: true, triggerCount: 0 };
            engine.addRule(rule);
            return { rule_id: id, name: rule.name };
        },
    }));
    ctx.tools.register(defineTool({
        name: 'reactor_list',
        description: 'List all reactor rules with runtime status: enabled/disabled, trigger count, last trigger, source type.',
        parameters: {},
        output: { schema: { type: 'array' }, render: (_args, value) => { const rules = value; if (rules.length === 0) return [{ type: 'text', text: 'No reactor rules currently defined.' }]; const lines = rules.map((r) => { const last = r.lastTriggered ? new Date(r.lastTriggered).toLocaleString() : 'never'; return [`- [${r.enabled ? 'ACTIVE' : 'DISABLED'}] ${r.name} (${r.id})`, `  Source: ${r.source.kind} → ${r.source.target}`, `  Conditions: ${r.conditions.length} (${r.conditionLogic ?? 'AND'})`, `  Actions: ${r.actions.map((a) => a.kind).join(', ')}`, `  Triggers: ${r.triggerCount ?? 0}, Last: ${last}`].join('\n'); }); return [{ type: 'text', text: lines.join('\n\n') }]; } },
        async execute() { return engine.listRules(); },
    }));
    ctx.tools.register(defineTool({
        name: 'reactor_status',
        description: 'Get detailed status of a specific rule, including last event payload.',
        parameters: { rule_id: { type: 'string', required: true, description: 'The rule ID (from reactor_list)' } },
        output: { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => { const r = value; return [{ type: 'text', text: `Rule: ${r.name} (${r.id})\nEnabled: ${r.enabled}\nTriggers: ${r.triggerCount}, Last: ${r.lastTriggered ?? 'never'}\nLast payload: ${JSON.stringify(r.lastPayload).slice(0, 200)}` }]; } },
        async execute(args) { const rule = engine.getRule(args.rule_id); if (!rule) throw new Error(`rule not found: ${args.rule_id}`); return { id: rule.id, name: rule.name, enabled: rule.enabled, source: rule.source, conditions: rule.conditions, conditionLogic: rule.conditionLogic ?? 'AND', actions: rule.actions, cooldownMs: rule.cooldownMs ?? 0, triggerCount: rule.triggerCount ?? 0, lastTriggered: rule.lastTriggered ? new Date(rule.lastTriggered).toISOString() : null, lastPayload: rule.lastPayload ?? null }; },
    }));
    ctx.tools.register(defineTool({
        name: 'reactor_remove',
        description: 'Remove a reactor rule. Stops its event source immediately.',
        parameters: { rule_id: { type: 'string', required: true, description: 'The rule ID to remove' } },
        output: { schema: { type: 'object', additionalProperties: true, properties: { removed: { type: 'boolean' } } }, render: (_args, value) => [{ type: 'text', text: value.removed ? 'Rule removed successfully.' : 'Failed to remove rule.' }] },
        async execute(args) { const removed = engine.removeRule(args.rule_id); if (!removed) throw new Error(`rule not found: ${args.rule_id}`); return { removed: true }; },
    }));
    ctx.tools.register(defineTool({
        name: 'reactor_test',
        description: 'Manually test a rule with a simulated payload. Evaluates conditions and executes actions if matched.',
        parameters: { rule_id: { type: 'string', required: true, description: 'The rule ID to test' }, payload: { type: 'object', additionalProperties: true, required: true, description: 'Simulated event payload' } },
        output: { schema: { type: 'object', additionalProperties: true, properties: { matched: { type: 'boolean' }, actionsRun: { type: 'number' } } }, render: (_args, value) => [{ type: 'text', text: value.matched ? `Conditions matched. ${value.actionsRun} action(s) executed.` : 'Conditions did not match. No actions executed.' }] },
        async execute(args) { return engine.testRule(args.rule_id, args.payload); },
    }));
    ctx.tools.register(defineTool({
        name: 'reactor_history',
        description: 'Show execution history: every trigger with matched result, per-action outcome, duration, agent session result. Optionally filter by rule_id.',
        parameters: { rule_id: { type: 'string', description: 'Optional rule ID to filter by' }, limit: { type: 'number', description: 'Max records. Default 10.' } },
        output: { schema: { type: 'array' }, render: (_args, value) => { const records = value; if (records.length === 0) return [{ type: 'text', text: 'No execution history records.' }]; const lines = records.map((r) => { const time = new Date(r.at).toLocaleString(); const actionLines = (r.actions ?? []).map((a) => { const status = a.ok ? 'OK' : `FAILED${a.error ? ` (${a.error})` : ''}`; return `    - ${a.kind} → ${a.target} [${status}, ${a.ms}ms]`; }).join('\n'); const sessionLine = r.sessionResult ? r.sessionResult.ok ? `    Session: ${r.sessionResult.sessionId ?? '?'} (${r.sessionResult.ms}ms)` : `    Session FAILED: ${r.sessionResult.error ?? '?'} (${r.sessionResult.ms}ms)` : ''; return [`- [${r.matched ? 'MATCH' : 'NO-MATCH'}] ${r.ruleName} (${r.ruleId}) @ ${time}`, ...(actionLines ? [actionLines] : []), ...(sessionLine ? [sessionLine] : [])].join('\n'); }); return [{ type: 'text', text: lines.join('\n\n') }]; } },
        async execute(args) { const records = engine.listHistory(args.rule_id); const limit = Math.max(1, Math.min(args.limit ?? 10, 100)); return records.slice(-limit); },
    }));
}
