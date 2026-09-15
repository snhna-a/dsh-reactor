# dsh-reactor GitHub Demo 宿主环境问题诊断与解决报告

**项目：** dsh-reactor  
**定位：** Event-Driven Autonomous Agent Runtime for DeepSeek Harness  
**当前版本：** v0.12  
**当前状态：** v0.8–v0.12 核心功能全部完成  
**报告类型：** GitHub Demo 测试问题诊断与解决方案  
**报告日期：** 2026-09-15

---

# 1. 问题背景

dsh-reactor 当前已经完成 v0.8–v0.12 的主要功能开发：

- v0.8：Agent Runtime、AgentRun、Completion、Token Accounting、RunStep
- v0.9：Budget、Cost Router、Verification、Retry、Recovery、Timeout
- v0.10：StateStore、Failure History、Long-running State
- v0.11：Debounce、Event Aggregation、Threshold、Hysteresis、Meaningful Change
- v0.12：Risk Level、Approval、Allow/Deny、高风险操作拦截、Audit

此前规划的核心目标是：

```text
External Event
      ↓
State
      ↓
Meaningful Change
      ↓
Cost / Risk Gate
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

这一定位与项目原有设计保持一致：Reactor 并不是重新实现一个 Agent，而是作为 DeepSeek Harness 中连接外部状态与 Agent 的事件控制平面。

原开发路线中，GitHub Autonomous Maintainer 是第一批核心 Demo：

```text
GitHub change
      ↓
Meaningful Change Filter
      ↓
Cost / Risk Gate
      ↓
Agent
      ↓
Test
      ↓
Failure
      ↓
Diagnose
      ↓
Fix
      ↓
Retest
      ↓
Verify
      ↓
Success
      ↓
Report
      ↓
Token Trace
```

该 Demo 的设计目标本身没有问题，问题出现在实际运行环境。

---

# 2. 当前测试结果

目前已经完成的实际验证表明，Reactor 核心链路已经能够工作。

## 2.1 GitHub 状态检测正常

GitHub Polling 使用：

```text
git ls-remote
```

获取远程仓库 HEAD。

测试结果：

```text
GitHub HEAD
    ↓
Polling
    ↓
Hash Comparison
    ↓
hash changed
    ↓
Condition matched
```

已经能够正确检测 GitHub 仓库发生变化。

15 秒 Polling 周期能够正常工作。

因此：

> GitHub Event Source 本身不是当前问题。

---

# 3. Reactor → Agent 链路已经验证

GitHub 状态变化后能够进入：

```text
Reactor
   ↓
Rule Match
   ↓
Agent Session
   ↓
Followup
   ↓
Agent ReAct
```

当前已经验证：

- 隔离 Agent Session 创建成功
- followup 投递成功
- Agent 能够进入 ReAct
- Agent 可以执行后续逻辑
- Session 能够产生运行结果
- History 可以保存运行记录

因此：

> Agent Runtime 并不是当前主要故障点。

---

# 4. Token Accounting 已经正常

当前 Agent Session 已经能够记录：

```text
input tokens
cached tokens
output tokens
```

因此成本统计基础已经具备。

这意味着 v0.9 中最重要的：

```text
Agent Run
   ↓
Token Usage
   ↓
Cost
```

已经可以用于 Demo。

---

# 5. 当前真正的失败点

当前 GitHub Demo 在执行：

```text
GitHub Change
    ↓
Agent
    ↓
Clone Repository
```

时出现：

```text
powershell.exe ENOENT
```

同时 Agent 侧无法访问预期 Workspace：

```text
reactor-demo-build
```

进一步出现：

```text
glob → not found
grep → not found
read → not found
```

最终形成：

```text
GitHub Change
      ↓
Reactor ✓
      ↓
Agent Session ✓
      ↓
Agent ReAct ✓
      ↓
需要访问 Workspace
      ↓
Workspace 不可见 ✗

需要执行 Shell
      ↓
PowerShell spawn
      ↓
powershell.exe ENOENT ✗
```

---

# 6. 故障性质判断

综合当前测试结果，可以将问题划分为三个层级。

| 层级 | 能力 | 当前状态 |
|---|---|---|
| Reactor | GitHub Polling | ✓ |
| Reactor | Hash Change Detection | ✓ |
| Reactor | Rule Matching | ✓ |
| Reactor | Agent Session | ✓ |
| Reactor | Agent ReAct | ✓ |
| Reactor | Token Accounting | ✓ |
| Reactor | History | ✓ |
| DSH Runtime | Agent Workspace | 待修复 |
| DSH Runtime | Shell Tool | 异常 |
| DSH Runtime | PowerShell Spawn | ✗ |
| Host | PowerShell 可执行路径 | ✗ |
| Host | Workspace Mount / Provision | ✗ |
| Host | Git Clone | 无法正常执行 |

因此当前问题应该定义为：

> **DSH Host Runtime Capability Failure**

而不是：

> dsh-reactor GitHub Reactor Logic Failure

---

# 7. 为什么不应该修改 Reactor GitHub 逻辑

当前最容易出现的错误，是为了让 Demo 跑起来而修改：

```text
GitHub Polling
GitHub Hash Detection
Agent Prompt
Recovery
Event Rule
```

甚至尝试把：

```text
git clone
```

改成其他 Reactor Action。

这不是正确方向。

因为 GitHub Demo 真正需要的能力是：

```text
Agent
 ↓
Workspace
 ↓
Shell
 ↓
Git
 ↓
Test
```

这些属于 Agent Runtime / Host Runtime 能力。

如果 Host 无法提供：

```text
powershell.exe
```

那么无论 Reactor 怎样修改：

```text
git clone
```

最终都会失败。

因此：

> **不要为了绕过 Host Runtime 问题而污染 Reactor 的核心架构。**

---

# 8. 第一优先级：解决 PowerShell ENOENT

## 8.1 需要检查 PowerShell 类型

Windows 环境下通常存在：

```text
powershell.exe
```

或者：

```text
pwsh.exe
```

分别对应 Windows PowerShell 与 PowerShell Core。

当前错误：

```text
powershell.exe ENOENT
```

说明 Node / DSH Runtime 在执行 spawn 时无法通过当前 PATH 找到对应 executable。

需要首先在运行 DSH 的**同一个宿主环境**中检查：

```powershell
where.exe powershell
```

以及：

```powershell
where.exe pwsh
```

进一步检查：

```powershell
powershell.exe -NoProfile -Command "$PSVersionTable.PSVersion"
```

和：

```powershell
pwsh.exe -NoProfile -Command "$PSVersionTable.PSVersion"
```

---

# 9. 第二优先级：检查 DSH 实际运行环境的 PATH

重点不是：

> “我的 Windows 电脑有没有 PowerShell。”

而是：

> “启动 DSH Harness 的那个 Node.js 进程能不能找到 PowerShell。”

因为：

```text
Terminal
   ↓
PowerShell exists
```

并不能证明：

```text
DSH Node Process
   ↓
spawn("powershell.exe")
   ↓
PowerShell exists
```

两者可能拥有不同的：

```text
PATH
Environment
Working Directory
User
Sandbox
Container
```

因此应该在 DSH Runtime 中增加一次最小测试：

```js
spawn("where.exe", ["powershell"])
```

或者：

```js
spawn("powershell.exe", [
  "-NoProfile",
  "-Command",
  "$PSVersionTable.PSVersion"
])
```

如果这里失败，则可以直接确定：

```text
DSH Host → PowerShell resolution failure
```

---

# 10. 不推荐直接硬编码 PowerShell 路径

不建议简单写死：

```text
C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe
```

原因是 DSH 的运行环境可能包括：

- Windows
- Linux
- WSL
- Docker
- Remote Runtime
- Sandbox

因此 Shell Runtime 应该具备 Shell Capability Detection。

推荐：

```text
Shell Runtime
     ↓
Detect Platform
     ↓
Windows?
 ┌───┴────┐
 ↓        ↓
pwsh   powershell
 ↓        ↓
Available?
     ↓
Capability
```

最终统一向 Reactor 返回：

```json
{
  "shell": {
    "available": true,
    "kind": "powershell",
    "executable": "powershell.exe"
  }
}
```

或者：

```json
{
  "shell": {
    "available": false,
    "kind": null,
    "executable": null,
    "reason": "EXECUTABLE_NOT_FOUND"
  }
}
```

---

# 11. 第三优先级：解决 Workspace 不可见问题

当前第二个关键问题是：

```text
reactor-demo-build
```

在 Agent 侧不存在。

因此需要区分：

```text
Reactor Workspace
```

与：

```text
Agent Workspace
```

是否实际上是同一个目录。

必须确认以下映射：

```text
Host Path
    ↓
DSH Workspace
    ↓
Agent Session Workspace
    ↓
Agent File Tools
```

例如：

```text
Host:
D:\project\reactor-demo-build

        ↓ mount

DSH:
workspace/reactor-demo-build

        ↓

Agent:
workspace/reactor-demo-build
```

如果其中任何一层没有 mount：

```text
Agent → read
```

就会得到：

```text
not found
```

---

# 12. 推荐的 Workspace Preflight

在 Agent 启动之前增加：

```text
Workspace Preflight
```

执行：

```text
1. Workspace exists?
2. Is directory?
3. Readable?
4. Writable?
5. Agent-visible?
6. Git repository?
```

返回：

```json
{
  "workspace": {
    "available": true,
    "path": "...",
    "readable": true,
    "writable": true,
    "gitRepository": true
  }
}
```

如果失败：

```json
{
  "workspace": {
    "available": false,
    "reason": "WORKSPACE_NOT_MOUNTED"
  }
}
```

---

# 13. 第四优先级：增加 Runtime Preflight

这是当前最值得加入 dsh-reactor 的一个新能力。

虽然 v0.8–v0.12 已经完成，但实际 Demo 暴露出了一个新的系统性问题：

> Reactor 在启动 Agent 之前不知道宿主是否具备完成任务所需的 Runtime Capability。

因此建议增加：

# Runtime Preflight

执行链路调整为：

```text
Event
  ↓
State
  ↓
Meaningful Change
  ↓
Policy
  ↓
Cost Gate
  ↓
Runtime Preflight
  ↓
Capability Check
  ↓
Agent
```

---

# 14. Runtime Capability 模型

建议定义：

```ts
interface RuntimeCapabilities {
  workspace: boolean;
  filesystemRead: boolean;
  filesystemWrite: boolean;
  shell: boolean;
  git: boolean;
  network: boolean;
}
```

对于 GitHub Maintainer：

```json
{
  "required": [
    "workspace",
    "filesystemRead",
    "filesystemWrite",
    "shell",
    "git"
  ]
}
```

Runtime Preflight：

```text
required capability
        ↓
    capability
       check
        ↓
 ┌──────┴──────┐
 ↓             ↓
PASS          FAIL
 ↓             ↓
Agent       BLOCKED
```

---

# 15. 失败时应该 Block，而不是启动 Agent

当前行为：

```text
GitHub Change
    ↓
Agent
    ↓
60s
    ↓
PowerShell ENOENT
    ↓
Agent timeout
```

这是非常浪费的。

正确行为：

```text
GitHub Change
    ↓
Meaningful Change
    ↓
Cost Gate
    ↓
Runtime Preflight
    ↓
PowerShell unavailable
    ↓
BLOCKED
```

最终：

```json
{
  "status": "blocked",
  "reason": "HOST_CAPABILITY_MISSING",
  "missingCapabilities": [
    "shell",
    "git"
  ],
  "tokens": 0
}
```

这样才能真正体现 Reactor 的“成本克制”。

---

# 16. Tool Result 必须统一为 Lossless JSON

当前测试中还发现：

```text
reactor_list
```

存在返回结果不完全 lossless 的问题。

这是另一个需要处理的问题。

建议所有 Reactor Tool 统一：

## Success

```json
{
  "ok": true,
  "data": {},
  "error": null
}
```

## Failure

```json
{
  "ok": false,
  "data": null,
  "error": {
    "code": "HOST_CAPABILITY_MISSING",
    "message": "PowerShell executable was not found",
    "details": {}
  }
}
```

不要让 Tool 直接返回：

```text
undefined
null
部分对象
字符串化 JSON
混合结构
```

否则 Agent Runtime 很难稳定判断：

```text
success
failure
blocked
retryable
fatal
```

---

# 17. GitHub Demo 应该分三级验收

目前不建议直接把：

```text
GitHub → Clone → Install → Test → Fix → Push
```

作为唯一验收标准。

应该拆成三级。

---

## Level 1：Event → Agent

```text
GitHub HEAD
    ↓
Hash Changed
    ↓
Reactor
    ↓
Agent
    ↓
History
    ↓
Token
```

当前：

> **已经完成。**

---

## Level 2：Event → Agent → Workspace

```text
GitHub HEAD
    ↓
Hash Changed
    ↓
Agent
    ↓
Read Workspace
    ↓
Analyze Code
    ↓
Generate Report
    ↓
History
```

建议现在立即完成。

这个 Demo 不依赖：

```text
git clone
npm install
PowerShell
```

只需要 DSH Agent 能访问已经存在的 Workspace。

---

## Level 3：Autonomous GitHub Maintainer

最终版本：

```text
GitHub Commit
      ↓
Meaningful Change
      ↓
Aggregation
      ↓
Cost Gate
      ↓
Runtime Preflight
      ↓
Agent
      ↓
Clone
      ↓
Install
      ↓
Test
      ↓
Failure
      ↓
Diagnose
      ↓
Repair
      ↓
Test
      ↓
Verify
      ↓
Success
      ↓
Report
```

Level 3 需要 DSH Host Runtime 的：

```text
Workspace
Shell
Git
Network
```

全部正常后再测试。

---

# 18. 当前最推荐的临时解决方案

如果当前目的是：

> **先把 dsh-reactor v0.12 Demo 完整展示出来**

那么不要等待 Shell 问题解决。

直接准备一个已经存在的本地 Git Repository：

```text
reactor-demo-build/
├── package.json
├── src/
├── tests/
└── README.md
```

让 Agent 直接访问：

```text
Workspace
```

测试：

```text
GitHub HEAD changed
        ↓
Reactor
        ↓
Agent
        ↓
Read source code
        ↓
Analyze change
        ↓
Run available verification
        ↓
Generate report
        ↓
Token accounting
        ↓
History
```

这样可以证明：

- Event Intelligence
- Agent Runtime
- Cost Router
- State
- Verification
- Recovery
- Trace
- Token Accounting

而不会被：

```text
powershell.exe ENOENT
```

卡住。

---

# 19. DSH Host Runtime 应该单独排查

建议建立一个独立的：

```text
DSH Runtime Capability Test
```

不要继续通过 GitHub Demo 间接排查。

测试顺序：

```text
Test 1
Node spawn
   ↓
where powershell
```

↓

```text
Test 2
powershell.exe
   ↓
echo hello
```

↓

```text
Test 3
shell
   ↓
pwd
```

↓

```text
Test 4
filesystem
   ↓
list workspace
```

↓

```text
Test 5
filesystem
   ↓
read file
```

↓

```text
Test 6
git
   ↓
git --version
```

↓

```text
Test 7
git
   ↓
git ls-remote
```

↓

```text
Test 8
workspace
   ↓
git clone
```

↓

```text
Test 9
workspace
   ↓
npm/node test
```

只有全部通过之后，才进入：

```text
Autonomous GitHub Maintainer
```

---

# 20. 最终故障树

当前问题可以正式归纳为：

```text
GitHub Demo Failure
        │
        ├── Reactor Event Source
        │       └── ✓ PASS
        │
        ├── State Detection
        │       └── ✓ PASS
        │
        ├── Meaningful Change
        │       └── ✓ PASS
        │
        ├── Cost / Policy
        │       └── ✓ PASS
        │
        ├── Agent Session
        │       └── ✓ PASS
        │
        ├── Agent ReAct
        │       └── ✓ PASS
        │
        ├── Token Accounting
        │       └── ✓ PASS
        │
        ├── Workspace
        │       └── ✗ NOT AVAILABLE
        │
        └── Shell
                └── ✗ powershell.exe ENOENT
```

因此：

> **当前不是 dsh-reactor v0.12 功能失败，而是 Demo 执行所依赖的 DSH Host Runtime Capability 不完整。**

---

# 21. 推荐解决顺序

优先级建议调整为：

## P0：DSH Host Runtime

### P0-1

解决：

```text
powershell.exe ENOENT
```

确认：

```text
where powershell
where pwsh
PATH
spawn
```

---

### P0-2

解决：

```text
Agent Workspace not found
```

确认：

```text
Host Path
    ↓
DSH Workspace
    ↓
Agent Workspace
```

是否一致。

---

### P0-3

独立完成：

```text
shell
filesystem
git
workspace
```

四项 Capability Test。

---

# 22. P0.5：加入 Runtime Preflight

在 dsh-reactor 中加入：

```text
Runtime Capability Registry
```

以及：

```text
Runtime Preflight
```

让 Reactor 在启动 Agent 前完成：

```text
Requirement
    ↓
Capability Check
    ↓
Pass / Block
```

---

# 23. P1：完成 GitHub Demo Level 2

使用：

```text
Pre-mounted Repository
```

实现：

```text
GitHub Change
    ↓
Reactor
    ↓
Agent
    ↓
Code Analysis
    ↓
Verification
    ↓
Report
```

这一步不应该等待 Shell Runtime。

---

# 24. P1：恢复 Level 3

等 DSH Host 修复：

```text
Git Clone
    ↓
Install
    ↓
Test
    ↓
Repair
    ↓
Retest
```

然后完成真正的：

> Autonomous GitHub Maintainer

---

# 25. Demo 最终展示指标

最终 Demo 不建议只展示：

```text
“Agent 成功运行”
```

而应该展示：

```text
Raw Events
       ↓
Meaningful Events
       ↓
Skipped Events
       ↓
Agent Runs
       ↓
Token Usage
       ↓
Verification
       ↓
Recovery Attempts
       ↓
Final Status
```

例如：

```text
GitHub events:          10
Meaningful changes:      2
Agent runs:              1
Skipped events:          9

Input tokens:         18.2k
Output tokens:         4.7k
Total tokens:         22.9k

Verification:        PASS
Recovery attempts:      1
Final status:      SUCCEEDED
```

如果 Runtime Preflight 阻断：

```text
GitHub events:          10
Meaningful changes:      1
Agent runs:              0

Blocked runs:            1
Reason:
HOST_CAPABILITY_MISSING

Missing:
- shell
- git

Agent tokens:             0
```

这反而能够成为 dsh-reactor 很有价值的展示点：

> **系统不是遇到事件就盲目调用 Agent，而是在执行前判断当前运行环境是否真的具备完成任务的能力。**

---

# 26. 对 v0.8–v0.12 状态的正式判断

原开发文档中的 v0.8–v0.12 路线已经完成：

```text
v0.8
Agent Runtime
       ✓

v0.9
Cost / Recovery / Verification
       ✓

v0.10
Stateful Reactor
       ✓

v0.11
Event Intelligence
       ✓

v0.12
Policy / Approval / Audit
       ✓
```

因此现在不应该继续称：

```text
v0.8 WIP
```

而应该将项目状态更新为：

```text
dsh-reactor v0.12
Core Runtime: COMPLETE

Demo Integration:
BLOCKED BY HOST RUNTIME CAPABILITY
```

---

# 27. 项目当前真实状态

建议 README / STATUS.md 使用：

```text
┌──────────────────────────────────────────┐
│          dsh-reactor v0.12               │
│                                          │
│ Core Runtime              ✓ COMPLETE     │
│ Event Intelligence        ✓ COMPLETE     │
│ Cost-aware Execution      ✓ COMPLETE     │
│ Stateful Execution        ✓ COMPLETE     │
│ Verification & Recovery   ✓ COMPLETE     │
│ Policy & Approval         ✓ COMPLETE     │
│ Token Accounting          ✓ COMPLETE     │
│                                          │
│ GitHub Demo                ⚠ HOST BLOCKED │
│ Shell Runtime              ✗ ENOENT      │
│ Workspace Mount            ✗ UNAVAILABLE │
└──────────────────────────────────────────┘
```

这个状态比直接写：

```text
GitHub Demo failed
```

严谨得多。

---

# 28. 最终结论

本次 GitHub Demo 测试暴露的问题并不是 dsh-reactor v0.12 核心架构缺陷。

实际测试已经证明：

```text
GitHub Event
    ↓
Polling
    ↓
Hash Change
    ↓
Rule Match
    ↓
Agent Session
    ↓
ReAct
    ↓
Token
    ↓
History
```

均已经能够正常工作。

当前失败发生在：

```text
Agent
  ↓
Host Runtime
  ↓
Shell / Workspace
  ↓
PowerShell
  ↓
ENOENT
```

因此正确的工程处理方式是：

```text
第一步：
修复 DSH Host 的 PowerShell / Shell Runtime

第二步：
修复 Agent Workspace Mount / Visibility

第三步：
建立独立 Runtime Capability Test

第四步：
在 dsh-reactor 增加 Runtime Preflight

第五步：
Level 2 Demo 先用预挂载 Workspace 完成

第六步：
Host Runtime 修复后完成 Level 3
Autonomous GitHub Maintainer
```

最重要的是：

> **不要因为这个问题重新修改已经完成的 v0.8–v0.12 Reactor 核心能力。**

现在项目已经从“开发 Reactor 核心功能”的阶段进入：

> **Runtime Integration + Demo Validation 阶段。**

这实际上是一个正常的工程阶段转换。

---

# 29. 下一阶段建议版本

因此建议将后续版本路线从原来的：

```text
v0.8 → v0.12 → v1.0
```

调整为：

```text
v0.12
Core Runtime Complete
        ↓
v0.12.1
Host Runtime Compatibility
        ↓
v0.12.2
Runtime Capability / Preflight
        ↓
v0.12.3
GitHub Demo Level 2
        ↓
v0.13
Autonomous GitHub Maintainer
        ↓
v1.0
Production-grade Event-Driven
Autonomous Agent Runtime
```

其中：

```text
v0.12.1
```

不属于 Reactor 核心能力升级，而属于：

> **DeepSeek Harness Host Runtime Integration**

而：

```text
v0.12.2
```

才是 dsh-reactor 自身值得正式沉淀的新能力：

> **Runtime Capability Awareness / Preflight**

这会让 dsh-reactor 从：

```text
Event → Agent
```

进一步演进为：

```text
Event
  ↓
State
  ↓
Meaningful Change
  ↓
Policy
  ↓
Cost Gate
  ↓
Runtime Capability
  ↓
Agent
  ↓
Verify
  ↓
Recover
  ↓
Trace
```

这与项目原来的“感知、克制、恢复、追踪”定位是统一的。