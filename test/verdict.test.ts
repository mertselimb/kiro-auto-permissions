import { expect, test } from "bun:test"
import { parseDecision, normalizeRawDecision } from "../src/verdict.ts"

test("accepts a valid allow decision", () => {
  const result = parseDecision({ decision: "allow", reasonCode: "routine_local_command", reason: "Safe." })
  expect(result).toEqual({ kind: "allow", reasonCode: "routine_local_command", reason: "Safe." })
})

test("rejects extra keys", () => {
  expect(parseDecision({ decision: "allow", reasonCode: "x", reason: "y", extra: 1 })).toBeNull()
})

test("rejects unknown decision value", () => {
  expect(parseDecision({ decision: "maybe", reasonCode: "x", reason: "y" })).toBeNull()
})

test("rejects bad reasonCode", () => {
  expect(parseDecision({ decision: "deny", reasonCode: "Bad Code", reason: "y" })).toBeNull()
})

test("truncates reason to 240 chars", () => {
  const long = "a".repeat(300)
  const result = parseDecision({ decision: "deny", reasonCode: "catastrophic_delete", reason: long })
  expect(result?.reason.length).toBe(240)
})

test("normalizeRawDecision lowercases decision and defaults a missing reasonCode", () => {
  const result = parseDecision(normalizeRawDecision({ decision: "ALLOW", reason: "harmless echo" }))
  expect(result).toEqual({ kind: "allow", reasonCode: "model_review", reason: "harmless echo" })
})

test("normalizeRawDecision keeps a valid reasonCode and normalizes DENY", () => {
  const result = parseDecision(normalizeRawDecision({ decision: "DENY", reasonCode: "force_push", reason: "no" }))
  expect(result).toEqual({ kind: "deny", reasonCode: "force_push", reason: "no" })
})

test("normalizeRawDecision still fails closed on missing reason", () => {
  expect(parseDecision(normalizeRawDecision({ decision: "allow" }))).toBeNull()
})
