import { readFile } from 'node:fs/promises';
import { execa } from 'execa';
import { evaluateAll } from './conditions.js';
import { runShellAction } from './actions/shell.js';
import { runWebhookAction } from './actions/webhook.js';
import { runAgentTalkAction } from './actions/agent-talk.js';
import { RuleStore, HistoryStore } from './store.js';
export class ReactorEngine {
    rules = new Map();
    timers = new Map();
    prevPayloads = new Map();
    ctx;
    config;
    runningActions = 0;
    ruleStore;
    historyStore;
    closed = false;
    eventSeq = 0;
    events = [];
    constructor(ctx, config) {
        this.ctx = ctx;
        this.config = config;
        this.ruleStore = new RuleStore(config.storePath);
        this.historyStore = new HistoryStore(config.historyPath, config.maxHistoryEntries ?? 500);
    }
    emitEvent(type, data) {
        const ev = { seq: ++this.eventSeq, type, at: Date.now(), ...data };
        this.events.push(ev);
        if (this.events.length > 200) this.events.splice(0, this.events.length - 200);
        return ev.seq;
    }
    listEvents(since = 0) { return this.events.filter((e) => e.seq > since); }
    getEventSeq() { return this.eventSeq; }
    getStats() {
        const rules = [...this.rules.values()];
        const history = this.historyStore.list();
        const triggered = history.filter((h) => h.matched);
        let totalActions = 0, failedActions = 0, lastTriggerAt;
        for (const rec of triggered) {
            if (lastTriggerAt === undefined || rec.at > lastTriggerAt) lastTriggerAt = rec.at;
            totalActions += rec.actions?.length ?? 0;
            failedActions += rec.actions?.filter((a) => !a.ok).length ?? 0;
        }
        return { totalRules: rules.length, enabledRules: rules.filter((r) => r.enabled).length, totalTriggers: triggered.length, totalActions, failedActions, lastTriggerAt };
    }
    async loadPersisted() {
        const rules = await this.ruleStore.load();
        for (const rule of rules) { this.rules.set(rule.id, rule); if (rule.enabled) this.startSource(rule); }
        await this.historyStore.load();
        if (rules.length > 0) this.ctx.logger.info(`[reactor] restored ${rules.length} persisted rule(s)`);
        return rules.length;
    }
    async persist() {
        try { await this.ruleStore.save([...this.rules.values()]); } catch (err) { this.ctx.logger.warn(`[reactor] rule persistence failed: ${err}`); }
    }
    addRule(rule) {
        this.rules.set(rule.id, rule);
        if (rule.enabled) this.startSource(rule);
        this.ctx.logger.info(`[reactor] rule added: ${rule.name} (${rule.id})`);
        this.emitEvent('rule-added', { ruleId: rule.id, ruleName: rule.name });
        void this.persist();
    }
    removeRule(id) {
        const rule = this.rules.get(id);
        if (!rule) return false;
        this.stopSource(id);
        this.rules.delete(id);
        this.prevPayloads.delete(id);
        this.ctx.logger.info(`[reactor] rule removed: ${id}`);
        this.emitEvent('rule-removed', { ruleId: id, ruleName: rule.name });
        void this.persist();
        return true;
    }
    updateRule(id, patch) {
        const existing = this.rules.get(id);
        if (!existing) return false;
        this.stopSource(id);
        const next = { ...existing, ...patch, lastTriggered: existing.lastTriggered, lastPayload: existing.lastPayload, triggerCount: existing.triggerCount };
        this.rules.set(id, next);
        if (next.enabled) this.startSource(next);
        this.ctx.logger.info(`[reactor] rule updated: ${next.name} (${id})`);
        this.emitEvent('rule-updated', { ruleId: id, ruleName: next.name });
        void this.persist();
        return true;
    }
    listRules() { return [...this.rules.values()]; }
    getRule(id) { return this.rules.get(id); }
    listHistory(ruleId) { return ruleId ? this.historyStore.listForRule(ruleId) : this.historyStore.list(); }
    dispatchWebhook(payload, path) {
        let matched = 0;
        for (const rule of this.rules.values()) {
            if (!rule.enabled || rule.source.kind !== 'webhook') continue;
            if (path && rule.source.target && rule.source.target !== '/' && rule.source.target !== path) continue;
            const prev = this.prevPayloads.get(rule.id);
            const ok = evaluateAll(rule.conditions, rule.conditionLogic ?? 'AND', payload, prev);
            this.prevPayloads.set(rule.id, payload);
            if (ok) { void this.fire(rule, payload); matched++; }
        }
        return matched;
    }
    async testRule(id, payload) {
        const rule = this.rules.get(id);
        if (!rule) throw new Error(`rule not found: ${id}`);
        const matched = evaluateAll(rule.conditions, rule.conditionLogic ?? 'AND', payload, this.prevPayloads.get(id));
        this.prevPayloads.set(id, payload);
        let actionsRun = 0;
        if (matched) { const record = await this.executeActions(rule, payload); actionsRun = record.actions.filter((a) => a.ok).length; this.record(rule, true, record.actions, record.sessionResult); }
        else { this.record(rule, false); }
        return { matched, actionsRun };
    }
    startSource(rule) {
        const { source } = rule;
        if (source.kind === 'webhook') return;
        const interval = source.intervalMs ?? this.config.defaultIntervalMs ?? 60_000;
        const tick = async () => {
            if (this.closed) return;
            try { const payload = await this.collectPayload(source); if (this.closed) return; await this.evaluate(rule, payload); }
            catch (err) { this.ctx.logger.warn(`[reactor] rule "${rule.name}" (${rule.id}) source error: ${err}`); this.emitEvent('rule-error', { ruleId: rule.id, ruleName: rule.name, error: err instanceof Error ? err.message : String(err) }); }
        };
        tick();
        const timer = setInterval(tick, interval);
        this.timers.set(rule.id, timer);
    }
    stopSource(id) { const timer = this.timers.get(id); if (timer) { clearInterval(timer); this.timers.delete(id); } }
    async collectPayload(source) {
        switch (source.kind) {
            case 'http-poll': { const res = await fetch(source.target, { method: source.method ?? 'GET', headers: source.headers }); const contentType = res.headers.get('content-type') ?? ''; if (contentType.includes('json')) return res.json(); return res.text(); }
            case 'command': { const { stdout } = await execa(source.target, { shell: true }); try { return JSON.parse(stdout); } catch { return stdout; } }
            case 'file-watch': { const content = await readFile(source.target, 'utf8'); try { return JSON.parse(content); } catch { return content; } }
            default: throw new Error(`unsupported source kind: ${source.kind}`);
        }
    }
    async evaluate(rule, payload) {
        const prev = this.prevPayloads.get(rule.id);
        const matched = evaluateAll(rule.conditions, rule.conditionLogic ?? 'AND', payload, prev);
        this.prevPayloads.set(rule.id, payload);
        if (!matched) { this.record(rule, false); return; }
        const cooldown = rule.cooldownMs ?? 0;
        if (cooldown > 0 && rule.lastTriggered) { if (Date.now() - rule.lastTriggered < cooldown) { this.ctx.logger.debug(`[reactor] rule "${rule.name}" suppressed by cooldown`); this.record(rule, false); return; } }
        await this.fire(rule, payload);
    }
    async fire(rule, payload) {
        rule.lastTriggered = Date.now();
        rule.lastPayload = payload;
        rule.triggerCount = (rule.triggerCount ?? 0) + 1;
        this.ctx.logger.info(`[reactor] rule "${rule.name}" triggered (count=${rule.triggerCount})`);
        this.emitEvent('rule-triggered', { ruleId: rule.id, ruleName: rule.name, matched: true, triggerCount: rule.triggerCount });
        const run = await this.executeActions(rule, payload);
        this.record(rule, true, run.actions, run.sessionResult);
        void this.persist();
    }
    async executeActions(rule, payload) {
        const maxConcurrent = this.config.maxConcurrentActions ?? 3;
        const records = [];
        let sessionResult;
        if (this.runningActions >= maxConcurrent) { this.ctx.logger.warn(`[reactor] rule "${rule.name}" actions skipped: max concurrent (${maxConcurrent}) reached`); return { actions: records }; }
        const maxRetries = this.config.maxRetries ?? 3;
        const baseDelay = this.config.retryDelayMs ?? 1000;
        for (const action of rule.actions) {
            this.runningActions++;
            const started = Date.now();
            const attemptLog = [];
            try {
                for (let attempt = 0; attempt <= maxRetries; attempt++) {
                    const once = await this.runActionOnce(rule, action, payload);
                    attemptLog.push({ at: attempt, ...once });
                    if (once.ok) break;
                    if (attempt < maxRetries) { const delay = baseDelay * 2 ** attempt; await new Promise((resolve) => setTimeout(resolve, delay)); }
                }
                const last = attemptLog[attemptLog.length - 1];
                const record = { kind: action.kind, target: action.target, ok: last.ok, error: last.error, ms: Date.now() - started, attempts: attemptLog.length, ...(attemptLog.length > 1 || !last.ok ? { attemptLog } : {}) };
                records.push(record);
                if (!record.ok) this.emitEvent('action-failed', { ruleId: rule.id, ruleName: rule.name, error: record.error });
                if (action.kind === 'agent-talk' && sessionResult === undefined && last.sessionResult) sessionResult = last.sessionResult;
            } finally { this.runningActions--; }
        }
        return { actions: records, sessionResult };
    }
    async runActionOnce(rule, action, payload) {
        const started = Date.now();
        try {
            switch (action.kind) {
                case 'shell': if (this.config.allowShell !== false) { await runShellAction(action, payload); } else { return { ok: false, error: 'shell action blocked by config (allowShell=false)', ms: Date.now() - started }; } break;
                case 'webhook': await runWebhookAction(action, payload); break;
                case 'agent-talk': if (this.config.allowAgentSession !== false) { const result = await runAgentTalkAction(this.ctx, action, payload, { workspaceDir: this.config.agentWorkspaceDir, agentPreset: this.config.agentPreset, permissionPreset: this.config.permissionPreset, ruleName: rule.name, ruleId: rule.id }); return { ok: result.ok, error: result.error, ms: result.ms, sessionResult: result }; } await runAgentTalkAction(this.ctx, action, payload, { enableSession: false }); break;
            }
            return { ok: true, ms: Date.now() - started };
        } catch (err) { return { ok: false, error: err instanceof Error ? err.message : String(err), ms: Date.now() - started }; }
    }
    record(rule, matched, actions, sessionResult) {
        this.historyStore.append({ id: `trig_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, ruleId: rule.id, ruleName: rule.name, at: Date.now(), matched, ...(actions && actions.length > 0 ? { actions } : {}), ...(sessionResult ? { sessionResult } : {}) });
    }
    async dispose() {
        this.closed = true;
        for (const timer of this.timers.values()) clearInterval(timer);
        this.timers.clear();
        try { await this.persist(); await this.historyStore.flush(); } catch { /* best-effort */ }
        this.rules.clear();
        this.prevPayloads.clear();
        this.events = [];
        this.ctx.logger.info('[reactor] engine disposed, all rules and timers cleared');
    }
}
