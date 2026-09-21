/**
 * Moharrik chat — the framework-agnostic core.
 *
 * Everything else in this package (the React component, the Vue plugin, the
 * script tag build) is a thin wrapper around `createChat`. The core talks to
 * two public endpoints on a Moharrik workspace:
 *
 *   POST /api/chat/{key}/messages   the visitor writes
 *   GET  /api/chat/{key}/messages   the visitor's own thread
 *
 * The widget key is public on purpose. What protects it is the origin
 * allow-list on the key: a key embedded on a site you did not allow is
 * refused, and the refusal is what `onError` reports.
 */

export type Locale = "en" | "ar"

export type ChatMessage = {
  id: string
  /** From the workspace's point of view: `in` is this visitor, `out` is the team. */
  direction: "in" | "out"
  body: string
  created_at: string
}

export type ChatStatus = "open" | "snoozed" | "closed"

export type ChatErrorKind = "blocked" | "unknown" | "network" | "too_long" | "server"

export class ChatError extends Error {
  constructor(
    public kind: ChatErrorKind,
    message: string,
    public status?: number,
  ) {
    super(message)
    this.name = "ChatError"
  }
}

export type ChatOptions = {
  /** The widget key from Moharrik (Inbox -> Chat widgets). Starts `cwk_`. */
  key: string
  /**
   * Where the Moharrik app lives, e.g. `https://app.moharrik.com`.
   * Required for npm/bundler use; the script-tag build infers it from its own
   * `src`, so a plain <script> install does not need it.
   */
  apiOrigin?: string
  /** `en` (default) or `ar`, which also flips the widget to RTL. */
  locale?: Locale
  /** How often to poll for replies while a conversation is open, in ms (default 5000, min 1000). */
  pollInterval?: number
  /** Remember the conversation between page loads (default true). Off = every reload starts fresh. */
  persist?: boolean
  /** Storage key prefix, when one page hosts more than one widget (default `moharrik.chat`). */
  storagePrefix?: string
  /** Optional visitor details attached when the conversation is created. */
  visitor?: { name?: string; email?: string }
  fetchImpl?: typeof fetch
}

export type ChatEvents = {
  /** Fires with the full thread whenever it changes (send, poll, resume). */
  messages: (messages: ChatMessage[]) => void
  /** The conversation's status as the team sees it. */
  status: (status: ChatStatus) => void
  error: (error: ChatError) => void
  /** Fires once, when a conversation is created and its resume token is issued. */
  conversation: (visitorToken: string) => void
}

export type ChatClient = {
  /** Send a message. Creates the conversation on the first call. */
  send(body: string): Promise<ChatMessage[]>
  /** Fetch the thread now. Safe to call before any message exists (returns []). */
  refresh(): Promise<ChatMessage[]>
  /** Start polling for replies. Called for you by `send`. */
  start(): void
  /** Stop polling (do this when your UI closes). */
  stop(): void
  /** Everything received so far. */
  messages(): ChatMessage[]
  status(): ChatStatus | null
  /** The resume token, if a conversation exists. */
  visitorToken(): string | null
  /** Forget the conversation on this browser; the next send starts a new one. */
  reset(): void
  on<E extends keyof ChatEvents>(event: E, handler: ChatEvents[E]): () => void
  destroy(): void
}

const MAX_BODY = 8000

function readStorage(k: string): string | null {
  try {
    return window.localStorage.getItem(k)
  } catch {
    return null // private mode: the conversation just does not resume
  }
}

function writeStorage(k: string, v: string | null) {
  try {
    if (v === null) window.localStorage.removeItem(k)
    else window.localStorage.setItem(k, v)
  } catch {
    /* ignore */
  }
}

function errorFor(status: number): ChatError {
  if (status === 403) return new ChatError("blocked", "This chat is not available on this site.", status)
  if (status === 404) return new ChatError("unknown", "This chat is not set up.", status)
  if (status === 400) return new ChatError("too_long", "That message is too long.", status)
  return new ChatError("server", "That did not send. Try again.", status)
}

/**
 * Create a chat client. It owns no DOM — render the messages however you like,
 * or use the packaged widget (`mount`), the React component or the Vue plugin.
 */
export function createChat(options: ChatOptions): ChatClient {
  if (!options?.key) throw new Error("moharrik-chat: `key` is required")
  const origin = (options.apiOrigin ?? "").replace(/\/+$/, "")
  if (!origin) throw new Error("moharrik-chat: `apiOrigin` is required (e.g. https://app.moharrik.com)")

  const doFetch = options.fetchImpl ?? globalThis.fetch?.bind(globalThis)
  if (!doFetch) throw new Error("moharrik-chat: no fetch available; pass `fetchImpl`")

  const persist = options.persist !== false
  const storeKey = `${options.storagePrefix ?? "moharrik.chat"}.${options.key}`
  const pollEvery = Math.max(1000, options.pollInterval ?? 5000)
  const base = `${origin}/api/chat/${encodeURIComponent(options.key)}/messages`

  let visitorToken: string | null = persist ? readStorage(storeKey) : null
  let messages: ChatMessage[] = []
  let status: ChatStatus | null = null
  let timer: ReturnType<typeof setInterval> | null = null
  let destroyed = false

  const handlers: { [K in keyof ChatEvents]: Set<ChatEvents[K]> } = {
    messages: new Set(),
    status: new Set(),
    error: new Set(),
    conversation: new Set(),
  }

  function emit<E extends keyof ChatEvents>(event: E, ...args: Parameters<ChatEvents[E]>) {
    for (const h of handlers[event]) (h as (...a: unknown[]) => void)(...args)
  }

  function fail(err: ChatError) {
    emit("error", err)
    return err
  }

  function setMessages(next: ChatMessage[]) {
    messages = next
    emit("messages", messages)
  }

  async function refresh(): Promise<ChatMessage[]> {
    if (!visitorToken || destroyed) return messages
    let res: Response
    try {
      res = await doFetch(`${base}?visitor_token=${encodeURIComponent(visitorToken)}`, {
        headers: { Accept: "application/json" },
      })
    } catch {
      fail(new ChatError("network", "Could not reach the chat server."))
      return messages
    }
    if (!res.ok) {
      // A token the server no longer knows (widget deleted, thread purged):
      // forget it so the next send starts a conversation instead of looping.
      if (res.status === 404) reset()
      else fail(errorFor(res.status))
      return messages
    }
    const data = (await res.json()) as { messages?: ChatMessage[]; status?: ChatStatus }
    if (data.status && data.status !== status) {
      status = data.status
      emit("status", status)
    }
    setMessages(data.messages ?? [])
    return messages
  }

  async function send(body: string): Promise<ChatMessage[]> {
    const text = String(body ?? "").trim()
    if (!text) return messages
    if (text.length > MAX_BODY) throw fail(new ChatError("too_long", "That message is too long."))

    const payload: Record<string, unknown> = { body: text }
    if (visitorToken) payload.visitor_token = visitorToken
    else if (options.visitor) {
      if (options.visitor.name) payload.name = options.visitor.name
      if (options.visitor.email) payload.email = options.visitor.email
    }

    let res: Response
    try {
      res = await doFetch(base, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify(payload),
      })
    } catch {
      throw fail(new ChatError("network", "Could not reach the chat server."))
    }
    if (!res.ok) throw fail(errorFor(res.status))

    const data = (await res.json()) as { visitor_token?: string }
    if (data.visitor_token && data.visitor_token !== visitorToken) {
      visitorToken = data.visitor_token
      if (persist) writeStorage(storeKey, visitorToken)
      emit("conversation", visitorToken)
    }
    start()
    return refresh()
  }

  function start() {
    if (timer || destroyed) return
    void refresh()
    timer = setInterval(() => void refresh(), pollEvery)
  }

  function stop() {
    if (!timer) return
    clearInterval(timer)
    timer = null
  }

  function reset() {
    visitorToken = null
    if (persist) writeStorage(storeKey, null)
    setMessages([])
    status = null
  }

  return {
    send,
    refresh,
    start,
    stop,
    messages: () => messages,
    status: () => status,
    visitorToken: () => visitorToken,
    reset,
    on(event, handler) {
      handlers[event].add(handler as never)
      return () => {
        handlers[event].delete(handler as never)
      }
    },
    destroy() {
      destroyed = true
      stop()
      for (const key of Object.keys(handlers) as (keyof ChatEvents)[]) handlers[key].clear()
    },
  }
}
