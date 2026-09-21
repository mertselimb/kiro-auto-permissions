import { applyDeterministicPolicy } from "./policy.ts"
import { buildReviewPrompt } from "./prompt.ts"
import { parseDecision, normalizeRawDecision } from "./verdict.ts"
import type { Config } from "./config.ts"
import type { Decision, PermissionRequest, ReviewInput, ReviewerClient } from "./types.ts"

const SESSION_APPROVAL_BLOCK =
  /\b(?:sudo|rm|rmdir|shred|git\s+(?:push|reset|clean|rebase)|npm\s+publish|pnpm\s+publish|deploy|terraform\s+apply|kubectl\s+(?:apply|delete)|curl\b[^\n|]*\|\s*(?:ba|z|k)?sh)\b/i

export async function review(
  input: ReviewInput,
  request: PermissionRequest,
  config: Config,
  client: ReviewerClient,
  cache: Set<string>,
): Promise<Decision> {
  const policyDecision = applyDeterministicPolicy(input)
  if (policyDecision) return policyDecision

  const approvalKey = reusableApprovalKey(config, request, input)
  if (approvalKey && cache.has(approvalKey)) {
    return { kind: "allow", reasonCode: "session_approval_reused", reason: "Reuses an approved narrow pattern from this session." }
  }

  let decision: Decision
  try {
    decision = await runModel(input, config, client)
  } catch (error) {
    const reason =
      error instanceof Error && /timed out/i.test(error.message)
        ? "Permission review timed out, so the action was blocked; continue with a narrower or lower-risk step and retry only if needed."
        : "Permission review failed, so the action was blocked; continue with a narrower or lower-risk step and retry only if needed."
    return { kind: "deny", reasonCode: "review_failed", reason }
  }

  if (approvalKey && (decision.kind === "allow" || decision.kind === "allow_session")) cache.add(approvalKey)
  return decision
}

async function runModel(input: ReviewInput, config: Config, client: ReviewerClient): Promise<Decision> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort("review timed out"), config.timeoutMs)
  try {
    const raw = await Promise.race([
      client.generate({ prompt: buildReviewPrompt(input), model: config.model, effort: config.effort, signal: controller.signal }),
      timeoutPromise(controller.signal),
    ])
    const decision = parseDecision(normalizeRawDecision(raw))
    if (!decision) throw new Error("Reviewer returned an invalid decision")
    return decision
  } finally {
    clearTimeout(timer)
  }
}

function timeoutPromise(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(new Error("Permission review timed out")), { once: true })
  })
}

export function reusableApprovalKey(config: Config, request: PermissionRequest, input: ReviewInput): string | undefined {
  if (!eligibleForSessionApproval(config, request, input)) return undefined
  return JSON.stringify([input.context.rootSessionID, request.action, request.always])
}

export function eligibleForSessionApproval(config: Config, request: PermissionRequest, input: ReviewInput): boolean {
  if (!config.sessionApprovals || request.always.length === 0) return false
  if (request.always.some((pattern) => isBroadPattern(pattern))) return false
  if ([...request.resources, ...request.always].some((value) => isSensitiveTarget(value))) return false
  if (["read", "glob", "grep", "list", "lsp"].includes(request.action)) return true
  if (request.action !== "shell" && request.action !== "bash") return false
  const command =
    typeof input.request.toolInput === "object" && input.request.toolInput !== null
      ? Reflect.get(input.request.toolInput, "command")
      : input.request.resources.join(" && ")
  if (typeof command !== "string") return false
  return !isSensitiveTarget(command) && !SESSION_APPROVAL_BLOCK.test(command)
}

export function isBroadPattern(pattern: string): boolean {
  const value = pattern.trim()
  return (
    !value ||
    value === "*" ||
    value === "**" ||
    /^[\\/]?(?:tmp|home|Users)[\\/][*?]+$/i.test(value) ||
    /^[*?]/.test(value) ||
    /\*\*/.test(value) ||
    /^(?:git|npm|pnpm|yarn|bun|cargo|go|sudo|rm)\s+[*?]+$/i.test(value)
  )
}

export function isSensitiveTarget(value: string): boolean {
  return /(?:^|[\\/])(?:\.ssh|\.aws|\.gnupg|Keychains?|credentials?|tokens?)(?:[\\/]|$)|(?:^|[\\/])\.env(?:\.|$)/i.test(value)
}
