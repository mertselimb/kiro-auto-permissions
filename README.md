# kiro-auto-permissions

Automatic, context-aware permission review for [Kiro CLI](https://kiro.dev).

Let routine work run untouched, send risky actions to a reviewer model, and keep an
unattended agent moving while you're away — with a real safety gate instead of blanket
trust. A Kiro `preToolUse` hook intercepts risk-bearing tool calls, applies a fast
deterministic policy, and escalates the rest to an isolated reviewer that answers allow or
block. It fails closed.

This is a port of [`opencode-auto-permissions`](https://github.com/hueyexe/opencode-auto-permissions)
to Kiro's hook model.

## How it works

```
your agent (tools pre-trusted → no prompts)   reviewer agent (no tools, no hook)
        │  wants to run shell / fs_write / use_aws / MCP tool
        ▼
   preToolUse hook  ──►  deterministic policy ──► allow (exit 0)
        │                                    └──► deny  (exit 2)
        │                     defer
        ▼
   reviewer model (kiro-cli chat --no-interactive)  ──►  {allow | deny}
        │
        ▼
   exit 0 (allow)  /  exit 2 (block, reason returned to the agent)
```

- **Reads are never gated.** Only `shell`, `fs_write`, `use_aws`, and MCP tools go through
  the hook, so inspection stays instant.
- **The deterministic policy answers first** — routine commands (`git status`, `npm test`,
  `cargo build`, …) are allowed and catastrophic ones (`rm -rf /`, `~`, `$HOME`) are denied
  without a model call.
- **Everything else is judged by the reviewer**, a tool-less, hook-less agent that receives
  the tool input plus your recent messages and returns a one-line verdict.
- **Fail closed.** A timeout, error, or unparseable verdict blocks the action and tells the
  agent to try something narrower.
- **No prompts.** The gated agent trusts its tools (`allowedTools: ["@builtin"]`), so nothing
  interrupts you; the hook is the gate, blocking with exit 2 when the reviewer says no.

## Requirements

- [Bun](https://bun.sh) ≥ 1.4
- `kiro-cli` on your `PATH`

## Install (global — gate every session)

This is the default, recommended setup: one pre-trusted agent, gated by the hook, set as
your global default so **every** `kiro-cli` session is reviewed.

```bash
bun install
bun run scripts/generate-prompt.ts

# 1. create a global default agent that trusts its tools (hands-off, no prompts)
cat > ~/.kiro/agents/kiro-default.json <<'JSON'
{ "name": "kiro-default", "description": "Default agent, gated by auto-permissions",
  "tools": ["@builtin"], "allowedTools": ["@builtin"] }
JSON

# 2. wire the hook + reviewer agent into it (resolves absolute bun/kiro-cli paths)
bun src/install.ts ~/.kiro/agents/kiro-default.json

# 3. make it the default for all sessions
kiro-cli settings chat.defaultAgent kiro-default
```

That's it — **enforce mode is on by default**. Every new `kiro-cli` session now routes
risk-bearing tool calls through the reviewer; reads and routine commands pass instantly, and
anything the reviewer denies is blocked with the reason handed back to the agent.

Revert anytime:

```bash
kiro-cli settings --delete chat.defaultAgent
```

> **Gate a single agent instead of all sessions?** Skip step 3 and run that agent explicitly:
> `kiro-cli chat --agent kiro-default`. You can also wire the hook into any existing agent by
> passing its JSON path to `bun src/install.ts`.

## Shadow mode (optional dry run)

Not enabled by default. Turn it on to watch decisions **without blocking anything** — useful
for building trust before relying on it:

```bash
echo '{"shadow": true, "debug": true}' > ~/.kiro/auto-permissions/config.json
tail -f ~/.kiro/auto-permissions/decisions.jsonl   # watch decisions as you work
```

Back to enforce (logging still on):

```bash
echo '{"debug": true}' > ~/.kiro/auto-permissions/config.json
```

> In shadow mode the gate **allows everything** and only logs — don't test blocking with a
> destructive command while shadow is on.

## Configuration

`~/.kiro/auto-permissions/config.json` (all optional):

| Key | Default | Meaning |
| --- | --- | --- |
| `model` | agent's default | Reviewer model — a `kiro-cli` model id (e.g. `claude-sonnet-4.6`). See `kiro-cli chat --list-models`. |
| `effort` | model default | Reviewer reasoning effort: `low`, `medium`, `high`, `xhigh`, or `max`. |
| `timeoutMs` | `30000` | Reviewer timeout (100–30000). On timeout the action is blocked. |
| `userMessageCount` | `8` | Recent user messages sent to the reviewer for context (1–20). |
| `shadow` | `false` | Evaluate and log, never block. |
| `debug` | `false` | Write decisions to `decisions.jsonl` (`true`, or a file path). |
| `kiroCliPath` | resolved at install | Absolute path to `kiro-cli` used to spawn the reviewer (set by the installer). |

Example:

```json
{ "model": "claude-sonnet-4.6", "effort": "medium", "debug": true }
```

## Uninstall

```bash
kiro-cli settings --delete chat.defaultAgent
rm -f ~/.kiro/agents/kiro-default.json ~/.kiro/agents/auto-permissions-reviewer.json
rm -rf ~/.kiro/auto-permissions
```

(If you wired the hook into a different agent, remove its `hooks.preToolUse` entries instead
of deleting `kiro-default.json`.)

## Development

```bash
bun test        # unit + integration tests
bun run check   # type-check
```

See [`docs/superpowers/specs`](docs/superpowers/specs) for the design and
[`docs/superpowers/plans`](docs/superpowers/plans) for the implementation plan.

## Notes and limits

- **The reviewer is the safety net.** Because the gated agent trusts its tools, the
  deterministic policy and the reviewer are what stand between the agent and a destructive
  command. Use shadow mode first if you want to validate its judgment.
- **Latency.** Each non-deterministic gated call spawns a reviewer turn (a few seconds).
  Routine allows and hard denies are instant.
- **No persistent cache.** Like the upstream plugin, session approvals are in-memory only;
  because a hook is a fresh process per call, repeat actions are re-reviewed rather than
  cached. On-disk caching is a possible follow-up.
- **Minimal hook PATH.** Kiro runs hooks with a minimal `PATH` that excludes `~/.bun/bin`
  and `~/.local/bin`. The installer therefore bakes the **absolute** `bun` path into the
  hook command and records the absolute `kiro-cli` path (`kiroCliPath`) in `config.json`;
  the reviewer spawns with an augmented `PATH`. If you move those binaries, re-run the
  installer.
- **Reviewer output is tolerated, not enforced.** `kiro-cli` has no structured-output mode,
  so the reviewer's JSON is normalized (lowercased decision, defaulted `reasonCode`) before
  strict validation. Genuinely malformed output still fails closed.

## Troubleshooting

- **Everything runs, nothing is logged:** the hook isn't firing. Confirm `chat.defaultAgent`
  is the wired agent, and that the hook `command` in the agent JSON is an absolute `bun` path.
- **`reasonCode:"review_failed"` on every non-routine command:** the reviewer subprocess
  failed — usually `kiro-cli` not resolvable. Re-run the installer so `config.json`'s
  `kiroCliPath` points at your `kiro-cli`.
- **Watch decisions:** `tail -f ~/.kiro/auto-permissions/decisions.jsonl` (needs `"debug":true`
  or `"shadow":true` in `config.json`).

## License

MIT
