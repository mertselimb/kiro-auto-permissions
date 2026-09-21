import { defaultDiagnosticsPath } from "./diagnostics.ts"

const DEFAULT_TIMEOUT_MS = 30_000
const DEFAULT_USER_MESSAGE_COUNT = 8
const EFFORTS = new Set(["low", "medium", "high", "xhigh", "max"])

export interface Config {
  model: string | undefined
  effort: string | undefined
  timeoutMs: number
  userMessageCount: number
  shadow: boolean
  sessionApprovals: boolean
  diagnosticsPath: string | undefined
  kiroCliPath: string | undefined
}

export function parseConfig(options: Readonly<Record<string, unknown>>): Config {
  return {
    model: parseModel(options.model),
    effort: parseEffort(options.effort),
    timeoutMs: boundedInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS, 100, 30_000, "timeoutMs"),
    userMessageCount: boundedInteger(options.userMessageCount, DEFAULT_USER_MESSAGE_COUNT, 1, 20, "userMessageCount"),
    shadow: options.shadow === true,
    sessionApprovals: options.sessionApprovals !== false,
    diagnosticsPath: parseDiagnosticsPath(options.debug),
    kiroCliPath: typeof options.kiroCliPath === "string" && options.kiroCliPath.trim() ? options.kiroCliPath.trim() : undefined,
  }
}

function parseModel(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Auto Permissions model must be a non-empty kiro-cli model id")
  }
  return value.trim()
}

function parseEffort(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (typeof value === "string" && EFFORTS.has(value)) return value
  throw new Error("Auto Permissions effort must be one of: low, medium, high, xhigh, max")
}

function parseDiagnosticsPath(value: unknown): string | undefined {
  if (value === undefined || value === false) return undefined
  if (value === true) return defaultDiagnosticsPath()
  if (typeof value === "string" && value.trim()) return value.trim()
  throw new Error("Auto Permissions debug must be true, false, or a file path")
}

function boundedInteger(value: unknown, fallback: number, minimum: number, maximum: number, name: string): number {
  if (value === undefined) return fallback
  if (!Number.isInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`Auto Permissions ${name} must be an integer from ${minimum} to ${maximum}`)
  }
  return value as number
}
