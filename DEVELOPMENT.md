# dsh-reactor 开发文档

> 事件驱动智能决策引擎（ECA：Event-Condition-Action）—— DeepSeek Harness 插件
>
> 文档版本：v2（一期基线 + 二期升级）｜更新时间：2026-09-09

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
export const inject = ['tools']   // 必需服务：工具注册表（webServer 为可选，经 ctx.get 读取）
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
pnpm build                   # 构建到 lib/
node test/smoke.mjs          # 核心引擎冒烟测试（37 项断言）
node test/boot-check.mjs     # 真实 Cordis 启动验证（无/有 webServer 两场景）
node examples/github-release-watcher.mjs   # 端到端演示（真实请求 GitHub）
```

### 4.3 依赖声明（package.json）

```json
{
  "dependencies": {
    "execa": "^9.5.2"
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
| 卸载清理 | `dsh plugin --profile web remove dsh-reactor` + 重启 | 插件完全移除 |

### 5.4 冒烟测试覆盖

| 测试组 | 覆盖点 |
|--------|--------|
| jsonPath | 嵌套取值 / 数组索引 / 缺失路径 |
| 条件评估 | 10 种操作符正反例 |
| AND/OR | 组合逻辑 |
| 插值（v0.2） | {{field}} / {{payload.field}} / 嵌套 / 缺失 |
| 引擎生命周期 | addRule / getRule / removeRule / dispose |
| 错误隔离 | 动作失败不崩溃 |
| 持久化（v0.2） | 规则重启恢复 / 运行时状态剥离 / 历史跨重启 |
| webhook 分派（v0.2） | 路径过滤 / 条件评估 / 触发计数 |
| 启动验证（v0.2） | boot-check：无 webServer 降级 + 有 webServer 挂载路由 |

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
- [x] 插件导出 `apply(ctx)` 模块（✅ 已满足）
- [x] package.json 声明 `dsh.bundle.patch`（✅ 已满足）
- [x] 开源许可证 MIT（✅ 已满足）
- [x] README 声明"社区插件，非官方出品"

---

## 七、后续规划

> 状态更新（2026-09-09）：P0、P1 四项已在 v0.2.0 全部实现并验证，详见[第八章](#八二期升级功能v020)。

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
| P2-2 | Web UI 面板 | 参考 dsh-widgets 模式扩展可视化规则管理 |
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
- **webServer 为可选依赖**：经 `ctx.get('webServer')` 读取（无需声明 `inject`），headless 等无 webServer 的 profile 下自动降级禁用入口，不阻塞插件加载（已实测修复 `cannot get property "webServer" without inject`）

**验证**：冒烟测试 —— 路径过滤（同路径触发、异路径跳过）、条件评估（命中/未命中）、引擎分派计数正确；boot-check —— 无 webServer 场景降级、有 webServer 场景挂载路由。

### 8.6 二期新增/变更文件清单

| 文件 | 变更 |
|------|------|
| `src/store.ts` | 新增：RuleStore（持久化）+ HistoryStore（历史） |
| `src/agent-session.ts` | 新增：真实 Agent 会话执行 |
| `src/webhook-server.ts` | 新增：HTTP 接收端点；`ctx.get('webServer')` 可选注入读取 |
| `src/types.ts` | 扩展：EventSourceKind + webhook；新增 TriggerRecord / ActionRunRecord / SessionRunResult / PersistedState / PersistedRule；Config 新增 9 项 |
| `src/engine.ts` | 接入持久化、历史、webhook 分派、真实会话；closed 标志防 dispose 后空转；dispose 顺序修正；testRule 更新 prevPayloads（changed 状态感知在测试路径一致） |
| `src/actions/shell.ts` | 改造：真实会话优先，事件广播降级；插值兼容 {{payload.field}} / {{field}} |
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
