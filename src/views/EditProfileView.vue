<script setup>
import { ref, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import * as api from '@/api'
import { useToast } from '@/composables/useToast'
import { MAX_UPLOAD_BYTES, DEFAULT_PROFILE_COVER_URL } from '@/utils/shared-helpers'
import Avatar from '@/components/Avatar.vue'

const router = useRouter()
const { toast } = useToast()

const loading = ref(true)
const profile = ref(null)
const user = ref(null)

const displayName = ref('')
const bio = ref('')
const avatarUrl = ref(null)
const coverUrl = ref(null)
const saving = ref(false)

const coverPreview = ref('')

function onCoverChange(e) {
  const file = e.target.files?.[0]
  if (!file) return
  if (file.size > MAX_UPLOAD_BYTES) {
    toast(`Cover image must be <= ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))} MB`, { kind: 'warn' })
    e.target.value = ''
    return
  }
  coverPreview.value = URL.createObjectURL(file)
}

function onAvatarChange(e) {
  const file = e.target.files?.[0]
  if (!file) return
  if (file.size > MAX_UPLOAD_BYTES) {
    toast(`Avatar must be <= ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))} MB`, { kind: 'warn' })
    e.target.value = ''
    return
  }
  toast(`Selected avatar: ${file.name}`)
}

async function handleSave() {
  saving.value = true
  try {
    const coverInput = document.getElementById('cover-file-input')
    const avatarInput = document.getElementById('avatar-file-input')
    const coverFile = coverInput?.files?.[0] || null
    const avatarFile = avatarInput?.files?.[0] || null

    if (coverFile) {
      const upload = await api.uploadActivityAsset(coverFile, { folder: 'profile-covers' })
      coverUrl.value = upload.publicUrl
    }
    if (avatarFile) {
      const upload = await api.uploadActivityAsset(avatarFile, { folder: 'profile-avatars' })
      avatarUrl.value = upload.publicUrl
    }

    await api.updateMyProfile({
      display_name: displayName.value.trim(),
      avatar_url: avatarUrl.value,
      cover_url: coverUrl.value,
      bio: bio.value.trim() || null,
    })
    toast('Profile updated', { kind: 'success' })
    router.push('/profile')
  } catch (err) {
    toast(err.message, { kind: 'error' })
  } finally {
    saving.value = false
  }
}

onMounted(async () => {
  try {
    const [p, u] = await Promise.all([api.getMyProfile(), api.getCurrentUser()])
    profile.value = p
    user.value = u
    displayName.value = p?.display_name || ''
    bio.value = p?.bio || ''
    avatarUrl.value = p?.avatar_url || null
    coverUrl.value = p?.cover_url || null
  } finally {
    loading.value = false
  }
})
</script>

<template>
  <div>
    <van-nav-bar title="Edit profile" left-arrow @click-left="router.back()" />

    <div v-if="loading" class="card"><div class="skeleton" style="height:300px;border-radius:10px"></div></div>

    <form v-else @submit.prevent="handleSave">
      <!-- Cover banner -->
      <div class="edit-banner" :style="`background-image:url('${coverPreview || coverUrl || DEFAULT_PROFILE_COVER_URL}')`">
        <button class="change-cover" type="button" @click="$refs.coverInput.click()">
          <i class="fa-solid fa-camera"></i> Change cover
        </button>
      </div>
      <input ref="coverInput" id="cover-file-input" type="file" accept="image/png,image/jpeg,image/webp,image/gif" style="display:none" @change="onCoverChange" />

      <!-- Avatar -->
      <div class="av-holder">
        <Avatar :profile="profile" size="lg" />
        <button class="edit" type="button" @click="$refs.avatarInput.click()">
          <i class="fa-solid fa-pen"></i>
        </button>
      </div>
      <input ref="avatarInput" id="avatar-file-input" type="file" accept="image/png,image/jpeg,image/webp,image/gif" style="display:none" @change="onAvatarChange" />

      <!-- Form fields -->
      <div class="section-head">Profile</div>
      <div class="field-group">
        <div class="field-row">
          <span class="label">Name</span>
          <input v-model="displayName" required minlength="2" maxlength="40" placeholder="Your display name" />
        </div>
        <div class="field-row vertical">
          <span class="label">Bio</span>
          <textarea v-model="bio" maxlength="240" placeholder="Tell your crew a little about you…"></textarea>
        </div>
      </div>

      <div class="section-head">Account</div>
      <div class="field-group">
        <div class="field-row">
          <span class="label">Email</span>
          <input :value="user?.email || ''" disabled />
        </div>
        <div class="field-row">
          <span class="label">User ID</span>
          <input :value="(user?.id || '').slice(0, 8) + '…'" disabled style="font-family:ui-monospace,SFMono-Regular,Consolas,monospace" />
        </div>
      </div>

      <div class="edit-save-bar">
        <button class="btn block" type="submit" :disabled="saving" style="height:48px;font-size:16px">
          <i class="fa-solid fa-floppy-disk"></i> {{ saving ? 'Saving…' : 'Save changes' }}
        </button>
      </div>
    </form>
  </div>
</template>
