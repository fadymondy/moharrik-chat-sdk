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
 */

import { createChat, type ChatClient, type ChatMessage, type ChatOptions, type Locale } from "./core"

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
  /** Panel title (default "Chat with us" / "تحدّث معنا"). */
  title?: string
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
  },
}

function css(accent: string, dark: boolean, rtl: boolean, atStart: boolean): string {
  const side = atStart ? (rtl ? "right" : "left") : rtl ? "left" : "right"
  const panelBg = dark ? "#0F1B33" : "#ffffff"
  const fg = dark ? "#E7ECF5" : "#0B1429"
  const line = dark ? "#24324f" : "#e4e7ee"
  const inBubble = dark ? "#1b2a47" : "#eef1f6"
  return `
:host{all:initial}
*{box-sizing:border-box;font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,'Noto Sans Arabic',sans-serif}
.wrap{position:fixed;bottom:20px;${side}:20px;z-index:2147483000;direction:${rtl ? "rtl" : "ltr"}}
.btn{display:inline-flex;align-items:center;gap:8px;border:0;border-radius:999px;padding:12px 18px;cursor:pointer;font-size:14px;font-weight:600;background:${accent};color:#0B1429;box-shadow:0 6px 24px rgba(0,0,0,.18)}
.panel{display:none;flex-direction:column;width:340px;max-width:calc(100vw - 40px);height:460px;max-height:calc(100vh - 120px);border-radius:14px;overflow:hidden;box-shadow:0 12px 40px rgba(0,0,0,.28);background:${panelBg};color:${fg};border:1px solid ${line}}
.panel.open{display:flex}
.head{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:12px 14px;background:${accent};color:#0B1429;font-weight:600;font-size:14px}
.x{border:0;background:transparent;cursor:pointer;font-size:18px;line-height:1;color:#0B1429;padding:2px 6px}
.log{flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px}
.row{display:flex;flex-direction:column}
.row.mine{align-items:flex-end}
.row.theirs{align-items:flex-start}
.who{font-size:11px;opacity:.65;margin:0 2px}
.msg{max-width:85%;padding:8px 11px;border-radius:12px;font-size:13.5px;line-height:1.45;white-space:pre-wrap;word-break:break-word}
.mine .msg{background:${accent};color:#0B1429}
.theirs .msg{background:${inBubble}}
.note{font-size:12.5px;opacity:.7;text-align:center;padding:10px}
.err{font-size:12.5px;color:#d9455f;padding:0 12px 6px}
.form{display:flex;gap:8px;padding:10px;border-top:1px solid ${line}}
.ta{flex:1;resize:none;height:38px;max-height:110px;padding:9px 10px;border-radius:9px;font-size:13.5px;border:1px solid ${dark ? "#2b3a5c" : "#d7dce6"};background:${dark ? "#0B1429" : "#fff"};color:inherit}
.ta:focus{outline:2px solid ${accent};outline-offset:1px}
.send{border:0;border-radius:9px;padding:0 14px;cursor:pointer;font-size:13.5px;font-weight:600;background:${accent};color:#0B1429}
.send:disabled{opacity:.55;cursor:default}
`
}

export function mount(options: WidgetOptions): ChatWidget {
  const locale: Locale = options.locale === "ar" ? "ar" : "en"
  const t = STRINGS[locale]
  const rtl = locale === "ar"
  const accent = options.accent ?? "#00A0A8"
  const dark =
    options.theme === "dark" ||
    (options.theme !== "light" && typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches)

  const client = createChat(options)

  const host = document.createElement("div")
  host.setAttribute("data-moharrik-chat", "")
  const root = host.attachShadow({ mode: "open" })
  ;(options.target ?? document.body).appendChild(host)

  const showLauncher = options.launcher !== false
  root.innerHTML = `
<style>${css(accent, dark, rtl, options.position === "start")}</style>
<div class="wrap">
  <div class="panel" role="dialog" aria-label="${options.title ?? t.title}">
    <div class="head"><span>${options.title ?? t.title}</span><button class="x" type="button" aria-label="${t.close}">×</button></div>
    <div class="log" aria-live="polite"></div>
    <div class="err" hidden></div>
    <form class="form"><textarea class="ta" rows="1" placeholder="${t.placeholder}"></textarea><button class="send" type="submit">${t.send}</button></form>
  </div>
  ${showLauncher ? `<button class="btn" type="button">${t.launcher}</button>` : ""}
</div>`

  const panel = root.querySelector(".panel") as HTMLElement
  const log = root.querySelector(".log") as HTMLElement
  const errBox = root.querySelector(".err") as HTMLElement
  const form = root.querySelector(".form") as HTMLFormElement
  const ta = root.querySelector(".ta") as HTMLTextAreaElement
  const sendBtn = root.querySelector(".send") as HTMLButtonElement
  const launcher = root.querySelector(".btn") as HTMLButtonElement | null
  const closeBtn = root.querySelector(".x") as HTMLButtonElement

  function render(messages: ChatMessage[]) {
    log.textContent = ""
    if (messages.length === 0) {
      const n = document.createElement("div")
      n.className = "note"
      n.textContent = options.greeting ?? t.empty
      log.appendChild(n)
      return
    }
    for (const m of messages) {
      const row = document.createElement("div")
      // `in` is inbound from the workspace's side, i.e. what this visitor sent.
      row.className = `row ${m.direction === "in" ? "mine" : "theirs"}`
      const who = document.createElement("div")
      who.className = "who"
      who.textContent = m.direction === "in" ? t.you : t.them
      const bubble = document.createElement("div")
      bubble.className = "msg"
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
    log.scrollTop = log.scrollHeight
  }

  const offMessages = client.on("messages", render)
  const offStatus = client.on("status", () => render(client.messages()))
  const offError = client.on("error", (e) => {
    errBox.textContent = e.message
    errBox.hidden = false
  })

  function open() {
    panel.classList.add("open")
    render(client.messages())
    client.start()
    ta.focus()
  }
  function close() {
    panel.classList.remove("open")
    client.stop()
  }
  function toggle() {
    panel.classList.contains("open") ? close() : open()
  }

  launcher?.addEventListener("click", toggle)
  closeBtn.addEventListener("click", close)
  ta.addEventListener("input", () => {
    ta.style.height = "38px"
    ta.style.height = `${Math.min(ta.scrollHeight, 110)}px`
  })
  ta.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      form.requestSubmit()
    }
  })
  form.addEventListener("submit", (e) => {
    e.preventDefault()
    const text = ta.value.trim()
    if (!text) return
    errBox.hidden = true
    sendBtn.disabled = true
    sendBtn.textContent = t.sending
    client
      .send(text)
      .then(() => {
        ta.value = ""
        ta.style.height = "38px"
      })
      .catch(() => {
        /* the error event already surfaced it */
      })
      .finally(() => {
        sendBtn.disabled = false
        sendBtn.textContent = t.send
      })
  })

  // Resume a thread this browser already has, so a returning visitor sees any
  // reply without writing again.
  if (client.visitorToken()) void client.refresh()

  return {
    ...client,
    open,
    close,
    toggle,
    isOpen: () => panel.classList.contains("open"),
    unmount() {
      offMessages()
      offStatus()
      offError()
      client.destroy()
      host.remove()
    },
  }
}
