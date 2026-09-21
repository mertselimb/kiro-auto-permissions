import type { Decision } from "./types.ts"

const DECISIONS = new Set(["allow", "allow_session", "deny"])
const KEYS = ["decision", "reason", "reasonCode"]
const REASON_CODE = /^[a-z][a-z0-9_]{0,63}$/
const MAX_REASON_LENGTH = 240

export function parseDecision(value: unknown): Decision | null {
  if (!isRecord(value)) return null
  if (Object.keys(value).sort().join(",") !== KEYS.join(",")) return null
  const decision = value.decision
  const reasonCode = value.reasonCode
  const reason = value.reason
  if (typeof decision !== "string" || !DECISIONS.has(decision)) return null
  if (typeof reasonCode !== "string" || !REASON_CODE.test(reasonCode)) return null
  if (typeof reason !== "string" || !reason.trim()) return null
  return { kind: decision as Decision["kind"], reasonCode, reason: reason.slice(0, MAX_REASON_LENGTH) }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

// Kiro's kiro-cli reviewer has no structured-output enforcement (unlike the
// upstream OpenCode client, which passed DECISION_SCHEMA), so a model may reply
// with an uppercase decision or omit reasonCode. Normalise those realistic
// shapes to the strict contract before validation; genuinely malformed output
// (missing/invalid decision or reason) still fails parseDecision and fails closed.
export function normalizeRawDecision(raw: unknown): unknown {
  if (!isRecord(raw)) return raw
  const decision = typeof raw.decision === "string" ? raw.decision.trim().toLowerCase() : raw.decision
  const rawCode = raw.reasonCode
  const reasonCode = typeof rawCode === "string" && REASON_CODE.test(rawCode) ? rawCode : "model_review"
  return { decision, reasonCode, reason: raw.reason }
}
