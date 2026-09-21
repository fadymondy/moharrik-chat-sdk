/**
 * moharrik-chat — the main entry point.
 *
 * Framework-agnostic: use `mount` for the packaged widget, or `createChat` for
 * the headless client and bring your own UI. React and Vue bindings live at
 * `moharrik-chat/react` and `moharrik-chat/vue`.
 */

export { createChat, ChatError } from "./core"
export type { ChatClient, ChatEvents, ChatMessage, ChatOptions, ChatStatus, ChatErrorKind, Locale } from "./core"
export { mount } from "./widget"
export type { ChatWidget, WidgetOptions } from "./widget"
