import { expect, test } from "bun:test"
import { extractJson, KiroReviewerClient } from "../src/kiro-client.ts"

test("extracts the last balanced JSON object from noisy stdout", () => {
  const stdout = 'banner line\n{"decision":"allow","reasonCode":"ok","reason":"fine"}\ntrailing'
  expect(extractJson(stdout)).toEqual({ decision: "allow", reasonCode: "ok", reason: "fine" })
})

test("throws when no JSON object present", () => {
  expect(() => extractJson("no json here")).toThrow()
})

test("does not truncate on a closing brace inside a string value", () => {
  const stdout = '{"decision":"deny","reasonCode":"x","reason":"use foo() } bar"}'
  expect(extractJson(stdout)).toEqual({ decision: "deny", reasonCode: "x", reason: "use foo() } bar" })
})

test("generate returns parsed object from spawn stdout", async () => {
  const client = new KiroReviewerClient({
    spawn: async () => ({ code: 0, stdout: '{"decision":"deny","reasonCode":"x","reason":"y"}' }),
  })
  const result = await client.generate({ prompt: "p", model: undefined, effort: undefined, signal: new AbortController().signal })
  expect(result).toEqual({ decision: "deny", reasonCode: "x", reason: "y" })
})

test("generate throws on non-zero exit", async () => {
  const client = new KiroReviewerClient({ spawn: async () => ({ code: 1, stdout: "" }) })
  await expect(
    client.generate({ prompt: "p", model: undefined, effort: undefined, signal: new AbortController().signal }),
  ).rejects.toThrow()
})

test("generate spawns the configured kiroCliPath binary", async () => {
  let usedBin = ""
  const client = new KiroReviewerClient({
    kiroCliPath: "/abs/path/kiro-cli",
    spawn: async (bin) => {
      usedBin = bin
      return { code: 0, stdout: '{"decision":"allow","reasonCode":"ok","reason":"fine"}' }
    },
  })
  await client.generate({ prompt: "p", model: undefined, effort: undefined, signal: new AbortController().signal })
  expect(usedBin).toBe("/abs/path/kiro-cli")
})

test("generate passes --model and --effort when provided", async () => {
  let usedArgs: string[] = []
  const client = new KiroReviewerClient({
    spawn: async (_bin, args) => {
      usedArgs = args
      return { code: 0, stdout: '{"decision":"allow","reasonCode":"ok","reason":"fine"}' }
    },
  })
  await client.generate({ prompt: "p", model: "claude-sonnet-4.6", effort: "medium", signal: new AbortController().signal })
  expect(usedArgs).toContain("--model")
  expect(usedArgs[usedArgs.indexOf("--model") + 1]).toBe("claude-sonnet-4.6")
  expect(usedArgs).toContain("--effort")
  expect(usedArgs[usedArgs.indexOf("--effort") + 1]).toBe("medium")
})
