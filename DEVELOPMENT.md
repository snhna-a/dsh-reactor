# dsh-reactor 开发文档

> 事件驱动智能决策引擎（ECA：Event-Condition-Action）—— DeepSeek Harness 插件
>
> 文档版本：v3（一期基线 + 二期升级 + 三期挂件）｜更新时间：2026-09-09

---

## 目录

- [一、项目概述](#一项目概述)
- [二、一期已有功能（v0.1.0）](#二一期已有功能v010)
- [三、架构设计](#三架构设计)
- [四、开发与构建](#四开发与构建)
- [五、安装与验证](#五安装与验证)
- [六、发布与收录](#六发布与收录)
- [七、后续规划](#七后续规划)
- [八、二期升级功能（v0.2.0）](#八二期升级功能v020)
- [九、三期升级功能（v0.3.0）——可视化挂件](#九三期升级功能v030可视化挂件)

---

## 一、项目概述

**定位**：dsh-reactor 是一个基于 **ECA（Event-Condition-Action）** 规则模型的 DeepSeek Harness 插件。与传统的定时任务插件（"到点执行预设命令"的时间驱动）不同，dsh-reactor 采用**状态驱动**——持续监控事件源、评估条件、状态变化或条件满足时才自动执行可组合动作，让 Agent 从"随叫随到的助理"变成"主动感知的守护进程"。

**核心差异**：
- 主流调度插件（dsh-automation / dsh-cron / dsh-cron-panel）都是时间驱动（Cron 到点执行）
- dsh-reactor 是条件/状态驱动（`changed` 状态变化、多条件 AND/OR、JSONPath 取值判断）
- dsh-automation 官方 README 明确声明"应响应文件/HTTP/进程条件的任务不适合它"——这正是 dsh-reactor 的定位缝隙

**仓库地址**：https://github.com/snhna-a/dsh-reactor（Public，已推送，topic `dsh-plugin` 待手动添加）
**包名**：`dsh-reactor`（npm 未占用，已核验）

---

## 二、一期已有功能（v0.1.0）

### 2.1 功能清单

| # | 功能 | 说明 | 状态 |
|---|------|------|------|
| 1 | ECA 规则引擎 | 事件源采集 → 条件评估 → 动作执行 的完整闭环 | ✅ 已实现 |
| 2 | 事件源：http-poll | 轮询 HTTP 接口，自动解析 JSON/文本响应 | ✅ 已实现 |
| 3 | 事件源：file-watch | 轮询读取本地文件内容，解析 JSON/文本 | ✅ 已实现 |
| 4 | 事件源：command | 执行 shell 命令并解析 stdout（JSON 优先） | ✅ 已实现 |
| 5 | 条件引擎 | JSONPath 取值 + 10 种比较运算符 | ✅ 已实现 |
| 6 | 多条件组合 | AND / OR 逻辑组合 | ✅ 已实现 |
| 7 | 状态感知 | `changed` 操作符（对比上次载荷） | ✅ 已实现 |
| 8 | 动作：shell | 执行命令，支持 `{{payload.field}}` 模板替换 | ✅ 已实现 |
| 9 | 动作：webhook | POST JSON 到 URL，自动附加事件载荷 | ✅ 已实现 |
| 10 | 动作：agent-talk | 向 Agent 会话注入提示词（v0.1.0 为事件广播） | ⚠️ 一期为简化版 |
| 11 | 冷却时间 | `cooldownMs` 防止频繁触发 | ✅ 已实现 |
| 12 | 并发限制 | `maxConcurrentActions` 全局并发上限 | ✅ 已实现 |
| 13 | 错误隔离 | 单动作失败不影响其他动作 | ✅ 已实现 |
| 14 | 模型可见工具 ×5 | reactor_define / list / status / remove / test | ✅ 已实现 |
| 15 | 静态规则配置 | cordis.patch.yml 预定义规则 | ✅ 已实现 |
| 16 | 可逆卸载 | 插件卸载自动清理定时器 | ✅ 已实现 |

### 2.2 模型可见工具（一期）

| 工具 | 用途 | 关键参数 |
|------|------|----------|
| `reactor_define` | 创建 ECA 规则 | source_kind / source_target / conditions / actions / cooldown_ms |
| `reactor_list` | 列出所有规则及运行状态 | — |
| `reactor_status` | 查看规则详情（含最近载荷） | rule_id |
| `reactor_remove` | 删除规则并停止轮询 | rule_id |
| `reactor_test` | 用模拟载荷手动测试规则 | rule_id / payload |

### 2.3 条件操作符（10 种）

| 操作符 | 说明 | 示例 |
|--------|------|------|
| `eq` / `ne` | 等于 / 不等于 | `$.status eq "error"` |
| `gt` / `lt` / `gte` / `lte` | 数值比较 | `$.count gt 5` |
| `contains` | 字符串包含 | `$.name contains "hello"` |
| `matches` | 正则匹配 | `$.code matches "^\\d+$"` |
| `exists` | 字段存在 | `$.token exists` |
| `changed` | 与上次载荷相比变化 | `$.sha changed` |

### 2.4 一期配置项

```yaml
# cordis.patch.yml
- id: dsh-reactor
  name: 'dsh-reactor'
  config:
    allowShell: true              # 是否允许 shell 动作
    maxConcurrentActions: 3       # 全局最大并发动作数
    defaultIntervalMs: 60000      # 默认轮询间隔（毫秒）
    rules: []                     # 静态规则列表（可选）
```

### 2.5 一期已知限制

| # | 限制 | 影响 |
|---|------|------|
| 1 | 规则仅存内存 | **重启 dsh 后规则全部丢失** |
| 2 | agent-talk 仅 emit 事件广播 | 未真正创建隔离 Session 执行，无执行边界 |
| 3 | 无运行历史记录 | 只有触发计数，无法审计每次执行结果 |
| 4 | 事件源仅轮询型 | 外部系统无法主动推送事件 |
| 5 | 无 Web UI | 全部通过 Agent 对话交互（设计如此） |

> 限制 1-4 对应 P0/P1 升级项，见[第七章](#七后续规划)。

---

## 三、架构设计

### 3.1 总体结构

```
┌────────────────────────────────────────────────────────────┐
│                      dsh-reactor 插件                       │
│                                                            │
│  ┌──────────────┐   ┌──────────────┐   ┌──────────────┐   │
│  │  EventSource │──▶│  Condition   │──▶│    Action    │   │
│  │  (事件源)     │   │  (条件引擎)   │   │  (动作执行)   │   │
│  └──────────────┘   └──────────────┘   └──────────────┘   │
│         │                  │                   │           │
│    http-poll          jsonPath/jq          shell          │
│    file-watch         10 种操作符          webhook         │
│    command            AND/OR 组合         agent-talk      │
│                                                            │
│  ┌────────────────────────────────────────────────────┐    │
│  │  模型可见工具 (ctx.tools)                           │    │
│  │  reactor_define / list / status / remove / test    │    │
│  └────────────────────────────────────────────────────┘    │
│                                                            │
│  运行时状态：规则表 + 上次载荷表 + 定时器表（可逆清理）       │
└────────────────────────────────────────────────────────────┘
```

### 3.2 模块划分

```
src/
├── index.ts              # 插件入口：name / inject / Config / apply
├── types.ts              # ECA 类型定义
├── engine.ts             # 核心引擎：事件源轮询 + 条件评估 + 动作执行
├── conditions.ts         # JSONPath 取值 + 条件评估器
├── tools.ts              # 模型可见工具注册
└── actions/
    ├── shell.ts          # shell 动作（含 {{payload.field}} 插值）
    ├── webhook.ts        # webhook POST 动作
    └── agent-talk.ts     # agent-talk 动作（一期：事件广播）
```

### 3.3 核心流程

```
插件加载 (apply)
  ├── 初始化 ReactorEngine
  ├── 加载静态规则（config.rules）
  ├── 注册 5 个模型可见工具
  └── ctx.effect(() => 卸载时 engine.dispose())   # 可逆清理

规则生命周期
  addRule → startSource（启动轮询定时器）
          → collectPayload（采集事件源数据）
          → evaluate（评估条件：AND/OR + changed）
          → executeActions（执行动作：shell/webhook/agent-talk）
  removeRule → stopSource（清除定时器）
  dispose → 清除全部定时器与规则
```

### 3.4 依赖注入

```typescript
export const inject = ['tools', 'webServer']   // 必需服务：工具注册表 + HTTP 载体（v0.3）
```

---

## 四、开发与构建

### 4.1 环境要求

| 依赖 | 版本 |
|------|------|
| Node.js | ^22.19.0 或 >=24.0.0 |
| pnpm | >=10 |
| TypeScript | ^5.7.0 |

### 4.2 命令

```bash
pnpm install                 # 安装依赖（需官方 registry）
pnpm typecheck               # 类型检查
pnpm build                   # 构建到 lib/（含 client 产物）
node test/smoke.mjs          # 核心引擎冒烟测试（37 项断言）
node test/boot-check.mjs     # 真实 Cordis 启动验证（无/有 webServer 两场景）
node examples/github-release-watcher.mjs   # 端到端演示（真实请求 GitHub）
node scripts/api-smoke.mjs   # v0.3 REST API 全链路冒烟（8 步）
```

### 4.3 依赖声明（package.json）

```json
{
  "dependencies": {
    "execa": "^9.5.2",
    "react": "^18.2.0",
    "react-dom": "^18.2.0"
  },
  "peerDependencies": {
    "@deepseek-ai/cordis": "^4.0.0",
    "@deepseek-ai/dsh-tools": "^0.1.2-rc.1",
    "@deepseek-ai/schemastery": "^3.18.0"
  }
}
```

### 4.4 Bundle 声明

```json
"dsh": {
  "bundle": {
    "patch": "./cordis.patch.yml"
  },
  "client": {
    "inject": ["@deepseek-ai/dsh-client-runtime"],
    "platform": "web"
  }
}
```

---

## 五、安装与验证

### 5.1 安装

```bash
dsh plugin --profile web add dsh-reactor
```

### 5.2 本地开发安装

```bash
# 在插件目录（无空格路径，如 C:\dsh-reactor）执行：
dsh plugin --profile web add .
```

> ⚠️ Windows 注意：插件路径含空格（如 `User Data`）会导致 pnpm 拆分参数，需放到无空格路径。

### 5.3 验证清单

| 验证项 | 方法 | 预期 |
|--------|------|------|
| 配置树挂载 | `dsh --profile web --dump-config` | 显示 `dsh-reactor` 行（PowerShell 用 `Select-String`，非 `grep`） |
| 工具可见 | 对话中问 Agent"有哪些 reactor 工具" | 列出 6 个工具（v0.2 含 reactor_history） |
| 规则创建 | 对话让 Agent 调 reactor_define | 返回规则 ID |
| 规则测试 | 对话让 Agent 调 reactor_test | 返回匹配结果 |
| 挂件可见 | 打开 http://127.0.0.1:3080/ 刷新（Ctrl+F5） | 右下角出现 mascot，点击展开面板（v0.3） |
| 卸载清理 | `dsh plugin --profile web remove dsh-reactor` + 重启 | 插件完全移除 |

### 5.4 冒烟测试覆盖

| 测试组 | 覆盖点 |
|--------|--------|
| jsonPath | 嵌套取值 / 数组索引 / 缺失路径 |
| 条件评估 | 10 种操作符正反例 |
| AND/OR | 组合逻辑 |
| 引擎生命周期 | addRule / getRule / removeRule / dispose |
| 错误隔离 | 动作失败不崩溃 |
| 持久化（v0.2） | 规则重启恢复 / 运行时状态剥离 / 历史跨重启 |
| webhook 分派（v0.2） | 路径过滤 / 条件评估 / 触发计数 |
| 启动验证（v0.2） | boot-check：无 webServer 降级 + 有 webServer 挂载路由 |
| REST API（v0.3） | api-smoke：webhook 202 / 创建 201 / 列表 / 历史 / stats / events / 删除 / 清理 8 步 |

---

## 六、发布与收录

### 6.1 发布到 npm

```bash
pnpm build
npm publish --access public
```

### 6.2 收录要求（dsh-plugin.org）

- [x] GitHub 仓库设为 Public（https://github.com/snhna-a/dsh-reactor）
- [ ] 仓库 Topics 添加 `dsh-plugin`（需在仓库 Settings → Topics 手动添加）
- [x] README 含安装命令 `dsh plugin --profile web add dsh-reactor`
- [ ] 插件导出 `apply(ctx)` 模块（✅ 已满足）
- [ ] package.json 声明 `dsh.bundle.patch`（✅ 已满足）
- [ ] 开源许可证 MIT（✅ 已满足）
- [ ] README 声明"社区插件，非官方出品"

---

## 七、后续规划

> 状态更新（2026-09-09）：P0、P1 四项已在 v0.2.0 全部实现并验证；P2-2 可视化面板已在 v0.3.0 落地，详见[第九章](#九三期升级功能v030可视化挂件)。

### P0（高优先级）—— ✅ 已在 v0.2.0 完成

| # | 事项 | 说明 |
|---|------|------|
| P0-1 | 规则持久化 | 规则落盘 JSON，重启 dsh 自动恢复 ✅ |
| P0-2 | agent-talk 真实会话执行 | 创建隔离 Workspace Session，让 Agent 在干净边界内执行任务 ✅ |

### P1（中优先级）—— ✅ 已在 v0.2.0 完成

| # | 事项 | 说明 |
|---|------|------|
| P1-1 | 运行历史记录 | 记录每次触发的动作结果、耗时、状态，可审计 ✅ |
| P1-2 | webhook 接收端点 | 让外部系统主动推送事件（HTTP POST），而非仅轮询 ✅ |

### P2（低优先级）

| # | 事项 | 说明 |
|---|------|------|
| P2-1 | 通知渠道 | ServerChan / 钉钉 / 飞书 webhook 模板 |
| P2-2 | Web UI 面板 | 参考 dsh-widgets 模式扩展可视化规则管理（✅ 已在 v0.3.0 落地为挂件） |
| P2-3 | http-poll headers 暴露 | 支持私有 GitHub 仓库等带鉴权请求 |

---

## 八、二期升级功能（v0.2.0）

> 本节为二期（P0 + P1）实现完成后的增量能力记录。基于一期的四个已知限制（规则不持久化、agent-talk 无真实执行、无运行历史、无推送事件源）逐项补齐。

### 8.1 升级总览

| 一期限制 | 二期升级 | 对应模块 | 状态 |
|----------|----------|----------|------|
| 规则仅存内存，重启丢失 | **P0-1 规则持久化** | `store.ts` (RuleStore) | ✅ 已实现 |
| agent-talk 仅事件广播 | **P0-2 真实隔离会话执行** | `agent-session.ts` | ✅ 已实现 |
| 无运行历史，不可审计 | **P1-1 运行历史记录** | `store.ts` (HistoryStore) + `reactor_history` | ✅ 已实现 |
| 事件源仅轮询型 | **P1-2 webhook 接收端点** | `webhook-server.ts` + engine.dispatchWebhook | ✅ 已实现 |

**新增工具**：`reactor_history`（模型可见，查询执行历史）
**版本**：0.1.0 → 0.2.0

### 8.2 P0-1 规则持久化

**实现**：
- 规则以 JSON 文档落盘（默认 `$DSH_HOME/reactor/rules.json`，可用 `storePath` 配置）
- 写入采用"临时文件 + rename"原子替换，且 `RuleStore` 内部串行化写队列，避免并发 save 竞争同一临时文件（Windows rename 竞态已实测修复）
- 落盘前剥离运行时字段（`lastTriggered` / `lastPayload` / `triggerCount`），恢复后从零计数
- 插件启动时 `engine.loadPersisted()` 恢复规则并自动重启事件源轮询
- 卸载时先持久化再清空（dispose 顺序已修正，避免保存空规则表）

**验证**：冒烟测试 `persistence` 组 —— 建规则 → dispose → 新引擎 loadPersisted 恢复规则 → 校验名称、运行时状态剥离、历史跨重启保留。

### 8.3 P0-2 agent-talk 真实隔离会话执行

**实现**：
- 新增 `agent-session.ts`，参照官方 `@deepseek-ai/dsh-webhook` 的 `createWebhookSession` 实现
- 流程：解析 preset → 创建工作区目录 → `workspaceRegistry.create()` → `agents.create()`（`origin: 'subagent'`、继承当前模型选择）→ `workspace.attachSession()` → 设置权限 preset 与会话标题 → `agent.followup(prompt)` 注入任务
- **干净执行边界**：每个 agent-talk 动作在独立工作区（默认 `$DSH_HOME/reactor/workspaces/<ruleId>`）+ 独立 Session 中执行，不污染主对话
- preset 可配置：`agentPreset`（默认 `standard`，可用 `minimal`/`cordis`/`ptc`）、`permissionPreset`（默认 `workspace-write`，可 `danger-full-access`）
- **优雅降级**：所有宿主服务通过 `ctx.get()` 可选解析；profile 缺少 `agents`/`workspaceRegistry`/`agentPresets` 时返回带错误信息的 `SessionRunResult`，不阻塞插件加载；`allowAgentSession: false` 时回退为事件广播
- 执行结果（sessionId / workspacePath / ok / error / ms）进入运行历史

**已知限制（与官方 webhook runtime 一致）**：
- fire-and-forget：`followup()` 成功后即视为已提交，不等待 Agent 完成，无完成状态回传
- 创建失败（preset 非法 / 工作区冲突等）记录在 `sessionResult.error`

### 8.4 P1-1 运行历史记录

**实现**：
- 每次触发（匹配或不匹配）追加一条 `TriggerRecord`：时间、规则、是否匹配、动作明细（类型/目标/成败/错误/耗时 ms）、Agent 会话结果
- 内存环形缓冲（默认 500 条，`maxHistoryEntries` 可配）+ JSON Lines 落盘（默认 `$DSH_HOME/reactor/history.jsonl`）
- 磁盘写入串行化（写队列），失败不阻塞规则执行（best-effort）
- 插件卸载时 `flush()` 等待待写队列排空
- 新增模型可见工具 `reactor_history`（可选按 `rule_id` 过滤、`limit` 截断），Agent 对话即可查询审计

**验证**：冒烟测试 —— 匹配/不匹配均产生记录、匹配记录含动作明细与耗时、历史跨重启保留、`listForRule` 过滤正确。

### 8.5 P1-2 webhook 接收端点事件源

**实现**：
- 新增 `webhook-server.ts`：在宿主 `webServer` 上注册精确路由（默认 `/reactor/webhook`，`webhookPath` 可配）
- HTTP 契约：仅接受 `POST application/json`；`202` 已分发、`400` 非法 JSON、`401` 令牌错误、`405` 非 POST、`413` 体积超限（默认 1 MiB）、`415` 非 JSON、`503` 引擎不可用
- 可选令牌：配置 `webhookToken` 后要求请求头 `x-reactor-token` 匹配（对外暴露时建议启用 + 反向代理 TLS）
- 引擎侧新增 `dispatchWebhook(payload, path)`：遍历 `source.kind === 'webhook'` 的规则，按路径过滤（`source.target` 非 `/` 时须精确匹配）、评估条件、命中则执行动作并记录历史
- webhook 事件源无轮询定时器（由推送驱动），`reactor_define` 的 `source_kind` 枚举已扩展 `webhook`
- 路由注册是可逆 effect，插件卸载自动摘除

**验证**：冒烟测试 —— 路径过滤（同路径触发、异路径跳过）、条件评估（命中/未命中）、引擎分派计数正确。

### 8.6 二期新增/变更文件清单

| 文件 | 变更 |
|------|------|
| `src/store.ts` | 新增：RuleStore（持久化）+ HistoryStore（历史） |
| `src/agent-session.ts` | 新增：真实 Agent 会话执行 |
| `src/webhook-server.ts` | 新增：HTTP 接收端点 |
| `src/types.ts` | 扩展：EventSourceKind + webhook；新增 TriggerRecord / ActionRunRecord / SessionRunResult / PersistedState / PersistedRule；Config 新增 9 项 |
| `src/engine.ts` | 接入持久化、历史、webhook 分派、真实会话；closed 标志防 dispose 后空转；dispose 顺序修正 |
| `src/actions/agent-talk.ts` | 改造：真实会话优先，事件广播降级 |
| `src/tools.ts` | reactor_define 支持 webhook；新增 reactor_history |
| `src/index.ts` | 加载持久化、注册 webhook 入口、新 Config 项 |
| `test/smoke.mjs` | 新增 persistence / webhook / interpolate 测试（37 项全过） |
| `test/boot-check.mjs` | 新增：真实 Cordis 启动验证（无/有 webServer 两场景） |
| `examples/github-release-watcher.mjs` | 新增：真实 GitHub Release 监控端到端演示（含 API 限流/断连降级） |
| `README.md` | 新功能文档化 + 真实效果演示 + GitHub 监控示例 + 兼容性声明 |
| `package.json` | 版本 0.2.0 |

### 8.7 二期验证记录

| 验证项 | 结果 |
|--------|------|
| `tsc` 类型检查（cordis 4.0.2 / dsh-tools 0.1.2-rc.1 / schemastery 3.18.2） | ✅ 0 错误 |
| 冒烟测试（37 项：jsonPath/条件/AND-OR/插值/引擎生命周期/持久化/历史/webhook 分派） | ✅ 37/37 通过 |
| Windows rename 并发竞态 | ✅ 串行写队列修复 |
| dispose 持久化顺序 | ✅ 先存后清 |
| 真实 Cordis 启动验证（`test/boot-check.mjs`：无 webServer / 有 webServer 两场景） | ✅ 2/2 通过 |
| webServer 可选注入修复 | ✅ `ctx.get('webServer')` 替代直接属性访问，消除 `cannot get property "webServer" without inject` 启动崩溃 |
| testRule 状态感知修复 | ✅ `testRule` 更新 prevPayloads，`changed` 条件在测试路径与轮询路径行为一致 |
| 模板插值兼容修复 | ✅ `{{payload.field}}` 与 `{{field}}` 等价（剥离 `payload.` 前缀），与文档写法一致 |
| 真实端到端演示（`examples/github-release-watcher.mjs`，真实请求 GitHub） | ✅ 基线触发 → 同版本不触发 → 新版本再触发；API 限流/SSL 失败自动降级 HTML 端点 |

### 8.8 二期遗留与后续建议

- agent-talk 会话执行结果（Agent 最终回复）暂无回传机制（fire-and-forget 设计）；如需完整闭环，后续可监听 `session/finish` 事件补充 `SessionRunResult`
- webhook 端点仅在 dsh 进程存活期间接收事件（无消息队列），崩溃窗口内的事件会丢失——如需强投递可前置消息队列/重放
- 真实会话执行需在带 web 栈的 profile（web）下验证；headless 环境会降级为事件广播

---

## 九、三期升级功能（v0.3.0）——可视化挂件

> 本节为三期实现完成后的增量能力记录。核心目标：把"规则定义与监控"从**对话框自然语言**升级为**可视化挂件**——右下角常驻卡通形象、触发即气泡提醒、点击展开管理面板，规则增删改、触发历史、动作日志、Token 消耗、失败重试与报错分析全部可视化。

### 9.1 升级总览

| 三期目标 | 实现方式 | 模块 | 状态 |
|----------|----------|------|------|
| 挂件入口 | `dsh.client` manifest + client `ctx.effect` + `createRoot` 直挂 `document.body`（对齐 dsh-cron-panel 验证路径） | `src/client/*` + `scripts/build-client.mjs` | ✅ 已实现并目验 |
| 规则/状态/历史可视化 | 服务端 REST API（7 路由）供挂件读取与操作 | `src/api-server.ts` | ✅ 已实现并实测 |
| 气泡提醒 | client 轮询 events API（seq 增量）→ toast + 未读角标 | `src/client/Widget.tsx` | ✅ 已实现 |
| 形象自定义 | 大小 0.6–2.5x 缩放、拖拽吸附、自定义形象 URL（localStorage 持久化） | `src/client/Widget.tsx` | ✅ 已实现 |
| webServer 注入修复 | `inject: ['tools', 'webServer']` + prefix 单路由（对齐 dsh-cron-panel） | `src/index.ts` / `api-server.ts` / `webhook-server.ts` | ✅ 已修复并验证 |

**版本**：0.2.0 → 0.3.0

### 9.2 WebServer 接入与两个关键修复

v0.3 是首个需要 `webServer` 服务的版本。实现过程中定位并修复了两个启动/路由级问题，与社区插件 dsh-cron-panel 的接入模式对齐后全部解决：

**修复 1：`ctx.get('webServer')` 返回 undefined**
- 现象：插件 `apply` 时 `ctx.get('webServer')` 为 `undefined`，API/webhook 路由全部注册失败（API 404、webhook 405）
- 根因：cordis 4 中**未在 `inject` 声明依赖的服务对插件不可见**（`ctx.get` 同样受门禁约束）
- 修复：`export const inject = ['tools', 'webServer']`，代码中直接 `ctx.webServer`（cordis 通过声明合并类型注入）

**修复 2：同路径 GET/POST 注册 duplicate exact 路由**
- 现象：`Error: webserver: duplicate exact route "/reactor/api/rules"`，dsh web 启动崩溃
- 根因：webServer 的 exact 路由表**按 path 唯一**（不区分 method），api-server 曾对 `rules` 分别注册 GET 与 POST 两个 exact 路由
- 修复：改为**单个 `kind: 'prefix'` 路由**（path `/reactor/api`）+ handler 内按 `method + path` 分发——与 dsh-cron-panel 验证过的模式一致

### 9.3 REST API（挂件数据通道）

单条 prefix 路由 `/reactor/api`，内部按 `{ method, path }` 分发：

| 方法 + 路径 | 用途 |
|------------|------|
| `GET /stats` | 总览统计：规则数、启用数、总触发次数、动作成败、最后触发时间 |
| `GET /rules` | 列出全部规则（含触发计数、最后载荷） |
| `POST /rules` | 创建规则（与 `reactor_define` 同一契约，自然语言/表单两入口） |
| `PATCH /rules` | 更新规则（启停、修改条件/动作） |
| `DELETE /rules?ruleId=` | 删除规则 |
| `GET /history` | 执行历史（含每动作成败/耗时/重试/Token 消耗/失败信息） |
| `GET /events?since=` | 事件流（seq 单调递增，挂件增量轮询驱动气泡提醒） |

- 认证：本机回环默认放行；配置 `webhookToken` 后要求 `x-reactor-token` 请求头（与 webhook 入口一致）
- 安全：`DELETE`/`PATCH` 等写操作与读操作同权，默认仅监听 `127.0.0.1`

### 9.4 客户端加载链

**声明**（package.json）：

```json
"exports": { "./client": { "default": "./lib/client.js" } },
"dsh": {
  "bundle": { "patch": "./cordis.patch.yml" },
  "client": {
    "inject": ["@deepseek-ai/dsh-client-runtime"],
    "platform": "web"
  }
}
```

**加载机制**（已对照 dsh-cron-panel@0.1.11 产物与 `@deepseek-ai/dsh-client-modules` 源码实证）：
1. dsh-client-modules 扫描 host Loader 中声明 `dsh.client` 的包（增量、按 fiber 事件驱动），组合成 `window.__DSH_BOOT__` 模块图
2. 组合产物经 `/plugins/??<id>/client.js&rev=<hash>` combo 路由下发；**组合失败（如缺产物）会抛 `ClientPackageCompositionError` 导致启动失败**——启动无此错误即证明 client 已被识别
3. 产物格式必须为 `window.__ModuleLoader__.load({ id, factory: (require) => {...} })`（esbuild bundle + IIFE 包装，见 `scripts/build-client.mjs`）；`react` / `react-dom/client` 经 factory `require` 从宿主模块表解析（esbuild external）
4. UI 注册：client 入口 `apply(ctx)` 内 `ctx.effect(() => { host = createElement('div'); createRoot(host).render(<ReactorWidget/>); document.body.appendChild(host) })`——挂件根节点 `.rxw-root` 用 `position: fixed` 定位，**不依赖 slots/shell.overlay**，与 dsh-cron-panel client 的挂载方式一致（已实证：slots 链在 client 端存在"未声明 inject 不可见"同类门禁风险，DOM 直挂规避整条链路）

**挂件功能清单**：
- 右下角 mascot 气泡（默认形象为浅蓝小反应堆机器人，可用 localStorage `dsh-reactor:avatar` 覆盖为任意图片 URL）
- 拖拽吸附（四角/四边）、大小 0.6–2.5x 缩放（localStorage `dsh-reactor:scale` / `dsh-reactor:pos`）
- 未读角标 + toast 气泡提醒（规则触发、动作失败、重试耗尽等事件）
- 展开面板：总览（统计卡 + 最近事件流）｜规则列表（启停开关、删除、点击进详情）｜新建规则表单（含 GitHub Release 监控等快捷预设）｜规则详情（执行历史、每动作成功/失败、重试次数、attemptLog、Agent 会话 Token 消耗、失败信息）

### 9.5 三期新增/变更文件清单

| 文件 | 变更 |
|------|------|
| `src/client/Widget.tsx` | 新增：挂件全部 UI（约 33KB） |
| `src/client/api.ts` | 新增：REST 客户端（ReactorApi，覆盖 7 路由） |
| `src/client/index.ts` | 新增：client 入口（`ctx.effect` + `createRoot` 直挂 body） |
| `scripts/build-client.mjs` | 新增：esbuild + ModuleLoader 包装构建脚本 |
| `lib/client.js` + `.map` | 构建产物（约 42KB / 62KB） |
| `src/api-server.ts` | 新增：REST API（prefix 单路由 + 内部分发） |
| `src/webhook-server.ts` | 重构：`ctx.webServer` 直取 + 支持 `prefix` 类型 |
| `src/index.ts` | `inject` 增加 `webServer`；注册 API 服务；Config 新增 `apiPath` / `uiEnabled` |
| `src/types.ts` | 扩展：ReactorEvent / ReactorStats / ActionAttempt.sessionResult |
| `package.json` | 版本 0.3.0；`dsh.client` + `./client` exports；client 构建依赖 |
| `scripts/api-smoke.mjs` | 新增：REST API 全链路冒烟（8 步） |

### 9.6 三期验证记录

| 验证项 | 结果 |
|--------|------|
| `tsc` 类型检查（含 client tsconfig） | ✅ 0 错误 |
| `pnpm build`（host + client 双产物） | ✅ lib/index.js + lib/client.js（42KB） |
| dsh web 重启（真实 profile，link 到新目录） | ✅ 启动无崩溃，插件正常加载 |
| REST API 全链路冒烟（`scripts/api-smoke.mjs`） | ✅ 8/8：webhook 202、创建 201、列表、历史、stats、events 增量、删除 200、清理确认 |
| 引擎真实运行 | ✅ 轮询规则持续触发，stats 计数增长（totalTriggers/totalActions） |
| client 组合加载 | ✅ 启动无 `ClientPackageCompositionError`（client 已被 dsh-client-modules 识别组合） |
| webhook 端点 | ✅ POST 返回 202（与 REST 同服务器，认证放行） |
| 浏览器渲染 | ✅ 已目验：headless Edge 加载 dsh web，`--dump-dom` 确认 `.rxw-root`（fixed 右下角）+ mascot `<img>` + 全量 rxw-* 面板节点渲染；整页截图右下角可见浅蓝 mascot |

### 9.7 三期遗留与后续建议

- 挂件浏览器渲染已目验通过：打开 http://127.0.0.1:3080/ 刷新页面（Ctrl+F5 强刷，规避旧 client 缓存），右下角应出现 mascot；点击展开管理面板
- Token 消耗统计：当前依赖 agent 会话返回的用量数据（`ActionAttempt.sessionResult`）；若宿主未回传用量，显示为 `-`
- GitHub Release 快捷预设：一键创建"监控 release 变化 → 拉取代码运行"规则（`examples/github-release-watcher.mjs` 已验证核心逻辑）
- 后续可选：挂件设置面板（配置项持久化）、历史分页、导出
