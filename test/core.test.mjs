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
