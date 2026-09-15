# dsh-reactor

> **Event-Driven Autonomous Agent Runtime for DeepSeek Harness**
>
> 让 DeepSeek Agent 从"随叫随到的助理"变成"主动感知环境、自主完成目标的守护进程"。

dsh-reactor 不是另一个 cron 插件。它把 DeepSeek Harness 的 Agent 变成一个**事件驱动的自主运行时**：你告诉它"监控什么、什么时候值得处理、想达成什么目标"，它就在后台持续观察，一旦条件命中，拉起一个隔离的 Agent Session，让 LLM 用 ReAct 自主完成任务、验证结果、自动恢复，并留下完整运行轨迹。

**社区插件，非 DeepSeek 官方出品。**

---

## 为什么不是 cron？

| 维度 | 传统 cron 插件 | dsh-reactor |
|------|---------------|-------------|
| 触发方式 | 固定时间 | 任意事件源 + 条件评估 |
| 决策逻辑 | 到点就执行 | 评估条件后决定是否执行 |
| 执行方式 | 跑预设脚本 | 拉起隔离 Agent，LLM ReAct 自主完成 |
| 结果验证 | 无 | 确定性验证（文件存在/命令退出码） |
| 失败恢复 | 无 | 自动分类 + 智能 retry |
| 状态感知 | 无 | 上次摘要注入，续作不重头开始 |
| 可审计 | 日志 | 完整 Run Trace 决策链 |

---

## 安装

```bash
dsh plugin --profile web add dsh-reactor
```

安装后重启 `dsh web`，插件自动加载。右下角会出现时钟主题挂件。

## 卸载

```bash
dsh plugin --profile web remove dsh-reactor
```

---

## 快速开始

安装后，在 DSH 对话中直接用自然语言描述你的目标：

> "帮我监控 https://api.github.com/repos/snhna-a/dsh-reactor 的最新 commit，当 HEAD 变化时，在 C:\work\dsh-reactor 目录里 git pull 最新代码并跑 npm run build，然后告诉我结果。"

Agent 会自动调用 `reactor_define` 创建规则。之后无需人工干预，规则在后台持续运行。

更多示例：

- "监控 deploy.json 文件，当 version 字段变化时，发 webhook 通知"
- "每 5 分钟跑 `git log --oneline -1`，当输出变化时，在新会话里分析这次提交"
- "轮询某网站的监控 API，当 status 变成 error 时，让 Agent 自动诊断并修复"

---

## 核心概念：ECG（Event-Condition-Goal）

dsh-reactor 把传统 ECA 升级为 **ECG**：

```
Event（事件）
  ↓ 轮询/监听/接收推送
Condition（条件）
  ↓ JSONPath + 比较运算 + AND/OR + changed
Goal（目标）
  ↓ 拉起隔离 Agent Session，LLM ReAct 自主完成
```

**关键区别**：Action 模式跑固定脚本；**Goal 模式**把你的目标 + 事件上下文注入隔离 Agent Session，让 LLM 自己决定怎么完成——拉代码、跑测试、分析报错、修复、再验证，全程自主。

---

## 事件源

| 类型 | 说明 |
|------|------|
| `http-poll` | 轮询 HTTP 接口，解析 JSON/文本 |
| `file-watch` | 读取本地文件（自动处理 BOM） |
| `command` | 执行 shell 命令，解析 stdout |
| `webhook` | 外部系统 HTTP POST 主动推送 |

## 条件

JSONPath（`$.status`、`$.data.count`）+ 运算符（`eq`/`ne`/`gt`/`contains`/`exists`/`changed`）+ AND/OR 组合。

## 两种执行模式

### Action 模式（传统 ECA）
- `shell`：执行命令（支持 `{{payload.field}}` 模板）
- `webhook`：POST JSON 到指定 URL
- `agent-talk`：在隔离 Session 中跑提示词

### Goal 模式（ECG，推荐）
- 拉起隔离 Agent Session
- 注入你的目标 + 上次运行摘要（续作）
- LLM ReAct 自主完成：读文件、跑命令、调工具、验证结果
- 完成后自动做**确定性验证**（文件存在/命令退出码）
- 失败自动分类 + 智能 retry

---

## 安全与防护

| 机制 | 说明 |
|------|------|
| Budget Gate | `maxRunsPerDay` / `maxTokens` 硬门，超限 blocked 0 token |
| Approval Gate | `riskLevel: high` + `requireApproval` → 等人工批准才跑 |
| Preflight | 启动 Agent 前检查工作目录/文件系统/网络能力，缺能力 blocked 0 token |
| Cooldown | 触发后冷却时间，防刷屏 |
| Overlap Protection | 同一规则不并发跑 |
| Failure Classification | 自动分类 transient/repairable/dangerous |
| Smart Retry | transient 错误（网络 blip/超时）自动多 retry 一次 |

---

## 可视化挂件

DSH Web 右下角常驻时钟主题挂件：

- **拖拽吸附**：可拖到四边/四角，左吸附自动镜像翻转
- **大小调节**：0.6–2.5x，半透明设置面板
- **触发提醒**：规则触发、失败、重试时气泡提示
- **管理面板**：总览 stats、规则列表（启停/删除）、规则详情
- **Run Trace**：每次 run 完整决策链时间线（trigger→decision→approval→budget→retry→agent→verify→result）
- **Failure 标签**：一眼看出失败类型（transient/repairable/dangerous）
- **Token 消耗**：每次 run 的 input/output/cache token

---

## 模型工具

Agent 通过以下工具管理规则（自然语言即可，无需手动操作）：

| 工具 | 用途 |
|------|------|
| `reactor_define` | 创建规则（支持 action/goal 模式） |
| `reactor_list` | 列出所有规则及运行状态 |
| `reactor_status` | 查看规则详情（最近载荷、运行状态） |
| `reactor_test` | 用模拟载荷手动测试规则 |
| `reactor_remove` | 删除规则 |
| `reactor_history` | 查看执行历史（含 Run Trace、Token、失败分类） |

---

## 规则持久化与审计

- 规则自动持久化到 `~/.dsh/reactor/rules.json`，重启自动恢复
- 每次触发记录到 `~/.dsh/reactor/history.jsonl`（ring buffer 500 条）
- 历史包含：触发时间、匹配结果、事件载荷、Agent 会话 ID、Token 消耗、Run Trace steps、失败分类
- 下次同规则触发时，上次摘要自动注入 goal prompt（续作不重头开始）

---

## 与其他 DSH 插件的关系

- **dsh-cron / dsh-automation**：定时任务，到点跑固定命令。dsh-reactor 是事件驱动 + Agent ReAct，不重复。
- **dsh-cron-panel**：定时任务面板。dsh-reactor 挂件是事件驱动规则的可视化。
- **dsh-taskboard**：人机协作看板。dsh-reactor 是后台自主运行，不需要人逐条验收。
- **dsh-agent-teams**：多 Agent 编排。dsh-reactor 是事件路由，每个事件拉起一个隔离 Agent。

---

## 权限与风险

- **shell 动作**在 dsh 运行环境执行命令，仅信任你自己创建的规则。
- **http-poll**向配置 URL 发请求，确保目标可信。
- **Goal 模式**在隔离工作区创建 Agent Session，使用 `permissionPreset` 控制能力边界。
- **webhook 入口**默认仅本地回环监听；对外暴露请配置 `webhookToken` + TLS。
- 所有数据存储在本地 `~/.dsh/reactor/`，不上传第三方。

### 兼容性

| 项 | 说明 |
|----|------|
| DeepSeek Harness | ≥ 0.1.2-rc.1（`@deepseek-ai/cordis` ^4.0.0） |
| Node.js | ≥ 22 |
| profile | `web` 完整能力；headless 自动降级 |
| 平台 | Windows / Linux / macOS |

---

## 开发

```bash
pnpm install
pnpm typecheck
pnpm build

# 本地链接到调试 profile
# 在 ~/.dsh/profiles/web/package.json 加: "dsh-reactor": "link:/path/to/dsh-reactor"
```

---

## License

MIT
