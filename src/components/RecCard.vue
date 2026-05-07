<script setup>
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import Avatar from './Avatar.vue'

const props = defineProps({
  activity: { type: Object, required: true },
})

const router = useRouter()
const a = computed(() => props.activity)
const cover = computed(() => a.value.cover_url || 'https://images.unsplash.com/photo-1486218119243-13883505764c?w=500&h=300&fit=crop')

function open() {
  router.push(`/activity/${a.value.id}`)
}
</script>

<template>
  <article class="rec-card interactive" @click="open">
    <div class="cover" :style="`background-image:url('${cover}')`"></div>
    <div class="body">
      <div class="title">{{ a.title }}</div>
      <div class="club">
        <Avatar :profile="a.club" size="sm" />
        {{ a.club?.name || 'Club' }}
      </div>
    </div>
  </article>
</template>
