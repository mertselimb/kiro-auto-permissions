import { expect, test } from "bun:test"
import { join } from "node:path"
import { collectReviewInput } from "../src/context.ts"
import type { PermissionRequest } from "../src/types.ts"

const fixturesDir = join(import.meta.dir, "fixtures")

function request(): PermissionRequest {
  return { id: "1", sessionID: "session", action: "shell", resources: ["ls"], always: [], toolInput: { command: "ls" } }
}

test("collects user messages excluding plugin continuations", async () => {
  const input = await collectReviewInput(request(), {
    sessionID: "session",
    userMessageCount: 8,
    transcriptDir: fixturesDir,
  })
  expect(input.context.userMessages).toEqual(["first user message", "do not run rm -rf build"])
})

test("respects userMessageCount window", async () => {
  const input = await collectReviewInput(request(), {
    sessionID: "session",
    userMessageCount: 1,
    transcriptDir: fixturesDir,
  })
  expect(input.context.userMessages).toEqual(["do not run rm -rf build"])
})

test("degrades to empty context when transcript missing", async () => {
  const input = await collectReviewInput(request(), {
    sessionID: "missing",
    userMessageCount: 8,
    transcriptDir: fixturesDir,
  })
  expect(input.context.userMessages).toEqual([])
})

test("maps request fields into review input", async () => {
  const input = await collectReviewInput(request(), {
    sessionID: "session",
    cwd: "/work",
    userMessageCount: 8,
    transcriptDir: fixturesDir,
  })
  expect(input.request).toEqual({ action: "shell", resources: ["ls"], sessionPatterns: [], toolInput: { command: "ls" } })
  expect(input.context.directory).toBe("/work")
  expect(input.context.rootSessionID).toBe("session")
})
