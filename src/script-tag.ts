/**
 * The <script> build. This is what Moharrik serves at /chat/v1.js.
 *
 *   <script src="https://app.moharrik.com/chat/v1.js" data-key="cwk_…" defer></script>
 *
 * It reads its options off its own tag and mounts the widget for you. The API
 * origin comes from the script's own `src`, so a plain HTML install never has
 * to be told where the app lives — and the Origin the browser sends is the
 * customer's site, which is what the key's allow-list is checked against.
 *
 * Everything is also exposed on `window.MoharrikChat`, so a page can open the
 * panel from its own button: `MoharrikChat.open()`.
 */

import { mount, type ChatWidget } from "./widget"
import { createChat, type Locale } from "./core"

declare global {
  interface Window {
    MoharrikChat?: ChatWidget & { mount: typeof mount; createChat: typeof createChat }
  }
}

function boot() {
  const el =
    (document.currentScript as HTMLScriptElement | null) ??
    (document.querySelector("script[data-key][src*='chat']") as HTMLScriptElement | null)
  if (!el) return

  const key = el.getAttribute("data-key")
  if (!key) {
    console.warn("[moharrik-chat] no data-key on the script tag")
    return
  }

  const apiOrigin = el.getAttribute("data-api-origin") ?? new URL(el.src, location.href).origin
  const attr = (name: string) => el.getAttribute(name) ?? undefined
  const localeAttr = (attr("data-locale") ?? document.documentElement.lang ?? "en").slice(0, 2).toLowerCase()

  const widget = mount({
    key,
    apiOrigin,
    locale: (localeAttr === "ar" ? "ar" : "en") as Locale,
    theme: attr("data-theme") as "light" | "dark" | undefined,
    position: attr("data-position") as "start" | "end" | undefined,
    accent: attr("data-accent"),
    greeting: attr("data-greeting"),
    greetingAr: attr("data-greeting-ar"),
    title: attr("data-title"),
    titleAr: attr("data-title-ar"),
    // The attributes are a copy of the widget's settings taken when the
    // snippet was copied: they paint the first frame, and the settings in
    // Moharrik win once they arrive, so an old snippet stays current.
    prefer: "server",
    launcher: el.getAttribute("data-launcher") !== "false",
    visitor: { name: attr("data-visitor-name"), email: attr("data-visitor-email") },
  })

  window.MoharrikChat = Object.assign(widget, { mount, createChat })
}

// `defer` scripts run after parsing, but a plain <script> in <head> can run
// before <body> exists — mount() needs a body to attach to.
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true })
else boot()
