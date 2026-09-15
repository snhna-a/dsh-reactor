# dsh-reactor 下一阶段开发文档

**文档版本：v0.8 Development Plan**  
**基线版本：v0.7 WIP**  
**目标版本：v1.0 Event-Driven Autonomous Agent Runtime**  
**最后更新：2026-09-15**

---

# 1. 文档目的

本文档基于当前 dsh-reactor v0.7 WIP 的实际实现状态，以及上一版《高价值差异化开发路线报告》，重新整理：

1. 当前已经实现的能力；
2. 当前存在的技术问题、架构不足和产品不足；
3. 哪些问题必须优先解决；
4. 下一阶段每一个版本应该具体开发什么；
5. 每项功能的验收标准；
6. 如何避免项目退化成“另一个 Cron / OpenClaw 简化版”。

本文档作为后续实际编码、测试、版本发布和 README 更新的主要依据。

---

# 2. 项目最终目标

## 2.1 最终定位

dsh-reactor 不继续以“事件触发器”或者“Cron 替代品”作为核心定位，而定位为：

> **Event-Driven Autonomous Agent Runtime for DeepSeek Harness**

中文：

> **面向 DeepSeek Harness 的事件驱动自主 Agent 运行时。**

核心目标：

> 让 DeepSeek Agent 能够感知外部环境中的重要状态变化，仅在真正值得处理时被唤醒，并在成本、权限、时间和重试约束下自主完成任务、验证结果、自动恢复并留下完整运行轨迹。

---

# 3. 当前 v0.7 WIP 实际能力

根据当前 STATUS.md：

## 3.1 已实现

### Event Source

- http-poll
- command
- file-watch
- webhook

其中 file-watch 已处理 UTF-8 BOM，并完成端到端验证。

### Condition

- JSONPath
- eq
- ne
- gt
- contains
- exists
- changed
- AND / OR

### 执行模式

`action`：

- shell
- webhook
- agent-talk

`goal`：

- 创建隔离 Agent Session；
- 由 LLM 通过 ReAct 自主完成任务。

但 goal 模式目前仅完成：

> Session 创建成功 → followup 投递成功

尚未完成：

> 模型真正运行 → tool call → 完成 → 结果回传。

### History

已经记录：

- trigger
- phase
- payload
- sessionResult
- ruleSeq

### Natural Language Rule

已经有：

- reactor-create skill；
- reactor_define；
- mode / goal / constraints；
- GitHub 使用示例。

### UI

已经有：

- 悬浮挂件；
- 规则管理；
- 触发气泡；
- 拖拽；
- 尺寸调节；
- 半透明设置。

### REST API

已有：

- GET /reactor/api/rules
- POST /reactor/api/rules
- GET /reactor/api/history
- webhook 入站接口。

---

# 4. 当前核心问题总览

按照严重程度排序：

| 优先级 | 问题 | 当前状态 | 影响 |
|---|---|---|---|
| P0 | goal 模式无法真正驱动模型 | 未解决 | 插件最核心能力不可用 |
| P0 | Agent 完成结果无法回传 | 未解决 | 无法做可靠闭环 |
| P0 | Token / Cost 仅有记录设计，没有成本门控 | 未完成 | 高频事件可能造成无意义 Agent 消耗 |
| P0 | 没有真正的 Agent Run 状态机 | 不完整 | 无法可靠支持 retry / recovery / verification |
| P0 | Agent 失败后没有标准恢复机制 | 未实现 | 自动任务停在失败状态 |
| P0 | 验证机制不足 | 未实现 | “Agent 说成功”不等于任务真的成功 |
| P1 | 状态与历史边界不清晰 | 部分已有 | 长任务状态难以持续 |
| P1 | 高频事件缺乏聚合与去抖 | 未实现 | Agent 可能被重复唤醒 |
| P1 | changed 仅是值变化，不代表业务意义变化 | 能力不足 | 无意义变化会消耗资源 |
| P1 | 高风险动作缺少 Policy / Approval | 未实现 | 自动 Agent 有安全风险 |
| P1 | run trace 不够细 | 不完整 | 难以解释 Agent 为什么被调用 |
| P1 | 长任务无法基于外部事件恢复同一上下文 | 未实现 | 每次都像新任务 |
| P2 | Agent 尚不能自主发现并建议新 Reactor | 未实现 | 缺少“自动化自进化”能力 |
| P2 | 多 Agent 编排尚未与事件层形成组合 | 未实现 | 只能使用基础 Agent |
| P2 | UI 目前偏规则管理，而非运行可观测性 | 基础版 | 无法展示真正的 Agent Runtime |

---

# 5. P0：首先修复 goal 模式

这是整个项目当前最重要的问题。

## 5.1 当前现象

当前已经能够：

```text
rule triggered
    ↓
agents.create()
    ↓
agent.status = running
    ↓
followup(prompt)
    ↓
返回成功
```

但之后：

```text
30s+
    ↓
没有模型事件
    ↓
没有 tool call
    ↓
没有最终回复
```

当前已排除：

- 宿主包无法 import；
- Cordis inject 不完整；
- provider / model 为空；
- followup 抛错。

当前主要调查方向：

1. subagent session 模型凭据继承；
2. model routing / installModelSelection；
3. dsh-llm 运行时错误；
4. 与 dsh-cron/agent-task.js 的 session 创建链路差异。

## 5.2 调试要求

必须形成一条完整的最小测试：

```text
reactor_define
    ↓
trigger
    ↓
goal-session
    ↓
model request
    ↓
assistant response
    ↓
tool call
    ↓
tool result
    ↓
final response
```

不要继续开发高级功能，直到该链路至少能稳定完成一次真实任务。

## 5.3 推荐测试任务

第一阶段不要直接测试复杂 GitHub 项目。

使用最小任务：

> “在工作区创建 hello.txt，写入 hello world，然后回复完成。”

然后：

> “读取 hello.txt，修改内容，再回复修改完成。”

最后：

> “运行 node --version，然后报告结果。”

只有这三类都稳定，才进入 GitHub Demo。

## 5.4 验收标准

一次真实 goal：

- Session 创建成功；
- 模型请求成功；
- 至少一个模型事件产生；
- 至少一个 tool call 成功；
- Agent 最终结束；
- 最终结果可以返回给 Reactor；
- `sessionId`、`durationMs`、`status` 可落历史。

---

# 6. P0：建立 AgentRun 状态机

## 6.1 当前问题

目前 history 中有：

- matched
- running
- completed
- failed
- skipped

但还没有一个严格的“Agent Run 生命周期”。

必须把：

> Trigger Record

升级为：

> Agent Run + Run Step + Final Result。

## 6.2 状态机

推荐：

```text
CREATED
   ↓
QUEUED
   ↓
RUNNING
   ↓
VERIFYING
   ↓
SUCCEEDED
```

失败：

```text
RUNNING
   ↓
FAILED
   ↓
RETRYING
   ↓
RUNNING
```

不可恢复：

```text
FAILED
   ↓
BLOCKED
   ↓
HUMAN_ESCALATION
```

取消：

```text
RUNNING
   ↓
CANCELLED
```

## 6.3 数据模型

```ts
interface AgentRun {
  runId: string
  ruleId: string
  parentRunId?: string
  sessionId?: string
  workspacePath?: string

  status:
    | 'created'
    | 'queued'
    | 'running'
    | 'verifying'
    | 'succeeded'
    | 'failed'
    | 'blocked'
    | 'cancelled'

  triggerId: string
  startedAt: string
  finishedAt?: string
  durationMs?: number

  stepCount: number
  toolCallCount: number

  tokenUsage: TokenUsage

  result?: AgentResult
  failure?: FailureInfo
}
```

## 6.4 验收标准

任何 Agent Run 必须最终进入以下之一：

```text
succeeded
failed
blocked
cancelled
```

禁止长期保持：

```text
running
```

而没有 timeout / terminal state。

---

# 7. P0：Agent Completion Callback

这是 goal 能力真正形成闭环的核心。

## 7.1 当前

```text
followup()
    ↓
submitted
```

## 7.2 目标

```text
followup()
    ↓
agent.started
    ↓
agent.step
    ↓
tool.call
    ↓
tool.result
    ↓
agent.finished
    ↓
AgentRun completed
```

## 7.3 接入原则

优先寻找 DSH Session / Agent 生命周期事件，而不是轮询状态。

如果运行时提供 session finish / message / tool events：

```text
subscribe
    ↓
capture
    ↓
normalize
    ↓
store RunStep
```

如果当前 DSH 版本事件能力不足：

第一版允许 polling，但必须：

- 有最大等待时间；
- 有状态变化检测；
- 有超时终态；
- 后续切换为事件驱动。

---

# 8. P0：Cost-Aware Agent Router

这是 dsh-reactor 最重要的产品差异化之一。

## 8.1 核心原则

> **Agent 是昂贵的最后一级执行者，而不是第一响应者。**

不能：

```text
Event
 ↓
Agent
```

应该：

```text
Event
 ↓
Cheap Detection
 ↓
State Change
 ↓
Rule
 ↓
Meaningful Change
 ↓
Budget / Risk Gate
 ↓
Agent
```

## 8.2 最低成本路径

例如 GitHub：

```text
GitHub poll
 ↓
读取 SHA
 ↓
SHA 未变化
 ↓
STOP
 ↓
Agent Tokens = 0
```

SHA 变化：

```text
SHA changed
 ↓
读取 changed files
 ↓
docs only?
 ├─ yes → STOP
 └─ no
      ↓
Budget check
      ↓
Agent
```

## 8.3 配置

建议：

```yaml
budget:
  maxTokensPerRun: 30000
  maxTokensPerDay: 100000
  maxRunsPerDay: 10
  maxRuntimeMs: 600000
  maxRetries: 2
```

## 8.4 Router 决策结果

```ts
type RouteDecision =
  | {
      action: 'skip'
      reason: 'unchanged'
          | 'low_value'
          | 'budget_exceeded'
          | 'cooldown'
          | 'duplicate'
    }
  | {
      action: 'run'
      reason: string
    }
```

## 8.5 必须记录

```text
event detected
event filtered
route decision
estimated token
actual token
skipped token
```

重点新增：

```text
estimatedTokensSaved
agentRunsSaved
```

这样可以证明：

> Reactor 不只是会花 token，而是在减少不必要的 token 消耗。

---

# 9. P0：Run Token Accounting

Token 统计不要只显示总数。

目标：

```text
Run #42

Trigger
0 token

Rule Decision
0 token

Agent
Input:  18,421
Output:  5,238
Total:  23,659

Recovery
Input:   4,112
Output:  1,820

Total Run
29,591
```

## 9.1 数据结构

```ts
interface TokenUsage {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cachedTokens?: number
  estimatedCost?: number
}
```

## 9.2 要支持两种状态

```text
estimated
actual
```

模型尚未启动时：

```text
estimatedTokens
```

结束以后：

```text
actualTokens
```

## 9.3 验收标准

一个没有变化的 Event：

```text
agentRuns = 0
totalAgentTokens = 0
```

---

# 10. P0：Recovery + Verification

## 10.1 为什么必须做

自动化不能把：

> “Agent 最终回复成功”

等价成：

> “任务真的成功”。

例如：

```text
Agent:
测试应该已经通过。
```

但实际：

```text
process exit code = 1
```

因此执行必须形成：

```text
Execute
 ↓
Observe
 ↓
Verify
 ↓
Success?
```

## 10.2 Verification

优先使用确定性验证：

```text
command exit code
HTTP health check
test result
file exists
git status
process status
```

不要用 LLM 自己判断自己是否成功。

## 10.3 Recovery

失败：

```text
failure
 ↓
classify
 ↓
retry?
 ├─ transient → retry
 ├─ repairable → Agent diagnose/fix
 └─ dangerous → human approval
```

## 10.4 停止条件

必须有：

```yaml
recovery:
  maxRetries: 2
  maxRuntimeMs: 600000
  maxTokens: 50000
  stopOnRepeatedFailure: true
```

如果连续出现相同错误：

```text
FAIL
FAIL
FAIL
```

不得无限循环。

---

# 11. P0：State Store

当前 `prevPayloads` 能解决简单 `changed`，但还不足以支撑自主 Agent 长任务。

需要独立的：

```text
RuleStore
StateStore
HistoryStore
```

## 11.1 StateStore

```ts
interface ReactorState {
  ruleId: string

  lastObservedState?: unknown
  lastMeaningfulChange?: unknown

  lastRunId?: string
  lastSuccessRunId?: string
  lastFailureReason?: string

  failureCount: number
  consecutiveFailures: number
  recoveryCount: number
}
```

## 11.2 状态用途

下一次 Agent 可以看到：

```text
上一次：
commit abc120
测试通过

这一次：
commit abc123
测试失败

过去：
连续两次发生 auth.test.ts 失败
```

这样 Agent 才是真正“有状态”的。

---

# 12. P1：Event Aggregation / Debounce

## 12.1 目的

解决：

```text
commit1
commit2
commit3
...
commit13
```

导致：

```text
13 Agent Runs
```

变成：

```text
13 raw events
 ↓
1 aggregated event
 ↓
1 Agent Run
```

## 12.2 推荐参数

```yaml
aggregation:
  enabled: true
  windowMs: 300000
  key: repository
  mode: latest
```

## 12.3 输出

```json
{
  "eventCount": 13,
  "firstEvent": "...",
  "latestEvent": "...",
  "changedFiles": 28
}
```

## 12.4 关键 KPI

```text
rawEvents
coalescedEvents
agentRunsSaved
estimatedTokensSaved
```

---

# 13. P1：Meaningful Change

当前 `changed` 只是：

> 值发生变化。

下一步要实现：

> **有意义的变化。**

例如 Git：

```text
README changed
→ low

docs changed
→ low

test changed
→ medium

src changed
→ high

package.json changed
→ high

security config changed
→ critical
```

建议新增：

```text
meaningful_changed
threshold_persisted
rising
falling
stale
recovered
flapping
```

原则：

> 确定性的判断优先由代码完成；只有语义判断才交给 Agent。

---

# 14. P1：Policy / Human Approval

定义风险等级：

```text
LOW
MEDIUM
HIGH
CRITICAL
```

示例：

```text
read file              → LOW
run test               → LOW
modify local file      → MEDIUM
git push               → HIGH
merge PR               → HIGH
production deploy      → CRITICAL
delete production data → CRITICAL
```

策略：

```yaml
policy:
  low: auto
  medium: auto
  high: approval
  critical: deny
```

这样才能真正支持：

> “自动完成，但不要越权。”

---

# 15. P1：Long-Running Event-Driven Goal

不要复制 DSH Goal。

应该做：

```text
DSH Goal
=
要完成什么

Reactor
=
什么时候由于外部变化继续执行
```

例如：

```text
Goal: 解决 GitHub Issue #123

Issue comment changed
 ↓
Resume

CI failed
 ↓
Resume

PR updated
 ↓
Resume

CI passed
 ↓
Verify

Issue closed
 ↓
Complete
```

这里 Reactor 的核心角色是：

> **Event → Goal Resume**

而不是：

> 自己重新实现 Goal。

---

# 16. P1：Run Trace

History 是“发生过什么”。

Run Trace 是：

> “为什么这样运行，以及中间发生了什么。”

建议：

```text
Run #42
│
├── trigger
├── state_decision
├── meaningful_change
├── budget_decision
├── agent_start
│   ├── tool_call
│   ├── tool_result
│   ├── tool_call
│   └── ...
├── verification
├── recovery
└── final_result
```

## 16.1 RunStep

```ts
interface RunStep {
  stepId: string
  runId: string

  type:
    | 'trigger'
    | 'decision'
    | 'agent'
    | 'tool'
    | 'verify'
    | 'retry'
    | 'approval'
    | 'result'

  status:
    | 'started'
    | 'succeeded'
    | 'failed'
    | 'skipped'

  startedAt: string
  finishedAt?: string
  durationMs?: number

  tokenUsage?: TokenUsage

  summary?: string
  error?: string
}
```

---

# 17. P2：Agent 自适应创建 Reactor

仅允许：

```text
Agent
 ↓
发现重复模式
 ↓
提出 Reactor
 ↓
Human Approval
 ↓
Create Rule
```

禁止：

```text
Agent
 ↓
无提示
 ↓
随便创建自动任务
```

示例：

> “我发现这个项目每次部署成功后都需要检查 migration。”

Agent 提出：

```text
WHEN deployment.success
AND migration.changed
THEN run migration verification
```

---

# 18. P2：Event-Driven Multi-Agent

不要重新实现 DSH 的：

- subagent；
- workflow；
- agent teams。

Reactor 负责事件路由。

例如：

```text
Security dependency changed
        ↓
Reactor
        ↓
Security workflow
   ┌────┼────┐
   ↓    ↓    ↓
Code  CVE  Test
Agent Agent Agent
   └────┼────┘
        ↓
Final verification
```

原则：

> Reactor 是事件控制平面，不是新的 Agent 编排框架。

---

# 19. 当前代码层面的架构调整建议

当前：

```text
engine.ts
goal-session.ts
agent-session.ts
store.ts
conditions.ts
tools.ts
api-server.ts
webhook-server.ts
```

下一阶段建议演化：

```text
src/
├── event/
│   ├── sources/
│   ├── normalizer.ts
│   └── aggregator.ts
│
├── state/
│   ├── state-store.ts
│   └── state-machine.ts
│
├── policy/
│   ├── conditions.ts
│   ├── budget.ts
│   ├── risk.ts
│   └── router.ts
│
├── runtime/
│   ├── agent-runner.ts
│   ├── run-controller.ts
│   ├── recovery.ts
│   └── verification.ts
│
├── trace/
│   ├── run-trace.ts
│   └── token-accounting.ts
│
├── store/
│   ├── rule-store.ts
│   ├── state-store.ts
│   └── history-store.ts
│
├── actions/
│   ├── shell.ts
│   ├── webhook.ts
│   └── agent.ts
│
└── tools.ts
```

不要求一次性重构。

原则：

> 先增加能力，再逐步拆分；不要为了“架构漂亮”提前大规模改目录。

---

# 20. 建议的核心执行流程

最终统一为：

```text
External Event
      ↓
Event Normalizer
      ↓
State Detection
      ↓
Event Aggregation
      ↓
Condition
      ↓
Meaningful Change
      ↓
Cost / Risk Gate
      ↓
Create AgentRun
      ↓
Agent Session
      ↓
Plan / Execute
      ↓
Observe
      ↓
Verify
      ↓
Success?
  ┌───┴────┐
 Yes       No
  │         │
  ↓         ↓
Complete  Recovery
            ↓
        Retry / Repair
            ↓
          Verify
            ↓
       Success / Block
            ↓
      Trace / State / Cost
```

---

# 21. 版本开发顺序

## v0.8 —— Agent Runtime 基础修复

### 必做

1. 打通 goal 模式；
2. Agent completion；
3. AgentRun；
4. terminal state；
5. Agent result 回传；
6. 基础 token accounting；
7. 基础 RunStep。

### 版本验收

必须完成：

> file-watch → goal → Agent → 创建文件 → 完成 → history。

---

# 22. v0.9 —— 成本感知 + 自动恢复

### 必做

1. Budget；
2. Cost Router；
3. estimated / actual token；
4. verification；
5. retry；
6. recovery；
7. timeout；
8. repeated failure stop。

### 版本验收

完成：

> GitHub commit → filter → Agent → 测试 → 失败 → 自动修复 → 再测试 → 成功。

并证明：

> 无变化事件 = 0 Agent Token。

---

# 23. v0.10 —— Stateful Reactor

### 必做

1. StateStore；
2. failure history；
3. lastSuccess；
4. consecutive failure；
5. recovery state；
6. Long-running resume 基础。

### 验收

模拟：

```text
Run1 fail
Run2 fail
Run3 success
```

Agent 能读取并识别过去的运行状态。

---

# 24. v0.11 —— Event Intelligence

### 必做

1. debounce；
2. event aggregation；
3. threshold；
4. hysteresis；
5. rising/falling；
6. recovered；
7. meaningful_changed。

### 验收

13 个 commit 在聚合窗口内只产生一个 Agent Run。

---

# 25. v0.12 —— Policy / Approval

### 必做

1. risk level；
2. approval；
3. allow / deny；
4. high-risk action interception；
5. audit。

### 验收

Agent 尝试执行：

```text
git push
```

系统进入：

```text
WAITING_APPROVAL
```

批准后继续。

---

# 26. v1.0 —— Autonomous Agent Runtime

最终形成：

```text
Event
 ↓
State
 ↓
Meaningful Change
 ↓
Cost Router
 ↓
Agent
 ↓
Verification
 ↓
Recovery
 ↓
State Update
 ↓
Trace / Cost / Audit
```

同时具备：

- Rule persistence；
- Goal execution；
- Agent completion；
- Token accounting；
- Budget；
- Recovery；
- Verification；
- Event aggregation；
- Meaningful change；
- Policy；
- Approval；
- Long-running resume；
- Run trace。

---

# 27. 第一批必须做的 Demo

不要先做大量第三方事件源。

建议只完成三个高质量 Demo。

## Demo A：Autonomous GitHub Maintainer

用户：

> “当这个 GitHub 仓库有新的代码提交时，自动检查测试。如果失败，让 Agent 分析原因并最多修复两次，成功后生成报告。”

流程：

```text
GitHub commit
 ↓
SHA changed
 ↓
Meaningful Change
 ↓
Budget
 ↓
Agent
 ↓
Checkout
 ↓
Run tests
 ↓
Failure
 ↓
Diagnose
 ↓
Fix
 ↓
Retest
 ↓
Pass
 ↓
Report
```

必须展示：

- Agent steps；
- tool calls；
- retry；
- final verification；
- Token；
- 总耗时。

---

## Demo B：Autonomous Service Recovery

用户：

> “当服务健康检查连续三次失败时，让 Agent 分析日志并尝试恢复；恢复后验证服务，否则通知我。”

流程：

```text
health check
 ↓
3 consecutive failures
 ↓
Agent
 ↓
logs
 ↓
process
 ↓
restart / fix
 ↓
health check
 ↓
success
```

这里特别能体现：

> Recovery + Verification。

---

## Demo C：Long-Running Issue Agent

用户：

> “持续跟踪这个 GitHub Issue，直到问题解决。”

流程：

```text
Issue created
 ↓
Agent analyze
 ↓
PR created
 ↓
Resume
 ↓
CI failed
 ↓
Resume
 ↓
Agent repair
 ↓
CI passed
 ↓
Issue closed
 ↓
Task completed
```

这里体现：

> Stateful + Resume + Event-driven Goal。

---

# 28. 明确暂时不要做的内容

以下内容不作为近期主线：

## 不做 1：大量事件源

不要为了数量快速增加：

- Telegram；
- Discord；
- Slack；
- 飞书；
- 钉钉；
- Jira；
- GitLab；
- 邮箱；
- 更多 SaaS。

事件源应该是适配层，不是核心竞争力。

---

## 不做 2：复杂 Web UI

当前挂件已经足够用于 Demo。

在 Agent Runtime 核心闭环完成之前，不投入大量 UI 工作。

未来 UI 的重点应该是：

> Run Graph / Token / State / Recovery

而不是单纯：

> Rule CRUD。

---

## 不做 3：复制 DSH Workflow

不要重新做：

- Workflow Engine；
- Agent Team；
- Subagent；
- Goal Framework。

Reactors 应该调用这些能力。

---

## 不做 4：每个事件都启动 Agent

严格禁止设计：

```text
poll
 ↓
LLM 判断是否变化
```

必须：

```text
cheap detection
 ↓
deterministic filter
 ↓
Agent only when necessary
```

---

# 29. 核心指标

以后每一个版本都不能只看：

```text
“功能跑通了”
```

而要测：

## Agent Reliability

```text
agent completion rate
agent timeout rate
agent failure rate
verification success rate
recovery success rate
```

## Token Efficiency

```text
raw events
agent runs
skipped events
tokens consumed
tokens saved
average tokens / successful task
```

## Recovery

```text
failed runs
recovered runs
recovery rate
average retries
repeated failure rate
```

## Runtime

```text
average runtime
p95 runtime
tool calls / run
steps / run
```

---

# 30. 最终产品判断标准

到了 v1.0，需要回答下面五个问题。

### 问题 1

为什么不用 Cron？

答案：

> 因为 Reactor 对“状态变化”和“事件语义”做响应，而不是到点执行。

### 问题 2

为什么不用普通 Webhook？

答案：

> 因为 Reactor 会根据状态、成本和风险决定是否唤醒 Agent。

### 问题 3

为什么不用普通 Agent？

答案：

> 因为 Reactor 负责让 Agent 在正确的时候运行，并提供恢复、验证、预算和审计。

### 问题 4

为什么不用 OpenClaw 类主动 Agent？

答案：

> Reactor 不重新实现通用 Agent，而专注 DeepSeek Harness 下的事件控制、成本治理、运行闭环和状态管理。

### 问题 5

为什么这个插件值得长期存在？

答案：

> 因为它解决的是“Agent 如何在真实世界中持续、经济、安全、可靠地工作”，而不是“如何再启动一次 Agent”。

---

# 31. 最终开发原则

整个项目后续开发必须遵守下面五条原则：

## 原则 1：Event First

先观察环境，不要先调用模型。

## 原则 2：Cheap Before Expensive

能用代码判断的问题，不交给 LLM。

## 原则 3：Agent Must Finish the Loop

Agent 不能只是“被唤醒”，必须：

```text
执行 → 验证 → 成功 / 恢复 / 阻断
```

## 原则 4：Every Run Must Be Explainable

任何一次 Agent 调用，都必须回答：

```text
为什么触发？
为什么调用 Agent？
花了多少 token？
做了什么？
成功了吗？
失败后做了什么？
```

## 原则 5：Autonomy With Boundaries

自动化必须同时具备：

```text
Budget
Timeout
Retry Limit
Permission
Approval
Audit
```

---

# 32. 最终目标架构

```text
                         External World
                              │
                    ┌─────────┴─────────┐
                    │                   │
                  Poll                Webhook
                    │                   │
                    └─────────┬─────────┘
                              ↓
                      Event Normalizer
                              ↓
                       State Detection
                              ↓
                     Event Aggregation
                              ↓
                    Meaningful Change
                              ↓
                    Condition / Policy
                              ↓
                    Cost / Risk Router
                       /          \
                    SKIP           RUN
                     │              │
                     ↓              ↓
                 0 Token        AgentRun
                                    │
                                    ↓
                              DeepSeek Agent
                                    │
                             Tool / Subagent
                                    │
                                    ↓
                                 Observe
                                    │
                                    ↓
                                Verify
                              /         \
                          success       fail
                             │            │
                             ↓            ↓
                         Complete      Recovery
                                           │
                                    Retry / Repair
                                           │
                                           ↓
                                        Verify
                                           │
                                  ┌────────┴────────┐
                                  ↓                 ↓
                               Success           Blocked
                                  │                 │
                                  └────────┬────────┘
                                           ↓
                                State / Trace / Cost
```

---

# 33. 一句话开发目标

> **不要让 dsh-reactor 变成“一个可以自动调用 Agent 的插件”，而要让它变成“让 DeepSeek Agent 在真正值得的时候醒来、完成任务、验证结果、失败自救，并且始终知道自己用了多少资源”的运行时。**

这句话作为整个 v0.8 → v1.0 开发阶段的总原则。
