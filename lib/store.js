import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
function defaultHome() { return process.env.DSH_HOME ?? join(homedir(), '.dsh'); }
export function defaultStorePath() { return join(defaultHome(), 'reactor', 'rules.json'); }
export function defaultHistoryPath() { return join(defaultHome(), 'reactor', 'history.jsonl'); }
export function defaultWorkspaceDir() { return join(defaultHome(), 'reactor', 'workspaces'); }
function toPersisted(rule) { const { lastTriggered: _lt, lastPayload: _lp, triggerCount: _tc, ...rest } = rule; return rest; }
function fromPersisted(p) { return { ...p, lastTriggered: undefined, lastPayload: undefined, triggerCount: 0 }; }
export class RuleStore {
    filePath;
    writeQueue = Promise.resolve();
    constructor(filePath) { this.filePath = filePath ?? defaultStorePath(); }
    async load() {
        try { const raw = await readFile(this.filePath, 'utf8'); const parsed = JSON.parse(raw); if (!Array.isArray(parsed?.rules)) return []; return parsed.rules.map(fromPersisted); }
        catch { return []; }
    }
    async save(rules) {
        const state = { version: 1, rules: rules.map(toPersisted) };
        this.writeQueue = this.writeQueue.then(() => this.write(state));
        await this.writeQueue;
    }
    async write(state) {
        try { await mkdir(dirname(this.filePath), { recursive: true }); const tmp = `${this.filePath}.tmp`; await writeFile(tmp, JSON.stringify(state, null, 2), 'utf8'); await rename(tmp, this.filePath); }
        catch { /* Best-effort */ }
    }
}
export class HistoryStore {
    filePath;
    maxEntries;
    records = [];
    writeQueue = Promise.resolve();
    constructor(filePath, maxEntries = 500) { this.filePath = filePath ?? defaultHistoryPath(); this.maxEntries = maxEntries; }
    async load() {
        try { const raw = await readFile(this.filePath, 'utf8'); const lines = raw.split('\n').filter((l) => l.trim().length > 0); this.records = lines.map((line) => { try { return JSON.parse(line); } catch { return null; } }).filter((r) => r !== null); if (this.records.length > this.maxEntries) this.records = this.records.slice(this.records.length - this.maxEntries); }
        catch { this.records = []; }
    }
    list() { return [...this.records]; }
    listForRule(ruleId) { return this.records.filter((r) => r.ruleId === ruleId); }
    append(record) {
        this.records.push(record);
        if (this.records.length > this.maxEntries) this.records.splice(0, this.records.length - this.maxEntries);
        this.writeQueue = this.writeQueue.then(() => this.persist());
    }
    async persist() {
        try { await mkdir(dirname(this.filePath), { recursive: true }); const tmp = `${this.filePath}.tmp`; const body = this.records.map((r) => JSON.stringify(r)).join('\n') + '\n'; await writeFile(tmp, body, 'utf8'); await rename(tmp, this.filePath); }
        catch { /* History persistence is best-effort */ }
    }
    async flush() { await this.writeQueue; }
}
