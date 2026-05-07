<script setup>
import { onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import AppShell from '@/components/AppShell.vue'
import AuthShell from '@/components/AuthShell.vue'

const route = useRoute()
const router = useRouter()
const auth = useAuthStore()

onMounted(async () => {
  await auth.init()
  auth.listenToAuthChanges(router)
  // Trigger initial guard after auth is ready
  router.replace(route.fullPath)
})

// Toggle body classes for full-bleed views
watch(() => route.path, (path) => {
  // run-fullscreen is managed by RunningView via useFullscreenTab
  document.body.classList.toggle('profile-fullscreen',
    path === '/profile' || path === '/profile/edit')
}, { immediate: true })
</script>

<template>
  <div v-if="!auth.ready" class="boot">
    <div class="boot-logo"><i class="fa-solid fa-person-running"></i></div>
    <div class="boot-title">RunLink</div>
    <div class="spinner" aria-hidden="true"></div>
  </div>

  <AuthShell v-else-if="route.meta.shell === 'auth' || !auth.isAuthenticated">
    <router-view v-slot="{ Component }">
      <Transition name="page-fade" mode="out-in">
        <component :is="Component" />
      </Transition>
    </router-view>
  </AuthShell>

  <AppShell v-else>
    <router-view v-slot="{ Component }">
      <Transition name="page-fade" mode="out-in">
        <component :is="Component" />
      </Transition>
    </router-view>
  </AppShell>
</template>
