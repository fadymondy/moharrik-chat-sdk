// The headless client, against a fake transport — no network, no browser.
// Run with: npm test   (node --test also works)
//
// These cover the behaviour a caller depends on: a conversation is created on
// the first send and resumed afterwards, the token survives a reload, refusals
// arrive as typed errors rather than throwing raw responses, and a token the
// server has forgotten resets instead of looping.

import assert from "node:assert/strict"
import test from "node:test"

import { createChat, ChatError } from "../dist/index.js"

const ORIGIN = "https://app.example.test"
const KEY = "cwk_test"

/** A localStorage good enough for the client, so `persist` can be exercised. */
function fakeStorage() {
  const map = new Map()
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    get size() {
      return map.size
    },
  }
}

// `await fn(...)`, not `return fn(...)`: without the await the finally block
// runs at the callback's first await and tears the fake window down while the
// client is still using it — which looks exactly like "the SDK never wrote to
// localStorage".
async function withWindow(fn) {
  const had = "window" in globalThis
  const previous = globalThis.window
  globalThis.window = { localStorage: fakeStorage() }
  try {
    return await fn(globalThis.window.localStorage)
  } finally {
    if (had) globalThis.window = previous
    else delete globalThis.window
  }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
}

test("the first send creates a conversation and keeps its token", async () => {
  await withWindow(async (storage) => {
    const calls = []
    const chat = createChat({
      key: KEY,
      apiOrigin: ORIGIN,
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), method: init?.method ?? "GET", body: init?.body })
        if (init?.method === "POST") return json({ visitor_token: "cvt_abc", sent: true }, 201)
        return json({ messages: [{ id: "m1", direction: "in", body: "Hello", created_at: "" }], status: "open" })
      },
    })

    const messages = await chat.send("Hello")
    chat.stop()

    assert.equal(chat.visitorToken(), "cvt_abc")
    assert.equal(messages.length, 1)
    assert.equal(messages[0].body, "Hello")
    assert.equal(storage.getItem(`moharrik.chat.${KEY}`), "cvt_abc", "the token is persisted for the next page load")

    const post = calls.find((c) => c.method === "POST")
    assert.ok(post.url.startsWith(`${ORIGIN}/api/chat/${KEY}/messages`))
    assert.equal(JSON.parse(post.body).visitor_token, undefined, "no token on the very first message")
  })
})

test("a second send continues the same conversation", async () => {
  await withWindow(async () => {
    const sent = []
    const chat = createChat({
      key: KEY,
      apiOrigin: ORIGIN,
      fetchImpl: async (url, init) => {
        if (init?.method === "POST") {
          sent.push(JSON.parse(init.body))
          return json({ visitor_token: "cvt_abc", sent: true }, 201)
        }
        return json({ messages: [], status: "open" })
      },
    })

    await chat.send("first")
    await chat.send("second")
    chat.stop()

    assert.equal(sent.length, 2)
    assert.equal(sent[0].visitor_token, undefined)
    assert.equal(sent[1].visitor_token, "cvt_abc", "the second message rides the existing conversation")
  })
})

test("a stored token resumes the thread without sending anything", async () => {
  await withWindow(async (storage) => {
    storage.setItem(`moharrik.chat.${KEY}`, "cvt_saved")
    let posts = 0
    const chat = createChat({
      key: KEY,
      apiOrigin: ORIGIN,
      fetchImpl: async (url, init) => {
        if (init?.method === "POST") posts++
        return json({ messages: [{ id: "m9", direction: "out", body: "We replied", created_at: "" }], status: "open" })
      },
    })

    const messages = await chat.refresh()
    assert.equal(posts, 0, "resuming must not create a second conversation")
    assert.equal(messages[0].body, "We replied")
    assert.equal(chat.status(), "open")
  })
})

test("a refused origin arrives as a typed error, not a raw response", async () => {
  await withWindow(async () => {
    const seen = []
    const chat = createChat({
      key: KEY,
      apiOrigin: ORIGIN,
      fetchImpl: async () => json({ error: "this origin is not allowed for this chat widget" }, 403),
    })
    chat.on("error", (e) => seen.push(e))

    await assert.rejects(() => chat.send("hi"), (err) => {
      assert.ok(err instanceof ChatError)
      assert.equal(err.kind, "blocked")
      assert.equal(err.status, 403)
      return true
    })
    assert.equal(seen.length, 1, "the error event fires too, for UIs that do not await send()")
  })
})

test("an unknown key reads as `unknown`", async () => {
  await withWindow(async () => {
    const chat = createChat({ key: KEY, apiOrigin: ORIGIN, fetchImpl: async () => json({}, 404) })
    await assert.rejects(() => chat.send("hi"), (err) => err.kind === "unknown")
  })
})

test("a token the server has forgotten resets instead of looping", async () => {
  await withWindow(async (storage) => {
    storage.setItem(`moharrik.chat.${KEY}`, "cvt_gone")
    const chat = createChat({ key: KEY, apiOrigin: ORIGIN, fetchImpl: async () => json({}, 404) })

    await chat.refresh()

    assert.equal(chat.visitorToken(), null)
    assert.equal(storage.getItem(`moharrik.chat.${KEY}`), null, "the dead token is dropped")
  })
})

test("persist:false keeps nothing between loads", async () => {
  await withWindow(async (storage) => {
    const chat = createChat({
      key: KEY,
      apiOrigin: ORIGIN,
      persist: false,
      fetchImpl: async (url, init) => (init?.method === "POST" ? json({ visitor_token: "cvt_x" }, 201) : json({ messages: [] })),
    })
    await chat.send("hi")
    chat.stop()
    assert.equal(chat.visitorToken(), "cvt_x", "still usable for this page view")
    assert.equal(storage.size, 0, "but nothing is written down")
  })
})

test("an over-long message is refused before it is sent", async () => {
  await withWindow(async () => {
    let called = false
    const chat = createChat({
      key: KEY,
      apiOrigin: ORIGIN,
      fetchImpl: async () => {
        called = true
        return json({}, 201)
      },
    })
    await assert.rejects(() => chat.send("x".repeat(8001)), (err) => err.kind === "too_long")
    assert.equal(called, false, "no pointless request")
  })
})

test("a network failure is an error, not a crash", async () => {
  await withWindow(async () => {
    const chat = createChat({
      key: KEY,
      apiOrigin: ORIGIN,
      fetchImpl: async () => {
        throw new TypeError("Failed to fetch")
      },
    })
    await assert.rejects(() => chat.send("hi"), (err) => err.kind === "network")
  })
})

test("missing options fail loudly at construction", () => {
  assert.throws(() => createChat({ apiOrigin: ORIGIN }), /key/)
  assert.throws(() => createChat({ key: KEY }), /apiOrigin/)
})

// ---- MH-382: config, presence, unread, lead, live -----------------------------

import { quickActionsFor } from "../dist/index.js"

test("the config is read, and anything unsafe in it is dropped", async () => {
  const chat = createChat({
    key: KEY,
    apiOrigin: ORIGIN,
    eventSourceImpl: null,
    fetchImpl: async (url) => {
      assert.equal(String(url), `${ORIGIN}/api/chat/${KEY}/config`)
      return json({
        greeting: "Hi there", accent: "red;}body{display:none", theme: "dark", position: "start",
        invite: true, invite_after_seconds: 1, presence: "online",
        quick_actions: [{ label: "Pricing", message: "How much?", path: "/pricing" }, { nope: 1 }],
      })
    },
  })
  const seen = []
  chat.on("presence", (p) => seen.push(p))
  const cfg = await chat.loadConfig()
  assert.equal(cfg.greeting, "Hi there")
  assert.equal(cfg.accent, "", "a value that is not a colour never reaches the stylesheet")
  assert.equal(cfg.theme, "dark")
  assert.equal(cfg.invite_after_seconds, 5, "clamped to the server's own floor")
  assert.equal(cfg.quick_actions.length, 1)
  assert.deepEqual(seen, ["online"])
  assert.equal(chat.presence(), "online")
})

test("an unreachable config is not an error and not a crash", async () => {
  const chat = createChat({ key: KEY, apiOrigin: ORIGIN, eventSourceImpl: null, fetchImpl: async () => { throw new TypeError("x") } })
  const errors = []
  chat.on("error", (e) => errors.push(e))
  assert.equal(await chat.loadConfig(), null)
  assert.equal(errors.length, 0)
})

test("quick actions follow the page and the language", () => {
  const cfg = {
    quick_actions: [
      { label: "Anywhere", message: "a", path: "", locale: "" },
      { label: "Pricing", message: "b", path: "/pricing", locale: "" },
      { label: "Arabic only", message: "c", path: "", locale: "ar" },
    ],
  }
  assert.deepEqual(quickActionsFor(cfg, "/", "en").map((a) => a.label), ["Anywhere"])
  assert.deepEqual(quickActionsFor(cfg, "/pricing/teams", "en").map((a) => a.label), ["Anywhere", "Pricing"])
  assert.deepEqual(quickActionsFor(cfg, "/ar/pricing", "ar").map((a) => a.label), ["Anywhere", "Pricing", "Arabic only"])
  assert.deepEqual(quickActionsFor(null, "/", "en"), [])
})

test("the first message is a lead, once", async () => {
  await withWindow(async () => {
    const chat = createChat({
      key: KEY,
      apiOrigin: ORIGIN,
      eventSourceImpl: null,
      fetchImpl: async (url, init) =>
        init?.method === "POST" ? json({ visitor_token: "cvt_lead", sent: true }, 201) : json({ messages: [], status: "open" }),
    })
    const leads = []
    chat.on("lead", (d) => leads.push(d))
    await chat.send("one")
    await chat.send("two")
    chat.stop()
    assert.deepEqual(leads, [{ visitorToken: "cvt_lead" }])
  })
})

test("unread replies are counted and cleared by markRead", async () => {
  await withWindow(async (storage) => {
    storage.setItem(`moharrik.chat.${KEY}`, "cvt_u")
    const posts = []
    const chat = createChat({
      key: KEY,
      apiOrigin: ORIGIN,
      eventSourceImpl: null,
      fetchImpl: async (url, init) => {
        if (init?.method === "POST") {
          posts.push({ url: String(url), body: JSON.parse(init.body) })
          return json({ unread: 0 })
        }
        return json({ messages: [{ id: "r", direction: "out", body: "Hi", created_at: "" }], status: "open", unread: 2, presence: "away" })
      },
    })
    const counts = []
    chat.on("unread", (n) => counts.push(n))
    await chat.refresh()
    assert.equal(chat.unread(), 2)
    assert.equal(chat.presence(), "away")
    await chat.markRead()
    assert.equal(chat.unread(), 0)
    assert.deepEqual(counts, [2, 0])
    assert.equal(posts[0].url, `${ORIGIN}/api/chat/${KEY}/read`)
    assert.equal(posts[0].body.visitor_token, "cvt_u")
  })
})

test("a live event refetches the thread; the stream is only for this visitor", async () => {
  await withWindow(async (storage) => {
    storage.setItem(`moharrik.chat.${KEY}`, "cvt_live")
    const streams = []
    class FakeES {
      constructor(url) {
        this.url = url
        this.readyState = 0
        streams.push(this)
      }
      close() {
        this.readyState = 2
      }
    }
    let gets = 0
    const chat = createChat({
      key: KEY,
      apiOrigin: ORIGIN,
      eventSourceImpl: FakeES,
      fetchImpl: async () => {
        gets++
        return json({ messages: [], status: "open" })
      },
    })
    const live = []
    chat.on("live", (v) => live.push(v))
    chat.listen()
    chat.listen() // idempotent
    assert.equal(streams.length, 1)
    assert.equal(streams[0].url, `${ORIGIN}/api/chat/${KEY}/events?visitor_token=cvt_live`)
    streams[0].onopen()
    assert.equal(chat.isLive(), true)
    const before = gets
    streams[0].onmessage({ data: '{"kind":"message"}' })
    await new Promise((r) => setTimeout(r, 0))
    assert.equal(gets, before + 1, "an event is a hint to refetch, not the data")
    streams[0].readyState = 2
    streams[0].onerror()
    assert.equal(chat.isLive(), false, "a dropped stream falls back to polling")
    assert.deepEqual(live, [true, false])
    chat.destroy()
  })
})

test("a 429 reads as slow_down with the wait", async () => {
  await withWindow(async () => {
    const chat = createChat({
      key: KEY,
      apiOrigin: ORIGIN,
      eventSourceImpl: null,
      fetchImpl: async () => new Response("{}", { status: 429, headers: { "Retry-After": "12" } }),
    })
    await assert.rejects(() => chat.send("hi"), (err) => err.kind === "slow_down" && /12 seconds/.test(err.message))
  })
})

// ---- MH-668: agent typing (incoming) and visitor composing (outgoing) --------

test("an SSE typing event marks the agent typing; a paused event clears it", async () => {
  await withWindow(async (storage) => {
    storage.setItem(`moharrik.chat.${KEY}`, "cvt_typ")
    const streams = []
    class FakeES {
      constructor(url) {
        this.url = url
        streams.push(this)
      }
      close() {}
    }
    const chat = createChat({
      key: KEY,
      apiOrigin: ORIGIN,
      eventSourceImpl: FakeES,
      fetchImpl: async () => json({ messages: [], status: "open" }),
    })
    const seen = []
    chat.on("agentTyping", (v) => seen.push(v))
    chat.listen()
    streams[0].onopen()
    assert.equal(chat.isAgentTyping(), false)
    streams[0].onmessage({ data: '{"kind":"typing","presence":"composing"}' })
    assert.equal(chat.isAgentTyping(), true)
    streams[0].onmessage({ data: '{"kind":"typing","presence":""}' })
    assert.equal(chat.isAgentTyping(), false)
    assert.deepEqual(seen, [true, false])
    chat.destroy()
  })
})

test("a new message arriving resets the agent-typing flag", async () => {
  await withWindow(async (storage) => {
    storage.setItem(`moharrik.chat.${KEY}`, "cvt_typ2")
    const streams = []
    class FakeES {
      constructor(url) {
        this.url = url
        streams.push(this)
      }
      close() {}
    }
    const chat = createChat({
      key: KEY,
      apiOrigin: ORIGIN,
      eventSourceImpl: FakeES,
      fetchImpl: async () => json({ messages: [{ id: "m", direction: "out", body: "hi", created_at: "" }], status: "open" }),
    })
    chat.listen()
    streams[0].onopen()
    streams[0].onmessage({ data: '{"kind":"typing","presence":"composing"}' })
    assert.equal(chat.isAgentTyping(), true)
    streams[0].onmessage({ data: '{"kind":"message"}' })
    await new Promise((r) => setTimeout(r, 0))
    assert.equal(chat.isAgentTyping(), false, "the reply arriving is itself a reason to stop showing it as typing")
    chat.destroy()
  })
})

test("agent typing clears itself after ~6s with no refreshing event", async (t) => {
  await withWindow(async (storage) => {
    storage.setItem(`moharrik.chat.${KEY}`, "cvt_timeout")
    const streams = []
    class FakeES {
      constructor(url) {
        this.url = url
        streams.push(this)
      }
      close() {}
    }
    const chat = createChat({
      key: KEY,
      apiOrigin: ORIGIN,
      eventSourceImpl: FakeES,
      fetchImpl: async () => json({ messages: [], status: "open" }),
    })
    t.mock.timers.enable({ apis: ["setTimeout"] })
    chat.listen()
    streams[0].onopen()
    streams[0].onmessage({ data: '{"kind":"typing","presence":"composing"}' })
    assert.equal(chat.isAgentTyping(), true)
    t.mock.timers.tick(5999)
    assert.equal(chat.isAgentTyping(), true, "not yet 6s")
    t.mock.timers.tick(1)
    assert.equal(chat.isAgentTyping(), false, "6s with nothing refreshing it reads as stopped")
    chat.destroy()
  })
})

test("a refreshing typing event resets the 6s timeout", async (t) => {
  await withWindow(async (storage) => {
    storage.setItem(`moharrik.chat.${KEY}`, "cvt_refresh")
    const streams = []
    class FakeES {
      constructor(url) {
        this.url = url
        streams.push(this)
      }
      close() {}
    }
    const chat = createChat({
      key: KEY,
      apiOrigin: ORIGIN,
      eventSourceImpl: FakeES,
      fetchImpl: async () => json({ messages: [], status: "open" }),
    })
    t.mock.timers.enable({ apis: ["setTimeout"] })
    chat.listen()
    streams[0].onopen()
    streams[0].onmessage({ data: '{"kind":"typing","presence":"composing"}' })
    t.mock.timers.tick(5000)
    streams[0].onmessage({ data: '{"kind":"typing","presence":"composing"}' }) // still going, before the 6s mark
    t.mock.timers.tick(5000)
    assert.equal(chat.isAgentTyping(), true, "the second event pushed the timeout out")
    chat.destroy()
  })
})

test("setComposing is a no-op before a conversation exists", async () => {
  await withWindow(async () => {
    let calls = 0
    const chat = createChat({
      key: KEY,
      apiOrigin: ORIGIN,
      eventSourceImpl: null,
      fetchImpl: async () => {
        calls++
        return json({})
      },
    })
    chat.setComposing(true)
    assert.equal(calls, 0)
  })
})

test("outgoing composing is throttled to at most one POST every ~3s", async (t) => {
  await withWindow(async (storage) => {
    storage.setItem(`moharrik.chat.${KEY}`, "cvt_out")
    const posts = []
    const chat = createChat({
      key: KEY,
      apiOrigin: ORIGIN,
      eventSourceImpl: null,
      fetchImpl: async (url, init) => {
        if (init?.method === "POST" && String(url).endsWith("/typing")) {
          posts.push(JSON.parse(init.body))
          return json({})
        }
        return json({ messages: [], status: "open" })
      },
    })
    t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: Date.now() })
    chat.setComposing(true)
    chat.setComposing(true)
    chat.setComposing(true)
    assert.deepEqual(posts.map((p) => p.presence), ["composing"], "continuous typing sends only the first composing")
    assert.equal(posts[0].visitor_token, "cvt_out")
    t.mock.timers.tick(2999)
    chat.setComposing(true)
    assert.equal(posts.length, 1, "still inside the 3s window")
    t.mock.timers.tick(1)
    chat.setComposing(true)
    assert.equal(posts.length, 2, "the throttle window has passed")
    chat.destroy()
  })
})

test("no keystrokes for ~4s sends paused on its own", async (t) => {
  await withWindow(async (storage) => {
    storage.setItem(`moharrik.chat.${KEY}`, "cvt_idle")
    const posts = []
    const chat = createChat({
      key: KEY,
      apiOrigin: ORIGIN,
      eventSourceImpl: null,
      fetchImpl: async (url, init) => {
        if (init?.method === "POST" && String(url).endsWith("/typing")) {
          posts.push(JSON.parse(init.body))
          return json({})
        }
        return json({ messages: [], status: "open" })
      },
    })
    t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: Date.now() })
    chat.setComposing(true)
    assert.deepEqual(posts.map((p) => p.presence), ["composing"])
    t.mock.timers.tick(3999)
    assert.equal(posts.length, 1, "not idle yet")
    t.mock.timers.tick(1)
    assert.deepEqual(posts.map((p) => p.presence), ["composing", ""], "~4s of silence reads as paused on its own")
    chat.destroy()
  })
})

test("an explicit paused (send or blur) goes through immediately and resets the throttle", async () => {
  await withWindow(async (storage) => {
    storage.setItem(`moharrik.chat.${KEY}`, "cvt_pause")
    const posts = []
    const chat = createChat({
      key: KEY,
      apiOrigin: ORIGIN,
      eventSourceImpl: null,
      fetchImpl: async (url, init) => {
        if (init?.method === "POST" && String(url).endsWith("/typing")) {
          posts.push(JSON.parse(init.body))
          return json({})
        }
        return json({ messages: [], status: "open" })
      },
    })
    chat.setComposing(true)
    chat.setComposing(false) // on send/blur — not throttled, unlike composing
    assert.deepEqual(posts.map((p) => p.presence), ["composing", ""])
    // a new message right after is not stuck behind the previous window
    chat.setComposing(true)
    assert.deepEqual(posts.map((p) => p.presence), ["composing", "", "composing"])
    chat.destroy()
  })
})

import { checkVisitor } from "../dist/index.js"

test("checkVisitor takes the addresses the server takes", () => {
  for (const email of ["mona@shop.test", "o'connor@shop.test", "a.b+tag@mail.shop.co"]) {
    assert.equal(checkVisitor({ name: "Mona", email }), null, email)
  }
  for (const email of ["mona@", "mo..na@shop.test", "mona@shop", "Mona <mona@shop.test>", "mona@-shop.test", `${"a".repeat(250)}@x.co`]) {
    assert.equal(checkVisitor({ name: "Mona", email }), "email", email)
  }
  assert.equal(checkVisitor({ name: "", email: "mona@shop.test" }), "name")
  assert.equal(checkVisitor({ name: "Mona" }), "contact")
})
