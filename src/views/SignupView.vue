<script setup>
import { ref } from 'vue'
import * as api from '@/api'
import { useToast } from '@/composables/useToast'

const { toast } = useToast()

const displayName = ref('')
const email = ref('')
const password = ref('')
const loading = ref(false)

async function handleSignup() {
  if (!email.value || !password.value) return toast('Fill in all fields', { kind: 'warn' })
  if (password.value.length < 6) return toast('Password must be at least 6 characters', { kind: 'warn' })
  loading.value = true
  try {
    await api.signUp({ email: email.value, password: password.value, displayName: displayName.value })
    toast('Account created! Check your email for verification.', { kind: 'success' })
  } catch (err) {
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
        {{ loading ? 'Creating account…' : 'Create account' }}
      </button>
    </form>

    <p class="auth-switch">
      Already have an account? <router-link to="/login">Sign in</router-link>
    </p>
  </div>
</template>
