import { mkdir, open, readFile, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import type { Decision, PermissionRequest } from "./types.ts"

const MAX_RECORDS = 100
const queues = new Map<string, Promise<void>>()

export interface DiagnosticRecord {
  timestamp: string
  event:
    | "plugin_started"
    | "model_attempt"
    | "model_failure"
    | "model_decision"
    | "request_received"
    | "decision"
    | "failure"
  requestID?: string
  sessionID?: string
  action?: string
  resourceCount?: number
  elapsedMs?: number
  source?: "policy" | "model" | "session"
  decision?: Decision["kind"]
  approvalScope?: "once" | "session"
  reasonCode?: string
  reason?: string
  shadow?: boolean
  failureCategory?: "timeout" | "cancelled" | "invalid_response" | "error"
  errorName?: string
  errorMessage?: string
  providerID?: string
  modelID?: string
  variant?: string
  attempt?: number
}

export async function flushDiagnostics(): Promise<void> {
  await Promise.allSettled([...queues.values()])
}

export function defaultDiagnosticsPath(): string {
  return join(homedir(), ".kiro", "auto-permissions", "decisions.jsonl")
}

export function writeDiagnostic(path: string | undefined, record: DiagnosticRecord): void {
  if (!path) return
  const previous = queues.get(path) ?? Promise.resolve()
  const next = previous.then(() => appendBounded(path, record)).catch(() => undefined)
  queues.set(path, next)
  void next.finally(() => {
    if (queues.get(path) === next) queues.delete(path)
  })
}

export function failureCategory(error: unknown): NonNullable<DiagnosticRecord["failureCategory"]> {
  const message = describeError(error).message
  if (/timed out/i.test(message)) return "timeout"
  if (error instanceof DOMException && error.name === "AbortError") return "cancelled"
  if (/invalid decision|no structured output|invalid response/i.test(message)) return "invalid_response"
  return "error"
}

export function describeError(error: unknown): { name: string; message: string } {
  const name = error instanceof Error ? error.name : "Error"
  const message =
    error instanceof Error ? error.message : typeof error === "string" ? error : "Unknown non-Error failure"
  return { name: name.slice(0, 500), message: message.slice(0, 500) }
}

async function appendBounded(path: string, record: DiagnosticRecord): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const line = JSON.stringify(record) + "\n"
  const existing = await readFile(path, "utf8").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return ""
    throw error
  })
  if (existing.split("\n").filter(Boolean).length >= MAX_RECORDS * 2) {
    const records = existing.split("\n").filter(Boolean)
    records.push(JSON.stringify(record))
    await writeFile(path, records.slice(-MAX_RECORDS).join("\n") + "\n", { mode: 0o600 })
    return
  }
  const handle = await open(path, "a")
  try {
    await handle.appendFile(line, "utf8")
  } finally {
    await handle.close()
  }
}
