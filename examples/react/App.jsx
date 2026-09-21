// npm install moharrik-chat
import { useState } from "react"
import { MoharrikChat, useMoharrikChat } from "moharrik-chat/react"

const KEY = "cwk_your_key"
const ORIGIN = "https://app.moharrik.com"

/** The packaged widget, opened from your own button. */
export function WithWidget() {
  const [chat, setChat] = useState(null)
  return (
    <>
      <button onClick={() => chat?.open()}>Need help?</button>
      <MoharrikChat widgetKey={KEY} apiOrigin={ORIGIN} onReady={setChat} />
    </>
  )
}

/** Or your own UI on the headless hook. */
export function OwnUI() {
  const { messages, send, sending, error } = useMoharrikChat({ key: KEY, apiOrigin: ORIGIN })
  const [text, setText] = useState("")

  return (
    <section>
      <ul>
        {messages.map((m) => (
          <li key={m.id} style={{ textAlign: m.direction === "in" ? "end" : "start" }}>
            {m.body}
          </li>
        ))}
      </ul>
      {error ? <p role="alert">{error.message}</p> : null}
      <form
        onSubmit={(e) => {
          e.preventDefault()
          send(text).then(() => setText(""))
        }}
      >
        <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Write a message…" />
        <button disabled={sending || !text.trim()}>Send</button>
      </form>
    </section>
  )
}
