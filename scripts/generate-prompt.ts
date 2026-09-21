import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { REVIEWER_SYSTEM_PROMPT } from "../src/agent.ts"

await writeFile(join(import.meta.dir, "..", "assets", "reviewer-system-prompt.txt"), REVIEWER_SYSTEM_PROMPT + "\n")
console.log("wrote assets/reviewer-system-prompt.txt")
