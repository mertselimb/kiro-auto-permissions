import { cp, mkdir, readFile, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"

const GATED_MATCHERS = ["shell", "fs_write", "use_aws", "@*/*"]
const TIMEOUT_MS = 30_000

type HookEntry = { matcher: string; command: string; timeout_ms?: number }

export function mergeHooks(config: Record<string, unknown>, hookCommand: string): Record<string, unknown> {
  const hooks = isRecord(config.hooks) ? { ...config.hooks } : {}
  const existing = Array.isArray(hooks.preToolUse) ? (hooks.preToolUse as HookEntry[]) : []
  const kept = existing.filter((entry) => !(GATED_MATCHERS.includes(entry.matcher) && entry.command === hookCommand))
  const added = GATED_MATCHERS.map((matcher) => ({ matcher, command: hookCommand, timeout_ms: TIMEOUT_MS }))
  return { ...config, hooks: { ...hooks, preToolUse: [...kept, ...added] } }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

async function install(targetAgentPath: string): Promise<void> {
  const home = homedir()
  const installDir = join(home, ".kiro", "auto-permissions")
  await mkdir(installDir, { recursive: true })
  const projectRoot = join(import.meta.dir, "..")
  await cp(join(projectRoot, "src"), join(installDir), { recursive: true })
  await cp(join(projectRoot, "assets", "reviewer-system-prompt.txt"), join(installDir, "reviewer-system-prompt.txt"))
  await mkdir(join(home, ".kiro", "agents"), { recursive: true })
  await cp(join(projectRoot, "assets", "auto-permissions-reviewer.json"), join(home, ".kiro", "agents", "auto-permissions-reviewer.json"))
  const hookCommand = `${process.execPath} ${join(installDir, "hook.ts")}`
  const raw = await readFile(targetAgentPath, "utf8")
  const config = JSON.parse(raw) as Record<string, unknown>
  await writeFile(targetAgentPath, JSON.stringify(mergeHooks(config, hookCommand), null, 2) + "\n")
  const kiroCli = Bun.which("kiro-cli") ?? "kiro-cli"
  const configPath = join(installDir, "config.json")
  const existingConfig = await readFile(configPath, "utf8").catch(() => "")
  const settings = existingConfig ? (JSON.parse(existingConfig) as Record<string, unknown>) : {}
  settings.kiroCliPath = kiroCli
  await writeFile(configPath, JSON.stringify(settings, null, 2) + "\n")
  console.log(`Installed. Hook wired into ${targetAgentPath}. Run that agent with --trust-all-tools for hands-off mode.`)
}

if (import.meta.main) {
  const target = process.argv[2]
  if (!target) {
    console.error("Usage: bun src/install.ts <path-to-worker-agent.json>")
    process.exit(1)
  }
  await install(target)
}
