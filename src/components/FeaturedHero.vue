<script setup>
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { fmtDate } from '@/utils/formatters'
import Avatar from './Avatar.vue'

const props = defineProps({
  activity: { type: Object, required: true },
})

const router = useRouter()
const a = computed(() => props.activity)
const cover = computed(() => a.value.cover_url || 'https://images.unsplash.com/photo-1552674605-db6ffd4facb5?w=900&h=500&fit=crop')

function open() {
  router.push(`/activity/${a.value.id}`)
}
</script>

<template>
  <div
    class="hero-feature"
    role="link"
    tabindex="0"
    @click="open"
    @keydown.enter="open"
    @keydown.space.prevent="open"
  >
    <div class="cover" :style="`background-image:url('${cover}');`"></div>
    <div class="overlay"></div>
    <div class="club-pill">
      <Avatar :profile="a.club" size="sm" />
      {{ a.club?.name || 'Running club' }}
    </div>
    <div class="content">
      <h3>{{ a.title }}</h3>
      <div class="row">
        <span><i class="fa-regular fa-calendar"></i> {{ fmtDate(a.start_at) }}</span>
        <span v-if="a.meetup_name">·</span>
        <span v-if="a.meetup_name"><i class="fa-solid fa-location-dot"></i> {{ a.meetup_name }}</span>
      </div>
      <button class="hero-cta" type="button" @click.stop="open">
        View activity
        <i class="fa-solid fa-arrow-right"></i>
      </button>
    </div>
  </div>
</template>
