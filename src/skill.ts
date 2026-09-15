/**
 * dsh-reactor — conversational rule-creation skill.
 *
 * Registered into the host's global skill layer so a session agent knows
 * how to turn natural-language monitoring requests into reactor rules:
 * infer the event source, pick the right condition, choose action vs goal
 * mode, and set sensible defaults.
 *
 * Follows the dsh-cron skill pattern: `ctx.inject(['skills'], ...)` so
 * hosts without the skill registry simply don't register it.
 */

import type { Context } from '@deepseek-ai/cordis'

export const REACTOR_SKILL_NAME = 'reactor-create'

const DESCRIPTION =
  'Create an event-driven automation rule on this host: watch a URL, file, or command, and when something changes, run a command, POST a webhook, or spawn an autonomous Agent to do a task.'

const WHEN_TO_USE =
  'Use when the user wants to monitor something and react automatically — "watch this repo for new releases", "alert me if this website goes down", "run tests when config changes", "watch this file and restart the service" — or asks to list, test, or remove such rules.'

const CONTENT = `# Creating reactor rules from a session

Reactor rules are event-driven: they watch a data source, evaluate conditions, and fire when conditions match. Unlike cron (which fires on a clock), reactor fires when **state changes**.

## Workflow

1. **Understand what to watch.** Ask only what's genuinely ambiguous. Most monitoring requests map directly to a source type (see below).
2. **Infer technical parameters.** Pick sensible defaults — don't ask the user for JSONPath expressions or poll intervals unless they care.
3. **Confirm briefly.** Show the rule in plain language ("I'll poll GitHub every 5 min, detect new tags, then clone+test"). Create it.
4. **Verify.** Call \`reactor_list\` to confirm, and offer \`reactor_test\` with a sample payload.

## Source cheat-sheet

| User says... | source_kind | source_target | interval |
|---|---|---|---|
| "watch this URL/API/website" | http-poll | the URL | 60000 (1 min) |
| "watch this file" | file-watch | file path | 30000 (30s) |
| "run this command and check output" | command | the shell command | 60000 |
| "receive webhooks / push events" | webhook | "/reactor/webhook" | — |

## Condition cheat-sheet

- **"changed"** — most common. "When there's a new release", "when the status changes", "when something updates". Use \`{field: "$.someField", op: "changed"}\`.
- **"equals something"** — use \`{field: "$.status", op: "eq", value: "error"}\`.
- **"greater than"** — use \`gt\`/\`lt\` for thresholds like disk usage > 90%.
- **Default**: if the user just says "watch X and react", use \`changed\` on the primary field. For GitHub releases, poll \`https://api.github.com/repos/{owner}/{repo}/releases/latest\` and watch \`$.tag_name\` with \`changed\`.

### GitHub monitoring — avoid rate limits
Unauthenticated GitHub REST API is capped at 60 requests/hour/IP, so a 1-minute http-poll will be rate-limited quickly. Prefer one of:
- **New release/tag (recommended)**: use a \`command\` source running \`git ls-remote --tags <repo>.git\` wrapped to emit JSON, poll every 5 min, \`changed\` on the latest tag. This uses the git protocol, not the REST quota.
- **New commit on a branch**: \`command\` source \`git ls-remote <repo>.git <branch>\`, \`changed\` on the SHA.
- Only use http-poll against the GitHub API when the user has a token available or poll interval is ≥10 min.

## Action vs Goal mode

- **Action mode** (default): simple, deterministic. Use for "run this shell command", "POST to this URL", or "notify me".
- **Goal mode**: for anything non-trivial. The Agent gets the event payload + your goal and figures out the steps itself. Use when the user says things like:
  - "pull the code and run tests"
  - "analyze the error and send a report"
  - "deploy and verify"
  - "clone the repo, install deps, run CI"

  Set \`mode: "goal"\` and write a clear \`goal\` string. The Agent runs autonomously in an isolated session — it never asks you questions.

## Defaults you should pick

- **interval_ms**: 60000 (1 min) for APIs, 30000 for local files, 300000 (5 min) for external APIs to avoid rate limits.
- **cooldown_ms**: 300000 (5 min) for polling sources — prevents rapid re-fires when data flaps.
- **goal constraints**: \`{timeoutMinutes: 30}\` is a safe default. Increase for big builds.

## Examples

### "Watch facebook/react for new releases, then clone and test"
\`\`\`
reactor_define:
  name: "React release monitor"
  source_kind: "http-poll"
  source_target: "https://api.github.com/repos/facebook/react/releases/latest"
  source_interval_ms: 300000
  conditions: [{field: "$.tag_name", op: "changed"}]
  cooldown_ms: 600000
  mode: "goal"
  goal: "A new React release was detected. Clone the repository at the release tag listed in the payload, install dependencies, run the test suite, and report the results — pass/fail, any errors."
\`\`\`

### "Watch my repo for a new tag, then pull and run"
Use a command source with git ls-remote (avoids GitHub API rate limits). The command must print JSON:
\`\`\`
reactor_define:
  name: "My repo auto-run"
  source_kind: "command"
  source_target: "git ls-remote --tags --sort=-v:refname https://github.com/OWNER/REPO.git | head -1 | awk '{print \\"{\\\\\\"tag\\\\\\":\\\\\\"\\"$2\\"\\\\\\"}\\"}'"
  source_interval_ms: 300000
  conditions: [{field: "$.tag", op: "changed"}]
  cooldown_ms: 600000
  mode: "goal"
  goal: "A new tag was detected (see payload). Clone or fetch the repo at that tag into the working directory, install dependencies, run the build/tests, and report pass/fail with any errors. Do not ask questions; decide reasonable defaults and proceed."
  constraints: {timeoutMinutes: 20, workingDir: "<absolute project path>"}
\`\`\`

### "Alert me if https://example.com/health returns non-200"
First poll it to see the response shape, then:
\`\`\`
reactor_define:
  name: "Website health check"
  source_kind: "http-poll"
  source_target: "https://example.com/health"
  source_interval_ms: 60000
  conditions: [{field: "$.status", op: "ne", value: "healthy"}]
  cooldown_ms: 300000
  mode: "action"
  actions: [{kind: "shell", target: "echo 'Website down: check it now' | mail -s ALERT admin@example.com"}]
\`\`\`

## Caution

- Rules persist across restarts. Deleting a rule stops its polling immediately.
- Goal runs are unattended: the Agent won't ask for approval. Keep goals focused and safe.
- Use \`reactor_list\` to see existing rules, \`reactor_history <rule_id>\` to check past runs, \`reactor_remove <rule_id>\` to delete.
`

export const REACTOR_SKILL = {
  name: REACTOR_SKILL_NAME,
  description: DESCRIPTION,
  whenToUse: WHEN_TO_USE,
  content: CONTENT,
  source: 'runtime' as const,
}

/**
 * Register the skill once the host's skill registry is available.
 * No-op if the host has no `skills` service.
 */
export function registerReactorSkill(ctx: Context): void {
  // ctx.inject may not exist on all hosts; guard defensively.
  const inject = (ctx as unknown as { inject?: (deps: string[], cb: (c: Context) => void) => void }).inject
  if (typeof inject !== 'function') return
  inject.call(ctx, ['skills'], (skillCtx) => {
    try {
      const skills = (skillCtx as unknown as { skills: { register: (s: unknown) => void } }).skills
      skills.register(REACTOR_SKILL)
      ;(ctx as unknown as { logger?: { info: (m: string) => void } }).logger?.info?.('[dsh-reactor] skill registered: reactor-create')
    } catch (err) {
      ;(ctx as unknown as { logger?: { warn: (m: string) => void } }).logger?.warn?.(`[dsh-reactor] skill registration failed: ${String(err)}`)
    }
  })
}
