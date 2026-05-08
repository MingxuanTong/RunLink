<script setup>
import { computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useToast } from '@/composables/useToast'
import { useModal } from '@/composables/useModal'

const { toast } = useToast()
const { confirm } = useModal()

const router = useRouter()
const route = useRoute()
const auth = useAuthStore()

const tabs = [
  { path: '/discover', icon: 'fa-compass', label: 'Discover' },
  { path: '/running', icon: 'fa-person-running', label: 'Running' },
  { path: '/community', icon: 'fa-people-group', label: 'Community' },
  { path: '/profile', icon: 'fa-user', label: 'Profile' },
]

const activeTab = computed(() => {
  const top = '/' + route.path.split('/')[1]
  return tabs.find(t => t.path === top)?.path ?? '/discover'
})

const pageTitle = computed(() => {
  const top = '/' + route.path.split('/')[1]
  return tabs.find(t => t.path === top)?.label ?? 'RunLink'
})

const showBack = computed(() => {
  const top = '/' + route.path.split('/')[1]
  return !tabs.some(t => t.path === top)
})

const hideHeader = computed(() => showBack.value)

function navigateTo(path) {
  router.push(path)
}

async function handleLogout() {
  if (!await confirm({ title: 'Log out of RunLink?', message: 'You can sign back in anytime.', confirmText: 'Log out', danger: true })) return
  await auth.signOut()
  toast('Logged out')
}
</script>

<template>
  <div :class="['app', { 'no-header': hideHeader }]">
    <!-- Desktop side-nav -->
    <aside class="side-nav" aria-label="Primary navigation">
      <div class="brand">
        <div class="logo" aria-hidden="true"><i class="fa-solid fa-person-running"></i></div>
        <div>
          <div class="brand-name">RunLink</div>
          <div class="brand-tag">Running Club Companion</div>
        </div>
      </div>
      <nav class="nav-list">
        <a
          v-for="t in tabs"
          :key="t.path"
          :class="{ active: activeTab === t.path }"
          @click="navigateTo(t.path)"
        >
          <i :class="`fa-solid ${t.icon}`"></i>
          <span>{{ t.label }}</span>
        </a>
      </nav>
      <div class="nav-footer">
        <button class="ghost-btn" type="button" @click="handleLogout">
          <i class="fa-solid fa-right-from-bracket"></i> Log out
        </button>
      </div>
    </aside>

    <!-- Mobile top bar -->
    <header v-if="!hideHeader" class="app-header" aria-label="Page header">
      <button
        v-if="showBack"
        class="icon-btn back-btn"
        type="button"
        aria-label="Back"
        @click="router.back()"
      >
        <i class="fa-solid fa-chevron-left"></i>
      </button>
      <div class="app-header-title">{{ pageTitle }}</div>
      <div v-if="showBack" style="width:32px"></div>
    </header>

    <!-- Desktop page heading -->
    <header v-if="!hideHeader" class="desktop-page-head" aria-label="Page heading">
      <button
        v-if="showBack"
        class="icon-btn neutral back-btn"
        type="button"
        aria-label="Back"
        @click="router.back()"
      >
        <i class="fa-solid fa-chevron-left"></i>
      </button>
      <h1 class="desktop-page-title">{{ pageTitle }}</h1>
    </header>

    <!-- Main content -->
    <main class="view" aria-live="polite" tabindex="-1">
      <slot />
    </main>

    <!-- Mobile bottom tabs -->
    <van-tabbar :model-value="activeTab" @change="navigateTo">
      <van-tabbar-item
        v-for="t in tabs"
        :key="t.path"
        :name="t.path"
        :icon="t.icon.replace('fa-solid fa-', '')"
      >
        {{ t.label }}
        <template #icon>
          <i :class="`fa-solid ${t.icon}`"></i>
        </template>
      </van-tabbar-item>
    </van-tabbar>
  </div>
</template>
