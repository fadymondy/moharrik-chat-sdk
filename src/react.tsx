/**
 * React bindings.
 *
 *   import { MoharrikChat } from "moharrik-chat/react"
 *   <MoharrikChat widgetKey="cwk_…" apiOrigin="https://app.moharrik.com" />
 *
 * Or build your own UI on the hook:
 *
 *   const { messages, send, error } = useMoharrikChat({ key, apiOrigin })
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { createChat, type ChatError, type ChatMessage, type ChatOptions, type ChatStatus, type Presence } from "./core"
import { mount, type ChatWidget, type WidgetOptions } from "./widget"

export type UseMoharrikChat = {
  messages: ChatMessage[]
  status: ChatStatus | null
  error: ChatError | null
  sending: boolean
  /** Whether the team is around right now. `null` until the config has loaded. */
  presence: Presence | null
  /** Team replies this visitor has not seen yet. */
  unread: number
  /** Whether an agent is composing a reply right now. */
  isAgentTyping: boolean
  send: (body: string) => Promise<void>
  refresh: () => Promise<void>
  /** Tell the team the visitor has seen their replies. Clears `unread`. */
  markRead: () => Promise<void>
  /** Tell the team this visitor is composing a reply, or has stopped. Throttled; see `ChatClient.setComposing`. */
  setComposing: (composing: boolean) => void
  reset: () => void
}

/**
 * The headless hook: state and actions, no DOM. Render it however you like.
 * Polling runs while the hook is mounted; unmounting stops it.
 */
export function useMoharrikChat(options: ChatOptions): UseMoharrikChat {
  const { key, apiOrigin, locale, pollInterval, persist, storagePrefix } = options
  const visitorName = options.visitor?.name
  const visitorEmail = options.visitor?.email
  const visitorPhone = options.visitor?.phone

  const client = useMemo(
    () =>
      createChat({
        key,
        apiOrigin,
        locale,
        pollInterval,
        persist,
        storagePrefix,
        visitor:
          visitorName || visitorEmail || visitorPhone
            ? { name: visitorName, email: visitorEmail, phone: visitorPhone }
            : undefined,
      }),
    [key, apiOrigin, locale, pollInterval, persist, storagePrefix, visitorName, visitorEmail, visitorPhone],
  )

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [status, setStatus] = useState<ChatStatus | null>(null)
  const [error, setError] = useState<ChatError | null>(null)
  const [sending, setSending] = useState(false)
  const [presence, setPresence] = useState<Presence | null>(null)
  const [unread, setUnread] = useState(0)
  const [isAgentTyping, setAgentTyping] = useState(false)

  useEffect(() => {
    const offMessages = client.on("messages", setMessages)
    const offStatus = client.on("status", setStatus)
    const offError = client.on("error", setError)
    const offPresence = client.on("presence", setPresence)
    const offUnread = client.on("unread", setUnread)
    const offAgentTyping = client.on("agentTyping", setAgentTyping)
    client.start()
    void client.loadConfig()
    return () => {
      offMessages()
      offStatus()
      offError()
      offPresence()
      offUnread()
      offAgentTyping()
      client.destroy()
    }
  }, [client])

  const send = useCallback(
    async (body: string) => {
      setSending(true)
      setError(null)
      try {
        await client.send(body)
      } catch {
        /* surfaced through the error event */
      } finally {
        setSending(false)
      }
    },
    [client],
  )

  const refresh = useCallback(async () => {
    await client.refresh()
  }, [client])

  const markRead = useCallback(async () => {
    await client.markRead()
  }, [client])

  const setComposing = useCallback((composing: boolean) => client.setComposing(composing), [client])

  const reset = useCallback(() => client.reset(), [client])

  return { messages, status, error, sending, presence, unread, isAgentTyping, send, refresh, markRead, setComposing, reset }
}

export type MoharrikChatProps = Omit<WidgetOptions, "key" | "target"> & {
  /** The widget key from Moharrik. Named `widgetKey` because `key` is reserved by React. */
  widgetKey: string
  /** Open the panel as soon as it mounts. */
  defaultOpen?: boolean
  /** Receives the widget so you can call open()/close() from your own buttons. */
  onReady?: (widget: ChatWidget) => void
}

/**
 * The packaged widget as a component. It renders nothing itself — the widget
 * attaches to document.body in its own shadow root — so it is safe to put
 * anywhere in your tree, including a layout that re-renders often.
 */
export function MoharrikChat({ widgetKey, defaultOpen, onReady, ...rest }: MoharrikChatProps) {
  const ref = useRef<ChatWidget | null>(null)
  const onReadyRef = useRef(onReady)
  onReadyRef.current = onReady

  // Options are read once per key/origin: remounting the widget on every render
  // would drop the open panel and the visitor's half-typed message.
  const { apiOrigin, locale, theme, position, accent, greeting, title, launcher, pollInterval, persist, storagePrefix } = rest
  const visitorName = rest.visitor?.name
  const visitorEmail = rest.visitor?.email
  const visitorPhone = rest.visitor?.phone

  useEffect(() => {
    if (typeof window === "undefined") return // SSR: mount on the client only
    const widget = mount({
      key: widgetKey,
      apiOrigin,
      locale,
      theme,
      position,
      accent,
      greeting,
      title,
      launcher,
      pollInterval,
      persist,
      storagePrefix,
      visitor:
          visitorName || visitorEmail || visitorPhone
            ? { name: visitorName, email: visitorEmail, phone: visitorPhone }
            : undefined,
    })
    ref.current = widget
    if (defaultOpen) widget.open()
    onReadyRef.current?.(widget)
    return () => {
      widget.unmount()
      ref.current = null
    }
  }, [
    widgetKey,
    apiOrigin,
    locale,
    theme,
    position,
    accent,
    greeting,
    title,
    launcher,
    pollInterval,
    persist,
    storagePrefix,
    visitorName,
    visitorEmail,
    visitorPhone,
    defaultOpen,
  ])

  return null
}

export { createChat, mount } from "./index"
export type { ChatClient, ChatError, ChatMessage, ChatOptions, ChatStatus, Locale, Presence } from "./core"
export type { ChatWidget, WidgetOptions } from "./widget"
