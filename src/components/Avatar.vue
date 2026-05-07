<script setup>
import { computed } from 'vue'
import { initials } from '@/utils/helpers'

const props = defineProps({
  profile: { type: Object, default: null },
  size: { type: String, default: 'md' },
})

const imgUrl = computed(() => props.profile?.avatar_url || props.profile?.crest_url)
const name = computed(() => props.profile?.display_name || props.profile?.name)
const sz = computed(() => props.size === 'sm' ? 'sm' : props.size === 'lg' ? 'lg' : '')
</script>

<template>
  <img v-if="imgUrl" :class="['avatar', sz]" :src="imgUrl" :alt="name || ''" />
  <span v-else :class="['avatar', sz]">{{ initials(name) }}</span>
</template>
