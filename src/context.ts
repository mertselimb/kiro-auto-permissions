import { readFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"
import type { PermissionRequest, ReviewInput } from "./types.ts"

const MAX_MESSAGE_CHARS = 4_000
export const AUTO_PERMISSIONS_MESSAGE_PREFIX = "[Auto Permissions] The requested action was blocked:"

export interface CollectOptions {
  sessionID: string
  cwd?: string
  userMessageCount: number
  transcriptDir?: string
}

export async function collectReviewInput(
  request: PermissionRequest,
  options: CollectOptions,
): Promise<ReviewInput> {
  const userMessages = await readUserMessages(options)
  return {
    request: {
      action: request.action,
      resources: [...request.resources],
      sessionPatterns: [...request.always],
      ...(request.toolInput !== undefined ? { toolInput: request.toolInput } : {}),
    },
    context: {
      rootSessionID: options.sessionID,
      ...(options.cwd ? { directory: options.cwd } : {}),
      userMessages,
    },
  }
}

async function readUserMessages(options: CollectOptions): Promise<string[]> {
  const dir = options.transcriptDir ?? join(homedir(), ".kiro", "sessions", "cli")
  const path = join(dir, `${options.sessionID}.jsonl`)
  const raw = await readFile(path, "utf8").catch(() => "")
  if (!raw) return []
  const messages: string[] = []
  for (const line of raw.split("\n")) {
    const text = userText(line)
    if (text !== undefined) messages.push(text.slice(0, MAX_MESSAGE_CHARS))
  }
  return messages.slice(-options.userMessageCount)
}

function userText(line: string): string | undefined {
  const trimmed = line.trim()
  if (!trimmed) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    return undefined
  }
  if (!isRecord(parsed) || parsed.kind !== "Prompt" || !isRecord(parsed.data)) return undefined
  const content = parsed.data.content
  if (!Array.isArray(content)) return undefined
  const text = content
    .filter((item): item is Record<string, unknown> => isRecord(item) && item.kind === "text" && typeof item.data === "string")
    .map((item) => item.data as string)
    .join("\n")
  if (!text || isPluginContinuation(text)) return undefined
  return text
}

function isPluginContinuation(text: string): boolean {
  return text.trimStart().startsWith(AUTO_PERMISSIONS_MESSAGE_PREFIX)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
