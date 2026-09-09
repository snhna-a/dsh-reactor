import { runAgentSession } from '../agent-session.js';
function interpolate(template, payload) {
    return template.replace(/\{\{\s*([^}]+)\s*\}\}/g, (_, path) => {
        let p = path.trim();
        if (p.startsWith('payload.')) p = p.slice('payload.'.length);
        const parts = p.split('.');
        let cur = payload;
        for (const part of parts) { if (cur == null) return ''; cur = cur[part]; }
        return String(cur ?? '');
    });
}
export async function runAgentTalkAction(ctx, action, payload, opts) {
    const promptText = interpolate(action.target, payload);
    if (opts.enableSession !== false) {
        return runAgentSession(ctx, { prompt: promptText, title: `reactor: ${opts.ruleName ?? 'task'}`, workspaceDir: opts.workspaceDir, agentPreset: opts.agentPreset, permissionPreset: opts.permissionPreset, ruleId: opts.ruleId, ruleName: opts.ruleName });
    }
    const emitter = ctx;
    emitter.emit('reactor/agent-talk', { session: action.session ?? 'new', prompt: promptText, payload });
    ctx.logger.info(`[reactor] agent-talk emitted (session=${action.session ?? 'new'})`);
    return { ok: true, ms: 0 };
}
