<script setup>
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { fmtDate, fmtTime, timeUntil } from '@/utils/formatters'
import Avatar from './Avatar.vue'

const props = defineProps({
  activity: { type: Object, required: true },
  wide: { type: Boolean, default: false },
})

const router = useRouter()
const a = computed(() => props.activity)

const isPast = computed(() => new Date(a.value.end_at) < new Date())
const timeLabel = computed(() => {
  if (isPast.value) return fmtDate(a.value.end_at, { withTime: false })
  const s = new Date(a.value.start_at)
  return `${s.toLocaleDateString('en',{month:'short',day:'numeric'})} · ${fmtTime(a.value.start_at)} → ${fmtTime(a.value.end_at)}`
})
const until = computed(() => !isPast.value && new Date(a.value.start_at) > new Date() ? timeUntil(a.value.start_at) : '')
const coverStyle = computed(() => a.value.cover_url
  ? `background-image:url('${a.value.cover_url}');background-size:cover;background-position:center;`
  : '')

function open() {
  router.push(`/activity/${a.value.id}`)
}
</script>

<template>
  <article
    :class="['card', 'activity-card', { wide }, 'interactive']"
    role="link"
    tabindex="0"
    @click="open"
    @keydown.enter="open"
    @keydown.space.prevent="open"
  >
    <div class="cover" :style="coverStyle"></div>
    <div class="info">
      <div class="title">{{ a.title }}</div>
      <div class="meta">
        <span v-if="a.club"><i class="fa-regular fa-flag"></i>{{ a.club.name }}</span>
        <span><i class="fa-regular fa-calendar"></i>{{ timeLabel }}</span>
      </div>
      <div class="meta" style="margin-top:2px">
        <span v-if="a.meetup_name" class="chip ghost">
          <i class="fa-solid fa-location-dot"></i>{{ a.meetup_name }}
        </span>
        <span v-if="until" class="chip brand">{{ until }}</span>
        <span v-if="a.status === 'cancelled'" class="chip danger">Cancelled</span>
        <slot name="badge" />
        <slot name="fullChip" />
      </div>
    </div>
    <slot name="actions" />
  </article>
</template>
