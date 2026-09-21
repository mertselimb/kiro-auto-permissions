import { createHash } from "node:crypto"
import { collectReviewInput } from "./context.ts"
import { review } from "./reviewer.ts"
import { KiroReviewerClient } from "./kiro-client.ts"
import { parseConfig } from "./config.ts"
import { writeDiagnostic, defaultDiagnosticsPath, failureCategory, describeError, flushDiagnostics } from "./diagnostics.ts"
import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import type { Config } from "./config.ts"
import type { PermissionRequest, ReviewerClient } from "./types.ts"

interface HookPayload {
  tool_name?: unknown
  tool_input?: unknown
  cwd?: unknown
}

interface HookDeps {
  config: Config
  client: ReviewerClient
  cache: Set<string>
  sessionID: string
  transcriptDir?: string
}

const ACTION_ALIASES: Record<string, string> = {
  execute_bash: "shell",
  execute_cmd: "shell",
  fs_write: "write",
  fsWrite: "write",
}

export function mapRequest(payload: HookPayload, sessionID: string): PermissionRequest {
  const toolName = typeof payload.tool_name === "string" ? payload.tool_name : "unknown"
  const action = ACTION_ALIASES[toolName] ?? toolName
  const toolInput = payload.tool_input
  const resources = deriveResources(action, toolInput)
  const id = createHash("sha256").update(`${sessionID}:${toolName}:${JSON.stringify(toolInput ?? null)}`).digest("hex").slice(0, 16)
  return { id, sessionID, action, resources, always: [], ...(toolInput !== undefined ? { toolInput } : {}) }
}

function deriveResources(action: string, toolInput: unknown): string[] {
  if (typeof toolInput === "object" && toolInput !== null) {
    if (action === "shell") {
      const command = Reflect.get(toolInput, "command")
      if (typeof command === "string") return [command]
    }
    if (action === "write") {
      const path = Reflect.get(toolInput, "path")
      if (typeof path === "string") return [path]
    }
    if (action === "use_aws") {
      const service = Reflect.get(toolInput, "service_name")
      const operation = Reflect.get(toolInput, "operation_name")
      if (typeof service === "string" && typeof operation === "string") return [`${service}/${operation}`]
    }
  }
  return []
}

export async function runHook(payload: HookPayload, deps: HookDeps): Promise<{ code: 0 | 2; stderr?: string }> {
  const startedAt = Date.now()
  const diagPath = deps.config.diagnosticsPath ?? (deps.config.shadow ? defaultDiagnosticsPath() : undefined)
  const request = mapRequest(payload, deps.sessionID)
  try {
    const input = await collectReviewInput(request, {
      sessionID: deps.sessionID,
      ...(typeof payload.cwd === "string" ? { cwd: payload.cwd } : {}),
      userMessageCount: deps.config.userMessageCount,
      ...(deps.transcriptDir ? { transcriptDir: deps.transcriptDir } : {}),
    })
    const decision = await review(input, request, deps.config, deps.client, deps.cache)
    writeDiagnostic(diagPath, {
      timestamp: new Date().toISOString(),
      event: "decision",
      action: request.action,
      resourceCount: request.resources.length,
      elapsedMs: Date.now() - startedAt,
      decision: decision.kind,
      reasonCode: decision.reasonCode,
      reason: decision.reason,
      shadow: deps.config.shadow,
    })
    if (deps.config.shadow) return { code: 0 }
    if (decision.kind === "deny") {
      return { code: 2, stderr: `Auto Permissions blocked this action: ${decision.reason}` }
    }
    return { code: 0 }
  } catch (error) {
    writeDiagnostic(diagPath, {
      timestamp: new Date().toISOString(),
      event: "failure",
      action: request.action,
      resourceCount: request.resources.length,
      elapsedMs: Date.now() - startedAt,
      failureCategory: failureCategory(error),
      errorMessage: describeError(error).message,
      shadow: deps.config.shadow,
    })
    if (deps.config.shadow) return { code: 0 }
    const message = error instanceof Error ? error.message : "unknown error"
    return { code: 2, stderr: `Auto Permissions blocked this action: review error (${message}); continue with a narrower or lower-risk step.` }
  }
}

async function loadFileConfig(path = join(homedir(), ".kiro", "auto-permissions", "config.json")): Promise<Config> {
  const raw = await readFile(path, "utf8").catch(() => "")
  const options = raw ? (JSON.parse(raw) as Record<string, unknown>) : {}
  return parseConfig(options)
}

export async function runEntry(
  stdinText: string,
  deps: { sessionID: string; transcriptDir?: string; configPath?: string; client?: ReviewerClient; cache?: Set<string> },
): Promise<{ code: 0 | 2; stderr?: string }> {
  try {
    const config = await loadFileConfig(deps.configPath)
    const payload = stdinText ? (JSON.parse(stdinText) as HookPayload) : {}
    const client = deps.client ?? new KiroReviewerClient({ kiroCliPath: config.kiroCliPath })
    const cache = deps.cache ?? new Set<string>()
    return await runHook(payload, {
      config,
      client,
      cache,
      sessionID: deps.sessionID,
      ...(deps.transcriptDir ? { transcriptDir: deps.transcriptDir } : {}),
    })
  } catch {
    return { code: 2, stderr: "Auto Permissions blocked this action: hook failed to start; continue with a narrower or lower-risk step." }
  }
}

if (import.meta.main) {
  const stdin = await Bun.stdin.text()
  const result = await runEntry(stdin, { sessionID: process.env.KIRO_SESSION_ID ?? "unknown" })
  if (result.stderr) process.stderr.write(result.stderr + "\n")
  await flushDiagnostics()
  process.exit(result.code)
}
