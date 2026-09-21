# kiro-auto-permissions

Automatic, context-aware permission review for [Kiro CLI](https://kiro.dev).

Run an agent unattended without blindly trusting it. A `preToolUse` hook intercepts
`shell`, `fs_write`, `use_aws`, and MCP calls and runs a fast deterministic policy over
them; whatever the policy can't decide goes to an isolated reviewer model that replies
allow or deny. If the reviewer times out, errors, or returns garbage, the action is
blocked. It fails closed.

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

- Reads are never gated: only `shell`, `fs_write`, `use_aws`, and MCP tools go through the
  hook, so inspection stays fast.
- The deterministic policy answers first. Routine commands (`git status`, `npm test`,
  `cargo build`) are allowed; catastrophic ones (`rm -rf /`, `~`, `$HOME`) are denied
  without a model call.
- Everything else goes to the reviewer, a tool-less, hook-less agent that gets the tool
  input plus your recent messages and returns a one-line verdict.
- A timeout, error, or unparseable verdict blocks the action and tells the agent to try
  something narrower.
- Nothing interrupts you: the gated agent trusts its tools (`allowedTools: ["@builtin"]`),
  and the hook blocks with exit 2 when the reviewer says no.

## Requirements

- [Bun](https://bun.sh) ≥ 1.4
- `kiro-cli` on your `PATH`

## Global install (gates every session)

The recommended setup: one pre-trusted agent, gated by the hook, set as your global default
so every `kiro-cli` session gets reviewed.

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

From here on, every new `kiro-cli` session runs in enforce mode: gated tool calls go
through the reviewer, and anything denied comes back to the agent with the reason.

To undo it:

```bash
kiro-cli settings --delete chat.defaultAgent
```

If you'd rather gate one agent than every session, skip step 3 and run that agent
explicitly (`kiro-cli chat --agent kiro-default`). You can also wire the hook into any
existing agent by passing its JSON path to `bun src/install.ts`.

## Shadow mode (optional dry run)

Off by default. Turn it on to watch decisions without blocking anything while you decide
whether to trust it:

```bash
echo '{"shadow": true, "debug": true}' > ~/.kiro/auto-permissions/config.json
tail -f ~/.kiro/auto-permissions/decisions.jsonl   # watch decisions as you work
```

Back to enforce (logging still on):

```bash
echo '{"debug": true}' > ~/.kiro/auto-permissions/config.json
```

In shadow mode the gate allows everything and only logs, so don't test blocking with a
destructive command while it's on.

## Configuration

`~/.kiro/auto-permissions/config.json` (all optional):

| Key | Default | Meaning |
| --- | --- | --- |
| `model` | agent's default | Reviewer model as a `kiro-cli` model id (e.g. `claude-sonnet-4.6`); see `kiro-cli chat --list-models`. |
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

If you wired the hook into a different agent, remove its `hooks.preToolUse` entries
instead of deleting `kiro-default.json`.

## Development

```bash
bun test        # unit + integration tests
bun run check   # type-check
```

See [`docs/superpowers/specs`](docs/superpowers/specs) for the design and
[`docs/superpowers/plans`](docs/superpowers/plans) for the implementation plan.

## Notes and limits

- The reviewer is the safety net. The gated agent trusts its tools, so the deterministic
  policy and the reviewer are all that stand between it and a destructive command. Spend
  some time in shadow mode before you trust its judgment.
- Each deferred call spawns a reviewer turn, which takes a few seconds. Routine allows and
  hard denies are instant.
- Nothing is cached on disk. Like the upstream plugin, approvals live in memory only, and
  since a hook is a fresh process per call, repeat actions get re-reviewed rather than
  cached. On-disk caching is a possible follow-up.
- Kiro runs hooks with a minimal `PATH` that excludes `~/.bun/bin` and `~/.local/bin`, so
  the installer bakes the absolute `bun` path into the hook command and records the
  absolute `kiro-cli` path (`kiroCliPath`) in `config.json`; the reviewer spawns with an
  augmented `PATH`. If you move those binaries, re-run the installer.
- Reviewer output is tolerated, not enforced. `kiro-cli` has no structured-output mode, so
  the reviewer's JSON is normalized (lowercased decision, defaulted `reasonCode`) before
  strict validation. Genuinely malformed output still fails closed.

## Troubleshooting

- If everything runs but nothing is logged, the hook isn't firing. Check that
  `chat.defaultAgent` is the wired agent and that the hook `command` in the agent JSON is
  an absolute `bun` path.
- If `reasonCode:"review_failed"` shows up on every non-routine command, the reviewer
  subprocess failed, usually because `kiro-cli` isn't resolvable. Re-run the installer so
  `kiroCliPath` in `config.json` points at your `kiro-cli`.
- To watch decisions, run `tail -f ~/.kiro/auto-permissions/decisions.jsonl` (needs
  `"debug":true` or `"shadow":true` in `config.json`).

## License

MIT
