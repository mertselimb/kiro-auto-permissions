import { expect, test } from "bun:test"
import { review, eligibleForSessionApproval, isSensitiveTarget } from "../src/reviewer.ts"
import { parseConfig } from "../src/config.ts"
import type { PermissionRequest, ReviewInput, ReviewerClient } from "../src/types.ts"

function make(action: string, command: string, always: string[] = []): { input: ReviewInput; request: PermissionRequest } {
  const request: PermissionRequest = { id: "1", sessionID: "s", action, resources: [command], always, toolInput: { command } }
  const input: ReviewInput = {
    request: { action, resources: [command], sessionPatterns: always, toolInput: { command } },
    context: { rootSessionID: "s", userMessages: [] },
  }
  return { input, request }
}

const allowClient: ReviewerClient = { generate: async () => ({ decision: "allow", reasonCode: "ok", reason: "fine" }) }
const failClient: ReviewerClient = { generate: async () => { throw new Error("boom") } }

test("policy deny short-circuits the model", async () => {
  const { input, request } = make("shell", "rm -rf /")
  const decision = await review(input, request, parseConfig({}), failClient, new Set())
  expect(decision.kind).toBe("deny")
  expect(decision.reasonCode).toBe("catastrophic_delete")
})

test("model allow is returned", async () => {
  const { input, request } = make("shell", "docker build .")
  const decision = await review(input, request, parseConfig({}), allowClient, new Set())
  expect(decision.kind).toBe("allow")
})

test("fails closed on client error", async () => {
  const { input, request } = make("shell", "docker build .")
  const decision = await review(input, request, parseConfig({}), failClient, new Set())
  expect(decision.kind).toBe("deny")
  expect(decision.reasonCode).toBe("review_failed")
})

test("flags sensitive targets", () => {
  expect(isSensitiveTarget("~/.ssh/id_rsa")).toBe(true)
  expect(isSensitiveTarget("./src/app.ts")).toBe(false)
})

test("session approval ineligible for push", () => {
  const { input, request } = make("shell", "git push --force", ["git push*"])
  expect(eligibleForSessionApproval(parseConfig({}), request, input)).toBe(false)
})
