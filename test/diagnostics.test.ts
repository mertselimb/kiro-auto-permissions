import { expect, test } from "bun:test"
import { failureCategory, defaultDiagnosticsPath, writeDiagnostic, flushDiagnostics } from "../src/diagnostics.ts"
import { mkdtemp, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

test("classifies timeout errors", () => {
  expect(failureCategory(new Error("Permission review timed out"))).toBe("timeout")
})

test("classifies abort as cancelled", () => {
  expect(failureCategory(new DOMException("x", "AbortError"))).toBe("cancelled")
})

test("classifies invalid response", () => {
  expect(failureCategory(new Error("Reviewer returned an invalid decision"))).toBe("invalid_response")
})

test("default path lives under kiro/auto-permissions", () => {
  expect(defaultDiagnosticsPath()).toMatch(/kiro[\\/]auto-permissions[\\/]decisions\.jsonl$/)
})

test("flushDiagnostics persists queued writes before the caller exits", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ap-diag-"))
  const path = join(dir, "decisions.jsonl")
  writeDiagnostic(path, { timestamp: new Date().toISOString(), event: "decision", decision: "deny", reasonCode: "x", reason: "y" })
  await flushDiagnostics()
  const contents = await readFile(path, "utf8")
  expect(contents).toContain('"decision":"deny"')
})
