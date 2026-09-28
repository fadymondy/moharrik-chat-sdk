/**
 * The packaged widget: a launcher and a panel, rendered into a shadow root so
 * the host page's CSS cannot reach in and this cannot leak out.
 *
 * Use it when you want chat without building any UI:
 *
 *   import { mount } from "moharrik-chat"
 *   const chat = mount({ key: "cwk_…", apiOrigin: "https://app.moharrik.com" })
 *
 * If you want your own UI, skip this and use `createChat` directly.
 *
 * What it does is ported from fadymondy.com's chat widget (MH-382): the
 * greeting, the team's online/away state in the header, page-dependent quick
 * actions while the thread is empty, an invitation that opens the panel once
 * per visit, an unread badge on the launcher, live replies, and a lead event
 * on the first message. All of it is configured per widget in Moharrik and
 * read from the widget's config, so a snippet pasted months ago stays current.
 */

import {
  createChat,
  quickActionsFor,
  type ChatClient,
  type ChatConfig,
  type ChatMessage,
  type ChatOptions,
  type Locale,
  type Presence,
  type QuickAction,
} from "./core"

export type WidgetOptions = ChatOptions & {
  /** Where to attach (default document.body). */
  target?: HTMLElement
  /** Show the floating launcher button (default true). Off = you call open() yourself. */
  launcher?: boolean
  /** `dark`, `light`, or unset to follow the visitor's system setting. */
  theme?: "light" | "dark"
  /** Pin to the inline start instead of the end (default end: right in LTR, left in RTL). */
  position?: "start" | "end"
  /** Brand colour for the launcher, header and the visitor's own bubbles. */
  accent?: string
  /** First line shown in an empty panel. */
  greeting?: string
  /** The greeting when the widget runs in Arabic. */
  greetingAr?: string
  /** Panel title (default "Chat with us" / "تحدّث معنا"). */
  title?: string
  titleAr?: string
  /**
   * Who wins when these options and the widget's settings in Moharrik differ.
   * `options` (the default for `mount`): what you pass here. `server`: the
   * settings in Moharrik — what the script tag uses, because its attributes
   * are only a copy of those settings taken when the snippet was copied.
   */
  prefer?: "options" | "server"
  /** Called on the visitor's first message (also dispatched as a `moharrik:lead` DOM event). */
  onLead?: (detail: { visitorToken: string }) => void
}

export type ChatWidget = ChatClient & {
  open(): void
  close(): void
  toggle(): void
  isOpen(): boolean
  /** Remove the widget from the page. */
  unmount(): void
}

const STRINGS: Record<Locale, Record<string, string>> = {
  en: {
    title: "Chat with us",
    placeholder: "Write a message…",
    send: "Send",
    launcher: "Chat with us",
    close: "Close chat",
    sending: "Sending…",
    empty: "Send a message and we will reply here.",
    you: "You",
    them: "Support",
    closedNote: "This conversation was closed. Writing again reopens it.",
    online: "Online now",
    away: "Away — we will reply soon",
    offline: "We reply here as soon as we can",
    typingNow: "Typing…",
    unread: "unread replies",
    suggestions: "Suggested messages",
  },
  ar: {
    title: "تحدّث معنا",
    placeholder: "اكتب رسالة…",
    send: "إرسال",
    launcher: "تحدّث معنا",
    close: "إغلاق المحادثة",
    sending: "جارٍ الإرسال…",
    empty: "أرسل رسالة وسنرد عليك هنا.",
    you: "أنت",
    them: "الدعم",
    closedNote: "أُغلقت هذه المحادثة. الكتابة مرة أخرى تعيد فتحها.",
    online: "متصل الآن",
    away: "غير متواجد — سنرد قريبًا",
    offline: "نرد عليك هنا في أقرب وقت",
    typingNow: "يكتب الآن…",
    unread: "ردود غير مقروءة",
    suggestions: "رسائل مقترحة",
  },
}

const DEFAULT_ACCENT = "#00A0A8"
const ACCENT = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i

/** Dark or light text, whichever reads on the accent (WCAG relative luminance). */
function onAccent(hex: string): string {
  let h = hex.slice(1)
  if (h.length === 3) h = h.replace(/./g, "$&$&")
  const lin = (i: number) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  }
  const L = 0.2126 * lin(0) + 0.7152 * lin(2) + 0.0722 * lin(4)
  // Contrast against near-black (#0B1429, L≈0.0075) vs white.
  return (L + 0.05) / 0.0575 >= 1.05 / (L + 0.05) ? "#0B1429" : "#ffffff"
}

function css(accent: string, dark: boolean, rtl: boolean, atStart: boolean): string {
  const side = atStart ? (rtl ? "right" : "left") : rtl ? "left" : "right"
  const panelBg = dark ? "#0F1B33" : "#ffffff"
  const fg = dark ? "#E7ECF5" : "#0B1429"
  const muted = dark ? "#9AA6BD" : "#5B6478"
  const line = dark ? "#24324f" : "#e4e7ee"
  const inBubble = dark ? "#1b2a47" : "#eef1f6"
  const ink = onAccent(accent)
  return `
:host{all:initial}
*{box-sizing:border-box;font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,'Noto Sans Arabic',sans-serif}
.wrap{position:fixed;bottom:20px;${side}:20px;z-index:2147483000;direction:${rtl ? "rtl" : "ltr"};display:flex;flex-direction:column;align-items:${atStart ? "flex-start" : "flex-end"};gap:12px}
.btn{position:relative;display:inline-flex;align-items:center;gap:8px;border:0;border-radius:999px;padding:12px 18px;cursor:pointer;font-size:14px;font-weight:600;background:${accent};color:${ink};box-shadow:0 6px 24px rgba(0,0,0,.18)}
.btn svg{width:18px;height:18px}
.badge{position:absolute;top:-6px;${rtl ? "left" : "right"}:-6px;min-width:20px;height:20px;padding:0 6px;border-radius:999px;background:#d9455f;color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;border:2px solid ${panelBg}}
.badge[hidden]{display:none}
.panel{display:none;flex-direction:column;width:360px;max-width:calc(100vw - 40px);height:500px;max-height:calc(100vh - 110px);border-radius:14px;overflow:hidden;box-shadow:0 12px 40px rgba(0,0,0,.28);background:${panelBg};color:${fg};border:1px solid ${line}}
.panel.open{display:flex}
.head{display:flex;align-items:center;gap:10px;padding:12px 14px;background:${accent};color:${ink}}
.who-box{display:flex;flex-direction:column;min-width:0;flex:1}
.ttl{font-weight:600;font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.sub{font-size:11.5px;opacity:.85;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dot{width:10px;height:10px;border-radius:50%;flex:none;box-shadow:0 0 0 2px ${ink === "#ffffff" ? "rgba(255,255,255,.55)" : "rgba(11,20,41,.35)"}}
.dot[data-state=online]{background:#22c55e}
.dot[data-state=away]{background:#f59e0b}
.dot[data-state=offline]{background:#94a3b8}
.dot[hidden]{display:none}
.x{border:0;background:transparent;cursor:pointer;font-size:20px;line-height:1;color:${ink};padding:2px 6px;border-radius:6px}
.x:focus-visible{outline:2px solid ${ink}}
.log{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px}
.row{display:flex;flex-direction:column}
.row.mine{align-items:flex-end}
.row.theirs{align-items:flex-start}
.who{font-size:11px;color:${muted};margin:0 2px 2px}
.msg{max-width:85%;padding:8px 11px;border-radius:12px;font-size:13.5px;line-height:1.45;white-space:pre-wrap;word-break:break-word}
.mine .msg{background:${accent};color:${ink}}
.theirs .msg{background:${inBubble}}
.greet{font-size:13.5px;line-height:1.5;padding:10px 12px;border-radius:12px;background:${inBubble};align-self:flex-start;max-width:90%;white-space:pre-wrap}
.note{font-size:12.5px;color:${muted};text-align:center;padding:10px}
.qa{display:flex;flex-wrap:wrap;gap:6px;padding:0 12px 10px}
.qa[hidden]{display:none}
.chip{border:1px solid ${line};background:transparent;color:inherit;border-radius:999px;padding:6px 11px;font-size:12.5px;cursor:pointer;text-align:start}
.chip:hover{border-color:${accent}}
.chip:disabled{opacity:.5;cursor:default}
.err{font-size:12.5px;color:#d9455f;padding:0 12px 6px}
.form{display:flex;gap:8px;padding:10px;border-top:1px solid ${line}}
.ta{flex:1;resize:none;height:38px;max-height:110px;padding:9px 10px;border-radius:9px;font-size:13.5px;border:1px solid ${dark ? "#2b3a5c" : "#d7dce6"};background:${dark ? "#0B1429" : "#fff"};color:inherit}
.ta:focus{outline:2px solid ${accent};outline-offset:1px}
.send{border:0;border-radius:9px;padding:0 14px;cursor:pointer;font-size:13.5px;font-weight:600;background:${accent};color:${ink}}
.send:disabled{opacity:.55;cursor:default}
`
}

const ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/></svg>`

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string)
}

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void
    dataLayer?: unknown[]
  }
}

export function mount(options: WidgetOptions): ChatWidget {
  const locale: Locale = options.locale === "ar" ? "ar" : "en"
  const t = STRINGS[locale]
  const rtl = locale === "ar"
  const preferServer = options.prefer === "server"

  const client = createChat(options)

  const host = document.createElement("div")
  host.setAttribute("data-moharrik-chat", "")
  const root = host.attachShadow({ mode: "open" })
  ;(options.target ?? document.body).appendChild(host)

  const showLauncher = options.launcher !== false
  root.innerHTML = `
<style></style>
<div class="wrap">
  <div class="panel" role="dialog">
    <div class="head">
      <span class="dot" hidden></span>
      <div class="who-box"><span class="ttl"></span><span class="sub"></span></div>
      <button class="x" type="button" aria-label="${esc(t.close)}">×</button>
    </div>
    <div class="log" aria-live="polite"></div>
    <div class="qa" role="group" aria-label="${esc(t.suggestions)}" hidden></div>
    <div class="err" hidden></div>
    <form class="form"><textarea class="ta" rows="1" dir="auto" placeholder="${esc(t.placeholder)}" aria-label="${esc(t.placeholder)}"></textarea><button class="send" type="submit">${esc(t.send)}</button></form>
  </div>
  ${showLauncher ? `<button class="btn" type="button">${ICON}<span>${esc(t.launcher)}</span><span class="badge" hidden></span></button>` : ""}
</div>`

  const style = root.querySelector("style") as HTMLStyleElement
  const panel = root.querySelector(".panel") as HTMLElement
  const titleEl = root.querySelector(".ttl") as HTMLElement
  const subEl = root.querySelector(".sub") as HTMLElement
  const dot = root.querySelector(".dot") as HTMLElement
  const log = root.querySelector(".log") as HTMLElement
  const qa = root.querySelector(".qa") as HTMLElement
  const errBox = root.querySelector(".err") as HTMLElement
  const form = root.querySelector(".form") as HTMLFormElement
  const ta = root.querySelector(".ta") as HTMLTextAreaElement
  const sendBtn = root.querySelector(".send") as HTMLButtonElement
  const launcher = root.querySelector(".btn") as HTMLButtonElement | null
  const badge = root.querySelector(".badge") as HTMLElement | null
  const closeBtn = root.querySelector(".x") as HTMLButtonElement

  // ---- what the widget looks like: options, then the config -----------------

  function pick<T>(fromOptions: T | undefined, fromServer: T | undefined, fallback: T): T {
    const has = (v: T | undefined) => v !== undefined && v !== null && (v as unknown) !== ""
    if (preferServer) return has(fromServer) ? (fromServer as T) : has(fromOptions) ? (fromOptions as T) : fallback
    return has(fromOptions) ? (fromOptions as T) : has(fromServer) ? (fromServer as T) : fallback
  }

  function settings(cfg: ChatConfig | null) {
    const serverTheme = cfg && cfg.theme !== "auto" ? cfg.theme : cfg ? "auto" : undefined
    const theme = pick<string>(options.theme, serverTheme, "auto")
    const accentRaw = pick<string>(options.accent, cfg?.accent, DEFAULT_ACCENT)
    return {
      accent: ACCENT.test(accentRaw) ? accentRaw : DEFAULT_ACCENT,
      theme,
      position: pick<string>(options.position, cfg?.position, "end"),
      title: rtl ? pick(options.titleAr, cfg?.title_ar, "") || pick(options.title, cfg?.title, t.title) : pick(options.title, cfg?.title, t.title),
      greeting: rtl
        ? pick(options.greetingAr, cfg?.greeting_ar, "") || pick(options.greeting, cfg?.greeting, "")
        : pick(options.greeting, cfg?.greeting, ""),
    }
  }

  const media = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null
  let current = settings(null)

  function paint() {
    current = settings(client.config())
    const dark = current.theme === "dark" || (current.theme !== "light" && !!media?.matches)
    style.textContent = css(current.accent, dark, rtl, current.position === "start")
    titleEl.textContent = current.title
    panel.setAttribute("aria-label", current.title)
    paintPresence(client.presence())
    render(client.messages())
  }
  media?.addEventListener?.("change", paint)

  function paintPresence(p: Presence | null) {
    // Absent until read: an unreachable config is not evidence anybody is offline.
    dot.hidden = !p
    if (p) dot.setAttribute("data-state", p)
    paintSub()
  }

  // The header's second line: "typing…" wins over the plain online/away/offline
  // word while it is true, same slot fadymondy.com uses for presence.
  function paintSub() {
    const p = client.presence()
    subEl.textContent = client.isAgentTyping() ? t.typingNow : p === "online" ? t.online : p === "away" ? t.away : t.offline
  }

  function paintBadge(n: number) {
    if (!badge) return
    const show = n > 0 && !isOpen()
    badge.hidden = !show
    badge.textContent = n > 9 ? "9+" : String(n)
    launcher?.setAttribute("aria-label", show ? `${t.launcher} (${n} ${t.unread})` : t.launcher)
  }

  // ---- the thread ---------------------------------------------------------------

  let sending = false

  function render(messages: ChatMessage[]) {
    log.textContent = ""
    if (messages.length === 0) {
      const g = document.createElement("div")
      g.className = current.greeting ? "greet" : "note"
      g.setAttribute("dir", "auto")
      g.textContent = current.greeting || t.empty
      log.appendChild(g)
    } else {
      for (const m of messages) {
        const row = document.createElement("div")
        // `in` is inbound from the workspace's side, i.e. what this visitor sent.
        row.className = `row ${m.direction === "in" ? "mine" : "theirs"}`
        const who = document.createElement("div")
        who.className = "who"
        who.textContent = m.direction === "in" ? t.you : t.them
        const bubble = document.createElement("div")
        bubble.className = "msg"
        bubble.setAttribute("dir", "auto")
        bubble.textContent = m.body
        row.append(who, bubble)
        log.appendChild(row)
      }
      if (client.status() === "closed") {
        const n = document.createElement("div")
        n.className = "note"
        n.textContent = t.closedNote
        log.appendChild(n)
      }
    }
    renderActions(messages.length === 0)
    log.scrollTop = log.scrollHeight
  }

  // Openers while there is nothing to read; gone once the conversation starts
  // (a way in, not a permanent menu). Picking one sends it.
  function renderActions(empty: boolean) {
    const list: QuickAction[] =
      empty && typeof location !== "undefined" ? quickActionsFor(client.config(), location.pathname, locale) : []
    qa.textContent = ""
    qa.hidden = list.length === 0
    for (const a of list) {
      const b = document.createElement("button")
      b.type = "button"
      b.className = "chip"
      b.setAttribute("dir", "auto")
      b.textContent = a.label
      b.disabled = sending
      b.addEventListener("click", () => void submit(a.message))
      qa.appendChild(b)
    }
  }

  // ---- outgoing typing (MH-668) -----------------------------------------------------
  //
  // Mirrors the header's own presence, in reverse. `client.setComposing` owns
  // the throttle (at most one `composing` every ~3s of continuous typing) and
  // the ~4s idle timeout on its own, so the widget only has to say what just
  // happened: `true` on every keystroke, `false` the moment the box blurs or
  // the message is sent — whichever comes first.

  async function submit(text: string) {
    text = text.trim()
    if (!text || sending) return
    client.setComposing(false) // the message itself is the "I stopped typing" signal
    errBox.hidden = true
    sending = true
    sendBtn.disabled = true
    sendBtn.textContent = t.sending
    renderActions(false)
    try {
      await client.send(text)
      if (ta.value.trim() === text) {
        ta.value = ""
        ta.style.height = "38px"
      }
    } catch {
      /* the error event already surfaced it; the typed text is kept */
      render(client.messages())
    } finally {
      sending = false
      sendBtn.disabled = false
      sendBtn.textContent = t.send
    }
  }

  // ---- events from the client -----------------------------------------------------

  const offs = [
    client.on("messages", (m) => {
      render(m)
      if (isOpen()) void client.markRead()
    }),
    client.on("status", () => render(client.messages())),
    client.on("config", paint),
    client.on("presence", paintPresence),
    client.on("agentTyping", paintSub),
    client.on("unread", (n) => {
      paintBadge(n)
      if (n > 0 && isOpen()) void client.markRead()
    }),
    client.on("error", (e) => {
      errBox.textContent = e.message
      errBox.hidden = false
    }),
    client.on("lead", (detail) => {
      // FM-130: the first message is the lead. The DOM event always fires, so
      // a site can wire its own analytics; gtag/dataLayer only when the
      // widget is set to report it.
      const payload = { lead_type: "chat", widget_key: options.key }
      try {
        window.dispatchEvent(new CustomEvent("moharrik:lead", { detail: payload }))
      } catch {
        /* very old browsers */
      }
      options.onLead?.(detail)
      if (client.config()?.lead_event === false) return
      if (typeof window.gtag === "function") window.gtag("event", "generate_lead", { lead_type: "chat" })
      if (Array.isArray(window.dataLayer)) window.dataLayer.push({ event: "generate_lead", lead_type: "chat" })
    }),
  ]

  // ---- open, close, invite -----------------------------------------------------------

  const inviteKey = `${options.storagePrefix ?? "moharrik.chat"}.invited.${options.key}`
  let inviteTimer: ReturnType<typeof setTimeout> | null = null
  let presenceTimer: ReturnType<typeof setInterval> | null = null

  function markInvited() {
    try {
      sessionStorage.setItem(inviteKey, "1")
    } catch {
      /* private mode */
    }
    if (inviteTimer) clearTimeout(inviteTimer)
    inviteTimer = null
  }

  function isOpen() {
    return panel.classList.contains("open")
  }

  function open() {
    // A visitor who opens it themselves has had their invitation.
    markInvited()
    panel.classList.add("open")
    paintBadge(client.unread())
    render(client.messages())
    client.start()
    void client.markRead()
    // Presence is a header detail: re-read while the panel is open, not from
    // every page view (fadymondy.com's PRESENCE_INTERVAL).
    if (!presenceTimer) presenceTimer = setInterval(() => void client.loadConfig(), 60_000)
    ta.focus()
  }
  function close() {
    panel.classList.remove("open")
    client.stop()
    if (presenceTimer) clearInterval(presenceTimer)
    presenceTimer = null
    paintBadge(client.unread())
  }
  function toggle() {
    isOpen() ? close() : open()
  }

  /*
    The invitation (fadymondy.com): someone who has read the page this long is
    interested. The panel opens itself once per visit (sessionStorage, so a
    visitor who closes it is not nagged on the next page) and creates nothing:
    a conversation starts with the first thing the visitor SAYS.
  */
  function scheduleInvite(cfg: ChatConfig) {
    if (!cfg.invite || isOpen() || inviteTimer) return
    try {
      if (sessionStorage.getItem(inviteKey)) return
    } catch {
      return // storage blocked: no invitation rather than one on every page
    }
    inviteTimer = setTimeout(() => {
      inviteTimer = null
      if (isOpen()) return
      try {
        sessionStorage.setItem(inviteKey, "1")
      } catch {
        /* ignore */
      }
      open()
    }, cfg.invite_after_seconds * 1000)
  }

  launcher?.addEventListener("click", toggle)
  closeBtn.addEventListener("click", close)
  ta.addEventListener("input", () => {
    ta.style.height = "38px"
    ta.style.height = `${Math.min(ta.scrollHeight, 110)}px`
    client.setComposing(!!ta.value.trim()) // cleared back to empty counts as stopped
  })
  ta.addEventListener("blur", () => client.setComposing(false))
  ta.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      form.requestSubmit()
    }
  })
  form.addEventListener("submit", (e) => {
    e.preventDefault()
    void submit(ta.value)
  })

  paint()
  void client.loadConfig().then((cfg) => {
    if (cfg) scheduleInvite(cfg)
  })
  // Resume a thread this browser already has, so a returning visitor sees any
  // reply (and its badge) without writing again, and hears the next one live.
  if (client.visitorToken()) {
    void client.refresh()
    client.listen()
  }

  return {
    ...client,
    open,
    close,
    toggle,
    isOpen,
    unmount() {
      for (const off of offs) off()
      media?.removeEventListener?.("change", paint)
      if (inviteTimer) clearTimeout(inviteTimer)
      if (presenceTimer) clearInterval(presenceTimer)
      client.destroy() // stops polling/streaming and its own composing-idle timer
      host.remove()
    },
  }
}
