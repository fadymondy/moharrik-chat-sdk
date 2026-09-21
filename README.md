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
| `data-launcher` | `true` | `false` hides the floating button — open it yourself. |
| `data-visitor-name`, `data-visitor-email` | — | Attach who this is, if you already know. |

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
  const { messages, send, sending, error } = useMoharrikChat({
    key: "cwk_your_key",
    apiOrigin: "https://app.moharrik.com",
  })

  return (
    <>
      {messages.map((m) => (
        <p key={m.id} className={m.direction === "in" ? "mine" : "theirs"}>{m.body}</p>
      ))}
      {error && <p role="alert">{error.message}</p>}
      <button disabled={sending} onClick={() => send("Hello")}>Send</button>
    </>
  )
}
```

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
const { messages, send, error } = useMoharrikChat({ key: "cwk_…", apiOrigin: "https://app.moharrik.com" })
</script>
```

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
| `visitor` | — | `{ name, email }` attached when the conversation is created. |
| `fetchImpl` | `globalThis.fetch` | Bring your own fetch (tests, SSR). |

`ChatClient`: `send(body)`, `refresh()`, `start()`, `stop()`, `messages()`, `status()`,
`visitorToken()`, `reset()`, `on(event, handler)`, `destroy()`.

Events: `messages`, `status`, `error`, `conversation`.

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
```

`dist/chat.js` is the file a Moharrik app serves at `/chat/v1.js`. This repo is where it is edited;
the app only serves the build.

MIT © Fady Mondy
