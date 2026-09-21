import { expect, test } from "bun:test"
import { mergeHooks } from "../src/install.ts"

const CMD = "bun ~/.kiro/auto-permissions/hook.ts"

test("adds preToolUse entries for gated tools", () => {
  const merged = mergeHooks({ name: "worker" }, CMD)
  const matchers = (merged.hooks as any).preToolUse.map((entry: any) => entry.matcher)
  expect(matchers).toEqual(["shell", "fs_write", "use_aws", "@*/*"])
})

test("is idempotent", () => {
  const once = mergeHooks({ name: "worker" }, CMD)
  const twice = mergeHooks(once, CMD)
  expect((twice.hooks as any).preToolUse).toHaveLength(4)
})

test("preserves unrelated existing hooks", () => {
  const existing = { name: "worker", hooks: { preToolUse: [{ matcher: "read", command: "echo hi" }] } }
  const merged = mergeHooks(existing, CMD)
  const matchers = (merged.hooks as any).preToolUse.map((entry: any) => entry.matcher)
  expect(matchers).toContain("read")
  expect(matchers).toContain("shell")
})
