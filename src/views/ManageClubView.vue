<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import * as api from '@/api'
import { useToast } from '@/composables/useToast'
import { useModal } from '@/composables/useModal'
import Avatar from '@/components/Avatar.vue'

const route = useRoute()
const router = useRouter()
const { toast } = useToast()
const { confirm } = useModal()

const loading = ref(true)
const club = ref(null)
const members = ref([])
const user = ref(null)

const isOwner = computed(() => club.value?.owner_id === user.value?.id)
const showTransferPicker = ref(false)
const otherMembers = computed(() => members.value.filter(m => m.profile?.id !== user.value?.id))

async function loadData() {
  loading.value = true
  try {
    const id = route.params.id
    const [c, u] = await Promise.all([api.getClub(id), api.getCurrentUser()])
    club.value = c
    user.value = u
    if (c) members.value = await api.listClubMembers(c.id)
  } finally { loading.value = false }
}

async function leaveClub() {
  if (!await confirm({ title: 'Leave this club?', message: "Your past runs and achievements are kept. You can rejoin anytime by registering for an activity or tapping Join on the club page.", confirmText: 'Leave', danger: true })) return
  try {
    await api.leaveClub(route.params.id)
    toast('Left the club', { kind: 'info' })
    router.push('/clubs')
  } catch (err) { toast(err.message, { kind: 'error' }) }
}

async function deleteClub() {
  if (!await confirm({ title: 'Delete this club?', message: 'This cannot be undone. All activities and data will be lost.', confirmText: 'Delete', danger: true })) return
  try {
    await api.deleteClub(route.params.id)
    toast('Club deleted', { kind: 'success' })
    router.push('/clubs')
  } catch (err) { toast(err.message, { kind: 'error' }) }
}

async function transferOwnership(targetMember) {
  showTransferPicker.value = false
  const name = targetMember.profile?.display_name || 'this member'
  if (!await confirm({
    title: `Transfer to ${name}?`,
    message: 'You will become a regular member. This cannot be undone from this page.',
    confirmText: 'Transfer',
    danger: true,
  })) return
  try {
    await api.transferClubOwnership({ clubId: route.params.id, newOwnerId: targetMember.profile?.id })
    toast(`Ownership transferred to ${name}`, { kind: 'success' })
    await loadData()
  } catch (err) { toast(err.message, { kind: 'error' }) }
}

onMounted(loadData)
</script>

<template>
  <div>
    <van-nav-bar title="Manage club" left-arrow @click-left="router.back()" />

    <div v-if="loading"><div class="skeleton" style="height:200px;border-radius:10px"></div></div>

    <template v-else-if="club">
      <div class="card">
        <div style="font-family:var(--font-display);font-size:22px;color:var(--ink-900)">{{ club.name }}</div>
        <div style="color:var(--ink-500);font-size:12px;margin-top:4px">{{ club.description || '' }}</div>
      </div>

      <div class="section-title">
        <h2>Activities</h2>
        <button class="link" @click="router.push(`/club/${club.id}/publish`)">＋ New activity</button>
      </div>

      <div class="section-title"><h2>Members · {{ members.length }}</h2></div>
      <div v-if="members.length">
        <div v-for="m in members" :key="m.profile?.id" class="card card-compact" style="display:flex;align-items:center;gap:10px">
          <Avatar :profile="m.profile" size="sm" />
          <div style="flex:1">
            <div style="font-weight:700;color:var(--ink-900)">{{ m.profile?.display_name }}</div>
            <div style="color:var(--ink-500);font-size:12px">{{ m.role.replace('_',' ') }}</div>
          </div>
        </div>
      </div>
      <div v-else class="empty"><p>No members yet.</p></div>

      <template v-if="isOwner">
        <div class="section-title"><h2>Danger zone</h2></div>
        <button class="btn ghost block" @click="showTransferPicker = true">
          <i class="fa-solid fa-right-left"></i> Transfer ownership
        </button>
        <button class="btn danger block" style="margin-top:8px" @click="deleteClub">
          <i class="fa-solid fa-trash"></i> Delete club
        </button>

        <van-popup v-model:show="showTransferPicker" position="bottom" round style="padding:20px">
          <h3>Transfer ownership to…</h3>
          <p style="color:var(--ink-500);font-size:12px;margin-bottom:12px">Select a member to become the new owner.</p>
          <div v-if="otherMembers.length">
            <button v-for="m in otherMembers" :key="m.profile?.id" class="card interactive" style="display:block;width:100%;text-align:left;border:0;margin-bottom:6px"
              @click="transferOwnership(m)">
              <div style="display:flex;gap:10px;align-items:center">
                <Avatar :profile="m.profile" size="sm" />
                <div style="flex:1">
                  <div style="font-weight:700;color:var(--ink-900)">{{ m.profile?.display_name }}</div>
                  <div style="color:var(--ink-500);font-size:12px">{{ m.role.replace('_',' ') }}</div>
                </div>
                <i class="fa-solid fa-chevron-right" style="color:var(--ink-400)"></i>
              </div>
            </button>
          </div>
          <div v-else class="empty" style="margin-top:6px">
            <p>No other members to transfer to.</p>
          </div>
          <div style="margin-top:14px">
            <button class="btn ghost block" @click="showTransferPicker = false">Cancel</button>
          </div>
        </van-popup>
      </template>
      <template v-else>
        <button class="btn ghost block" style="margin-top:12px" @click="leaveClub">
          <i class="fa-solid fa-right-from-bracket"></i> Leave club
        </button>
      </template>
    </template>

    <div v-else class="empty"><h3>Not found</h3></div>
  </div>
</template>
