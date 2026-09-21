export interface PermissionRequest {
  id: string
  sessionID: string
  action: string
  resources: string[]
  always: string[]
  toolInput?: unknown
}

export type Decision =
  | { kind: "allow"; reasonCode: string; reason: string }
  | { kind: "allow_session"; reasonCode: string; reason: string }
  | { kind: "deny"; reasonCode: string; reason: string }

export interface ReviewInput {
  request: {
    action: string
    resources: string[]
    sessionPatterns: string[]
    toolInput?: unknown
  }
  context: {
    rootSessionID: string
    directory?: string
    userMessages: string[]
  }
}

export interface ReviewerClient {
  generate(input: {
    prompt: string
    model: string | undefined
    effort: string | undefined
    signal: AbortSignal
  }): Promise<unknown>
}
