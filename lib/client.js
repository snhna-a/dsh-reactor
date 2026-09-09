window.__ModuleLoader__.load({
  id: "dsh-reactor",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
"use strict";
var __dshReactorExports = (() => {
  var __create = Object.create;
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getProtoOf = Object.getPrototypeOf;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
    get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
  }) : x)(function(x) {
    if (typeof require !== "undefined") return require.apply(this, arguments);
    throw Error('Dynamic require of "' + x + '" is not supported');
  });
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
    isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
    mod
  ));
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
  var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

  // src/client/index.ts
  var index_exports = {};
  __export(index_exports, {
    apply: () => apply,
    default: () => index_default
  });
  var import_react2 = __toESM(__require("react"), 1);
  var import_client = __require("react-dom/client");

  // src/client/Widget.tsx
  var import_react = __toESM(__require("react"), 1);

  // src/client/api.ts
  var ReactorApi = class {
    constructor(base = "/reactor/api") {
      __publicField(this, "base", base);
    }
    async request(path, init) {
      const res = await fetch(`${this.base}${path}`, {
        headers: { "content-type": "application/json" },
        ...init
      });
      const text = await res.text();
      let body = {};
      if (text) {
        try {
          body = JSON.parse(text);
        } catch {
          body = { error: text.slice(0, 200) };
        }
      }
      if (!res.ok) {
        const msg = body.error ?? `HTTP ${res.status}`;
        throw new Error(msg);
      }
      return body;
    }
    listRules() { return this.request("/rules"); }
    createRule(input) { return this.request("/rules", { method: "POST", body: JSON.stringify(input) }); }
    updateRule(id, patch) { return this.request("/rules", { method: "PATCH", body: JSON.stringify({ id, patch }) }); }
    deleteRule(id) { return this.request(`/rules?ruleId=${encodeURIComponent(id)}`, { method: "DELETE" }); }
    history(ruleId, limit = 100) {
      const q = new URLSearchParams();
      if (ruleId) q.set("ruleId", ruleId);
      q.set("limit", String(limit));
      return this.request(`/history?${q.toString()}`);
    }
    stats() { return this.request("/stats"); }
    events(since) { return this.request(`/events?since=${since}`); }
  };

  // src/client/Widget.tsx
  var MASCOT_URL = "/reactor/mascot.png";
  var LS_SCALE = "dsh-reactor:scale";
  var LS_POS = "dsh-reactor:pos";
  var LS_AVATAR = "dsh-reactor:avatar";
  var LS_BUBBLE = "dsh-reactor:bubble";
  function readLS(key, fallback) {
    try { const raw = localStorage.getItem(key); if (raw === null) return fallback; return JSON.parse(raw); } catch { return fallback; }
  }
  function writeLS(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch { }
  }
  var EV_TYPES = {
    "rule-triggered": { label: "触发", tone: "#4ade80" },
    "rule-added": { label: "新规则", tone: "#38bdf8" },
    "rule-updated": { label: "规则更新", tone: "#38bdf8" },
    "rule-error": { label: "规则错误", tone: "#fb923c" },
    "action-failed": { label: "动作失败", tone: "#f87171" }
  };
  var OP_LABELS = { eq: "等于", ne: "不等于", gt: "大于", lt: "小于", gte: "≥", lte: "≤", contains: "包含", matches: "匹配", exists: "存在", changed: "变化" };
  var SOURCE_LABELS = { "http-poll": "HTTP 轮询", "file-watch": "文件监听", command: "命令输出", webhook: "Webhook 推送" };
  var ACTION_LABELS = { shell: "执行命令", webhook: "Webhook 调用", "agent-talk": "Agent 会话" };
  function fmtTime(ts) {
    if (!ts) return "—";
    const d = new Date(ts);
    const pad = (n) => String(n).padStart(2, "0");
    return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }
  function fmtTokens(t) {
    if (!t) return "—";
    const total = (t.input ?? 0) + (t.output ?? 0);
    return `${total.toLocaleString()} (in ${(t.input ?? 0).toLocaleString()} / out ${(t.output ?? 0).toLocaleString()})`;
  }
  var CSS = `
.rxw-root, .rxw-root * { box-sizing: border-box; }
.rxw-root { position: fixed; z-index: 2147483000; font-family: -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif; }
.rxw-mascot-wrap { position: relative; width: 72px; height: 72px; cursor: grab; touch-action: none; user-select: none; }
.rxw-mascot-wrap:active { cursor: grabbing; }
.rxw-mascot { width: 100%; height: 100%; border-radius: 50%; overflow: hidden; box-shadow: 0 6px 24px rgba(56,189,248,.35), 0 0 0 2px rgba(255,255,255,.12) inset; transition: transform .18s cubic-bezier(.34,1.56,.64,1), box-shadow .2s ease; transform-origin: 50% 100%; background: linear-gradient(135deg, #e0f2fe, #bae6fd); }
.rxw-mascot-wrap:hover .rxw-mascot { box-shadow: 0 8px 32px rgba(56,189,248,.5), 0 0 0 2px rgba(255,255,255,.2) inset; }
.rxw-mascot-wrap.pressed .rxw-mascot { transform: scaleY(.86) scaleX(1.08); }
.rxw-mascot-wrap.glow .rxw-mascot { animation: rxw-glow 1.2s ease-out; }
@keyframes rxw-glow { 0% { box-shadow: 0 0 0 0 rgba(74,222,128,.7); } 70% { box-shadow: 0 0 0 18px rgba(74,222,128,0); } 100% { box-shadow: 0 6px 24px rgba(56,189,248,.35); } }
.rxw-mascot img { width: 100%; height: 100%; object-fit: cover; display: block; pointer-events: none; }
.rxw-root.flipped .rxw-mascot-wrap { transform: scaleX(-1); }
.rxw-badge { position: absolute; top: -2px; right: -2px; min-width: 20px; height: 20px; padding: 0 6px; border-radius: 10px; background: linear-gradient(135deg, #f87171, #ef4444); color: #fff; font-size: 11px; font-weight: 700; line-height: 20px; text-align: center; box-shadow: 0 2px 10px rgba(248,113,113,.6); }
.rxw-bubble { position: absolute; bottom: calc(100% + 14px); right: 0; width: 240px; pointer-events: none; opacity: 0; transform: translateY(8px) scale(.95); transform-origin: bottom right; transition: opacity .2s ease, transform .22s cubic-bezier(.34,1.56,.64,1); }
.rxw-bubble.open { opacity: 1; transform: none; pointer-events: auto; }
.rxw-bubble svg { display: block; width: 100%; height: auto; }
.rxw-bubble-content { position: absolute; top: 14px; left: 18px; right: 18px; bottom: 28px; display: flex; flex-direction: column; gap: 4px; color: #1e293b; }
.rxw-bubble-title { font-size: 11px; font-weight: 700; color: #0ea5e9; letter-spacing: .04em; }
.rxw-bubble-main { font-size: 20px; font-weight: 800; color: #0f172a; line-height: 1.1; }
.rxw-bubble-sub { font-size: 11px; color: #64748b; }
.rxw-menu-btn { position: absolute; top: 2px; left: -4px; width: 24px; height: 24px; border: none; border-radius: 8px; background: rgba(15,23,42,.85); cursor: pointer; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; padding: 0; opacity: 0; transition: opacity .15s; z-index: 2; }
.rxw-mascot-wrap:hover .rxw-menu-btn, .rxw-menu-btn.visible { opacity: 1; }
.rxw-menu-btn span { display: block; width: 12px; height: 2px; background: #fff; border-radius: 1px; }
.rxw-menu { position: fixed; min-width: 200px; background: rgba(255,255,255,.96); border: 1px solid rgba(14,165,233,.25); border-radius: 14px; padding: 12px 14px; box-shadow: 0 12px 40px rgba(0,0,0,.2); z-index: 2147483001; opacity: 0; transform: scale(.94) translateY(-4px); transform-origin: bottom left; transition: opacity .16s ease, transform .2s cubic-bezier(.34,1.56,.64,1); pointer-events: none; color-scheme: light; }
.rxw-menu.open { opacity: 1; transform: none; pointer-events: auto; }
.rxw-menu label { display: block; font-size: 11px; color: #475569; margin: 6px 0 4px; font-weight: 600; }
.rxw-menu input[type=range] { width: 100%; accent-color: #0ea5e9; }
.rxw-menu input[type=text] { width: 100%; background: #f1f5f9; border: 1px solid #cbd5e1; border-radius: 8px; color: #1e293b; padding: 6px 8px; font-size: 12px; }
.rxw-menu-row { display: flex; align-items: center; gap: 8px; margin: 6px 0; color: #334155; font-size: 12px; }
.rxw-panel { position: fixed; display: flex; flex-direction: column; width: 440px; max-width: calc(100vw - 20px); height: min(640px, calc(100vh - 40px)); background: rgba(15,23,42,.92); border: 1px solid rgba(56,189,248,.2); border-radius: 20px; box-shadow: 0 20px 70px rgba(0,0,0,.6), 0 0 0 1px rgba(255,255,255,.05) inset; color: #e2e8f0; font-size: 13px; overflow: hidden; backdrop-filter: blur(20px); }
.rxw-head { display: flex; align-items: center; gap: 12px; padding: 14px 16px; background: linear-gradient(135deg, rgba(14,165,233,.18), rgba(56,189,248,.08)); border-bottom: 1px solid rgba(56,189,248,.15); }
.rxw-head img { width: 40px; height: 40px; border-radius: 50%; object-fit: cover; box-shadow: 0 2px 12px rgba(56,189,248,.4); }
.rxw-head h1 { font-size: 15px; font-weight: 700; margin: 0; color: #f8fafc; }
.rxw-head p { margin: 2px 0 0; font-size: 11px; color: #7dd3fc; }
.rxw-nav { display: flex; gap: 2px; padding: 10px 12px 0; background: rgba(255,255,255,.02); }
.rxw-nav button { flex: 1; background: transparent; border: none; color: #64748b; font-size: 12px; padding: 8px 0 10px; cursor: pointer; border-bottom: 2px solid transparent; transition: color .12s; font-weight: 500; }
.rxw-nav button.on { color: #38bdf8; border-bottom-color: #38bdf8; font-weight: 700; }
.rxw-body { flex: 1; overflow-y: auto; padding: 14px; display: flex; flex-direction: column; gap: 10px; }
.rxw-body::-webkit-scrollbar { width: 6px; }
.rxw-body::-webkit-scrollbar-thumb { background: rgba(56,189,248,.3); border-radius: 3px; }
.rxw-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
.rxw-stat { background: linear-gradient(135deg, rgba(255,255,255,.06), rgba(255,255,255,.02)); border: 1px solid rgba(255,255,255,.08); border-radius: 14px; padding: 12px 10px; text-align: center; }
.rxw-stat b { display: block; font-size: 22px; font-weight: 800; color: #f8fafc; line-height: 1.1; }
.rxw-stat span { font-size: 10px; color: #64748b; margin-top: 2px; display: block; }
.rxw-card { background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.07); border-radius: 14px; padding: 12px 14px; transition: border-color .15s, background .15s; }
.rxw-card:hover { border-color: rgba(56,189,248,.25); background: rgba(255,255,255,.06); }
.rxw-row { display: flex; align-items: center; gap: 8px; }
.rxw-row .grow { flex: 1; min-width: 0; }
.rxw-name { font-weight: 600; color: #f1f5f9; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rxw-meta { font-size: 11px; color: #64748b; margin-top: 3px; }
.rxw-chip { display: inline-block; font-size: 10px; padding: 2px 8px; border-radius: 10px; background: rgba(56,189,248,.14); color: #7dd3fc; margin-right: 6px; font-weight: 600; }
.rxw-chip.green { background: rgba(74,222,128,.12); color: #4ade80; }
.rxw-chip.red { background: rgba(248,113,113,.14); color: #f87171; }
.rxw-switch { width: 36px; height: 20px; border-radius: 10px; border: none; cursor: pointer; position: relative; background: rgba(255,255,255,.15); transition: background .15s; flex: none; }
.rxw-switch.on { background: #22c55e; }
.rxw-switch::after { content: ''; position: absolute; top: 2px; left: 2px; width: 16px; height: 16px; border-radius: 50%; background: #fff; transition: left .15s; box-shadow: 0 1px 4px rgba(0,0,0,.3); }
.rxw-switch.on::after { left: 18px; }
.rxw-icon-btn { background: transparent; border: none; color: #64748b; cursor: pointer; font-size: 14px; padding: 5px 7px; border-radius: 8px; transition: color .12s, background .12s; }
.rxw-icon-btn:hover { color: #f87171; background: rgba(248,113,113,.1); }
.rxw-btn { background: linear-gradient(135deg, #0ea5e9, #0284c7); color: #fff; border: none; border-radius: 12px; padding: 9px 16px; font-size: 13px; font-weight: 600; cursor: pointer; transition: transform .1s, box-shadow .15s; box-shadow: 0 2px 12px rgba(14,165,233,.35); }
.rxw-btn:hover { transform: translateY(-1px); box-shadow: 0 4px 18px rgba(14,165,233,.5); }
.rxw-btn:active { transform: translateY(0); }
.rxw-btn.ghost { background: rgba(255,255,255,.08); color: #cbd5e1; box-shadow: none; }
.rxw-btn.ghost:hover { background: rgba(255,255,255,.14); }
.rxw-btn.danger { background: rgba(248,113,113,.16); color: #f87171; box-shadow: none; }
.rxw-field { margin-bottom: 12px; }
.rxw-field label { display: block; font-size: 11px; color: #94a3b8; margin-bottom: 5px; font-weight: 600; }
.rxw-field input, .rxw-field select, .rxw-field textarea { width: 100%; background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.12); border-radius: 10px; color: #e5e7eb; padding: 8px 11px; font-size: 12px; transition: border-color .12s; }
.rxw-field input:focus, .rxw-field select:focus, .rxw-field textarea:focus { outline: none; border-color: #0ea5e9; box-shadow: 0 0 0 3px rgba(14,165,233,.15); }
.rxw-cond { display: grid; grid-template-columns: 1fr 80px 1fr 28px; gap: 6px; margin-bottom: 6px; }
.rxw-log { font-size: 12px; color: #cbd5e1; }
.rxw-log b { color: #e2e8f0; font-weight: 600; }
.rxw-log .ok { color: #4ade80; }
.rxw-log .err { color: #f87171; }
.rxw-empty { color: #475569; text-align: center; padding: 28px 0; font-size: 12px; }
.rxw-foot { padding: 10px 16px; border-top: 1px solid rgba(255,255,255,.07); display: flex; justify-content: space-between; align-items: center; font-size: 11px; color: #64748b; background: rgba(0,0,0,.2); }
.rxw-detail .tl { color: #94a3b8; margin-bottom: 6px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .05em; }
.rxw-preset { display: inline-block; background: rgba(56,189,248,.1); border: 1px solid rgba(56,189,248,.2); color: #7dd3fc; border-radius: 10px; padding: 5px 10px; font-size: 11px; cursor: pointer; margin: 0 6px 6px 0; transition: background .12s; }
.rxw-preset:hover { background: rgba(56,189,248,.2); }
`;
  function injectCss() {
    const id = "dsh-reactor-style";
    if (document.getElementById(id)) return;
    const el = document.createElement("style");
    el.id = id;
    el.textContent = CSS;
    document.head.appendChild(el);
  }
  function Stat({ label, value, tone }) {
    return /* @__PURE__ */ import_react.default.createElement("div", { className: "rxw-stat" }, /* @__PURE__ */ import_react.default.createElement("b", { style: tone ? { color: tone } : void 0 }, value), /* @__PURE__ */ import_react.default.createElement("span", null, label));
  }
  function RuleRow({ rule, onToggle, onDelete, onOpen }) {
    return /* @__PURE__ */ import_react.default.createElement("div", { className: "rxw-card", onClick: () => onOpen(rule.id), style: { cursor: "pointer" } }, /* @__PURE__ */ import_react.default.createElement("div", { className: "rxw-row" }, /* @__PURE__ */ import_react.default.createElement("div", { className: "grow" }, /* @__PURE__ */ import_react.default.createElement("div", { className: "rxw-name" }, rule.name), /* @__PURE__ */ import_react.default.createElement("div", { className: "rxw-meta" }, /* @__PURE__ */ import_react.default.createElement("span", { className: "rxw-chip" }, SOURCE_LABELS[rule.source.kind] ?? rule.source.kind), rule.triggerCount ? /* @__PURE__ */ import_react.default.createElement("span", { className: "rxw-chip green" }, "触发 ", rule.triggerCount) : null, "最后 ", fmtTime(rule.lastTriggered))), /* @__PURE__ */ import_react.default.createElement(
      "button",
      {
        className: `rxw-switch ${rule.enabled ? "on" : ""}`,
        title: rule.enabled ? "停用" : "启用",
        onClick: (e) => { e.stopPropagation(); onToggle(rule.id, !rule.enabled); }
      }
    ), /* @__PURE__ */ import_react.default.createElement("button", { className: "rxw-icon-btn", title: "删除规则", onClick: (e) => { e.stopPropagation(); onDelete(rule.id); } }, "✕")));
  }
  function ConditionEditor({ value, onChange }) {
    const update = (i, patch) => { const next = value.slice(); next[i] = { ...next[i], ...patch }; onChange(next); };
    return /* @__PURE__ */ import_react.default.createElement("div", null, value.map((c, i) => /* @__PURE__ */ import_react.default.createElement("div", { className: "rxw-cond", key: i }, /* @__PURE__ */ import_react.default.createElement("input", { placeholder: "$.status", value: c.field, onChange: (e) => update(i, { field: e.target.value }) }), /* @__PURE__ */ import_react.default.createElement("select", { value: c.op, onChange: (e) => update(i, { op: e.target.value }) }, Object.entries(OP_LABELS).map(([k, v]) => /* @__PURE__ */ import_react.default.createElement("option", { key: k, value: k }, v))), c.op === "exists" || c.op === "changed" ? /* @__PURE__ */ import_react.default.createElement("span", null) : /* @__PURE__ */ import_react.default.createElement("input", { placeholder: "值", value: String(c.value ?? ""), onChange: (e) => update(i, { value: e.target.value }) }), /* @__PURE__ */ import_react.default.createElement("button", { className: "rxw-icon-btn", onClick: () => onChange(value.filter((_, j) => j !== i)) }, "✕"))), /* @__PURE__ */ import_react.default.createElement("button", { className: "rxw-btn ghost", style: { padding: "5px 12px", fontSize: 12 }, onClick: () => onChange([...value, { field: "$.status", op: "eq", value: "ok" }]) }, "+ 条件"));
  }
  function ActionEditor({ value, onChange }) {
    const update = (i, patch) => { const next = value.slice(); next[i] = { ...next[i], ...patch }; onChange(next); };
    return /* @__PURE__ */ import_react.default.createElement("div", null, value.map((a, i) => /* @__PURE__ */ import_react.default.createElement("div", { key: i, style: { display: "flex", gap: 6, marginBottom: 6 } }, /* @__PURE__ */ import_react.default.createElement("select", { value: a.kind, style: { width: 110, background: "rgba(255,255,255,.06)", border: "1px solid rgba(255,255,255,.12)", borderRadius: 10, color: "#e5e7eb", padding: "8px 6px", fontSize: 12 }, onChange: (e) => update(i, { kind: e.target.value }) }, Object.entries(ACTION_LABELS).map(([k, v]) => /* @__PURE__ */ import_react.default.createElement("option", { key: k, value: k }, v))), /* @__PURE__ */ import_react.default.createElement("input", { placeholder: a.kind === "agent-talk" ? "注入给 Agent 的提示词" : a.kind === "webhook" ? "https://…" : "命令", style: { flex: 1, background: "rgba(255,255,255,.06)", border: "1px solid rgba(255,255,255,.12)", borderRadius: 10, color: "#e5e7eb", padding: "8px 10px", fontSize: 12 }, value: a.target, onChange: (e) => update(i, { target: e.target.value }) }), /* @__PURE__ */ import_react.default.createElement("button", { className: "rxw-icon-btn", onClick: () => onChange(value.filter((_, j) => j !== i)) }, "✕"))), /* @__PURE__ */ import_react.default.createElement("button", { className: "rxw-btn ghost", style: { padding: "5px 12px", fontSize: 12 }, onClick: () => onChange([...value, { kind: "shell", target: "" }]) }, "+ 动作"));
  }
  function RuleDetail({ ruleId, api, onBack }) {
    const [history, setHistory] = (0, import_react.useState)([]);
    const [rule, setRule] = (0, import_react.useState)(null);
    const [loading, setLoading] = (0, import_react.useState)(true);
    (0, import_react.useEffect)(() => {
      let alive = true;
      setLoading(true);
      Promise.all([api.listRules(), api.history(ruleId, 200)]).then(([r, h]) => {
        if (!alive) return;
        setRule(r.rules.find((x) => x.id === ruleId) ?? null);
        setHistory(h.records);
      }).catch(() => { }).finally(() => alive && setLoading(false));
      return () => { alive = false; };
    }, [api, ruleId]);
    const failed = history.filter((h) => h.actions?.some((a) => !a.ok));
    return /* @__PURE__ */ import_react.default.createElement("div", { className: "rxw-detail" }, /* @__PURE__ */ import_react.default.createElement("div", { className: "rxw-row", style: { marginBottom: 12 } }, /* @__PURE__ */ import_react.default.createElement("button", { className: "rxw-btn ghost", onClick: onBack, style: { padding: "6px 12px", fontSize: 12 } }, "← 返回"), /* @__PURE__ */ import_react.default.createElement("div", { className: "grow" }, /* @__PURE__ */ import_react.default.createElement("div", { className: "rxw-name" }, rule?.name ?? ruleId), /* @__PURE__ */ import_react.default.createElement("div", { className: "rxw-meta" }, rule ? /* @__PURE__ */ import_react.default.createElement("span", { className: "rxw-chip" }, SOURCE_LABELS[rule.source.kind] ?? rule.source.kind) : null, rule ? /* @__PURE__ */ import_react.default.createElement("span", { className: "rxw-chip" }, rule.conditions.length, " 条件 / ", rule.actions.length, " 动作") : null, failed.length ? /* @__PURE__ */ import_react.default.createElement("span", { className: "rxw-chip red" }, failed.length, " 次含失败") : null))), rule?.description ? /* @__PURE__ */ import_react.default.createElement("div", { className: "rxw-card", style: { marginBottom: 10 } }, rule.description) : null, /* @__PURE__ */ import_react.default.createElement("div", { className: "rxw-card" }, /* @__PURE__ */ import_react.default.createElement("div", { className: "tl" }, "执行历史（最近 ", history.length, " 条）"), history.length === 0 ? /* @__PURE__ */ import_react.default.createElement("div", { className: "rxw-empty" }, "还没有触发记录") : [...history].reverse().map((h) => {
      const fail = h.actions?.find((a) => !a.ok);
      return /* @__PURE__ */ import_react.default.createElement("div", { key: h.id, style: { borderBottom: "1px solid rgba(255,255,255,.06)", padding: "8px 0" } }, /* @__PURE__ */ import_react.default.createElement("div", { className: "rxw-row" }, /* @__PURE__ */ import_react.default.createElement("span", { className: `rxw-chip ${h.matched ? "green" : ""}`, style: h.matched ? void 0 : { background: "rgba(148,163,184,.12)", color: "#94a3b8" } }, h.matched ? "命中" : "未命中"), /* @__PURE__ */ import_react.default.createElement("span", { style: { color: "#94a3b8", fontSize: 11 } }, fmtTime(h.at)), h.sessionResult?.tokens ? /* @__PURE__ */ import_react.default.createElement("span", { className: "rxw-chip" }, "Tokens ", fmtTokens(h.sessionResult.tokens)) : null, fail ? /* @__PURE__ */ import_react.default.createElement("span", { className: "rxw-chip red" }, "失败：", (fail.error ?? "").slice(0, 50)) : null), h.actions?.map((a, i) => /* @__PURE__ */ import_react.default.createElement("div", { key: i, className: "rxw-log", style: { marginTop: 5 } }, /* @__PURE__ */ import_react.default.createElement("span", { className: a.ok ? "ok" : "err" }, "[", a.ok ? "✓" : "✗", "]"), " ", /* @__PURE__ */ import_react.default.createElement("b", null, ACTION_LABELS[a.kind] ?? a.kind), " ", a.target.slice(0, 50), a.attempts && a.attempts > 1 ? ` · 重试 ${a.attempts - 1} 次` : "", a.error ? /* @__PURE__ */ import_react.default.createElement("span", { className: "err" }, " — ", a.error.slice(0, 70)) : null, a.attemptLog?.map((at, j) => !at.ok ? /* @__PURE__ */ import_react.default.createElement("div", { key: j, style: { color: "#f87171", fontSize: 11, marginLeft: 14 } }, "第 ", j + 1, " 次尝试失败（", at.ms, "ms）：", at.error?.slice(0, 70)) : null))));
    })));
  }
  function RuleForm({ api, onCreated }) {
    const [name, setName] = (0, import_react.useState)("");
    const [kind, setKind] = (0, import_react.useState)("command");
    const [target, setTarget] = (0, import_react.useState)("");
    const [intervalMs, setIntervalMs] = (0, import_react.useState)(6e4);
    const [conditions, setConditions] = (0, import_react.useState)([{ field: "$.status", op: "eq", value: "error" }]);
    const [actions, setActions] = (0, import_react.useState)([{ kind: "shell", target: "" }]);
    const [logic, setLogic] = (0, import_react.useState)("AND");
    const [busy, setBusy] = (0, import_react.useState)(false);
    const [err, setErr] = (0, import_react.useState)("");
    const submit = async () => {
      setErr("");
      if (!name.trim()) { setErr("请填写规则名称"); return; }
      if (!target.trim()) { setErr("请填写事件源目标"); return; }
      const cleanActions = actions.filter((a) => a.target.trim());
      if (!cleanActions.length) { setErr("至少需要一个动作"); return; }
      setBusy(true);
      try {
        await api.createRule({
          name: name.trim(),
          source_kind: kind,
          source_target: target.trim(),
          source_interval_ms: kind === "http-poll" || kind === "command" ? intervalMs : void 0,
          conditions,
          condition_logic: logic,
          actions: cleanActions,
          enabled: true
        });
        onCreated();
      } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
    };
    const presets = [
      { label: "GitHub Release 监控", kind: "http-poll", target: "https://api.github.com/repos/owner/repo/releases/latest", intervalMs: 6e5 },
      { label: "命令输出检查", kind: "command", target: 'echo {"status":"error"}', intervalMs: 3e4 },
      { label: "文件变化监听", kind: "file-watch", target: "C:\\logs\\app.log" }
    ];
    return /* @__PURE__ */ import_react.default.createElement("div", null, /* @__PURE__ */ import_react.default.createElement("div", { style: { marginBottom: 14 } }, presets.map((p) => /* @__PURE__ */ import_react.default.createElement("span", { key: p.label, className: "rxw-preset", onClick: () => { setKind(p.kind); setTarget(p.target); if (p.intervalMs) setIntervalMs(p.intervalMs); } }, p.label))), /* @__PURE__ */ import_react.default.createElement("div", { className: "rxw-field" }, /* @__PURE__ */ import_react.default.createElement("label", null, "规则名称"), /* @__PURE__ */ import_react.default.createElement("input", { value: name, placeholder: "例如：GitHub 新版本自动拉取并运行", onChange: (e) => setName(e.target.value) })), /* @__PURE__ */ import_react.default.createElement("div", { className: "rxw-field" }, /* @__PURE__ */ import_react.default.createElement("label", null, "事件源类型"), /* @__PURE__ */ import_react.default.createElement("select", { value: kind, onChange: (e) => setKind(e.target.value) }, Object.entries(SOURCE_LABELS).map(([k, v]) => /* @__PURE__ */ import_react.default.createElement("option", { key: k, value: k }, v)))), /* @__PURE__ */ import_react.default.createElement("div", { className: "rxw-field" }, /* @__PURE__ */ import_react.default.createElement("label", null, kind === "file-watch" ? "文件路径" : kind === "http-poll" ? "轮询 URL" : kind === "webhook" ? "Webhook 路径" : "命令（输出 JSON 作为事件载荷）"), /* @__PURE__ */ import_react.default.createElement("input", { value: target, onChange: (e) => setTarget(e.target.value) })), (kind === "http-poll" || kind === "command") && /* @__PURE__ */ import_react.default.createElement("div", { className: "rxw-field" }, /* @__PURE__ */ import_react.default.createElement("label", null, "轮询间隔（毫秒）"), /* @__PURE__ */ import_react.default.createElement("input", { type: "number", value: intervalMs, onChange: (e) => setIntervalMs(Number(e.target.value)) })), /* @__PURE__ */ import_react.default.createElement("div", { className: "rxw-field" }, /* @__PURE__ */ import_react.default.createElement("label", null, "条件（JSONPath 字段 + 比较符）"), /* @__PURE__ */ import_react.default.createElement(ConditionEditor, { value: conditions, onChange: setConditions }), /* @__PURE__ */ import_react.default.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8, marginTop: 8 } }, /* @__PURE__ */ import_react.default.createElement("span", { style: { fontSize: 11, color: "#94a3b8" } }, "组合逻辑"), /* @__PURE__ */ import_react.default.createElement("select", { value: logic, onChange: (e) => setLogic(e.target.value), style: { width: 90 } }, /* @__PURE__ */ import_react.default.createElement("option", { value: "AND" }, "全部满足"), /* @__PURE__ */ import_react.default.createElement("option", { value: "OR" }, "任一满足")))), /* @__PURE__ */ import_react.default.createElement("div", { className: "rxw-field" }, /* @__PURE__ */ import_react.default.createElement("label", null, "动作（命中后执行）"), /* @__PURE__ */ import_react.default.createElement(ActionEditor, { value: actions, onChange: setActions })), err ? /* @__PURE__ */ import_react.default.createElement("div", { style: { color: "#f87171", fontSize: 12, marginBottom: 10 } }, err) : null, /* @__PURE__ */ import_react.default.createElement("button", { className: "rxw-btn", style: { width: "100%" }, disabled: busy, onClick: submit }, busy ? "创建中…" : "创建规则"));
  }
  function ReactorWidget() {
    const api = (0, import_react.useMemo)(() => new ReactorApi(), []);
    const [open, setOpen] = (0, import_react.useState)(false);
    const [bubbleOpen, setBubbleOpen] = (0, import_react.useState)(false);
    const [view, setView] = (0, import_react.useState)({ name: "overview" });
    const [rules, setRules] = (0, import_react.useState)([]);
    const [stats, setStats] = (0, import_react.useState)(null);
    const [events, setEvents] = (0, import_react.useState)([]);
    const [lastSeq, setLastSeq] = (0, import_react.useState)(0);
    const [scale, setScale] = (0, import_react.useState)(() => readLS(LS_SCALE, 1));
    const [anchor, setAnchor] = (0, import_react.useState)(() => readLS(LS_POS, { h: "right", hOff: 0, v: "bottom", vOff: 0 }));
    const [avatar, setAvatar] = (0, import_react.useState)(() => readLS(LS_AVATAR, MASCOT_URL));
    const [bubbleOn, setBubbleOn] = (0, import_react.useState)(() => readLS(LS_BUBBLE, true));
    const [menuOpen, setMenuOpen] = (0, import_react.useState)(false);
    const [pressed, setPressed] = (0, import_react.useState)(false);
    const [glow, setGlow] = (0, import_react.useState)(false);
    const dragRef = (0, import_react.useRef)(null);
    const rootRef = (0, import_react.useRef)(null);
    const menuRef = (0, import_react.useRef)(null);
    const refresh = (0, import_react.useCallback)(() => {
      api.listRules().then((r) => setRules(r.rules)).catch(() => { });
      api.stats().then((s) => setStats(s.stats)).catch(() => { });
    }, [api]);
    (0, import_react.useEffect)(() => {
      injectCss();
      refresh();
      const t1 = window.setInterval(refresh, 3e4);
      const t2 = window.setInterval(() => {
        api.events(lastSeq).then((res) => {
          if (res.seq > lastSeq) {
            setLastSeq(res.seq);
            if (res.events.length) {
              setEvents((prev) => [...prev, ...res.events].slice(-100));
              const hasTrigger = res.events.some((e) => e.type === "rule-triggered" || e.type === "action-failed");
              if (hasTrigger) {
                setGlow(true);
                window.setTimeout(() => setGlow(false), 1200);
                if (bubbleOn && !open) { setBubbleOpen(true); window.setTimeout(() => setBubbleOpen(false), 4e3); }
              }
              refresh();
            }
          }
        }).catch(() => { });
      }, 5e3);
      return () => { window.clearInterval(t1); window.clearInterval(t2); };
    }, [api, lastSeq, refresh, bubbleOn, open]);
    (0, import_react.useEffect)(() => {
      if (!menuOpen) return;
      const handler = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false); };
      document.addEventListener("mousedown", handler);
      return () => document.removeEventListener("mousedown", handler);
    }, [menuOpen]);
    const unread = events.filter((e) => e.type === "rule-triggered" || e.type === "rule-error" || e.type === "action-failed").length;
    const onToggle = (0, import_react.useCallback)((id, enabled) => { api.updateRule(id, { enabled }).then(() => refresh()).catch(() => { }); }, [api, refresh]);
    const onDelete = (0, import_react.useCallback)((id) => { if (!window.confirm("确认删除这条规则？此操作不可恢复。")) return; api.deleteRule(id).then(() => refresh()).catch(() => { }); }, [api, refresh]);
    const computePos = (anc) => {
      const vp = { w: window.innerWidth, h: window.innerHeight };
      const size = 72 * scale;
      const flipped = anc.h === "left";
      if (anc.h === "right" && anc.v === "bottom") return { right: anc.hOff + 16, bottom: anc.vOff + 16, flipped };
      if (anc.h === "left" && anc.v === "bottom") return { left: anc.hOff + 16, bottom: anc.vOff + 16, flipped };
      if (anc.h === "right" && anc.v === "top") return { right: anc.hOff + 16, top: anc.vOff + 16, flipped };
      if (anc.h === "left" && anc.v === "top") return { left: anc.hOff + 16, top: anc.vOff + 16, flipped };
      const left = anc.h === null ? anc.hOff : anc.h === "left" ? anc.hOff : vp.w - size - anc.hOff;
      const top = anc.v === null ? anc.vOff : anc.v === "top" ? anc.vOff : vp.h - size - anc.vOff;
      return { left, top, flipped };
    };
    const pos = computePos(anchor);
    const dragStart = (e) => {
      if (open) return;
      setPressed(true);
      const rect = rootRef.current?.getBoundingClientRect();
      dragRef.current = { sx: e.clientX, sy: e.clientY, ox: rect?.left ?? 0, oy: rect?.top ?? 0, moved: false };
      e.currentTarget.setPointerCapture(e.pointerId);
    };
    const dragMove = (e) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = e.clientX - d.sx;
      const dy = e.clientY - d.sy;
      if (dx * dx + dy * dy > 25) d.moved = true;
      const size = 72 * scale;
      const x = Math.max(4, Math.min(window.innerWidth - size - 4, d.ox + dx));
      const y = Math.max(4, Math.min(window.innerHeight - size - 4, d.oy + dy));
      setAnchor({ h: null, hOff: x, v: null, vOff: y });
    };
    const dragEnd = (e) => {
      setPressed(false);
      const d = dragRef.current;
      dragRef.current = null;
      if (!d || !d.moved) return;
      const size = 72 * scale;
      const vp = { w: window.innerWidth, h: window.innerHeight };
      const cx = d.ox + (e.clientX - d.sx) + size / 2;
      const cy = d.oy + (e.clientY - d.sy) + size / 2;
      let h = null; let hOff = 0;
      if (cx < vp.w / 4) { h = "left"; hOff = 0; } else if (cx > vp.w * 3 / 4) { h = "right"; hOff = 0; } else { h = null; hOff = d.ox + (e.clientX - d.sx); }
      let v = null; let vOff = 0;
      if (cy < vp.h / 4) { v = "top"; vOff = 0; } else if (cy > vp.h * 3 / 4) { v = "bottom"; vOff = 0; } else { v = null; vOff = d.oy + (e.clientY - d.sy); }
      const next = { h, hOff, v, vOff };
      setAnchor(next);
      writeLS(LS_POS, next);
    };
    const mascotClick = () => {
      if (dragRef.current?.moved) return;
      if (menuOpen) { setMenuOpen(false); return; }
      setOpen((v) => !v);
      setBubbleOpen(false);
    };
    const panelPos = (() => {
      const size = 72 * scale;
      if (anchor.h === "left") return { left: Math.min(anchor.hOff + size + 12, window.innerWidth - 460), top: anchor.v === "top" ? anchor.vOff + 12 : Math.max(12, (anchor.v === null ? anchor.vOff : window.innerHeight - size - anchor.vOff) - 400) };
      return { right: anchor.h === null ? window.innerWidth - anchor.hOff + 12 : anchor.hOff + 16, top: anchor.v === "top" ? anchor.vOff + 12 : Math.max(12, window.innerHeight - 660) };
    })();
    return /* @__PURE__ */ import_react.default.createElement("div", { className: `rxw-root ${pos.flipped ? "flipped" : ""}`, ref: rootRef, style: { left: pos.left, top: pos.top, right: pos.right, bottom: pos.bottom } }, /* @__PURE__ */ import_react.default.createElement("div", { className: `rxw-bubble ${bubbleOpen && !open ? "open" : ""}` }, /* @__PURE__ */ import_react.default.createElement("svg", { viewBox: "0 0 240 130", preserveAspectRatio: "none" }, /* @__PURE__ */ import_react.default.createElement("path", { fill: "rgba(255,255,255,.97)", stroke: "rgba(14,165,233,.3)", strokeWidth: "2", strokeLinejoin: "round", d: "M 16 12 Q 16 4 24 4 L 216 4 Q 224 4 224 12 L 224 88 Q 224 96 216 96 L 140 96 L 120 116 L 116 96 L 24 96 Q 16 96 16 88 Z" })), /* @__PURE__ */ import_react.default.createElement("div", { className: "rxw-bubble-content" }, /* @__PURE__ */ import_react.default.createElement("div", { className: "rxw-bubble-title" }, "dsh-reactor · 实时状态"), /* @__PURE__ */ import_react.default.createElement("div", { className: "rxw-bubble-main" }, stats?.totalTriggers ?? 0, " ", /* @__PURE__ */ import_react.default.createElement("span", { style: { fontSize: 12, color: "#64748b", fontWeight: 500 } }, "次触发")), /* @__PURE__ */ import_react.default.createElement("div", { className: "rxw-bubble-sub" }, stats?.enabledRules ?? 0, " 规则运行中 · 最后 ", fmtTime(stats?.lastTriggerAt)), stats?.failedActions ? /* @__PURE__ */ import_react.default.createElement("div", { className: "rxw-bubble-sub", style: { color: "#f87171" } }, "⚠ ", stats.failedActions, " 次动作失败") : null)), /* @__PURE__ */ import_react.default.createElement(
      "div",
      {
        className: `rxw-mascot-wrap ${pressed ? "pressed" : ""} ${glow ? "glow" : ""}`,
        style: { transform: `scale(${scale})`, transformOrigin: pos.flipped ? "bottom left" : "bottom right" },
        onPointerDown: dragStart,
        onPointerMove: dragMove,
        onPointerUp: dragEnd,
        onPointerCancel: () => { setPressed(false); dragRef.current = null; },
        onClick: mascotClick
      },
      /* @__PURE__ */ import_react.default.createElement("div", { className: "rxw-mascot" }, /* @__PURE__ */ import_react.default.createElement("img", { src: avatar, alt: "dsh-reactor", onError: (e) => { e.target.src = MASCOT_URL; } })),
      unread > 0 && !open ? /* @__PURE__ */ import_react.default.createElement("span", { className: "rxw-badge" }, unread > 99 ? "99+" : unread) : null,
      /* @__PURE__ */ import_react.default.createElement("button", { className: "rxw-menu-btn", title: "设置", onClick: (e) => { e.stopPropagation(); setMenuOpen((v) => !v); } }, /* @__PURE__ */ import_react.default.createElement("span", null), /* @__PURE__ */ import_react.default.createElement("span", null), /* @__PURE__ */ import_react.default.createElement("span", null))
    ), menuOpen && /* @__PURE__ */ import_react.default.createElement(
      "div",
      {
        ref: menuRef,
        className: "rxw-menu open",
        style: {
          left: pos.flipped ? (pos.left ?? 0) + 80 : Math.max(8, pos.left ?? window.innerWidth - (pos.right ?? 0) - 80),
          top: (pos.top ?? window.innerHeight - (pos.bottom ?? 0) - 100) - 10
        }
      },
      /* @__PURE__ */ import_react.default.createElement("label", null, "大小 ", scale.toFixed(1), "x"),
      /* @__PURE__ */ import_react.default.createElement("input", { type: "range", min: 0.6, max: 2.5, step: 0.1, value: scale, onChange: (e) => { const v = Number(e.target.value); setScale(v); writeLS(LS_SCALE, v); } }),
      /* @__PURE__ */ import_react.default.createElement("label", null, "形象图片 URL"),
      /* @__PURE__ */ import_react.default.createElement("input", { type: "text", value: avatar, onChange: (e) => setAvatar(e.target.value), onBlur: () => writeLS(LS_AVATAR, avatar) }),
      /* @__PURE__ */ import_react.default.createElement("div", { className: "rxw-menu-row" }, /* @__PURE__ */ import_react.default.createElement("input", { type: "checkbox", checked: bubbleOn, onChange: (e) => { setBubbleOn(e.target.checked); writeLS(LS_BUBBLE, e.target.checked); }, style: { accentColor: "#0ea5e9" } }), /* @__PURE__ */ import_react.default.createElement("span", null, "触发时弹出气泡")),
      /* @__PURE__ */ import_react.default.createElement("button", { className: "rxw-btn ghost", style: { width: "100%", marginTop: 8, padding: "6px 0", fontSize: 12 }, onClick: () => { setAvatar(MASCOT_URL); writeLS(LS_AVATAR, MASCOT_URL); } }, "恢复默认形象")
    ), open && /* @__PURE__ */ import_react.default.createElement("div", { className: "rxw-panel", style: panelPos }, /* @__PURE__ */ import_react.default.createElement("div", { className: "rxw-head" }, /* @__PURE__ */ import_react.default.createElement("img", { src: avatar, alt: "", onError: (e) => { e.target.src = MASCOT_URL; } }), /* @__PURE__ */ import_react.default.createElement("div", { className: "grow" }, /* @__PURE__ */ import_react.default.createElement("h1", null, "dsh-reactor"), /* @__PURE__ */ import_react.default.createElement("p", null, "事件驱动的 Agent 自动规则引擎")), /* @__PURE__ */ import_react.default.createElement("button", { className: "rxw-icon-btn", onClick: () => setOpen(false), style: { fontSize: 18, color: "#94a3b8" } }, "✕")), /* @__PURE__ */ import_react.default.createElement("div", { className: "rxw-nav" }, /* @__PURE__ */ import_react.default.createElement("button", { className: view.name === "overview" ? "on" : "", onClick: () => setView({ name: "overview" }) }, "总览"), /* @__PURE__ */ import_react.default.createElement("button", { className: view.name === "rules" ? "on" : "", onClick: () => setView({ name: "rules" }) }, "规则"), /* @__PURE__ */ import_react.default.createElement("button", { className: view.name === "new" ? "on" : "", onClick: () => setView({ name: "new" }) }, "新建")), /* @__PURE__ */ import_react.default.createElement("div", { className: "rxw-body" }, view.name === "overview" && /* @__PURE__ */ import_react.default.createElement(import_react.default.Fragment, null, /* @__PURE__ */ import_react.default.createElement("div", { className: "rxw-stats" }, /* @__PURE__ */ import_react.default.createElement(Stat, { label: "规则总数", value: stats?.totalRules ?? 0 }), /* @__PURE__ */ import_react.default.createElement(Stat, { label: "启用中", value: stats?.enabledRules ?? 0, tone: "#4ade80" }), /* @__PURE__ */ import_react.default.createElement(Stat, { label: "累计触发", value: stats?.totalTriggers ?? 0, tone: "#38bdf8" }), /* @__PURE__ */ import_react.default.createElement(Stat, { label: "执行动作", value: stats?.totalActions ?? 0 }), /* @__PURE__ */ import_react.default.createElement(Stat, { label: "失败动作", value: stats?.failedActions ?? 0, tone: stats?.failedActions ? "#f87171" : void 0 }), /* @__PURE__ */ import_react.default.createElement(Stat, { label: "最近触发", value: fmtTime(stats?.lastTriggerAt) })), /* @__PURE__ */ import_react.default.createElement("div", { className: "rxw-card" }, /* @__PURE__ */ import_react.default.createElement("div", { className: "tl" }, "最近事件"), events.length === 0 ? /* @__PURE__ */ import_react.default.createElement("div", { className: "rxw-empty" }, "暂无事件——创建规则后，轮询/推送事件会出现在这里") : [...events].reverse().slice(0, 20).map((e) => /* @__PURE__ */ import_react.default.createElement("div", { key: e.seq, className: "rxw-row", style: { padding: "5px 0", borderBottom: "1px solid rgba(255,255,255,.05)" } }, /* @__PURE__ */ import_react.default.createElement("span", { className: "rxw-chip" }, EV_TYPES[e.type]?.label ?? e.type), /* @__PURE__ */ import_react.default.createElement("span", { className: "grow", style: { color: "#cbd5e1", fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, e.ruleName ?? e.ruleId), /* @__PURE__ */ import_react.default.createElement("span", { style: { color: "#64748b", fontSize: 11 } }, fmtTime(e.at)))))), view.name === "rules" && (rules.length === 0 ? /* @__PURE__ */ import_react.default.createElement("div", { className: "rxw-empty" }, "还没有规则。", /* @__PURE__ */ import_react.default.createElement("br", null), /* @__PURE__ */ import_react.default.createElement("button", { className: "rxw-btn", style: { marginTop: 12 }, onClick: () => setView({ name: "new" }) }, "创建第一条规则")) : rules.map((r) => /* @__PURE__ */ import_react.default.createElement(RuleRow, { key: r.id, rule: r, onToggle, onDelete, onOpen: (id) => setView({ name: "detail", ruleId: id }) }))), view.name === "new" && /* @__PURE__ */ import_react.default.createElement(RuleForm, { api, onCreated: () => { setView({ name: "rules" }); refresh(); } }), view.name === "detail" && /* @__PURE__ */ import_react.default.createElement(RuleDetail, { key: view.ruleId, ruleId: view.ruleId, api, onBack: () => setView({ name: "rules" }) })), /* @__PURE__ */ import_react.default.createElement("div", { className: "rxw-foot" }, /* @__PURE__ */ import_react.default.createElement("span", null, "总触发 ", stats?.totalTriggers ?? 0, " · 总动作 ", stats?.totalActions ?? 0), /* @__PURE__ */ import_react.default.createElement("button", { className: "rxw-btn ghost", style: { padding: "4px 12px", fontSize: 11 }, onClick: refresh }, "刷新"))));
  }

  // src/client/index.ts
  function apply(ctx) {
    const c = ctx;
    c.effect(() => {
      const host = document.createElement("div");
      host.dataset.reactorWidgetHost = "";
      const root = (0, import_client.createRoot)(host);
      root.render(import_react2.default.createElement(ReactorWidget));
      document.body.appendChild(host);
      return () => { root.unmount(); host.remove(); };
    });
  }
  var index_default = { apply };
  return __toCommonJS(index_exports);
})();

    module.exports = (typeof __dshReactorExports !== "undefined" ? __dshReactorExports : module.exports);
    return module.exports;
  }
});
