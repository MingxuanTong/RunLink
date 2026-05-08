<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import * as api from '@/api'
import { useToast } from '@/composables/useToast'

const router = useRouter()
const { toast } = useToast()

const displayName = ref('')
const email = ref('')
const password = ref('')
const loading = ref(false)
const feedback = ref('')
const feedbackKind = ref('info')

async function handleSignup() {
  feedback.value = ''

  if (!email.value || !password.value) {
    feedbackKind.value = 'warn'
    feedback.value = 'Fill in all fields.'
    return toast('Fill in all fields', { kind: 'warn' })
  }
  if (password.value.length < 6) {
    feedbackKind.value = 'warn'
    feedback.value = 'Password must be at least 6 characters.'
    return toast('Password must be at least 6 characters', { kind: 'warn' })
  }

  loading.value = true
  try {
    const result = await api.signUp({
      email: email.value,
      password: password.value,
      displayName: displayName.value,
    })

    password.value = ''

    if (result.session) {
      feedbackKind.value = 'success'
      feedback.value = 'Account created. Redirecting you now...'
      toast('Account created! You are now signed in.', { kind: 'success' })
      router.replace('/discover')
      return
    }

    feedbackKind.value = 'success'
    feedback.value = 'Account created. Verify your email, then sign in.'
    toast('Account created! Verify your email, then sign in.', { kind: 'success' })
    router.replace('/login')
  } catch (err) {
    feedbackKind.value = 'error'
    feedback.value = err?.message === 'email rate limit exceeded'
      ? 'Too many signup emails were sent recently. Please wait a bit, or disable email confirmation in Supabase and try again.'
      : (err.message || 'Could not create account.')
    toast(err.message, { kind: 'error' })
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="auth-view-content">
    <h2 class="auth-heading">Create account</h2>
    <p class="auth-sub">Join RunLink and start tracking your runs</p>

    <form @submit.prevent="handleSignup">
      <div class="field">
        <label>Display name</label>
        <input v-model="displayName" type="text" placeholder="Your name" />
      </div>
      <div class="field">
        <label>Email</label>
        <input v-model="email" type="email" placeholder="you@example.com" required />
      </div>
      <div class="field">
        <label>Password</label>
        <input v-model="password" type="password" placeholder="Min 6 characters" required minlength="6" />
      </div>
      <button class="btn block" type="submit" :disabled="loading">
        {{ loading ? 'Creating account...' : 'Create account' }}
      </button>
    </form>

    <p v-if="feedback" class="auth-feedback" :class="`is-${feedbackKind}`">
      {{ feedback }}
    </p>

    <p class="auth-switch">
      Already have an account? <router-link to="/login">Sign in</router-link>
    </p>
  </div>
</template>

<style scoped>
.auth-feedback {
  margin-top: 12px;
  font-size: 13px;
  line-height: 1.5;
}

.auth-feedback.is-success { color: #15803d; }
.auth-feedback.is-warn { color: #b45309; }
.auth-feedback.is-error { color: #b91c1c; }
</style>
