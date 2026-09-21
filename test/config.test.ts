import { expect, test } from "bun:test"
import { parseConfig } from "../src/config.ts"

test("applies defaults", () => {
  const config = parseConfig({})
  expect(config.timeoutMs).toBe(30000)
  expect(config.userMessageCount).toBe(8)
  expect(config.sessionApprovals).toBe(true)
  expect(config.shadow).toBe(false)
  expect(config.model).toBeUndefined()
  expect(config.effort).toBeUndefined()
  expect(config.diagnosticsPath).toBeUndefined()
})

test("parses a kiro-cli model id", () => {
  const config = parseConfig({ model: "claude-sonnet-4.6" })
  expect(config.model).toBe("claude-sonnet-4.6")
})

test("rejects an empty model", () => {
  expect(() => parseConfig({ model: "  " })).toThrow()
})

test("parses a valid effort", () => {
  expect(parseConfig({ effort: "medium" }).effort).toBe("medium")
})

test("rejects an invalid effort", () => {
  expect(() => parseConfig({ effort: "turbo" })).toThrow()
})

test("shadow true enables default diagnostics path", () => {
  const config = parseConfig({ shadow: true, debug: true })
  expect(config.diagnosticsPath).toMatch(/decisions\.jsonl$/)
})

test("rejects out-of-range timeout", () => {
  expect(() => parseConfig({ timeoutMs: 99 })).toThrow()
})
