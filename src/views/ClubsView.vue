<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import * as api from '@/api'
import { useToast } from '@/composables/useToast'
import { readFileAsDataUrl, MAX_UPLOAD_BYTES } from '@/utils/shared-helpers'
import Avatar from '@/components/Avatar.vue'

const router = useRouter()
const { toast } = useToast()

const loading = ref(true)
const activeTab = ref('mine')
const allClubs = ref([])
const mineIds = ref(new Set())
const user = ref(null)

const CHINA_CITY_TIMEZONE = {
  Beijing: 'Asia/Shanghai', Shanghai: 'Asia/Shanghai', Guangzhou: 'Asia/Shanghai',
  Shenzhen: 'Asia/Shanghai', Hangzhou: 'Asia/Shanghai', Nanjing: 'Asia/Shanghai',
  Suzhou: 'Asia/Shanghai', Chengdu: 'Asia/Shanghai', Chongqing: 'Asia/Shanghai',
  Wuhan: 'Asia/Shanghai', XiAn: 'Asia/Shanghai', Tianjin: 'Asia/Shanghai',
  Qingdao: 'Asia/Shanghai', Xiamen: 'Asia/Shanghai', Zhengzhou: 'Asia/Shanghai',
  Changsha: 'Asia/Shanghai', Ningbo: 'Asia/Shanghai', Hefei: 'Asia/Shanghai',
}

const filteredClubs = computed(() => {
  if (activeTab.value === 'mine') return allClubs.value.filter(c => mineIds.value.has(c.id))
  return allClubs.value
})

// Create club form state
const newClub = ref({
  name: '', description: '', city: 'Shanghai', visibility: 'public',
})
const crestFile = ref(null)
const crestPreview = ref('')
const creating = ref(false)
const joiningId = ref(null)

async function loadData() {
  loading.value = true
  try {
    const [u, clubs] = await Promise.all([api.getCurrentUser(), api.listClubs()])
    user.value = u
    allClubs.value = clubs
    const { supabase } = await import('@/lib/supabase')
    const { data } = await supabase.from('club_members').select('club_id').eq('user_id', u.id)
    mineIds.value = new Set((data ?? []).map(m => m.club_id))
  } finally {
    loading.value = false
  }
}

async function joinClub(id) {
  joiningId.value = id
  try {
    await api.joinClub(id)
    toast('Joined', { kind: 'success' })
    await loadData()
  } catch (err) {
    toast(err.message, { kind: 'error' })
  } finally {
    joiningId.value = null
  }
}

function openClub(id) {
  // Store active club id and navigate to community
  router.push({ path: '/community', query: { club: id } })
}

function onCrestChange(e) {
  const file = e.target.files?.[0]
  if (!file) { crestFile.value = null; crestPreview.value = ''; return }
  if (file.size > MAX_UPLOAD_BYTES) {
    toast(`Avatar must be <= ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))} MB`, { kind: 'warn' })
    e.target.value = ''
    return
  }
  crestFile.value = file
  crestPreview.value = file.name
}

async function createClub() {
  if (!newClub.value.name.trim()) return toast('Club name is required', { kind: 'warn' })
  creating.value = true
  try {
    let crestUrl = null
    if (crestFile.value) {
      const upload = await api.uploadActivityAsset(crestFile.value, { folder: 'club-crests' })
      crestUrl = upload.publicUrl
    }
    const club = await api.createClub({
      name: newClub.value.name.trim(),
      description: newClub.value.description.trim() || null,
      crest_url: crestUrl,
      timezone: CHINA_CITY_TIMEZONE[newClub.value.city] || 'Asia/Shanghai',
      visibility: newClub.value.visibility,
    })
    toast(`Club "${club.name}" created`, { kind: 'success' })
    newClub.value = { name: '', description: '', city: 'Shanghai', visibility: 'public' }
    crestFile.value = null
    crestPreview.value = ''
    activeTab.value = 'mine'
    await loadData()
  } catch (err) {
    toast(err.message, { kind: 'error' })
  } finally {
    creating.value = false
  }
}

onMounted(loadData)
</script>

<template>
  <div>
    <van-nav-bar title="Clubs" left-arrow @click-left="router.back()" />

    <div class="tabs-pill">
      <button :class="['pill-tab', { active: activeTab === 'mine' }]" @click="activeTab = 'mine'">My clubs</button>
      <button :class="['pill-tab', { active: activeTab === 'all' }]" @click="activeTab = 'all'">Browse</button>
      <button :class="['pill-tab', { active: activeTab === 'new' }]" @click="activeTab = 'new'">＋ Create</button>
    </div>

    <!-- Club list -->
    <template v-if="activeTab !== 'new'">
      <div v-if="loading">
        <div v-for="n in 3" :key="n" class="card"><div class="skeleton" style="height:72px;border-radius:10px"></div></div>
      </div>
      <template v-else-if="filteredClubs.length">
        <article v-for="c in filteredClubs" :key="c.id" class="card" style="display:flex;gap:12px;align-items:center">
          <Avatar :profile="c" size="md" />
          <div style="flex:1;min-width:0">
            <div style="font-family:var(--font-display);font-size:20px;color:var(--ink-900)">{{ c.name }}</div>
            <div style="color:var(--ink-500);font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ c.description || '' }}</div>
          </div>
          <button v-if="mineIds.has(c.id)" class="btn ghost sm" @click="openClub(c.id)">Open</button>
          <button v-else class="btn sm" :disabled="joiningId === c.id" @click="joinClub(c.id)">{{ joiningId === c.id ? 'Joining…' : 'Join' }}</button>
        </article>
      </template>
      <div v-else class="empty">
        <i class="fa-solid fa-people-group"></i>
        <p>{{ activeTab === 'mine' ? "You haven't joined any clubs yet. Browse below." : 'No clubs here yet.' }}</p>
      </div>
    </template>

    <!-- Create club form -->
    <form v-else class="card" @submit.prevent="createClub">
      <div class="field">
        <label>Club name</label>
        <input v-model="newClub.name" required minlength="2" maxlength="60" />
      </div>
      <div class="field">
        <label>Description</label>
        <textarea v-model="newClub.description" maxlength="240" placeholder="When, where, and what you run."></textarea>
      </div>
      <div class="field">
        <label>Club avatar</label>
        <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" @change="onCrestChange" />
        <div class="hint" style="margin-top:8px">{{ crestPreview || 'No avatar selected.' }}</div>
      </div>
      <div class="field">
        <label>City (China)</label>
        <select v-model="newClub.city">
          <option v-for="city in Object.keys(CHINA_CITY_TIMEZONE)" :key="city" :value="city">
            {{ city === 'XiAn' ? "Xi'an" : city }}
          </option>
        </select>
      </div>
      <div class="field">
        <label>Visibility</label>
        <select v-model="newClub.visibility">
          <option value="public">Public — anyone can find it</option>
          <option value="private">Private — invite-only</option>
        </select>
      </div>
      <button class="btn block" type="submit" :disabled="creating">
        <i class="fa-solid fa-plus"></i> {{ creating ? 'Creating…' : 'Create' }}
      </button>
    </form>
  </div>
</template>
