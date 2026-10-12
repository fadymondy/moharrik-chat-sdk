/**
 * Moharrik chat — the framework-agnostic core.
 *
 * Everything else in this package (the React component, the Vue plugin, the
 * script tag build) is a thin wrapper around `createChat`. The core talks to
 * the public endpoints of one Moharrik chat widget:
 *
 *   GET  /api/chat/{key}/config     greeting, look, invitation, quick actions, presence
 *   POST /api/chat/{key}/messages   the visitor writes
 *   GET  /api/chat/{key}/messages   the visitor's own thread
 *   POST /api/chat/{key}/read       the visitor has seen the team's replies
 *   GET  /api/chat/{key}/events     a live stream for the visitor's own thread (SSE)
 *
 * The widget key is public on purpose. What protects it is the origin
 * allow-list on the key: a key embedded on a site you did not allow is
 * refused, and the refusal is what `onError` reports.
 *
 * Live updates follow fadymondy.com's rule: the stream makes a reply arrive
 * QUICKLY, the thread endpoint makes it arrive AT ALL. The client listens when
 * it can and keeps polling while the conversation is on screen either way, so
 * a proxy that blocks the stream makes chat slower, never silent.
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

/** Whether anybody on the team is around. A word, never a time. */
export type Presence = "online" | "away" | "offline"

export type QuickAction = {
  label: string
  /** Sent as the visitor's first message when picked. */
  message: string
  /** Only on pages whose path starts with this. Empty: every page. */
  path?: string
  /** Only in this language. Empty: both. */
  locale?: "" | Locale
}

/** What the workspace configured for this widget (Inbox → Chat widgets). */
export type ChatConfig = {
  greeting: string
  greeting_ar: string
  title: string
  title_ar: string
  accent: string
  theme: "auto" | "light" | "dark"
  position: "start" | "end"
  invite: boolean
  invite_after_seconds: number
  quick_actions: QuickAction[]
  lead_event: boolean
  presence: Presence
  /** Ask for a name and an email or phone before the first message (the pre-chat form). */
  require_contact: boolean
  /** The business the visitor is talking to. Empty on an older server. */
  name: string
  /** The business's picture, absolute. Empty when it has none. */
  avatar_url: string
}

/** Who the visitor is, as the pre-chat form (or your own UI) collected it. */
export type Visitor = {
  name?: string
  email?: string
  /** With its country code, e.g. `+20 100 123 4567`. */
  phone?: string
}

export type ChatErrorKind =
  | "blocked"
  | "unknown"
  | "network"
  | "too_long"
  | "server"
  | "slow_down"
  /** The widget asks for a name and an email or phone first (see `needsContact`). */
  | "contact_required"

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
  /** Listen for replies over a live stream when the browser can (default true). Polling stays as the fallback. */
  live?: boolean
  /** Remember the conversation between page loads (default true). Off = every reload starts fresh. */
  persist?: boolean
  /** Storage key prefix, when one page hosts more than one widget (default `moharrik.chat`). */
  storagePrefix?: string
  /**
   * Visitor details attached when the conversation is created. A widget with
   * the pre-chat form on needs a name and an email or phone; details set
   * with `setVisitor` are remembered on this browser and win over these.
   */
  visitor?: Visitor
  fetchImpl?: typeof fetch
  /** EventSource constructor; defaults to the browser's. Pass `null` to never stream. */
  eventSourceImpl?: typeof EventSource | null
}

export type ChatEvents = {
  /** Fires with the full thread whenever it changes (send, poll, resume). */
  messages: (messages: ChatMessage[]) => void
  /** The conversation's status as the team sees it. */
  status: (status: ChatStatus) => void
  error: (error: ChatError) => void
  /** Fires once, when a conversation is created and its resume token is issued. */
  conversation: (visitorToken: string) => void
  /** The widget's configuration, when it arrives or changes. */
  config: (config: ChatConfig) => void
  /** Whether the team is around, whenever it is read. */
  presence: (presence: Presence) => void
  /** Team replies this visitor has not seen yet. */
  unread: (count: number) => void
  /** The visitor's first message created a conversation: a lead. */
  lead: (detail: { visitorToken: string }) => void
  /** The live stream connected (true) or dropped back to polling (false). */
  live: (connected: boolean) => void
  /** Whether an agent is composing a reply right now (MH-668). */
  agentTyping: (typing: boolean) => void
}

export type ChatClient = {
  /** Send a message. Creates the conversation on the first call. */
  send(body: string): Promise<ChatMessage[]>
  /** Fetch the thread now. Safe to call before any message exists (returns []). */
  refresh(): Promise<ChatMessage[]>
  /** Fetch the widget's configuration (and presence). Never throws: an unreachable config returns null. */
  loadConfig(): Promise<ChatConfig | null>
  /** Start polling for replies. Called for you by `send`. */
  start(): void
  /** Stop polling (do this when your UI closes). The live stream keeps listening. */
  stop(): void
  /** Listen for replies on the live stream, if a conversation exists. Called for you. */
  listen(): void
  /** Tell the team the visitor has seen their replies. */
  markRead(): Promise<void>
  /**
   * Tell the team this visitor is composing a reply (`true`), or has stopped
   * (`false`). Outgoing calls with `true` are throttled to at most one every
   * ~3 seconds; `false` always goes through immediately. A no-op before a
   * conversation exists.
   */
  setComposing(composing: boolean): void
  /** Everything received so far. */
  messages(): ChatMessage[]
  status(): ChatStatus | null
  config(): ChatConfig | null
  presence(): Presence | null
  unread(): number
  /** Whether an agent is composing a reply right now. */
  isAgentTyping(): boolean
  /** Whether the live stream is connected right now. */
  isLive(): boolean
  /** The resume token, if a conversation exists. */
  visitorToken(): string | null
  /** Forget the conversation on this browser; the next send starts a new one. */
  reset(): void
  /** The visitor's details: what `setVisitor` remembered, else `options.visitor`. */
  visitor(): Visitor
  /** Set (and, with `persist`, remember on this browser) who the visitor is. */
  setVisitor(visitor: Visitor): void
  /**
   * Whether the next `send` would be refused for missing contact details: the
   * widget asks for them, no conversation exists yet, and no name plus email
   * or phone is known. Show your form when this is true.
   */
  needsContact(): boolean
  on<E extends keyof ChatEvents>(event: E, handler: ChatEvents[E]): () => void
  destroy(): void
}

const MAX_BODY = 8000

// With the stream connected, polling is only a safety net for a stream that
// died quietly (a sleeping laptop, a proxy that stopped forwarding).
const LIVE_SAFETY_POLL = 30_000

// MH-668: how long an agent's "composing" is shown before it is assumed stale
// (the server refreshes it on every keystroke-ish tick; nothing arriving for
// this long means the paused/stopped event itself was lost, not that they are
// still typing). And how often this visitor's own "composing" is allowed to
// reach the server while they keep typing — mirrors the server's own
// agentPresenceThrottle for the same reason: the input fires far more often
// than the presence protocol on the other end wants to be hit.
const AGENT_TYPING_TIMEOUT = 6000
const COMPOSING_THROTTLE = 3000
// Going quiet this long without another keystroke reads as "stopped", the
// same as an explicit blur or send.
const TYPING_IDLE = 4000

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

// A plain address: a dot-atom, a dotted domain, a letter TLD. The server's
// visitorEmail (moharrik internal/inbox/prechat.go) checks the same shape.
const EMAIL = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@(?:[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,}$/

/**
 * Contact details the server would accept: a name, and a plausible email or a
 * phone with its country code. The server has the last word; this only spares
 * a round trip, and tells a form what to say.
 */
export function checkVisitor(v: Visitor | null | undefined): "name" | "email" | "phone" | "contact" | null {
  const name = (v?.name ?? "").trim()
  const email = (v?.email ?? "").trim()
  const phone = toAsciiDigits((v?.phone ?? "").trim())
  if (!name) return "name"
  if (email && (email.length > 254 || !EMAIL.test(email))) return "email"
  if (phone) {
    const digits = phone.replace(/\D/g, "").replace(/^00/, "")
    if (!/^(\+|00)/.test(phone) || digits.length < 8 || digits.length > 15) return "phone"
  }
  if (!email && !phone) return "contact"
  return null
}

function toAsciiDigits(s: string): string {
  return s.replace(/[٠-٩۰-۹]/g, (d) => String((d.charCodeAt(0) & 0xf) % 10))
}

function errorFor(status: number, retryAfter?: string | null, detail?: string): ChatError {
  if (status === 422 && detail?.startsWith("contact_required")) {
    const why = detail.replace(/^contact_required:\s*/, "")
    return new ChatError("contact_required", why ? why.charAt(0).toUpperCase() + why.slice(1) + "." : "Tell us who you are first.", status)
  }
  if (status === 403) return new ChatError("blocked", "This chat is not available on this site.", status)
  if (status === 404) return new ChatError("unknown", "This chat is not set up.", status)
  if (status === 400) return new ChatError("too_long", "That message is too long.", status)
  if (status === 429) {
    const s = Number(retryAfter)
    const wait = Number.isFinite(s) && s > 0 ? ` Try again in ${Math.ceil(s)} seconds.` : ""
    return new ChatError("slow_down", `Please slow down a little.${wait}`, status)
  }
  return new ChatError("server", "That did not send. Try again.", status)
}

const ACCENT = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i

/** Keeps only what a widget can safely use from a config response. */
function cleanConfig(raw: Partial<ChatConfig>): ChatConfig {
  const str = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "")
  const actions = Array.isArray(raw.quick_actions) ? raw.quick_actions : []
  return {
    greeting: str(raw.greeting, 500),
    greeting_ar: str(raw.greeting_ar, 500),
    title: str(raw.title, 60),
    title_ar: str(raw.title_ar, 60),
    // It ends up in a stylesheet: a colour or nothing.
    accent: typeof raw.accent === "string" && ACCENT.test(raw.accent) ? raw.accent : "",
    theme: raw.theme === "light" || raw.theme === "dark" ? raw.theme : "auto",
    position: raw.position === "start" ? "start" : "end",
    invite: raw.invite === true,
    invite_after_seconds: Math.min(600, Math.max(5, Number(raw.invite_after_seconds) || 25)),
    quick_actions: actions
      .filter((a): a is QuickAction => !!a && typeof a.label === "string" && typeof a.message === "string")
      .slice(0, 8)
      .map((a) => ({
        label: a.label.slice(0, 40),
        message: a.message.slice(0, 500),
        path: typeof a.path === "string" ? a.path : "",
        locale: a.locale === "en" || a.locale === "ar" ? a.locale : "",
      })),
    lead_event: raw.lead_event !== false,
    presence: raw.presence === "online" || raw.presence === "away" ? raw.presence : "offline",
    // Absent on a server older than the form: it never asks.
    require_contact: raw.require_contact === true,
    name: str(raw.name, 80),
    // It ends up in an <img src>: an http(s) address or nothing.
    avatar_url: typeof raw.avatar_url === "string" && /^https?:\/\//i.test(raw.avatar_url) ? raw.avatar_url : "",
  }
}

/**
 * The quick actions for one page and language (fadymondy.com FM-137: the
 * openers follow the page). An action with no path is everywhere.
 */
export function quickActionsFor(config: ChatConfig | null, pathname: string, locale: Locale): QuickAction[] {
  if (!config) return []
  // /ar/pricing and /en/pricing both match /pricing, as on fadymondy.com.
  const bare = pathname.replace(/^\/[a-z]{2}(?=\/|$)/i, "") || "/"
  return config.quick_actions.filter(
    (a) => (!a.locale || a.locale === locale) && (!a.path || pathname.startsWith(a.path) || bare.startsWith(a.path)),
  )
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
  const ES: typeof EventSource | null =
    options.live === false || options.eventSourceImpl === null
      ? null
      : (options.eventSourceImpl ?? (typeof EventSource === "function" ? EventSource : null))

  const persist = options.persist !== false
  const storeKey = `${options.storagePrefix ?? "moharrik.chat"}.${options.key}`
  const pollEvery = Math.max(1000, options.pollInterval ?? 5000)
  const root = `${origin}/api/chat/${encodeURIComponent(options.key)}`
  const base = `${root}/messages`

  let visitorToken: string | null = persist ? readStorage(storeKey) : null
  const visitorKey = `${storeKey}.visitor`
  let visitor: Visitor = { ...(options.visitor ?? {}) }
  if (persist) {
    try {
      const saved = JSON.parse(readStorage(visitorKey) ?? "null") as Visitor | null
      if (saved && typeof saved === "object") {
        for (const k of ["name", "email", "phone"] as const) {
          if (typeof saved[k] === "string" && saved[k]) visitor[k] = saved[k]
        }
      }
    } catch {
      /* a corrupt entry: ask again */
    }
  }
  let messages: ChatMessage[] = []
  let status: ChatStatus | null = null
  let config: ChatConfig | null = null
  let presence: Presence | null = null
  let unread = 0
  let timer: ReturnType<typeof setInterval> | null = null
  let timerEvery = 0
  let polling = false
  let stream: EventSource | null = null
  let live = false
  let destroyed = false
  let agentTyping = false
  let agentTypingTimer: ReturnType<typeof setTimeout> | null = null
  let lastComposingSent = 0
  let composingIdleTimer: ReturnType<typeof setTimeout> | null = null

  const handlers: { [K in keyof ChatEvents]: Set<ChatEvents[K]> } = {
    messages: new Set(),
    status: new Set(),
    error: new Set(),
    conversation: new Set(),
    config: new Set(),
    presence: new Set(),
    unread: new Set(),
    lead: new Set(),
    live: new Set(),
    agentTyping: new Set(),
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
    // A refreshed thread is the agent's reply arriving (or at least catching
    // up); either way "still typing" is stale the moment new content shows.
    setAgentTyping(false)
    emit("messages", messages)
  }

  function setAgentTyping(v: boolean) {
    if (agentTypingTimer) {
      clearTimeout(agentTypingTimer)
      agentTypingTimer = null
    }
    if (v === agentTyping) return
    agentTyping = v
    emit("agentTyping", v)
  }

  function bumpAgentTypingTimeout() {
    if (agentTypingTimer) clearTimeout(agentTypingTimer)
    agentTypingTimer = setTimeout(() => {
      agentTypingTimer = null
      if (agentTyping) {
        agentTyping = false
        emit("agentTyping", false)
      }
    }, AGENT_TYPING_TIMEOUT)
  }

  function setPresence(p: Presence | undefined) {
    if (!p || p === presence) return
    presence = p
    emit("presence", p)
  }

  function setUnread(n: number) {
    if (n === unread) return
    unread = n
    emit("unread", n)
  }

  async function loadConfig(): Promise<ChatConfig | null> {
    if (destroyed) return config
    try {
      const res = await doFetch(`${root}/config`, { headers: { Accept: "application/json" } })
      if (!res.ok) {
        // A refused origin or a deleted key is worth saying once; the widget
        // still works from its tag attributes if the config is merely unreachable.
        if (res.status === 403 || res.status === 404) fail(errorFor(res.status))
        return config
      }
      config = cleanConfig((await res.json()) as Partial<ChatConfig>)
      emit("config", config)
      setPresence(config.presence)
      return config
    } catch {
      return config
    }
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
    const data = (await res.json()) as {
      messages?: ChatMessage[]
      status?: ChatStatus
      unread?: number
      presence?: Presence
    }
    if (data.status && data.status !== status) {
      status = data.status
      emit("status", status)
    }
    setPresence(data.presence)
    if (typeof data.unread === "number") setUnread(data.unread)
    setMessages(data.messages ?? [])
    return messages
  }

  async function markRead(): Promise<void> {
    if (!visitorToken || destroyed || unread === 0) return
    setUnread(0)
    try {
      await doFetch(`${root}/read`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ visitor_token: visitorToken }),
      })
    } catch {
      /* the next refresh brings the true count back */
    }
  }

  async function send(body: string): Promise<ChatMessage[]> {
    const text = String(body ?? "").trim()
    if (!text) return messages
    if (text.length > MAX_BODY) throw fail(new ChatError("too_long", "That message is too long."))

    const payload: Record<string, unknown> = { body: text }
    if (visitorToken) payload.visitor_token = visitorToken
    else {
      if (visitor.name) payload.name = visitor.name
      if (visitor.email) payload.email = visitor.email
      if (visitor.phone) payload.phone = visitor.phone
      // Where the conversation started, for whoever answers it.
      if (typeof location !== "undefined") payload.page_url = location.href
      if (options.locale) payload.locale = options.locale
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
    if (!res.ok) {
      let detail = ""
      if (res.status === 422) {
        try {
          detail = String(((await res.json()) as { detail?: string }).detail ?? "")
        } catch {
          /* not JSON */
        }
      }
      throw fail(errorFor(res.status, res.headers?.get?.("Retry-After"), detail))
    }

    const data = (await res.json()) as { visitor_token?: string }
    if (data.visitor_token && data.visitor_token !== visitorToken) {
      const first = !visitorToken
      visitorToken = data.visitor_token
      if (persist) writeStorage(storeKey, visitorToken)
      emit("conversation", visitorToken)
      // The first message is the lead; later ones are the conversation (FM-130).
      if (first) emit("lead", { visitorToken })
    }
    start()
    listen()
    return refresh()
  }

  function schedule() {
    if (!polling || destroyed) return
    const every = live ? Math.max(pollEvery, LIVE_SAFETY_POLL) : pollEvery
    if (timer && timerEvery === every) return
    if (timer) clearInterval(timer)
    timerEvery = every
    timer = setInterval(() => void refresh(), every)
  }

  function start() {
    if (polling || destroyed) return
    polling = true
    void refresh()
    schedule()
  }

  function stop() {
    polling = false
    if (!timer) return
    clearInterval(timer)
    timer = null
  }

  function setLive(v: boolean) {
    if (v === live) return
    live = v
    emit("live", v)
    schedule() // back to the fast poll when the stream drops, the slow one when it is up
  }

  function listen() {
    if (!ES || stream || !visitorToken || destroyed) return
    const token = visitorToken
    let es: EventSource
    try {
      es = new ES(`${root}/events?visitor_token=${encodeURIComponent(token)}`)
    } catch {
      return // the poll carries on
    }
    stream = es
    es.onopen = () => setLive(true)
    es.onmessage = (ev: MessageEvent) => {
      let data: { kind?: string; presence?: string } | null = null
      try {
        data = JSON.parse((ev as { data: string }).data) as { kind?: string; presence?: string }
      } catch {
        data = null
      }
      if (data?.kind === "typing") {
        // "composing" or "recording" is typing; anything else (paused, empty)
        // clears it. Never a reason to refetch: no message exists yet.
        const typing = data.presence === "composing" || data.presence === "recording"
        setAgentTyping(typing)
        if (typing) bumpAgentTypingTimeout()
        return
      }
      // Any other kind ("message", "status", or an older server with no
      // `kind` at all) says only "changed"; the thread endpoint is the data.
      void refresh()
    }
    es.onerror = () => {
      setLive(false)
      // A closed stream (a refused token, a deleted widget) is not retried by
      // the browser; the poll carries on and reports what is wrong.
      if (es.readyState === 2) {
        if (stream === es) stream = null
      }
    }
  }

  function closeStream() {
    stream?.close()
    stream = null
    setLive(false)
  }

  function postTyping(presence: "composing" | "") {
    if (!visitorToken || destroyed) return
    doFetch(`${root}/typing`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ visitor_token: visitorToken, presence }),
    }).catch(() => {
      /* best-effort, like markRead: the next keystroke or timeout tries again */
    })
  }

  function clearComposingIdle() {
    if (composingIdleTimer) {
      clearTimeout(composingIdleTimer)
      composingIdleTimer = null
    }
  }

  /**
   * Owns the whole outgoing side of typing, so a caller (the packaged widget,
   * or your own input box) only ever has to say what just happened: `true` on
   * every keystroke, `false` on send or blur. `true` is throttled to at most
   * one `composing` every ~3s; going quiet for ~4s without another `true`
   * sends `paused` on its own, the same as an explicit `false` would.
   */
  function setComposing(composing: boolean) {
    if (!visitorToken || destroyed) return
    if (composing) {
      const now = Date.now()
      if (now - lastComposingSent >= COMPOSING_THROTTLE) {
        lastComposingSent = now
        postTyping("composing")
      }
      clearComposingIdle()
      composingIdleTimer = setTimeout(() => {
        composingIdleTimer = null
        lastComposingSent = 0
        postTyping("")
      }, TYPING_IDLE)
    } else {
      clearComposingIdle()
      // Mirrors the server's own clearPresenceThrottle: "paused" always goes
      // through, and it resets the window so the next "composing" (a new
      // message) does not have to wait out a throttle from the last one.
      lastComposingSent = 0
      postTyping("")
    }
  }

  function reset() {
    closeStream()
    visitorToken = null
    if (persist) writeStorage(storeKey, null)
    setMessages([])
    setUnread(0)
    status = null
    lastComposingSent = 0
    clearComposingIdle()
  }

  return {
    send,
    refresh,
    loadConfig,
    start,
    stop,
    listen,
    markRead,
    setComposing,
    messages: () => messages,
    status: () => status,
    config: () => config,
    presence: () => presence,
    unread: () => unread,
    isAgentTyping: () => agentTyping,
    isLive: () => live,
    visitorToken: () => visitorToken,
    reset,
    visitor: () => ({ ...visitor }),
    setVisitor(v: Visitor) {
      const next: Visitor = {}
      for (const k of ["name", "email", "phone"] as const) {
        const val = typeof v?.[k] === "string" ? (v[k] as string).trim().slice(0, k === "name" ? 120 : 254) : ""
        if (val) next[k] = val
      }
      visitor = next
      if (persist) writeStorage(visitorKey, JSON.stringify(next))
    },
    needsContact: () => !!config?.require_contact && !visitorToken && checkVisitor(visitor) !== null,
    on(event, handler) {
      handlers[event].add(handler as never)
      return () => {
        handlers[event].delete(handler as never)
      }
    },
    destroy() {
      destroyed = true
      stop()
      closeStream()
      if (agentTypingTimer) {
        clearTimeout(agentTypingTimer)
        agentTypingTimer = null
      }
      clearComposingIdle()
      for (const key of Object.keys(handlers) as (keyof ChatEvents)[]) handlers[key].clear()
    },
  }
}
