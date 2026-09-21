<!-- npm install moharrik-chat -->
<script setup>
import { ref } from "vue"
import { MoharrikChat, useMoharrikChat } from "moharrik-chat/vue"

const KEY = "cwk_your_key"
const ORIGIN = "https://app.moharrik.com"

// The packaged widget, opened from your own button.
const widget = ref(null)

// Or your own UI on the headless composable.
const { messages, send, sending, error } = useMoharrikChat({ key: KEY, apiOrigin: ORIGIN })
const text = ref("")

async function submit() {
  await send(text.value)
  text.value = ""
}
</script>

<template>
  <button @click="widget?.open()">Need help?</button>
  <MoharrikChat :widget-key="KEY" :api-origin="ORIGIN" @ready="widget = $event" />

  <section>
    <ul>
      <li v-for="m in messages" :key="m.id" :style="{ textAlign: m.direction === 'in' ? 'end' : 'start' }">
        {{ m.body }}
      </li>
    </ul>
    <p v-if="error" role="alert">{{ error.message }}</p>
    <form @submit.prevent="submit">
      <input v-model="text" placeholder="Write a message…" />
      <button :disabled="sending || !text.trim()">Send</button>
    </form>
  </section>
</template>
