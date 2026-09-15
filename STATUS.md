# dsh-reactor — 实现现状文档（v0.12 Runtime Complete）

> 项目路径：`C:\Users\Administrator\Desktop\plugin\dsh-reactor`
> 本文档记录当前已实现能力、架构、已验证链路与待解决卡点。
> 最后更新：2026-09-15

---

## 0. 版本完成摘要

### v0.8 Agent Runtime 基础 ✅
- goal 模式打通：file-watch → goal → 隔离 Agent Session → 模型流式 → 工具调用 → idle
- AgentRun 状态机（created/queued/running/succeeded/failed/blocked）+ runId
- RunStep（trigger → agent → result）
- token accounting（input/output/cached/total）

### v0.9 成本感知 + 自动恢复 ✅
- Budget gate（maxRunsPerDay 超了直接 blocked 0 token）
- retry loop（maxRetries）
- 无变化 0 token
- consecutiveFailures 累计

### v0.10 Stateful Reactor ✅
- ReactorRuleState（lastSuccessAt/consecutiveFailures/successCount）持久化
- 历史状态注入 goal prompt

### v0.11 Event Aggregation ✅
- aggregationWindowMs 窗口合并
- overlap protection

### v0.12 Policy / Human Approval ✅
- riskLevel: low/medium/high
- requireApproval: high-risk 触发后 blocked/awaiting_approval，0 token
- POST /rules/approve

### v0.12.1 Host Runtime Compatibility ✅（部分）
- poll-git.cjs git ls-remote 轮询脚本（timeout 30s）
- silence watchdog：60s 无模型事件主动 abort

### v0.12.2 Runtime Preflight ✅
- goal-session.ts 启动 Agent 前检查 workingDir 是否存在
- 不存在直接 blocked 0 token，不再烧 60s 静默

### v0.12.3 Runtime Capability Hardening ✅
- `src/preflight.ts`：RuntimeCapabilities 检测（workspace/fsRead/fsWrite/shell/git/network）
- goal-session.ts 启动 Agent 前 runPreflight，缺能力直接 blocked 0 token
- `constraints.requiredCapabilities: CapabilityKind[]` 规则可声明所需能力
- tool result（reactor_list/history）JSON.parse(JSON.stringify()) 确保 lossless
- 实测：真实目录全绿；不存在目录正确 blocked missing=[workspace]

### v0.13 Run Trace 决策链补全 ✅
- RunStep type union 加 `approval` 步
- 成功路径 steps：trigger → decision → approval → budget → retry* → agent(含 tokenUsage) → result
- approval 分支、budget 分支也补全决策步，blocked 原因完整可追溯
- 每次 run 的"为什么这样跑"在 history.steps 里完整记录
- 实测：v013-trace-test 成功 run 显示 6 步决策链

### v0.14 挂件 Run Trace 面板 ✅
- RuleDetail history 条目下渲染 steps 时间线
- 每步显示 type/status/summary，颜色区分成功/失败/跳过
- 点击规则详情即可看到完整决策链

### v0.15 Long-running Resume ✅
- ReactorRuleState 加 lastSummary + lastRunStatus
- 每次 run 后记录 Agent 报告的 summary（前 500 字）
- 下次同规则触发时，goal prompt 注入上次摘要 + 状态，Agent 知道做到哪可继续
- 不再是每次从零开始，而是事件驱动的续作

### v0.16 Deterministic Verification ✅
- constraints.verify: { type: 'file-exists', path } 或 { type: 'command', cmd }
- Agent settled 后自动跑确定性验证（不用 LLM 自判）
- 验证失败即使 Agent 报 ok 也标记 failed
- RunTrace 加 verify 步，显示验证结果
- 例：goal 让 Agent 写文件，verify 检查文件真的存在

### v0.17 Failure Classification ✅
- 失败自动分类：transient（网络/超时/503）/ repairable（代码错误/ENOENT）/ dangerous（安全/权限）
- history record 带 failureClass 字段
- 为后续智能 retry 策略（transient 自动重试，dangerous 暂停）铺路

### v0.18 Smart Retry ✅
- transient 错误（网络 blip/超时）即使 maxRetries=0 也自动 retry 一次
- retry step 记录 "transient error, auto-retry"
- dangerous/repairable 错误按用户配置的 maxRetries 走
- 减少因临时网络抖动导致的误失败

### v0.19 挂件 failureClass 标签 ✅
- RuleDetail history 条目显示 failureClass 标签（transient/repairable/dangerous）
- 一眼看出失败原因类型

---

## 1. Level 2 Demo 验证结果（2026-09-15）

**GitHub push → 15s 轮询 → hash changed → 拉起 Agent → 读文件 → summary 落库**，全链路通。

- 规则：`reactor_1789435666980_8cd1vw` "GitHub Level2 read-only"
- 事件源：command 跑 poll-git.cjs（git ls-remote）
- 条件：`$.hash changed`
- Agent 实际行为：
  1. read `demo-trigger.txt`
  2. glob `src/**/*.js` → `src/**/*` → `**/*` 完整清单
  3. 未跑 shell/git
- 结果：status=succeeded
- tokens: input 17.4k / output 402 / cached 37.0k / total 54.8k

### Host 层卡点（非插件问题）
- `powershell.exe ENOENT`：DSH sandbox spawn PowerShell 失败
- git clone / npm install 被 sandbox 拦
- 待 DSH Host 修复后跑 Level 3 Autonomous Maintainer

---

## 2. 插件定位

dsh-reactor 是 DSH 的**事件驱动 Agent Runtime**，从 ECA 升级为 ECG（事件-条件-目标）：

```
事件源轮询 → JSONPath 条件评估 → Cost/Risk Gate → Runtime Preflight
  → 拉起隔离 Agent Session → LLM ReAct → Verify/Recover → Trace
```

与 dsh-cron/dsh-automation 的差异：触发后不跑固定脚本，把事件上下文+目标交给全新 Agent Session，由 LLM 自主决策。

---

## 3. 已实现能力

### 3.1 事件源
| source_kind | 状态 |
|---|---|
| http-poll | ✅ |
| command（含 poll-git.cjs） | ✅ |
| file-watch（UTF-8 BOM 处理） | ✅ |
| webhook | ✅ |

### 3.2 条件评估
- JSONPath 字段，eq/ne/gt/contains/exists/changed
- AND/OR 组合

### 3.3 执行模式
| mode | 状态 |
|---|---|
| action（shell/webhook/agent-talk） | ✅ |
| goal（隔离 Agent ReAct） | ✅ Level 2 已验证 |

### 3.4 REST API
- GET/POST /reactor/api/rules
- GET /reactor/api/history
- POST /reactor/api/rules/approve
- GET /reactor/api/webhook/:token

---

## 4. 架构模块（src/）
| 文件 | 职责 |
|---|---|
| index.ts | Cordis 入口，inject=[tools,webServer,agents,agentDefaultModel,sessions] |
| engine.ts | 事件轮询、条件、goal 分发、overlap、phase 记录 |
| goal-session.ts | goal 执行闭环 + preflight + silence watchdog |
| host-modules.ts | link 布局宿主包解析 |
| tools.ts | reactor_define/list/status/test/remove |
| skill.ts | reactor-create skill |
| api-server.ts | REST API + 挂件资源 |
| webhook-server.ts | webhook 入站 |
| store.ts | 规则/历史持久化 |
| conditions.ts | JSONPath 条件 |
| types.ts | 类型定义 |

---

## 5. 本地开发
```
cd C:\Users\Administrator\Desktop\plugin\dsh-reactor
npx tsc -p tsconfig.json

# 启动
cd C:\Users\Administrator
npx @deepseek-ai/dsh web --no-open
```

调试日志：`C:\Users\Administrator\.dsh\reactor-goal-debug.log`
历史：`C:\Users\Administrator\.dsh\reactor\history.jsonl`
