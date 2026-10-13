// The packaged widget, end to end in a real (headless) browser against a mock
// of Moharrik's public chat API — the script tag build exactly as a customer
// site loads it. Drives the pre-chat form, the thread, typing, timestamps,
// focus and the returning visitor; optionally saves screenshots.
//
//   npm run build && node test/widget.e2e.mjs
//   SHOTS=docs/screenshots/after node test/widget.e2e.mjs        # also screenshots
//   BUNDLE=old-v1.js SHOTS=docs/screenshots/before ONLY_SHOTS=1 node test/widget.e2e.mjs
//
// Needs Chrome (or Edge) installed; set CHROME to its path if it is not in
// the usual place. Uses puppeteer-core only: no browser download.

import assert from "node:assert/strict"
import { existsSync, mkdirSync, readFileSync } from "node:fs"
import http from "node:http"
import path from "node:path"
import { fileURLToPath } from "node:url"

import puppeteer from "puppeteer-core"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const bundle = path.resolve(root, process.env.BUNDLE ?? "dist/chat.js")
const shotsDir = process.env.SHOTS ? path.resolve(root, process.env.SHOTS) : ""
const onlyShots = process.env.ONLY_SHOTS === "1"
const KEY = "cwk_demo"

const CHROME =
  process.env.CHROME ??
  [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].find((p) => existsSync(p))
if (!CHROME) {
  console.log("SKIP widget e2e: no Chrome found (set CHROME)")
  process.exit(0)
}

// ---- the mock API ---------------------------------------------------------------

const state = {
  requireContact: true,
  configRequires: true,
  configDelayMs: 0,
  reject: "", // a 422 detail for the next first send
  failRefresh: false, // a 503 for the next thread read
  posts: [],
  threads: new Map(), // token -> messages
  streams: new Map(), // token -> [res]
}
let seq = 0
const now = () => new Date().toISOString()

const AVATAR = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f59e0b"/><stop offset="1" stop-color="#db2777"/></linearGradient></defs><rect width="80" height="80" fill="url(#g)"/><circle cx="40" cy="31" r="14" fill="#fff" opacity=".92"/><path d="M14 74c3-15 14-23 26-23s23 8 26 23" fill="#fff" opacity=".92"/></svg>`

function page(locale) {
  const ar = locale === "ar"
  return `<!doctype html><html lang="${locale}" dir="${ar ? "rtl" : "ltr"}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Demo</title>
<style>body{margin:0;font-family:system-ui,'Segoe UI',Tahoma,sans-serif;background:#f4f1ea;color:#1f2937}
header{padding:22px 40px;display:flex;justify-content:space-between;align-items:center;border-bottom:1px solid #e5e0d5;background:#fffdf8}
header b{font-size:20px}nav a{margin-inline-start:22px;color:#4b5563;text-decoration:none}
main{max-width:760px;padding:56px 40px}h1{font-size:42px;line-height:1.15;margin:0 0 18px}p{font-size:18px;line-height:1.7;color:#4b5563}
.cta{display:inline-block;margin-top:14px;background:#111827;color:#fff;padding:12px 22px;border-radius:10px;text-decoration:none}</style></head>
<body><header><b>${ar ? "فادي موندي" : "Fady Mondy"}</b><nav><a href="#">${ar ? "الخدمات" : "Services"}</a><a href="#">${ar ? "الأعمال" : "Work"}</a><a href="#">${ar ? "تواصل" : "Contact"}</a></nav></header>
<main><h1>${ar ? "أبني منتجات برمجية تنمو مع عملك" : "I build software products that grow with your business"}</h1>
<p>${ar ? "من الفكرة إلى الإطلاق: تطبيقات ويب، أنظمة داخلية، وأتمتة بالذكاء الاصطناعي." : "From idea to launch: web apps, internal systems and AI automation, built to last and easy to run."}</p>
<a class="cta" href="#">${ar ? "احجز مكالمة" : "Book a call"}</a></main>
<script src="/chat.js" data-key="${KEY}" data-locale="${locale}" defer></script></body></html>`
}

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" })
  res.end(JSON.stringify(body))
}

function push(token, data) {
  for (const s of state.streams.get(token) ?? []) s.write(`data: ${JSON.stringify(data)}\n\n`)
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x")
  const p = url.pathname
  if (p === "/" || p === "/ar") return res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(page(p === "/ar" ? "ar" : "en"))
  if (p === "/chat.js") return res.writeHead(200, { "Content-Type": "text/javascript" }).end(readFileSync(bundle))
  if (p === "/avatar.svg") return res.writeHead(200, { "Content-Type": "image/svg+xml" }).end(AVATAR)
  const m = p.match(/^\/api\/chat\/([^/]+)\/(config|messages|read|typing|events)$/)
  if (!m || m[1] !== KEY) return json(res, 404, { detail: "not found" })
  const what = m[2]
  if (what === "config" && state.configDelayMs) {
    const ms = state.configDelayMs
    state.configDelayMs = 0
    return setTimeout(() => server.emit("request", req, res), ms)
  }
  if (what === "config")
    return json(res, 200, {
      greeting: "Hi! 👋 Ask me anything about a project — I usually reply within the hour.",
      greeting_ar: "أهلًا! 👋 اسألني أي شيء عن مشروعك — أرد عادةً خلال ساعة.",
      title: "Chat with Fady",
      title_ar: "تحدّث مع فادي",
      accent: "#4F46E5",
      theme: "auto",
      position: "end",
      invite: false,
      invite_after_seconds: 25,
      quick_actions: [
        { label: "Get a quote", message: "Hi, I'd like a quote for a project.", locale: "en" },
        { label: "Book a call", message: "Can we book a call this week?", locale: "en" },
        { label: "اطلب عرض سعر", message: "أهلًا، أريد عرض سعر لمشروع.", locale: "ar" },
        { label: "احجز مكالمة", message: "هل يمكن أن نحجز مكالمة هذا الأسبوع؟", locale: "ar" },
      ],
      lead_event: true,
      presence: "online",
      require_contact: state.configRequires,
      name: "Fady Mondy",
      avatar_url: `http://${req.headers.host}/avatar.svg`,
    })
  if (what === "events") {
    const token = url.searchParams.get("visitor_token")
    res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" })
    res.write(": hi\n\n")
    const list = state.streams.get(token) ?? []
    list.push(res)
    state.streams.set(token, list)
    req.on("close", () => state.streams.set(token, (state.streams.get(token) ?? []).filter((r) => r !== res)))
    return
  }
  if (what === "messages" && req.method === "GET" && state.failRefresh) {
    state.failRefresh = false
    return json(res, 503, { detail: "busy" })
  }
  if (what === "messages" && req.method === "GET") {
    const token = url.searchParams.get("visitor_token")
    if (!state.threads.has(token)) return json(res, 404, { detail: "unknown visitor" })
    return json(res, 200, { messages: state.threads.get(token), status: "open", unread: 0, presence: "online" })
  }
  let raw = ""
  req.on("data", (c) => (raw += c))
  req.on("end", () => {
    const body = raw ? JSON.parse(raw) : {}
    if (what !== "messages") return json(res, 200, { ok: true })
    state.posts.push(body)
    let token = body.visitor_token
    if (!token && state.reject) {
      const detail = state.reject
      state.reject = ""
      return json(res, 422, { title: "Unprocessable Entity", status: 422, detail })
    }
    if (!token) {
      if (state.requireContact && (!body.name || !(body.email || body.phone)))
        return json(res, 422, { title: "Unprocessable Entity", status: 422, detail: "contact_required: an email or a phone number is required" })
      token = `cvt_${++seq}`
      state.threads.set(token, [])
    }
    const thread = state.threads.get(token)
    if (!thread) return json(res, 404, { detail: "unknown visitor" })
    thread.push({ id: `m${++seq}`, direction: "in", body: body.body, created_at: now() })
    json(res, 201, { visitor_token: token, sent: true })
  })
})

await new Promise((r) => server.listen(0, "127.0.0.1", r))
const base = `http://127.0.0.1:${server.address().port}`

/** The team replies: typing first, then the message. */
async function agentReplies(token, text, typingMs = 0) {
  push(token, { kind: "typing", presence: "composing" })
  if (typingMs) await sleep(typingMs)
  state.threads.get(token).push({ id: `m${++seq}`, direction: "out", body: text, created_at: now() })
  push(token, { kind: "message" })
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// ---- the browser ----------------------------------------------------------------

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-first-run", "--no-default-browser-check", "--font-render-hinting=none", "--lang=en-US", ...(process.env.CI ? ["--no-sandbox"] : [])],
})

const DESKTOP = { width: 1280, height: 820, deviceScaleFactor: 1 }
const MOBILE = { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true }

async function shot(pg, name) {
  if (!shotsDir) return
  mkdirSync(shotsDir, { recursive: true })
  await sleep(350) // let the open/close transition settle
  await pg.screenshot({ path: path.join(shotsDir, `${name}.png`) })
}

/** Run in the widget's shadow root. */
const inWidget = (pg, fn, ...args) =>
  pg.evaluate(
    (src, a) => {
      const r = document.querySelector("[data-moharrik-chat]").shadowRoot
      return new Function("r", "args", `return (${src})(r, ...args)`)(r, a)
    },
    fn.toString(),
    args,
  )

async function fresh(viewport, locale = "en", context) {
  const ctx = context ?? (await browser.createBrowserContext())
  const pg = await ctx.newPage()
  await pg.setViewport(viewport)
  await pg.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "light" }])
  await pg.goto(`${base}/${locale === "ar" ? "ar" : ""}`, { waitUntil: "load" })
  await pg.waitForFunction(() => !!window.MoharrikChat)
  return { ctx, pg }
}

async function type(pg, selector, text) {
  const h = await pg.evaluateHandle((s) => document.querySelector("[data-moharrik-chat]").shadowRoot.querySelector(s), selector)
  await h.asElement().click({ count: 3 })
  await h.asElement().type(text)
}
async function click(pg, selector) {
  const h = await pg.evaluateHandle((s) => document.querySelector("[data-moharrik-chat]").shadowRoot.querySelector(s), selector)
  await h.asElement().click()
}

let failed = 0
async function step(name, fn) {
  try {
    await fn()
    console.log(`ok   ${name}`)
  } catch (e) {
    failed++
    console.log(`FAIL ${name}\n     ${e?.stack ?? e}`)
  }
}

try {
  // ---- screenshots only (e.g. the old bundle, which has no form) -----------------
  if (onlyShots) {
    state.requireContact = false
    for (const [vp, vpName] of [
      [DESKTOP, "desktop"],
      [MOBILE, "mobile"],
    ]) {
      for (const locale of ["en", "ar"]) {
        const { ctx, pg } = await fresh(vp, locale)
        await shot(pg, `${vpName}-${locale}-1-closed`)
        await pg.evaluate(() => window.MoharrikChat.open())
        await shot(pg, `${vpName}-${locale}-2-open`)
        await pg.evaluate(() => window.MoharrikChat.send("Hi, I'd like a quote for a project."))
        await sleep(400)
        const token = await pg.evaluate(() => window.MoharrikChat.visitorToken())
        await agentReplies(token, locale === "ar" ? "أهلًا! بالتأكيد، ما نوع المشروع؟" : "Hi! Sure — what kind of project is it?")
        await sleep(700)
        await shot(pg, `${vpName}-${locale}-4-thread`)
        await ctx.close()
      }
    }
  } else {
    // ---- the flow, desktop English ---------------------------------------------------
    const { ctx, pg } = await fresh(DESKTOP, "en")
    await shot(pg, "desktop-en-1-closed")

    await step("the launcher says the widget's title, not a fixed label", async () => {
      await pg.waitForFunction(
        () => document.querySelector("[data-moharrik-chat]").shadowRoot.querySelector(".btn .lbl").textContent === "Chat with Fady",
      )
      const label = await inWidget(pg, (r) => r.querySelector(".btn").getAttribute("aria-label"))
      assert.equal(label, "Chat with Fady")
    })

    await step("the header names the business, with its picture", async () => {
      await pg.evaluate(() => window.MoharrikChat.open())
      await pg.waitForFunction(() => document.querySelector("[data-moharrik-chat]").shadowRoot.querySelector(".panel.open"))
      const h = await inWidget(pg, (r) => ({
        title: r.querySelector(".ttl").textContent,
        img: r.querySelector(".av img").getAttribute("src"),
        imgShown: !r.querySelector(".av img").hidden,
        sub: r.querySelector(".sub").textContent,
        role: r.querySelector(".panel").getAttribute("role"),
        labelled: r.getElementById(r.querySelector(".panel").getAttribute("aria-labelledby"))?.textContent,
      }))
      assert.equal(h.title, "Fady Mondy")
      assert.ok(h.imgShown && h.img.endsWith("/avatar.svg"))
      assert.equal(h.sub, "Online now")
      assert.equal(h.role, "dialog")
      assert.equal(h.labelled, "Fady Mondy")
    })

    await step("a first-time visitor sees the pre-chat form, focused on their name", async () => {
      const f = await inWidget(pg, (r) => ({
        form: !r.querySelector(".pre").hidden,
        composer: !r.querySelector(".form").hidden,
        focused: r.activeElement?.getAttribute("name"),
      }))
      assert.ok(f.form, "the form shows")
      assert.ok(!f.composer, "the plain composer waits for the form")
      assert.equal(f.focused, "name")
    })
    await shot(pg, "desktop-en-2-open-form")

    await step("nothing is sent without a name and an email or phone", async () => {
      const before = state.posts.length
      await click(pg, ".go")
      let e = await inWidget(pg, (r) => ({
        name: r.querySelector("[name=name]").getAttribute("aria-invalid"),
        nameErr: r.querySelector(`#${r.querySelector("[name=name]").id}-e`).textContent,
        focus: r.activeElement?.getAttribute("name"),
      }))
      assert.equal(e.name, "true")
      assert.match(e.nameErr, /name/i)
      assert.equal(e.focus, "name")
      await type(pg, "[name=name]", "Mona Adel")
      await type(pg, "[name=phone]", "0101 234 5678")
      await type(pg, ".pre .ta", "Do you build mobile apps?")
      await click(pg, ".go")
      e = await inWidget(pg, (r) => ({
        phone: r.querySelector("[name=phone]").getAttribute("aria-invalid"),
        phoneErr: r.querySelector(`#${r.querySelector("[name=phone]").id}-e`).textContent,
      }))
      assert.equal(e.phone, "true")
      assert.match(e.phoneErr, /country code/)
      assert.equal(state.posts.length, before, "no request left the browser")
    })
    await shot(pg, "desktop-en-3-form-errors")

    let token = ""
    await step("with a valid email the conversation starts and carries the details", async () => {
      await type(pg, "[name=phone]", "+20 101 234 5678")
      await type(pg, "[name=email]", "mona@example.test")
      await click(pg, ".go")
      await pg.waitForFunction(() => window.MoharrikChat.visitorToken())
      token = await pg.evaluate(() => window.MoharrikChat.visitorToken())
      const post = state.posts.at(-1)
      assert.equal(post.name, "Mona Adel")
      assert.equal(post.email, "mona@example.test")
      assert.equal(post.phone, "+20 101 234 5678")
      assert.equal(post.body, "Do you build mobile apps?")
      await pg.waitForFunction(() => document.querySelector("[data-moharrik-chat]").shadowRoot.querySelector(".row.mine"))
      const v = await inWidget(pg, (r) => ({
        form: !r.querySelector(".pre").hidden,
        composer: !r.querySelector(".form").hidden,
        time: r.querySelector(".row.mine time")?.textContent,
        day: r.querySelector(".day")?.textContent,
      }))
      assert.ok(!v.form && v.composer, "the form gives way to the thread")
      assert.match(v.time, /\d{1,2}:\d{2}/)
      assert.equal(v.day, "Today")
    })

    await step("the team typing shows as a bubble and in the header", async () => {
      push(token, { kind: "typing", presence: "composing" })
      await pg.waitForFunction(() => !document.querySelector("[data-moharrik-chat]").shadowRoot.querySelector(".typing").hidden)
      assert.equal(await inWidget(pg, (r) => r.querySelector(".sub").textContent), "Typing…")
    })
    await shot(pg, "desktop-en-4-typing")

    await step("a reply arrives live, with the business's name and a time", async () => {
      await agentReplies(token, "Hi Mona! Yes — iOS and Android, usually with a shared web admin. What do you have in mind?")
      await pg.waitForFunction(() => document.querySelector("[data-moharrik-chat]").shadowRoot.querySelector(".row.theirs"))
      const r = await inWidget(pg, (r) => ({
        who: r.querySelector(".row.theirs .who").textContent,
        time: r.querySelector(".row.theirs time").getAttribute("datetime"),
        typing: !r.querySelector(".typing").hidden,
      }))
      assert.equal(r.who, "Fady Mondy")
      assert.ok(r.time)
      assert.ok(!r.typing, "the reply clears the typing bubble")
    })
    await pg.evaluate(() => window.MoharrikChat.send("Great. A booking app for a clinic, with WhatsApp reminders."))
    await sleep(300)
    await agentReplies(token, "Perfect, that's right up my street. I'll send a short plan and estimate by email today.")
    await sleep(500)
    await shot(pg, "desktop-en-5-thread")

    await step("Escape closes the panel and gives focus back to the launcher", async () => {
      await click(pg, ".form .ta")
      await pg.keyboard.press("Escape")
      await sleep(300)
      const c = await inWidget(pg, (r) => ({
        hidden: r.querySelector(".panel").hidden,
        focus: r.activeElement?.className,
        expanded: r.querySelector(".btn").getAttribute("aria-expanded"),
      }))
      assert.ok(c.hidden)
      assert.match(c.focus ?? "", /btn/)
      assert.equal(c.expanded, "false")
    })

    await step("a returning visitor with a conversation is not asked again", async () => {
      await pg.reload({ waitUntil: "load" })
      await pg.waitForFunction(() => !!window.MoharrikChat)
      await pg.evaluate(() => window.MoharrikChat.open())
      await sleep(300)
      const f = await inWidget(pg, (r) => ({ form: !r.querySelector(".pre").hidden, rows: r.querySelectorAll(".row").length }))
      assert.ok(!f.form)
      assert.ok(f.rows >= 4, "the thread resumed")
    })

    await step("a returning visitor whose conversation is gone is not asked again either", async () => {
      await pg.evaluate((k) => localStorage.removeItem(`moharrik.chat.${k}`), KEY)
      await pg.reload({ waitUntil: "load" })
      await pg.waitForFunction(() => !!window.MoharrikChat)
      await pg.evaluate(() => window.MoharrikChat.open())
      await sleep(300)
      assert.ok(await inWidget(pg, (r) => r.querySelector(".pre").hidden), "no form")
      await pg.evaluate(() => window.MoharrikChat.send("Back again!"))
      const post = state.posts.at(-1)
      assert.equal(post.name, "Mona Adel", "remembered details go with the new conversation")
      assert.equal(post.email, "mona@example.test")
    })
    await ctx.close()

    await step("a server that wants details the config did not mention brings the form up", async () => {
      state.configRequires = false
      const { ctx, pg } = await fresh(DESKTOP, "en")
      await pg.evaluate(() => window.MoharrikChat.open())
      await type(pg, ".form .ta", "hello?")
      await pg.keyboard.press("Enter")
      await pg.waitForFunction(() => !document.querySelector("[data-moharrik-chat]").shadowRoot.querySelector(".pre").hidden)
      assert.equal(await inWidget(pg, (r) => r.querySelector(".pre .ta").value), "hello?", "the typed message moves into the form")
      assert.equal(await inWidget(pg, (r) => r.querySelector(".form .ta").value), "", "and leaves the composer")
      state.configRequires = true
      await ctx.close()
    })

    const fillForm = async (pg) => {
      await pg.evaluate(() => window.MoharrikChat.open())
      await pg.waitForFunction(() => !document.querySelector("[data-moharrik-chat]").shadowRoot.querySelector(".pre").hidden)
      await type(pg, "[name=name]", "Liam")
      await type(pg, "[name=email]", "o'connor@example.test")
      await type(pg, ".pre .ta", "Still there?")
    }

    await step("an address the server refuses is shown on the email field, nothing lost", async () => {
      const { ctx, pg } = await fresh(DESKTOP, "en")
      await fillForm(pg)
      state.reject = "contact_required: that email address is not valid"
      await click(pg, ".go")
      await pg.waitForFunction(() => document.querySelector("[data-moharrik-chat]").shadowRoot.querySelector("[name=email]").getAttribute("aria-invalid") === "true")
      const v = await inWidget(pg, (r) => ({
        form: !r.querySelector(".pre").hidden,
        err: r.querySelector(`#${r.querySelector("[name=email]").id}-e`).textContent,
        focus: r.activeElement?.getAttribute("name"),
        msg: r.querySelector(".pre .ta").value,
      }))
      assert.ok(v.form, "the form stays")
      assert.match(v.err, /email/i)
      assert.equal(v.focus, "email")
      assert.equal(v.msg, "Still there?")
      await ctx.close()
    })

    await step("a dropped connection on the first send keeps the form and the message", async () => {
      const { ctx, pg } = await fresh(DESKTOP, "en")
      await fillForm(pg)
      // The network fails the first send (the browser would retry a socket
      // the server cuts, so the request is aborted in the browser instead).
      await pg.setRequestInterception(true)
      let aborted = 0
      const onReq = (r) => (r.method() === "POST" && r.url().endsWith("/messages") && !aborted++ ? r.abort("internetdisconnected") : r.continue())
      pg.on("request", onReq)
      await click(pg, ".go")
      await pg.waitForFunction(() => !document.querySelector("[data-moharrik-chat]").shadowRoot.querySelector(".err").hidden)
      pg.off("request", onReq)
      await pg.setRequestInterception(false)
      const v = await inWidget(pg, (r) => ({ form: !r.querySelector(".pre").hidden, msg: r.querySelector(".pre .ta").value, name: r.querySelector("[name=name]").value }))
      assert.ok(v.form, "the form stays up")
      assert.equal(v.msg, "Still there?")
      assert.equal(v.name, "Liam")
      await click(pg, ".go")
      await pg.waitForFunction(() => window.MoharrikChat.visitorToken())
      assert.equal(state.posts.at(-1).email, "o'connor@example.test")
      await ctx.close()
    })

    await step("a config that arrives late brings the form without losing the draft", async () => {
      state.configDelayMs = 800
      const { ctx, pg } = await fresh(DESKTOP, "en")
      await pg.evaluate(() => window.MoharrikChat.open())
      await type(pg, ".form .ta", "typed early")
      await pg.waitForFunction(() => !document.querySelector("[data-moharrik-chat]").shadowRoot.querySelector(".pre").hidden, { timeout: 5000 })
      await new Promise((r) => setTimeout(r, 50))
      const v = await inWidget(pg, (r) => ({ msg: r.querySelector(".pre .ta").value, focus: r.activeElement?.getAttribute("name") }))
      assert.equal(v.msg, "typed early")
      assert.equal(v.focus, "name")
      assert.equal(await inWidget(pg, (r) => r.querySelector(".form .ta").value), "", "the draft moved, not copied")
      // The message goes in, but the thread read after it fails: the form
      // still gives way to the composer, which holds no stale draft.
      await type(pg, "[name=name]", "Liam")
      await type(pg, "[name=email]", "liam@example.test")
      await type(pg, ".pre .ta", "typed early, then edited")
      state.failRefresh = true
      await click(pg, ".go")
      await pg.waitForFunction(() => window.MoharrikChat.visitorToken())
      await pg.waitForFunction(() => document.querySelector("[data-moharrik-chat]").shadowRoot.querySelector(".pre").hidden)
      const after = await inWidget(pg, (r) => ({ composer: !r.querySelector(".form").hidden, draft: r.querySelector(".form .ta").value }))
      assert.ok(after.composer)
      assert.equal(after.draft, "")
      state.failRefresh = false
      await ctx.close()
    })

    // ---- Arabic, mobile ---------------------------------------------------------------
    await step("Arabic on a phone: RTL, full screen, the same form", async () => {
      const { ctx, pg } = await fresh(MOBILE, "ar")
      await shot(pg, "mobile-ar-1-closed")
      await click(pg, ".btn")
      await sleep(300)
      const a = await inWidget(pg, (r) => {
        const p = r.querySelector(".panel").getBoundingClientRect()
        return {
          dir: getComputedStyle(r.querySelector(".wrap")).direction,
          w: p.width,
          h: p.height,
          start: r.querySelector(".go").textContent,
          launcherHidden: getComputedStyle(r.querySelector(".btn")).display === "none",
        }
      })
      assert.equal(a.dir, "rtl")
      assert.equal(a.w, 390)
      assert.equal(a.h, 844)
      assert.equal(a.start, "ابدأ المحادثة")
      assert.equal(await inWidget(pg, (r) => r.querySelector(".btn .lbl").textContent), "تحدّث مع فادي")
      assert.ok(a.launcherHidden, "the close button in the header takes over")
      await shot(pg, "mobile-ar-2-open-form")
      await type(pg, "[name=name]", "منى عادل")
      await type(pg, "[name=phone]", "+٢٠ ١٠١ ٢٣٤ ٥٦٧٨")
      await type(pg, ".pre .ta", "هل تبنون تطبيقات للجوال؟")
      await click(pg, ".go")
      await pg.waitForFunction(() => window.MoharrikChat.visitorToken())
      const tok = await pg.evaluate(() => window.MoharrikChat.visitorToken())
      await agentReplies(tok, "أهلًا منى! نعم، iOS وAndroid مع لوحة تحكم على الويب. ما الفكرة؟")
      await pg.waitForFunction(() => document.querySelector("[data-moharrik-chat]").shadowRoot.querySelector(".row.theirs"))
      push(tok, { kind: "typing", presence: "composing" })
      await sleep(300)
      await shot(pg, "mobile-ar-3-thread")
      await ctx.close()
    })

    await step("English on a phone, dark", async () => {
      const ctx = await browser.createBrowserContext()
      const pg = await ctx.newPage()
      await pg.setViewport(MOBILE)
      await pg.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "dark" }])
      await pg.goto(base, { waitUntil: "load" })
      await pg.waitForFunction(() => !!window.MoharrikChat)
      await pg.evaluate(() => window.MoharrikChat.open())
      await shot(pg, "mobile-en-dark-open-form")
      await ctx.close()
    })

    await step("Arabic on desktop", async () => {
      const { ctx, pg } = await fresh(DESKTOP, "ar")
      await pg.evaluate(() => window.MoharrikChat.open())
      await shot(pg, "desktop-ar-2-open-form")
      await ctx.close()
    })
  }
} finally {
  await browser.close()
  server.close()
  for (const list of state.streams.values()) for (const s of list) s.destroy()
}

if (failed) {
  console.log(`\n${failed} failed`)
  process.exit(1)
}
console.log("\nwidget e2e: all passed")
process.exit(0)
