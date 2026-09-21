import { spawn as nodeSpawn } from "node:child_process"
import { homedir } from "node:os"
import { dirname, join } from "node:path"
import { REVIEWER_AGENT_ID } from "./agent.ts"
import type { ReviewerClient } from "./types.ts"

export type SpawnFn = (
  bin: string,
  args: string[],
  input: string,
  signal: AbortSignal,
) => Promise<{ code: number; stdout: string }>

export function extractJson(stdout: string): unknown {
  let depth = 0
  let start = -1
  let candidate: string | undefined
  let inString = false
  let escaped = false
  for (let index = 0; index < stdout.length; index++) {
    const char = stdout[index]
    if (inString) {
      if (escaped) escaped = false
      else if (char === "\\") escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') {
      inString = true
    } else if (char === "{") {
      if (depth === 0) start = index
      depth++
    } else if (char === "}") {
      depth--
      if (depth === 0 && start >= 0) candidate = stdout.slice(start, index + 1)
    }
  }
  if (!candidate) throw new Error("Reviewer returned no JSON object")
  return JSON.parse(candidate)
}

export class KiroReviewerClient implements ReviewerClient {
  private readonly spawn: SpawnFn
  private readonly bin: string

  constructor(deps: { spawn?: SpawnFn; kiroCliPath?: string } = {}) {
    this.spawn = deps.spawn ?? defaultSpawn
    this.bin = deps.kiroCliPath ?? "kiro-cli"
  }

  async generate(input: { prompt: string; model: string | undefined; effort: string | undefined; signal: AbortSignal }): Promise<unknown> {
    const args = ["chat", "--no-interactive", "--agent", REVIEWER_AGENT_ID]
    if (input.model) args.push("--model", input.model)
    if (input.effort) args.push("--effort", input.effort)
    args.push(input.prompt)
    const { code, stdout } = await this.spawn(this.bin, args, "", input.signal)
    if (code !== 0) throw new Error(`Reviewer process exited with code ${code}`)
    return extractJson(stdout)
  }
}

const defaultSpawn: SpawnFn = (bin, args, _input, signal) =>
  new Promise((resolve, reject) => {
    const child = nodeSpawn(bin, args, { signal, env: { ...process.env, PATH: augmentedPath(bin) } })
    let stdout = ""
    child.stdout?.on("data", (chunk) => {
      stdout += String(chunk)
    })
    child.on("error", reject)
    child.on("close", (code) => resolve({ code: code ?? 1, stdout }))
  })

function augmentedPath(bin: string): string {
  const home = homedir()
  const extras = [
    dirname(bin),
    dirname(process.execPath),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    join(home, ".local", "bin"),
    join(home, ".bun", "bin"),
  ]
  return [process.env.PATH ?? "", ...extras].filter(Boolean).join(":")
}
