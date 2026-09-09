# dsh-reactor

> 事件驱动的智能决策引擎 — 让 DeepSeek Harness Agent 从"随叫随到的助理"变成"主动感知的守护进程"。

dsh-reactor 是一个基于 **ECA（Event-Condition-Action）** 规则模型的 DeepSeek Harness 插件。与传统的定时任务插件（到点执行预设命令）不同，dsh-reactor 让 Agent 能够**持续监控事件源、智能评估条件、自动执行可组合动作**，真正实现"状态感知、自主决策"。

**社区插件，非 DeepSeek 官方出品。**

---

## 安装

```bash
dsh plugin --profile web add dsh-reactor
```

安装后重启 dsh（`dsh web`），插件即自动加载。

## 卸载

```bash
dsh plugin --profile web remove dsh-reactor
```

---

## 快速开始

安装后，在对话中直接用自然语言告诉 Agent 你想监控什么、触发什么。例如：

> "帮我每 30 秒检查一次 https://api.example.com/status，当 status 字段变成 'error' 时，用 curl 发送告警到 https://hooks.example.com/alert"

Agent 会自动调用 `reactor_define` 工具创建规则，之后无需人工干预，规则在后台持续运行。

更多示例：

- "监控我的 deploy.json 文件，当 version 字段变化时，给我发一个 webhook 通知"
- "每 5 分钟运行一次 `git log --oneline -1`，当输出变化时，在新会话中提醒我查看提交"
- "轮询 GitHub API 获取最新 release，当 tag_name 变化时，把新版本拉下来构建运行"（完整示例见下节）

---

## 示例：监控 GitHub 新版本发布

目标：某仓库发布新 Release 时，把新版本代码拉下来构建运行。dsh-reactor 的事件驱动模型正是为此设计——**条件触发**（版本变化）而非定时执行。

**对话方式**（对 Agent 说）：

> "创建一个规则：每 5 分钟轮询 https://api.github.com/repos/vercel/next.js/releases/latest，当 tag_name 字段变化时，执行 `git -C C:\work\next fetch origin tag {{payload.tag_name}} && git -C C:\work\next checkout {{payload.tag_name}}`"

**静态配置方式**（`cordis.patch.yml`）：

```yaml
- id: dsh-reactor
  config:
    rules:
      - id: gh-release-deploy
        name: GitHub Release Deploy
        source:
          kind: http-poll
          target: https://api.github.com/repos/vercel/next.js/releases/latest
          intervalMs: 300000        # 5 分钟
        conditions:
          - field: $.tag_name
            op: changed             # 与上次载荷相比发生变化
        actions:
          - kind: shell
            target: >-
              git -C C:\work\next fetch origin tag {{payload.tag_name}} &&
              git -C C:\work\next checkout {{payload.tag_name}} &&
              cd C:\work\next && pnpm install && pnpm build
        cooldownMs: 3600000         # 1 小时冷却，防止抖动
        enabled: true
```

**要点**：
- **首次触发（基线）**：`changed` 在第一次轮询时 prev 为空，会立即触发一次（相当于初始化部署到当前最新版），之后只在 tag 变化时触发。
- **模板插值**：`{{payload.tag_name}}` 与 `{{tag_name}}` 写法等价，自动从事件载荷取值。
- **GitHub API 限流**：未认证 60 次/小时，5 分钟轮询（12 次/小时）绰绰有余；私有仓库需配置带 token 的请求。
- 建议先让 Agent 调 `reactor_test` 用真实/模拟载荷验证，再启用。

---

## 真实效果演示

仓库内置端到端示例：`examples/github-release-watcher.mjs`（真实请求 GitHub，监控 `vercel/next.js` 最新 Release）。以下为 2026-09-09 实测输出：

```text
▶ 定义规则：监控 GitHub Release，新版本发布即执行
[INFO] [reactor] rule added: GitHub Release Watcher (gh-release-demo)

▶ 真实请求 GitHub: GET https://api.github.com/repos/vercel/next.js/releases/latest
  数据来源: github.com releases/latest redirect
  (API error: exit code 35 — 本次环境 api.github.com SSL 握手失败，自动降级 HTML 端点)
  latest tag: v16.3.4, published: 2026-09-09T06:32:06.603Z

▶ 第一次评估（基线，prev 为空 → changed 为 true → 触发）
"new release detected: v16.3.4 (2026-09-09T06:32:06.603Z)"
  条件匹配: true，动作执行: 1

▶ 第二次评估（同一 tag，prev 相同 → changed 为 false → 不触发）
  条件匹配: false，动作执行: 0

▶ 模拟新版本发布（tag_name 变化 → 再次触发）
"new release detected: v16.3.4-demo-new (2026-09-09T06:32:06.625Z)"
  条件匹配: true，动作执行: 1

▶ 执行历史（reactor_history 的数据来源）
  2026-09-09T06:32:06.624Z matched=true  [OK] shell: echo "new release detected: {{payload.tag_name}} ({{payload.published_at}})" (21ms)
  2026-09-09T06:32:06.625Z matched=false
  2026-09-09T06:32:06.642Z matched=true  [OK] shell: echo "new release detected: {{payload.tag_name}} ({{payload.published_at}})" (17ms)

演示完成 ✅
```

这段输出展示了 dsh-reactor 的四个核心特性：

1. **条件驱动**：tag 变化才触发；同一版本再次轮询**不触发**（`changed` 状态感知，这是与传统 cron 的本质区别）
2. **真实数据**：从 GitHub 获取最新版本号；API 不可用（限流/连接失败）时自动降级 HTML 端点，不中断
3. **模板插值**：`{{payload.tag_name}}` 从事件载荷取值注入动作，实现"发布即部署"
4. **可审计**：每次触发（匹配/不匹配）连同动作成败与耗时进入执行历史，供 `reactor_history` 查询

运行方式：`node examples/github-release-watcher.mjs`

---

## 规则模型（ECA）

每条规则由三部分组成：

### 1. 事件源（Event Source）

| 类型 | 说明 | 配置 |
|------|------|------|
| `http-poll` | 轮询 HTTP 接口，解析 JSON 或文本响应 | URL、轮询间隔、请求头 |
| `file-watch` | 读取本地文件内容（轮询模式） | 文件路径、轮询间隔 |
| `command` | 执行 shell 命令，解析 stdout | 命令、轮询间隔 |
| `webhook` | **由外部系统主动推送事件**（HTTP POST 到 dsh-reactor 的 webhook 入口，v0.2 新增） | webhook 路径过滤（可选） |

### 2. 条件（Condition）

使用 **JSONPath**（如 `$.status`、`$.data.count`）从事件载荷中取值，然后用比较运算符判定：

| 运算符 | 说明 |
|--------|------|
| `eq` / `ne` | 等于 / 不等于 |
| `gt` / `lt` / `gte` / `lte` | 数值比较 |
| `contains` | 字符串包含 |
| `matches` | 正则匹配 |
| `exists` | 字段存在 |
| `changed` | 与上一次载荷相比发生了变化 |

多个条件支持 `AND` / `OR` 组合。

### 3. 动作（Action）

| 类型 | 说明 |
|------|------|
| `shell` | 执行 shell 命令（支持 `{{payload.field}}` 模板替换） |
| `webhook` | POST JSON 到指定 URL（自动附加事件载荷） |
| `agent-talk` | 在**真实隔离的 Workspace Session** 中执行提示词（v0.2 升级，不再是事件广播） |

一条规则可配置多个动作，按顺序执行。

### 防护机制

- **冷却时间（cooldownMs）**：触发后多久内不再重复触发，防止刷屏
- **并发限制**：全局最大并发动作数（默认 3），防止资源耗尽
- **错误隔离**：单个动作失败不影响其他动作，错误记录到日志

---

## 模型可见工具

Agent 通过以下工具管理规则（用户无需手动操作，自然语言即可）：

| 工具 | 用途 |
|------|------|
| `reactor_define` | 创建一条新的 ECA 规则 |
| `reactor_list` | 列出所有规则及运行状态 |
| `reactor_status` | 查看指定规则详情（含最近一次事件载荷） |
| `reactor_remove` | 删除规则并停止其事件源 |
| `reactor_test` | 用模拟载荷手动测试规则是否匹配 |
| `reactor_history` | 查看规则执行历史：每次触发的匹配结果、每个动作的成败与耗时、Agent 会话执行结果（v0.2 新增） |

---

## 可视化挂件（v0.3）

除了对话管理，dsh-reactor 还提供一个**常驻在 DSH Web 右下角的小挂件**，把规则设定、监控结果、触发历史全部可视化：

- **卡通形象悬浮气泡**：默认是一只浅蓝小反应堆机器人，可拖拽吸附到四边/四角，大小 0.6–2.5x 缩放，支持自定义形象图片（点击形象或通过挂件设置修改）
- **触发即提醒**：规则触发、动作失败、重试耗尽时弹出 toast 气泡 + 未读角标，点击可放大成完整管理面板
- **管理面板**：
  - 总览：规则数、总触发次数、动作成败、最后触发时间、最近事件流
  - 规则列表：启停开关、删除、点击进入详情
  - 新建规则：可视化表单（含 **GitHub Release 监控**等快捷预设——监控仓库新版本发布 → 自动拉取代码运行）
  - 规则详情：每次触发的执行历史、每动作成功/失败、重试次数、attemptLog、Agent 会话 Token 消耗、失败报错与分析
- **数据通道**：挂件通过内置 REST API（`/reactor/api/*`）读写规则与状态，与对话工具完全同源

挂件默认开启（`uiEnabled: true`）；如不需要，在 `cordis.patch.yml` 中配置 `uiEnabled: false` 即可。

> 依赖 `dsh.client` 客户端通道（自动随插件安装加载），仅 `web` profile 生效。

---

## 静态配置（可选）

除了通过 Agent 对话动态创建规则，也可以在 profile 的 `cordis.patch.yml` 中预定义静态规则：

```yaml
- id: dsh-reactor
  config:
    allowShell: true
    maxConcurrentActions: 3
    defaultIntervalMs: 60000
    rules:
      - id: health-check
        name: API 健康检查
        source:
          kind: http-poll
          target: https://api.example.com/health
          intervalMs: 30000
        conditions:
          - field: $.status
            op: ne
            value: ok
        actions:
          - kind: webhook
            target: https://hooks.example.com/alert
            payload:
              level: critical
        cooldownMs: 60000
        enabled: true
```

---

## 配置项

| 字段 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `allowShell` | boolean | `true` | 是否允许 shell 动作。安全敏感环境可设为 `false` |
| `maxConcurrentActions` | number | `3` | 全局最大并发动作数 |
| `defaultIntervalMs` | number | `60000` | 事件源默认轮询间隔（毫秒） |
| `rules` | array | `[]` | 预定义的静态规则列表 |
| `storePath` | string | `$DSH_HOME/reactor/rules.json` | 规则持久化文件路径（v0.2） |
| `historyPath` | string | `$DSH_HOME/reactor/history.jsonl` | 运行历史文件路径（v0.2） |
| `maxHistoryEntries` | number | `500` | 历史记录保留条数（v0.2） |
| `webhookPath` | string | `/reactor/webhook` | webhook 接收端点路径（v0.2） |
| `webhookToken` | string | 无 | 可选共享令牌，设置后需在请求头携带 `x-reactor-token`（v0.2） |
| `allowAgentSession` | boolean | `true` | agent-talk 是否创建真实会话执行（v0.2） |
| `agentWorkspaceDir` | string | `$DSH_HOME/reactor/workspaces` | agent-talk 会话的工作区根目录（v0.2） |
| `agentPreset` | string | `standard` | 创建会话使用的 Agent 预设（v0.2） |
| `permissionPreset` | string | `workspace-write` | 创建会话使用的权限预设（v0.2） |
| `apiPath` | string | `/reactor/api` | 挂件 REST API 前缀路径（v0.3） |
| `uiEnabled` | boolean | `true` | 是否启用 Web 挂件（v0.3；仅 web profile 生效） |

---

## 运行历史（v0.2）

每次规则触发都会记录一条历史（可审计）：

- **匹配结果**：条件是否命中
- **动作明细**：每个动作的类型、目标、成败、错误信息、耗时（毫秒）
- **Agent 会话**：agent-talk 创建的真实会话 ID、工作区路径、执行结果
- **持久化**：历史写入 `history.jsonl`，重启后可通过 `reactor_history` 查询

在对话中直接问 Agent："查看 dsh-reactor 最近的执行历史" 即可。

---

## Webhook 推送入口（v0.2）

除了轮询事件源，dsh-reactor 还提供一个 HTTP 接收端点，让外部系统**主动推送事件**：

```bash
# 默认端点（无令牌）
curl -X POST http://127.0.0.1:3080/reactor/webhook \
  -H "Content-Type: application/json" \
  -d '{"status":"error","service":"api"}'

# 配置了 webhookToken 时
curl -X POST http://127.0.0.1:3080/reactor/webhook \
  -H "Content-Type: application/json" \
  -H "x-reactor-token: YOUR_TOKEN" \
  -d '{"status":"error"}'
```

返回 `202 Accepted` 表示事件已接收并分发（规则评估异步进行）。创建 webhook 规则示例：

> "创建一个 webhook 规则：当推送到 /reactor/webhook 的 JSON 中 `status` 等于 `error` 时，执行 `echo alarm`"

**HTTP 契约**：`202` 已分发 ｜ `400` 非法 JSON ｜ `401` 令牌错误 ｜ `405` 非 POST ｜ `413` 体积超限 ｜ `415` 非 JSON 内容类型 ｜ `503` 引擎不可用

---

## 规则持久化（v0.2）

- 所有通过对话创建的规则自动写入 `rules.json`，**重启 dsh 后自动恢复**
- 持久化只保存规则定义，运行态（触发计数、最近载荷）不落盘，恢复后从零开始
- 静态配置（`config.rules`）仅在首次启动（存储为空）时加载，之后以动态规则为准

---

## 与现有定时任务插件的区别

| 维度 | 传统 cron 类插件 | dsh-reactor |
|------|-----------------|-------------|
| 触发方式 | 固定时间（Cron 表达式） | 任意事件源 + 条件评估 |
| 决策逻辑 | 到点就执行 | 评估条件后决定是否执行 |
| 状态感知 | 无 | 保留上次载荷，支持 `changed` 条件 |
| 动作 | 预设单一命令 | 可组合多动作（shell/webhook/agent-talk） |
| 定义方式 | 手写配置 | Agent 自然语言创建 + 静态配置 |
| 通用性 | 定时提醒/执行 | 通用 ECA 框架，事件源可扩展 |
| 持久化 | 部分支持 | 规则 + 历史双落盘（v0.2） |
| 外部推送 | 不支持 | webhook 接收端点（v0.2） |
| 可审计性 | 运行日志 | 每次触发、每个动作、会话结果全记录（v0.2） |
| 可视化管理 | 部分插件有面板 | 常驻挂件：气泡提醒 + 规则/历史/Token/失败分析可视化（v0.3） |

---

## 权限与风险说明

- **shell 动作**会在 dsh 运行环境中执行命令，请仅信任你自己创建的规则。部署时可通过 `allowShell: false` 完全禁用。
- **http-poll** 会向配置的 URL 发起网络请求，请确保目标地址可信。
- **file-watch** 以 dsh 进程权限读取文件，请勿指向敏感文件。
- **agent-talk**（v0.2）会在独立工作区创建真实 Agent 会话执行任务，使用 `agentPreset` / `permissionPreset` 控制能力边界（默认 `standard` + `workspace-write`）。
- **webhook 入口**（v0.2）默认无鉴权，仅在本地回环监听；如需对外暴露请配置 `webhookToken` 并在反向代理层加 TLS。
- 规则与历史存储在 `$DSH_HOME/reactor/` 下，均为本地文件，本插件不上传任何数据到第三方服务。

### 兼容性

| 项 | 说明 |
|----|------|
| DeepSeek Harness | ≥ 0.1.2-rc.1（`dsh` CLI，`@deepseek-ai/cordis` ^4.0.0） |
| Node.js | 运行时 ≥ 22；构建 ≥ 22.19 |
| profile | `web` 等带 webServer 的 profile：完整能力（含 webhook 入口）；headless profile：自动降级（无 webhook 入口，其余功能正常） |
| 平台 | Windows / Linux / macOS；`shell` 动作依赖系统默认 shell（cmd / bash / zsh） |
| 外部服务 | 事件源 URL（http-poll）、webhook 目标（动作）、GitHub API 等由你的规则决定；本插件不内建任何第三方连接 |

---

## 开发

```bash
# 安装依赖
pnpm install

# 类型检查
pnpm typecheck

# 构建
pnpm build

# 冒烟测试 + 启动验证
node test/smoke.mjs
node test/boot-check.mjs

# 端到端演示（真实请求 GitHub）
node examples/github-release-watcher.mjs

# 本地安装到调试 profile
dsh plugin --profile dev add .

# 验证挂载
dsh --profile dev --dump-config | grep reactor

# 启动调试
dsh --profile dev web
```

## 发布

```bash
pnpm build
npm publish --access public
```

发布后：
1. 在 GitHub 仓库 Settings → Topics 中添加 `dsh-plugin`
2. 确保 README 包含安装命令 `dsh plugin --profile web add dsh-reactor`
3. 等待 dsh-plugin.org 自动扫描收录

---

## License

MIT
