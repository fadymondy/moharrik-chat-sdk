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
 *
 * The header shows who the visitor is talking to (the business's name and
 * picture, or its initials on the brand colour). A widget that asks for
 * contact details shows a short pre-chat form — name, then an email or a
 * phone with its country code, then the message — before the first message;
 * what was given is remembered on this browser so nobody is asked twice.
 */

import {
  checkVisitor,
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
  /** Panel and launcher title (default "Chat with us" / "تحدّث معنا"). */
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

const STRINGS = {
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
    typing: "is typing",
    unread: "unread replies",
    suggestions: "Suggested messages",
    formIntro: "So we can get back to you even after you leave, tell us how to reach you.",
    name: "Your name",
    email: "Email",
    phone: "Phone (with country code)",
    phoneHint: "e.g. +20 100 123 4567",
    or: "Email or phone — one is enough.",
    message: "Your message",
    start: "Start chat",
    errName: "Please enter your name.",
    errEmail: "That email address does not look right.",
    errPhone: "Add the country code, e.g. +20 100 123 4567.",
    errContact: "Add an email or a phone number.",
    errMessage: "Write your message.",
    today: "Today",
    yesterday: "Yesterday",
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
    typing: "يكتب الآن",
    unread: "ردود غير مقروءة",
    suggestions: "رسائل مقترحة",
    formIntro: "لنتمكّن من الرد عليك حتى بعد مغادرتك، أخبرنا كيف نتواصل معك.",
    name: "اسمك",
    email: "البريد الإلكتروني",
    phone: "رقم الهاتف (مع مفتاح الدولة)",
    phoneHint: "مثال: ‎+20 100 123 4567",
    or: "البريد أو الهاتف — يكفي أحدهما.",
    message: "رسالتك",
    start: "ابدأ المحادثة",
    errName: "من فضلك اكتب اسمك.",
    errEmail: "البريد الإلكتروني غير صحيح.",
    errPhone: "أضف مفتاح الدولة، مثال: ‎+20 100 123 4567.",
    errContact: "أضف بريدًا إلكترونيًا أو رقم هاتف.",
    errMessage: "اكتب رسالتك.",
    today: "اليوم",
    yesterday: "أمس",
  },
}

type Strings = (typeof STRINGS)["en"]

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
  const bg = dark ? "#0F1B33" : "#ffffff"
  const soft = dark ? "#132240" : "#f6f7fb"
  const fg = dark ? "#E7ECF5" : "#0B1429"
  const muted = dark ? "#A3AEC4" : "#5B6478"
  const line = dark ? "#26365a" : "#e4e7ee"
  const field = dark ? "#0B1429" : "#ffffff"
  const fieldLine = dark ? "#33456d" : "#cfd5e1"
  const inBubble = dark ? "#1d2c4b" : "#eef1f6"
  const danger = dark ? "#ff8b9d" : "#b4233f"
  const ink = onAccent(accent)
  const ring = `0 0 0 3px color-mix(in srgb, ${accent} 35%, transparent)`
  return `
:host{all:initial}
*{box-sizing:border-box;font-family:${rtl ? "'IBM Plex Sans Arabic','Noto Sans Arabic','Segoe UI',Tahoma," : ""}ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,'Noto Sans Arabic',sans-serif}
.wrap{position:fixed;bottom:20px;${side}:20px;z-index:2147483000;direction:${rtl ? "rtl" : "ltr"};display:flex;flex-direction:column;align-items:${atStart ? "flex-start" : "flex-end"};gap:14px;color:${fg};-webkit-font-smoothing:antialiased}
button{font:inherit}
:focus-visible{outline:2px solid ${accent};outline-offset:2px}
.btn{position:relative;display:inline-flex;align-items:center;justify-content:center;gap:8px;border:0;border-radius:999px;height:52px;min-width:52px;padding:0 20px;cursor:pointer;font-size:14.5px;font-weight:600;background:${accent};color:${ink};box-shadow:0 10px 30px -6px rgba(11,20,41,.35),0 2px 6px rgba(11,20,41,.12);transition:transform .2s ease,box-shadow .2s ease}
.btn:hover{transform:translateY(-1px);box-shadow:0 14px 34px -6px rgba(11,20,41,.4),0 2px 6px rgba(11,20,41,.14)}
.btn:focus-visible{outline:3px solid ${fg};outline-offset:3px}
.btn svg{width:22px;height:22px;flex:none}
.btn .ic-x{display:none}
.btn.on{padding:0}
.btn.on .lbl,.btn.on .ic-chat{display:none}
.btn.on .ic-x{display:block}
.badge{position:absolute;top:-4px;${rtl ? "left" : "right"}:-4px;min-width:21px;height:21px;padding:0 6px;border-radius:999px;background:#d0263f;color:#fff;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;border:2px solid ${bg}}
.badge[hidden]{display:none}
.panel{display:flex;flex-direction:column;width:380px;max-width:calc(100vw - 32px);height:600px;max-height:calc(100vh - 110px);max-height:calc(100dvh - 110px);border-radius:18px;overflow:hidden;background:${bg};color:${fg};border:1px solid ${line};box-shadow:0 24px 60px -12px rgba(11,20,41,.35),0 4px 14px rgba(11,20,41,.1);transform-origin:bottom ${side};opacity:0;transform:translateY(14px) scale(.97);transition:opacity .2s ease,transform .24s cubic-bezier(.2,.9,.3,1.2)}
.panel.open{opacity:1;transform:none}
.panel[hidden]{display:none}
.head{display:flex;align-items:center;gap:12px;padding:14px 14px 14px 16px;background:${accent};color:${ink}}
.av{position:relative;width:40px;height:40px;flex:none}
.av img,.av .ini{width:40px;height:40px;border-radius:50%;object-fit:cover;display:block;background:${ink === "#ffffff" ? "rgba(255,255,255,.2)" : "rgba(11,20,41,.12)"}}
.av .ini{display:flex;align-items:center;justify-content:center;font-weight:700;font-size:15px;letter-spacing:.02em}
.av img[hidden],.av .ini[hidden]{display:none}
.dot{position:absolute;bottom:0;${rtl ? "left" : "right"}:0;width:12px;height:12px;border-radius:50%;border:2px solid ${accent}}
.dot[data-state=online]{background:#22c55e}
.dot[data-state=away]{background:#f59e0b}
.dot[data-state=offline]{background:#94a3b8}
.dot[hidden]{display:none}
.who-box{display:flex;flex-direction:column;min-width:0;flex:1;gap:1px}
.ttl{font-weight:700;font-size:15px;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin:0}
.sub{font-size:12px;line-height:1.3;opacity:.9;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.x{display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;border:0;background:transparent;cursor:pointer;color:${ink};border-radius:10px;flex:none}
.x:hover{background:${ink === "#ffffff" ? "rgba(255,255,255,.16)" : "rgba(11,20,41,.08)"}}
.x:focus-visible{outline:2px solid ${ink};outline-offset:-2px}
.x svg{width:20px;height:20px}
.body{flex:1;overflow-y:auto;overscroll-behavior:contain;padding:16px 14px 8px;display:flex;flex-direction:column;background:${soft}}
.log{display:flex;flex-direction:column;gap:2px}
.day{align-self:center;font-size:11.5px;font-weight:600;color:${muted};background:${bg};border:1px solid ${line};border-radius:999px;padding:3px 10px;margin:10px 0 8px}
.row{display:flex;flex-direction:column;margin-top:8px;max-width:84%}
.row.cont{margin-top:2px}
.row.mine{align-self:flex-end;align-items:flex-end}
.row.theirs{align-self:flex-start;align-items:flex-start}
.who{font-size:11.5px;font-weight:600;color:${muted};margin:0 4px 3px}
.msg{padding:9px 13px;border-radius:16px;font-size:14px;line-height:1.5;white-space:pre-wrap;word-break:break-word;overflow-wrap:anywhere}
.mine .msg{background:${accent};color:${ink};border-end-end-radius:5px}
.theirs .msg{background:${inBubble};color:${fg};border-end-start-radius:5px}
.cont.mine .msg{border-start-end-radius:5px}
.cont.theirs .msg{border-start-start-radius:5px}
.ts{font-size:11px;color:${muted};margin:3px 4px 0}
.greet{font-size:14px;line-height:1.55;padding:12px 14px;border-radius:16px;border-end-start-radius:5px;background:${inBubble};align-self:flex-start;max-width:88%;white-space:pre-wrap}
.note{font-size:12.5px;color:${muted};text-align:center;padding:10px 6px}
.typing{align-self:flex-start;display:inline-flex;gap:4px;align-items:center;padding:12px 14px;margin-top:8px;border-radius:16px;border-end-start-radius:5px;background:${inBubble}}
.typing[hidden]{display:none}
.typing i{width:7px;height:7px;border-radius:50%;background:${muted};animation:mc-b 1.2s infinite ease-in-out}
.typing i:nth-child(2){animation-delay:.15s}
.typing i:nth-child(3){animation-delay:.3s}
@keyframes mc-b{0%,60%,100%{transform:translateY(0);opacity:.45}30%{transform:translateY(-4px);opacity:1}}
.qa{display:flex;flex-wrap:wrap;gap:6px;padding:8px 14px 2px;background:${soft}}
.qa[hidden]{display:none}
.chip{border:1px solid ${fieldLine};background:${bg};color:inherit;border-radius:999px;padding:7px 12px;font-size:13px;cursor:pointer;text-align:start;transition:border-color .15s ease,background .15s ease}
.chip:hover{border-color:${accent}}
.chip:disabled{opacity:.5;cursor:default}
.err{font-size:12.5px;color:${danger};padding:6px 16px 0;background:${bg}}
.err[hidden]{display:none}
.form{display:flex;align-items:flex-end;gap:8px;padding:10px 12px 12px;border-top:1px solid ${line};background:${bg}}
.form[hidden]{display:none}
.ta,.in{width:100%;font-size:14px;line-height:1.4;border:1px solid ${fieldLine};background:${field};color:inherit;border-radius:12px;transition:border-color .15s ease,box-shadow .15s ease}
.ta{flex:1;resize:none;height:42px;max-height:120px;padding:10px 12px}
.ta:focus,.in:focus{outline:none;border-color:${accent};box-shadow:${ring}}
.ta::placeholder,.in::placeholder{color:${muted};opacity:1}
.send{display:inline-flex;align-items:center;justify-content:center;width:42px;height:42px;flex:none;border:0;border-radius:12px;cursor:pointer;background:${accent};color:${ink};transition:opacity .15s ease}
.send svg{width:19px;height:19px;${rtl ? "transform:scaleX(-1)" : ""}}
.send:disabled{opacity:.5;cursor:default}
.pre{display:flex;flex-direction:column;gap:10px;padding:16px;margin:4px 0 6px;border:1px solid ${line};border-radius:16px;background:${bg}}
.pre[hidden]{display:none}
.intro{font-size:13px;line-height:1.5;color:${muted};margin:0}
.fld{display:flex;flex-direction:column;gap:5px}
.fld label{font-size:12.5px;font-weight:600}
.fld .req{color:${danger}}
.in{height:42px;padding:0 12px}
.in[aria-invalid=true],.ta[aria-invalid=true]{border-color:${danger}}
.pre .ta{height:64px;flex:none}
.hint{font-size:11.5px;color:${muted}}
.ferr{font-size:12px;color:${danger}}
.ferr:empty{display:none}
.go{height:44px;border:0;border-radius:12px;cursor:pointer;font-size:14.5px;font-weight:700;background:${accent};color:${ink}}
.go:disabled{opacity:.6;cursor:default}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
@media (max-width:480px){
.wrap{bottom:16px;${side}:16px}
.panel{position:fixed;inset:0;width:100%;max-width:none;height:100%;max-height:none;border-radius:0;border:0;transform:translateY(24px)}
.wrap.is-open .btn{display:none}
.ta,.in{font-size:16px}
}
@media (prefers-reduced-motion:reduce){.panel,.btn,.chip{transition:none}.typing i{animation:none;opacity:.7}}
`
}

const ICON_CHAT = `<svg class="ic-chat" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/></svg>`
const ICON_X = `<svg class="ic-x" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>`
const ICON_SEND = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>`

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string)
}

/** Up to two letters for the header when the business has no picture. */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  const first = (w: string | undefined) => (w ? Array.from(w)[0] ?? "" : "")
  return (first(words[0]) + (words.length > 1 ? first(words[words.length - 1]) : "")).toUpperCase() || "?"
}

let seq = 0

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void
    dataLayer?: unknown[]
  }
}

export function mount(options: WidgetOptions): ChatWidget {
  const locale: Locale = options.locale === "ar" ? "ar" : "en"
  const t: Strings = STRINGS[locale]
  const rtl = locale === "ar"
  const preferServer = options.prefer === "server"
  const id = `mc${++seq}`

  const client = createChat(options)

  const host = document.createElement("div")
  host.setAttribute("data-moharrik-chat", "")
  const root = host.attachShadow({ mode: "open" })
  ;(options.target ?? document.body).appendChild(host)

  const showLauncher = options.launcher !== false
  const field = (name: string, label: string, type: string, extra: string, hint = "") => `
      <div class="fld"><label for="${id}-${name}">${esc(label)}</label>
        <input class="in" id="${id}-${name}" name="${name}" type="${type}" ${extra} aria-describedby="${id}-${name}-e${hint ? ` ${id}-${name}-h` : ""}">
        ${hint ? `<span class="hint" id="${id}-${name}-h">${esc(hint)}</span>` : ""}
        <span class="ferr" id="${id}-${name}-e" aria-live="polite"></span></div>`
  root.innerHTML = `
<style></style>
<div class="wrap">
  <section class="panel" role="dialog" aria-labelledby="${id}-t" aria-describedby="${id}-s" hidden>
    <header class="head">
      <div class="av" aria-hidden="true"><img alt="" hidden><span class="ini"></span><span class="dot" hidden></span></div>
      <div class="who-box"><h2 class="ttl" id="${id}-t"></h2><span class="sub" id="${id}-s"></span></div>
      <button class="x" type="button" aria-label="${esc(t.close)}">${ICON_X.replace(' class="ic-x"', "")}</button>
    </header>
    <div class="body">
      <form class="pre" novalidate hidden>
        <p class="intro">${esc(t.formIntro)}</p>
        ${field("name", t.name, "text", 'autocomplete="name" maxlength="120" dir="auto" required aria-required="true"')}
        <span class="hint">${esc(t.or)}</span>
        ${field("email", t.email, "email", 'autocomplete="email" inputmode="email" maxlength="254" dir="ltr"')}
        ${field("phone", t.phone, "tel", 'autocomplete="tel" inputmode="tel" maxlength="40" dir="ltr"', t.phoneHint)}
        <div class="fld"><label for="${id}-message">${esc(t.message)}</label>
          <textarea class="ta" id="${id}-message" name="message" dir="auto" maxlength="8000" aria-describedby="${id}-message-e"></textarea>
          <span class="ferr" id="${id}-message-e" aria-live="polite"></span></div>
        <button class="go" type="submit">${esc(t.start)}</button>
      </form>
      <div class="log" role="log" aria-live="polite" aria-relevant="additions"></div>
      <div class="typing" role="status" hidden><span class="sr"></span><i></i><i></i><i></i></div>
    </div>
    <div class="qa" role="group" aria-label="${esc(t.suggestions)}" hidden></div>
    <div class="err" role="alert" hidden></div>
    <form class="form"><textarea class="ta" rows="1" dir="auto" placeholder="${esc(t.placeholder)}" aria-label="${esc(t.placeholder)}"></textarea><button class="send" type="submit" aria-label="${esc(t.send)}">${ICON_SEND}</button></form>
  </section>
  ${showLauncher ? `<button class="btn" type="button" aria-expanded="false">${ICON_CHAT}${ICON_X}<span class="lbl">${esc(t.launcher)}</span><span class="badge" hidden></span></button>` : ""}
</div>`

  const $ = <T extends Element>(sel: string) => root.querySelector(sel) as T
  const style = $<HTMLStyleElement>("style")
  const wrap = $<HTMLElement>(".wrap")
  const panel = $<HTMLElement>(".panel")
  const titleEl = $<HTMLElement>(".ttl")
  const subEl = $<HTMLElement>(".sub")
  const avImg = $<HTMLImageElement>(".av img")
  const avIni = $<HTMLElement>(".av .ini")
  const dot = $<HTMLElement>(".dot")
  const body = $<HTMLElement>(".body")
  const log = $<HTMLElement>(".log")
  const typingEl = $<HTMLElement>(".typing")
  const qa = $<HTMLElement>(".qa")
  const errBox = $<HTMLElement>(".err")
  const form = $<HTMLFormElement>(".form")
  const ta = $<HTMLTextAreaElement>(".form .ta")
  const sendBtn = $<HTMLButtonElement>(".send")
  const pre = $<HTMLFormElement>(".pre")
  const preBtn = $<HTMLButtonElement>(".go")
  const launcher = root.querySelector(".btn") as HTMLButtonElement | null
  const launcherLbl = launcher?.querySelector(".lbl") as HTMLElement | null
  const badge = root.querySelector(".badge") as HTMLElement | null
  const closeBtn = $<HTMLButtonElement>(".x")
  const input = (n: string) => pre.querySelector(`[name=${n}]`) as HTMLInputElement | HTMLTextAreaElement
  avImg.addEventListener("error", () => {
    avImg.hidden = true
    avIni.hidden = false
  })

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
    const title = rtl
      ? pick(options.titleAr, cfg?.title_ar, "") || pick(options.title, cfg?.title, t.title)
      : pick(options.title, cfg?.title, t.title)
    return {
      accent: ACCENT.test(accentRaw) ? accentRaw : DEFAULT_ACCENT,
      theme,
      position: pick<string>(options.position, cfg?.position, "end"),
      title,
      // Who the visitor talks to: the business, else the panel's title.
      name: cfg?.name || title,
      greeting: rtl
        ? pick(options.greetingAr, cfg?.greeting_ar, "") || pick(options.greeting, cfg?.greeting, "")
        : pick(options.greeting, cfg?.greeting, ""),
    }
  }

  const media = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null
  let current = settings(null)

  function paint() {
    const cfg = client.config()
    current = settings(cfg)
    const dark = current.theme === "dark" || (current.theme !== "light" && !!media?.matches)
    style.textContent = css(current.accent, dark, rtl, current.position === "start")
    titleEl.textContent = current.name
    panel.setAttribute("aria-label", current.title)
    // The launcher says the title too (data-title / data-title-ar, or the
    // widget's settings), so "Chat with me" is not stuck on "Chat with us".
    if (launcherLbl) launcherLbl.textContent = current.title
    paintBadge(client.unread())
    avIni.textContent = initials(current.name)
    const pic = cfg?.avatar_url ?? ""
    if (pic && avImg.getAttribute("src") !== pic) avImg.src = pic
    avImg.hidden = !pic
    avIni.hidden = !!pic
    paintPresence(client.presence())
    render(client.messages(), true)
  }
  media?.addEventListener?.("change", paint)

  function paintPresence(p: Presence | null) {
    // Absent until read: an unreachable config is not evidence anybody is offline.
    dot.hidden = !p
    if (p) dot.setAttribute("data-state", p)
    paintSub()
  }

  // The header's second line: "typing…" wins over the plain online/away/offline
  // word while it is true; the thread shows the same as a bubble of dots.
  function paintSub() {
    const p = client.presence()
    const typing = client.isAgentTyping()
    subEl.textContent = typing ? t.typingNow : p === "online" ? t.online : p === "away" ? t.away : t.offline
    typingEl.hidden = !typing || showingForm()
    ;(typingEl.firstChild as HTMLElement).textContent = `${current.name} ${t.typing}`
    if (typing) stick()
  }

  function paintBadge(n: number) {
    if (!badge) return
    const show = n > 0 && !isOpen()
    badge.hidden = !show
    badge.textContent = n > 9 ? "9+" : String(n)
    launcher?.setAttribute("aria-label", show ? `${current.title} (${n} ${t.unread})` : isOpen() ? t.close : current.title)
  }

  // ---- time -------------------------------------------------------------------

  const tag = rtl ? "ar-EG" : "en"
  const fmt = (o: Intl.DateTimeFormatOptions) => {
    try {
      return new Intl.DateTimeFormat(tag, o)
    } catch {
      return new Intl.DateTimeFormat(undefined, o)
    }
  }
  const timeFmt = fmt({ hour: "numeric", minute: "2-digit" })
  const dayFmt = fmt({ weekday: "short", day: "numeric", month: "short" })
  const fullFmt = fmt({ dateStyle: "medium", timeStyle: "short" })
  const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
  function dayLabel(d: Date): string {
    const now = new Date()
    if (dayKey(d) === dayKey(now)) return t.today
    const y = new Date(now)
    y.setDate(now.getDate() - 1)
    return dayKey(d) === dayKey(y) ? t.yesterday : dayFmt.format(d)
  }

  // ---- the thread ---------------------------------------------------------------
  //
  // Appended, not redrawn, while the thread only grows: a screen reader
  // announces each new message once instead of reading the whole log again.

  let sending = false
  let rendered: string[] = []
  let lastDay = ""
  let lastSide = ""
  let lastAt = 0
  let shownClosed = false
  let formForced = false
  let formWasOn = false

  const showingForm = () => (formForced || client.needsContact()) && client.messages().length === 0

  function stick() {
    body.scrollTop = body.scrollHeight
  }

  function row(m: ChatMessage) {
    const mine = m.direction === "in" // `in` is inbound to the workspace: this visitor
    const side = mine ? "mine" : "theirs"
    const at = new Date(m.created_at)
    const valid = !isNaN(at.getTime())
    if (valid && dayKey(at) !== lastDay) {
      lastDay = dayKey(at)
      lastSide = ""
      const d = document.createElement("div")
      d.className = "day"
      d.textContent = dayLabel(at)
      log.appendChild(d)
    }
    // Consecutive messages from one side within a few minutes read as a group.
    const cont = side === lastSide && valid && at.getTime() - lastAt < 5 * 60_000
    const r = document.createElement("div")
    r.className = `row ${side}${cont ? " cont" : ""}`
    if (!cont && !mine) {
      const who = document.createElement("div")
      who.className = "who"
      who.textContent = current.name || t.them
      r.appendChild(who)
    }
    const bubble = document.createElement("div")
    bubble.className = "msg"
    bubble.setAttribute("dir", "auto")
    bubble.textContent = m.body
    if (!cont && mine) bubble.setAttribute("aria-label", `${t.you}: ${m.body}`)
    r.appendChild(bubble)
    if (valid) {
      const ts = document.createElement("time")
      ts.className = "ts"
      ts.dateTime = m.created_at
      ts.title = fullFmt.format(at)
      ts.textContent = timeFmt.format(at)
      r.appendChild(ts)
      // Only the last of a run keeps its time; the run shares it.
      const prev = log.lastElementChild
      if (cont && prev?.classList.contains("row")) prev.querySelector(".ts")?.setAttribute("hidden", "")
    }
    lastSide = side
    lastAt = valid ? at.getTime() : lastAt
    log.appendChild(r)
  }

  function render(messages: ChatMessage[], full = false) {
    const formOn = showingForm()
    if (formOn && !formWasOn) {
      // The composer gives way to the form (a late config, or a server that
      // wants contact details): carry what was typed, and keep focus inside.
      const msg = input("message")
      if (!msg.value.trim() && ta.value.trim()) {
        msg.value = ta.value
        ta.value = "" // the form owns it now: no stale copy when the composer returns
        ta.style.height = ""
      }
      if (root.activeElement === ta) queueMicrotask(() => input(input("name").value ? "message" : "name").focus({ preventScroll: true }))
    }
    formWasOn = formOn
    pre.hidden = !formOn
    form.hidden = formOn
    const closed = client.status() === "closed"
    const ids = messages.map((m) => m.id || `${m.created_at}|${m.body}`)
    const grows = !full && closed === shownClosed && rendered.length > 0 && rendered.every((k, i) => ids[i] === k)
    const nearEnd = body.scrollHeight - body.scrollTop - body.clientHeight < 80
    if (!grows) {
      log.textContent = ""
      lastDay = lastSide = ""
      lastAt = 0
      rendered = []
    }
    if (messages.length === 0) {
      if (!formOn || current.greeting) {
        const g = document.createElement("div")
        g.className = current.greeting ? "greet" : "note"
        g.setAttribute("dir", "auto")
        g.textContent = current.greeting || t.empty
        log.appendChild(g)
      }
      // The form goes under the greeting.
      if (formOn) log.after(pre)
    } else {
      for (const m of messages.slice(rendered.length)) row(m)
      if (closed && (!grows || !shownClosed)) {
        const n = document.createElement("div")
        n.className = "note"
        n.textContent = t.closedNote
        log.appendChild(n)
      }
    }
    if (!formOn) body.appendChild(typingEl)
    rendered = ids
    shownClosed = closed
    renderActions(messages.length === 0)
    paintSub()
    if (formOn) body.scrollTop = 0
    else if (!grows || nearEnd) stick()
  }

  // Openers while there is nothing to read; gone once the conversation starts
  // (a way in, not a permanent menu). Picking one sends it — or, while the
  // form is up, writes it into the form's message.
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
      b.addEventListener("click", () => {
        if (showingForm()) {
          const msg = input("message")
          msg.value = a.message
          ;(input("name").value ? msg : input("name")).focus()
        } else void submit(a.message)
      })
      qa.appendChild(b)
    }
  }

  function busy(on: boolean) {
    sending = on
    sendBtn.disabled = on
    preBtn.disabled = on
    preBtn.textContent = on ? t.sending : t.start
    sendBtn.setAttribute("aria-label", on ? t.sending : t.send)
    for (const b of Array.from(qa.querySelectorAll("button"))) (b as HTMLButtonElement).disabled = on
  }

  // ---- outgoing typing (MH-668) -----------------------------------------------------
  //
  // `client.setComposing` owns the throttle and the idle timeout; the widget
  // only says what just happened: `true` on every keystroke, `false` the
  // moment the box blurs or the message is sent.

  async function submit(text: string): Promise<boolean> {
    text = text.trim()
    if (!text || sending) return false
    client.setComposing(false) // the message itself is the "I stopped typing" signal
    errBox.hidden = true
    busy(true)
    renderActions(false)
    try {
      await client.send(text)
      if (ta.value.trim() === text) {
        ta.value = ""
        ta.style.height = ""
      }
      formForced = false
      // The thread refresh after a send can fail on its own; the message is in
      // either way, so the composer replaces the form now, not on the next poll.
      render(client.messages(), true)
      return true
    } catch (e) {
      // The error event already surfaced it; the typed text is kept. A server
      // that wants contact details the widget did not know about shows the form.
      if ((e as { kind?: string })?.kind === "contact_required") {
        const fromForm = formWasOn
        formForced = true
        if (!showingForm()) return false
        const msg = input("message")
        if (!msg.value) msg.value = text
        if (ta.value.trim() === text) {
          ta.value = "" // moved into the form, not copied
          ta.style.height = ""
        }
        render(client.messages(), true)
        // The server checked what the form let through: say which field, in
        // the visitor's language, and go there.
        if (fromForm) {
          const why = String((e as { message?: string }).message ?? "").toLowerCase()
          const field = /email or a phone/.test(why) ? "contact" : /name/.test(why) ? "name" : /phone/.test(why) ? "phone" : "email"
          if (field === "contact") {
            setFieldError("email", t.errContact)
            setFieldError("phone", " ")
          } else setFieldError(field, field === "name" ? t.errName : field === "phone" ? t.errPhone : t.errEmail)
          input(field === "contact" ? "email" : field).focus()
        }
        return false
      }
      render(client.messages(), true)
      return false
    } finally {
      busy(false)
    }
  }

  // ---- the pre-chat form ------------------------------------------------------------

  function setFieldError(name: string, message: string) {
    const el = input(name)
    el.setAttribute("aria-invalid", message ? "true" : "false")
    ;(root.getElementById(`${id}-${name}-e`) as HTMLElement).textContent = message
  }

  function prefill() {
    const v = client.visitor()
    for (const k of ["name", "email", "phone"] as const) {
      const el = input(k)
      if (!el.value && v[k]) el.value = v[k] as string
    }
  }

  pre.addEventListener("submit", async (e) => {
    e.preventDefault()
    if (sending) return
    errBox.hidden = true
    const v = { name: input("name").value, email: input("email").value, phone: input("phone").value }
    const message = input("message").value.trim()
    const problem = checkVisitor(v)
    for (const k of ["name", "email", "phone", "message"]) setFieldError(k, "")
    let first = ""
    if (problem === "name") setFieldError((first = "name"), t.errName)
    else if (problem === "email") setFieldError((first = "email"), t.errEmail)
    else if (problem === "phone") setFieldError((first = "phone"), t.errPhone)
    else if (problem === "contact") {
      setFieldError((first = "email"), t.errContact)
      setFieldError("phone", " ")
    }
    if (!message) {
      setFieldError("message", t.errMessage)
      first ||= "message"
    }
    if (first) {
      input(first).focus()
      return
    }
    client.setVisitor(v)
    // The form stays until the first message is actually in: a dropped
    // connection leaves the visitor where they were, their words intact.
    formForced = true
    if (await submit(message)) {
      input("message").value = ""
      ta.focus()
    }
  })

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
      if (e.kind === "contact_required") return // said by the form itself
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
  let hideTimer: ReturnType<typeof setTimeout> | null = null
  let returnFocus: HTMLElement | null = null

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
    return !panel.hidden && panel.classList.contains("open")
  }

  function open(fromInvite = false) {
    // A visitor who opens it themselves has had their invitation.
    markInvited()
    if (hideTimer) clearTimeout(hideTimer)
    hideTimer = null
    const active = document.activeElement as HTMLElement | null
    returnFocus = active && active !== document.body && active !== host ? active : launcher
    panel.hidden = false
    void panel.offsetWidth // start the transition from the closed state
    panel.classList.add("open")
    wrap.classList.add("is-open")
    launcher?.classList.add("on")
    launcher?.setAttribute("aria-expanded", "true")
    paintBadge(client.unread())
    prefill()
    render(client.messages(), true)
    client.start()
    void client.markRead()
    // Presence is a header detail: re-read while the panel is open, not from
    // every page view (fadymondy.com's PRESENCE_INTERVAL).
    if (!presenceTimer) presenceTimer = setInterval(() => void client.loadConfig(), 60_000)
    // An invitation does not steal the visitor's focus (or the keyboard on a phone).
    // The form starts at its top (the greeting and why we ask), not scrolled to the field.
    if (!fromInvite) (showingForm() ? input(input("name").value ? "message" : "name") : ta).focus({ preventScroll: true })
  }
  function close() {
    if (panel.hidden) return
    const hadFocus = root.activeElement != null
    panel.classList.remove("open")
    wrap.classList.remove("is-open")
    launcher?.classList.remove("on")
    launcher?.setAttribute("aria-expanded", "false")
    const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches
    hideTimer = setTimeout(
      () => {
        hideTimer = null
        if (!panel.classList.contains("open")) panel.hidden = true
      },
      reduced ? 0 : 220,
    )
    client.stop()
    if (presenceTimer) clearInterval(presenceTimer)
    presenceTimer = null
    paintBadge(client.unread())
    if (hadFocus) (returnFocus?.isConnected ? returnFocus : launcher)?.focus()
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
      open(true)
    }, cfg.invite_after_seconds * 1000)
  }

  launcher?.addEventListener("click", toggle)
  closeBtn.addEventListener("click", close)
  panel.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.stopPropagation()
      close()
    }
  })
  ta.addEventListener("input", () => {
    ta.style.height = ""
    ta.style.height = `${Math.min(ta.scrollHeight + 2, 120)}px`
    client.setComposing(!!ta.value.trim()) // cleared back to empty counts as stopped
  })
  ta.addEventListener("blur", () => client.setComposing(false))
  ta.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
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
    open: () => open(),
    close,
    toggle,
    isOpen,
    unmount() {
      for (const off of offs) off()
      media?.removeEventListener?.("change", paint)
      if (inviteTimer) clearTimeout(inviteTimer)
      if (presenceTimer) clearInterval(presenceTimer)
      if (hideTimer) clearTimeout(hideTimer)
      client.destroy() // stops polling/streaming and its own composing-idle timer
      host.remove()
    },
  }
}
