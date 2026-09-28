/**
 * Vue 3 bindings.
 *
 * As a plugin (widget on every page):
 *
 *   import { createApp } from "vue"
 *   import { MoharrikChatPlugin } from "moharrik-chat/vue"
 *   createApp(App).use(MoharrikChatPlugin, { key: "cwk_…", apiOrigin: "https://app.moharrik.com" })
 *
 * As a component:
 *
 *   <MoharrikChat widget-key="cwk_…" api-origin="https://app.moharrik.com" />
 *
 * Or headless, for your own UI:
 *
 *   const { messages, send } = useMoharrikChat({ key, apiOrigin })
 */

import { defineComponent, onBeforeUnmount, onMounted, ref, shallowRef, type App, type PropType, type Ref } from "vue"

import {
  createChat,
  type ChatError,
  type ChatMessage,
  type ChatOptions,
  type ChatStatus,
  type Locale,
  type Presence,
} from "./core"
import { mount, type ChatWidget, type WidgetOptions } from "./widget"

export type UseMoharrikChat = {
  messages: Ref<ChatMessage[]>
  status: Ref<ChatStatus | null>
  error: Ref<ChatError | null>
  sending: Ref<boolean>
  /** Whether the team is around right now. `null` until the config has loaded. */
  presence: Ref<Presence | null>
  /** Team replies this visitor has not seen yet. */
  unread: Ref<number>
  /** Whether an agent is composing a reply right now. */
  isAgentTyping: Ref<boolean>
  send: (body: string) => Promise<void>
  refresh: () => Promise<void>
  /** Tell the team the visitor has seen their replies. Clears `unread`. */
  markRead: () => Promise<void>
  /** Tell the team this visitor is composing a reply, or has stopped. Throttled; see `ChatClient.setComposing`. */
  setComposing: (composing: boolean) => void
  reset: () => void
}

/** Headless composable: reactive state and actions, no DOM. */
export function useMoharrikChat(options: ChatOptions): UseMoharrikChat {
  const client = createChat(options)
  const messages = ref<ChatMessage[]>([]) as Ref<ChatMessage[]>
  const status = ref<ChatStatus | null>(null) as Ref<ChatStatus | null>
  const error = ref<ChatError | null>(null) as Ref<ChatError | null>
  const sending = ref(false)
  const presence = ref<Presence | null>(null) as Ref<Presence | null>
  const unread = ref(0)
  const isAgentTyping = ref(false)

  const offs = [
    client.on("messages", (m) => (messages.value = m)),
    client.on("status", (s) => (status.value = s)),
    client.on("error", (e) => (error.value = e)),
    client.on("presence", (p) => (presence.value = p)),
    client.on("unread", (n) => (unread.value = n)),
    client.on("agentTyping", (v) => (isAgentTyping.value = v)),
  ]

  onMounted(() => {
    client.start()
    void client.loadConfig()
  })
  onBeforeUnmount(() => {
    for (const off of offs) off()
    client.destroy()
  })

  return {
    messages,
    status,
    error,
    sending,
    presence,
    unread,
    isAgentTyping,
    async send(body: string) {
      sending.value = true
      error.value = null
      try {
        await client.send(body)
      } catch {
        /* surfaced through the error event */
      } finally {
        sending.value = false
      }
    },
    async refresh() {
      await client.refresh()
    },
    async markRead() {
      await client.markRead()
    },
    setComposing(composing: boolean) {
      client.setComposing(composing)
    },
    reset: () => client.reset(),
  }
}

/** The packaged widget as a component. Renders nothing; the widget owns its own shadow root. */
export const MoharrikChat = defineComponent({
  name: "MoharrikChat",
  props: {
    widgetKey: { type: String, required: true },
    apiOrigin: { type: String, required: true },
    locale: { type: String as PropType<Locale>, default: undefined },
    theme: { type: String as PropType<"light" | "dark">, default: undefined },
    position: { type: String as PropType<"start" | "end">, default: undefined },
    accent: { type: String, default: undefined },
    greeting: { type: String, default: undefined },
    title: { type: String, default: undefined },
    launcher: { type: Boolean, default: true },
    defaultOpen: { type: Boolean, default: false },
  },
  emits: ["ready"],
  setup(props, { emit }) {
    const widget = shallowRef<ChatWidget | null>(null)
    onMounted(() => {
      widget.value = mount({
        key: props.widgetKey,
        apiOrigin: props.apiOrigin,
        locale: props.locale,
        theme: props.theme,
        position: props.position,
        accent: props.accent,
        greeting: props.greeting,
        title: props.title,
        launcher: props.launcher,
      })
      if (props.defaultOpen) widget.value.open()
      emit("ready", widget.value)
    })
    onBeforeUnmount(() => {
      widget.value?.unmount()
      widget.value = null
    })
    return () => null
  },
})

export type MoharrikChatPluginOptions = Omit<WidgetOptions, "target">

/**
 * Install the widget once for the whole app. `app.config.globalProperties.$moharrikChat`
 * and `inject("moharrikChat")` both give you the widget, so any component can
 * open it from its own button.
 */
export const MoharrikChatPlugin = {
  install(app: App, options: MoharrikChatPluginOptions) {
    if (typeof window === "undefined") return // SSR: nothing to mount
    const widget = mount(options)
    app.config.globalProperties.$moharrikChat = widget
    app.provide("moharrikChat", widget)
    app.component("MoharrikChat", MoharrikChat)
  },
}

export { createChat, mount } from "./index"
export type { ChatClient, ChatError, ChatMessage, ChatOptions, ChatStatus, Locale, Presence } from "./core"
export type { ChatWidget, WidgetOptions } from "./widget"
