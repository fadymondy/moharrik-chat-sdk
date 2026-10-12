# moharrik-chat

The chat widget for [Moharrik](https://moharrik.com), and the headless client underneath it.

Drop in a `<script>` tag, or install from npm and use it with **React**, **Vue**, Svelte, Angular,
or plain JavaScript. The widget renders inside a shadow root, so your CSS and its CSS never touch.

```bash
npm install moharrik-chat
```

---

## Get a widget key

In Moharrik: **Inbox → Chat widgets → Add widget**. Give it a name and the origins it is allowed to
run on (`https://example.com`), and copy the key — it looks like `cwk_…`.

The key is public; it is meant to ship in your page. What protects it is the **allowed origins**
list on the key: the same key embedded on a site you did not list is refused. A widget with no
origins set is blocked everywhere, on purpose.

---

## Plain HTML

```html
<script src="https://app.moharrik.com/chat/v1.js" data-key="cwk_your_key" defer></script>
```

That is the whole install. The script finds the API from its own `src`, so there is nothing else to
configure. Options go on the same tag:

| Attribute | Default | What it does |
| --- | --- | --- |
| `data-key` | — | **Required.** Your widget key. |
| `data-locale` | the page's `<html lang>` | `en` or `ar` (`ar` also flips the widget to RTL). |
| `data-theme` | the visitor's system setting | `light` or `dark`. |
| `data-position` | `end` | `start` pins it to the other side. |
| `data-accent` | `#00A0A8` | Brand colour for the launcher, header and the visitor's bubbles. |
| `data-title` | "Chat with us" | Panel title. |
| `data-greeting` | — | First line shown in an empty panel. |
| `data-greeting-ar`, `data-title-ar` | — | The same, when the widget runs in Arabic. |
| `data-launcher` | `true` | `false` hides the floating button — open it yourself. |

The snippet Moharrik gives you already carries these, copied from the widget's settings. They paint
the first frame. Once the widget has read its settings from Moharrik (Inbox → Chat widgets →
Customize), those win, so a change to the greeting, colours, invitation or quick actions reaches every
page that embeds the key without anyone re-pasting the snippet.

### What the widget does

- **Greeting and presence.** The panel opens on your greeting. Its header shows your workspace's
  name and picture (initials on your accent when there is no picture) and whether anyone on your
  team is around: online, away, or a plain "we reply here as soon as we can".
- **Contact details first.** When the widget asks for them (on by default, a per-widget setting), a
  new visitor gives a name and an email or a phone number with its country code before the first
  message. The server files them as a CRM contact — linking an existing one with that address,
  never editing it. They are remembered on that browser, so a returning visitor is not asked again.
- **The thread.** Messages are grouped by sender with a time under each run and a day separator
  (Today, Yesterday, a date); a typing bubble shows while an agent writes.
- **Mobile, RTL, accessible.** Full screen under 480px wide; right-to-left in Arabic; a labelled
  dialog that closes on Esc and returns focus; visible focus rings; respects reduced motion.
- **Live replies.** While the page is open, replies arrive over a live stream (Server-Sent Events) and
  the launcher shows an unread count. If the stream cannot connect, the widget polls instead.
- **Typing indicators, both ways.** When an agent is composing a reply, the header swaps its
  online/away line for "Typing…" — cleared the moment a reply arrives, the agent stops, or ~6s pass
  with nothing refreshing it (a dropped "stopped" event should not leave it stuck). The visitor's own
  typing reaches the team the same way: `composing` while they write (throttled to at most once every
  ~3s), `paused` the moment they stop for ~4s, blur the box, or send.
- **Quick actions.** Ready-made first messages, optionally limited to pages whose path starts with a
  prefix (`/pricing`) or to one language. Picking one sends it.
- **Invitation.** Optionally opens itself once per visit after N seconds. It starts no conversation
  until the visitor writes.
- **Lead event.** The visitor's first message dispatches a `moharrik:lead` DOM event on `window`
  (`detail: { lead_type: "chat", widget_key }`). When the widget is set to report leads, it also sends a
  `generate_lead` event to `gtag` and `dataLayer`, if the page has them.
| `data-visitor-name`, `data-visitor-email`, `data-visitor-phone` | — | Attach who this is, if you already know (the form is then skipped). |

Open it from your own button:

```html
<button onclick="MoharrikChat.open()">Need help?</button>
```

---

## React

```tsx
import { MoharrikChat } from "moharrik-chat/react"

export default function Layout({ children }) {
  return (
    <>
      {children}
      <MoharrikChat widgetKey="cwk_your_key" apiOrigin="https://app.moharrik.com" />
    </>
  )
}
```

The component renders nothing itself (the widget lives in its own shadow root on `document.body`),
so it is safe anywhere in the tree. It is SSR-safe: nothing mounts until the client.

> The prop is `widgetKey`, not `key` — React reserves `key`.

Open it from your own UI:

```tsx
const [chat, setChat] = useState(null)

<button onClick={() => chat?.open()}>Need help?</button>
<MoharrikChat widgetKey="cwk_…" apiOrigin="https://app.moharrik.com" onReady={setChat} />
```

### Your own UI

```tsx
import { useMoharrikChat } from "moharrik-chat/react"

function Support() {
  const { messages, send, sending, error, presence, unread, markRead } = useMoharrikChat({
    key: "cwk_your_key",
    apiOrigin: "https://app.moharrik.com",
  })

  return (
    <>
      <p>{presence === "online" ? "We're online" : "We'll reply soon"}</p>
      {messages.map((m) => (
        <p key={m.id} className={m.direction === "in" ? "mine" : "theirs"}>{m.body}</p>
      ))}
      {error && <p role="alert">{error.message}</p>}
      <button disabled={sending} onClick={() => send("Hello")}>Send</button>
      <button onClick={() => markRead()}>Mark read ({unread})</button>
    </>
  )
}
```

`useMoharrikChat` also returns `presence` (`"online" | "away" | "offline" | null` — `null` until
the widget's config has loaded) and `unread` (team replies this visitor has not seen yet), plus
`markRead()` to clear it. `isAgentTyping` is `true` while an agent is composing a reply — wire your
own textarea's `onChange`/`onBlur`/submit to `setComposing(true | false)` to send the same signal back.

---

## Vue

As a plugin, so it is on every page:

```ts
import { createApp } from "vue"
import { MoharrikChatPlugin } from "moharrik-chat/vue"
import App from "./App.vue"

createApp(App)
  .use(MoharrikChatPlugin, { key: "cwk_your_key", apiOrigin: "https://app.moharrik.com" })
  .mount("#app")
```

Any component can then open it:

```vue
<script setup>
import { inject } from "vue"
const chat = inject("moharrikChat")
</script>

<template><button @click="chat.open()">Need help?</button></template>
```

As a component:

```vue
<script setup>
import { MoharrikChat } from "moharrik-chat/vue"
</script>

<template>
  <MoharrikChat widget-key="cwk_your_key" api-origin="https://app.moharrik.com" />
</template>
```

Headless, for your own UI:

```vue
<script setup>
import { useMoharrikChat } from "moharrik-chat/vue"
const { messages, send, error, presence, unread, markRead } = useMoharrikChat({
  key: "cwk_…",
  apiOrigin: "https://app.moharrik.com",
})
</script>

<template>
  <p>{{ presence === "online" ? "We're online" : "We'll reply soon" }}</p>
  <button @click="markRead()">Mark read ({{ unread }})</button>
</template>
```

`useMoharrikChat` also returns `presence` (a `Ref<"online" | "away" | "offline" | null>` — `null`
until the widget's config has loaded) and `unread` (a `Ref<number>` of team replies this visitor
has not seen yet), plus `markRead()` to clear it. `isAgentTyping` is a `Ref<boolean>`, `true` while
an agent is composing a reply — call `setComposing(true | false)` from your own textarea's input,
blur and submit handlers to send the same signal back.

---

## Anything else (Svelte, Angular, vanilla…)

The core has no framework in it. Mount the packaged widget:

```js
import { mount } from "moharrik-chat"

const chat = mount({ key: "cwk_your_key", apiOrigin: "https://app.moharrik.com" })
chat.open()
```

or drive it yourself with the headless client:

```js
import { createChat } from "moharrik-chat"

const chat = createChat({ key: "cwk_your_key", apiOrigin: "https://app.moharrik.com" })

chat.on("messages", (messages) => render(messages))
chat.on("error", (err) => console.warn(err.kind, err.message))

await chat.send("My order is late")
chat.start()   // poll for replies
chat.stop()    // when your UI closes
```

---

## API

### `createChat(options)` → `ChatClient`

| Option | Default | |
| --- | --- | --- |
| `key` | — | **Required.** The widget key. |
| `apiOrigin` | — | **Required** off the script tag, e.g. `https://app.moharrik.com`. |
| `locale` | `en` | `en` or `ar`. |
| `pollInterval` | `5000` | How often to check for replies, in ms (min 1000). |
| `persist` | `true` | Remember the conversation across reloads (localStorage). |
| `storagePrefix` | `moharrik.chat` | Change it if one page runs two widgets. |
| `visitor` | — | `{ name, email, phone }` attached when the conversation is created. |
| `fetchImpl` | `globalThis.fetch` | Bring your own fetch (tests, SSR). |

`ChatClient`: `send(body)`, `refresh()`, `start()`, `stop()`, `markRead()`, `setComposing(composing)`,
`messages()`, `status()`, `presence()`, `unread()`, `isAgentTyping()`, `isLive()`,
`visitorToken()`, `visitor()`, `setVisitor(v)`, `needsContact()`, `reset()`, `on(event, handler)`,
`destroy()`.

`needsContact()` is true when the widget asks for contact details, no conversation has started and
the visitor so far is not enough. Collect them in your own UI, check them with the exported
`checkVisitor(v)` (returns the field at fault — `"name"`, `"email"`, `"phone"`, `"contact"` — or
`null`), then `setVisitor(v)` and `send(body)`. `setVisitor` remembers them on this browser.

Events: `messages`, `status`, `error`, `conversation`, `config`, `presence`, `unread`, `lead`, `live`,
`agentTyping`.

`setComposing(true)` tells the team this visitor is writing a reply; call it on every keystroke — it
throttles itself to at most one call to the server every ~3s, and sends `false` on its own after ~4s
without another `true`. Call `setComposing(false)` yourself on send and on blur, so the team's view
never shows a stale "typing…" after the visitor has actually stopped.

### `mount(options)` → `ChatWidget`

Everything `createChat` takes, plus `target`, `launcher`, `theme`, `position`, `accent`,
`greeting`, `title`. Returns the client plus `open()`, `close()`, `toggle()`, `isOpen()`,
`unmount()`.

### Errors

`error.kind` is one of:

| kind | means |
| --- | --- |
| `blocked` | This origin is not on the key's allow-list, or the widget is disabled (403). |
| `unknown` | No widget with that key (404). |
| `too_long` | Over the 8,000 character limit. |
| `contact_required` | The widget wants a name and an email or phone first, or one was not valid (422). |
| `network` | The request never reached the server. |
| `server` | The server answered with something else. |

---

## How a conversation works

1. The first `send` creates a conversation and the server returns a **visitor token**.
2. The token is kept in `localStorage`, so a reload (or a return visit) resumes the same thread.
3. While the widget is open it polls for replies; your team answers from Moharrik's Inbox.
4. The visitor only ever sees the thread that token belongs to — never another visitor's, and never
   your team's email addresses.

Set `persist: false` if you would rather every page load start fresh.

---

## Development

```bash
npm install
npm run build      # dist/: ESM + CJS + types, and the script-tag bundle
npm run typecheck
npm test
npm run e2e        # the widget in headless Chrome against a mock API; SHOTS=dir saves screenshots
```

`dist/chat.js` is the file a Moharrik app serves at `/chat/v1.js`. This repo is where it is edited;
the app only serves the build.

MIT © Fady Mondy
