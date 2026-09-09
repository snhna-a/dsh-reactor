import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { defaultWorkspaceDir } from './store.js';
function userMessage(text) { return { role: 'user', content: [{ type: 'text', text }] }; }
export async function runAgentSession(ctx, options) {
    const started = Date.now();
    const host = ctx;
    const agents = host.agents;
    const registry = host.workspaceRegistry;
    const presets = host.agentPresets;
    if (!agents || !registry || !presets) { return { ok: false, ms: Date.now() - started, error: 'agent session services unavailable in this profile (need agents/workspaceRegistry/agentPresets)' }; }
    const agentPreset = options.agentPreset ?? 'standard';
    const permissionPreset = options.permissionPreset ?? 'workspace-write';
    const workspaceBase = options.workspaceDir ?? defaultWorkspaceDir();
    const workspacePath = join(workspaceBase, options.ruleId ?? `session-${Date.now()}`);
    try {
        const preset = await presets.resolve(agentPreset);
        host.permissionPresets?.resolve?.(permissionPreset);
        await mkdir(workspacePath, { recursive: true });
        const workspace = await registry.create(workspacePath);
        const sessionId = `reactor-${randomUUID()}`;
        const selection = host.agentDefaultModel?.currentSelection?.();
        const handle = await agents.create({ sessionId, meta: { cwd: workspace.path, agentPreset: preset.id, origin: 'subagent' }, ...(selection ? { agentOptions: { provider: selection.provider, model: selection.model } } : {}), setup: async (agentCtx) => { await presets.mount(agentCtx, preset.id); } });
        let attached = false;
        try {
            await workspace.attachSession(sessionId); attached = true;
            host.permissionPresets?.set(handle.agent.session, permissionPreset);
            host.sessionTitle?.rename(handle.agent.session, options.title ?? `reactor: ${options.ruleName ?? 'rule'}`);
            handle.agent.followup(userMessage(options.prompt));
        } catch (error) {
            if (attached) { try { await workspace.detachSession(sessionId); } catch { /* best-effort rollback */ } }
            try { await handle.dispose(); } catch { /* best-effort rollback */ }
            throw error;
        }
        let tokens;
        try {
            const agentObj = handle.agent;
            const usageFn = (agentObj.getUsage ?? agentObj.usage);
            const usageVal = typeof usageFn === 'function' ? usageFn.call(agentObj) : usageFn;
            if (usageVal && typeof usageVal === 'object') { const u = usageVal; const input = (u.input ?? u.inputTokens ?? u.promptTokens); const output = (u.output ?? u.outputTokens ?? u.completionTokens); if (input !== undefined || output !== undefined) tokens = { ...(typeof input === 'number' ? { input } : {}), ...(typeof output === 'number' ? { output } : {}) }; }
        } catch { /* usage probing is best-effort */ }
        return { sessionId, workspacePath, ok: true, ms: Date.now() - started, ...(tokens ? { tokens } : {}) };
    } catch (error) { return { ok: false, ms: Date.now() - started, error: error instanceof Error ? error.message : String(error) }; }
}
