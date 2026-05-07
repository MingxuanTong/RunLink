<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import * as api from '@/api'
import { useToast } from '@/composables/useToast'

const router = useRouter()
const { toast } = useToast()

const email = ref('')
const password = ref('')
const loading = ref(false)

async function handleLogin() {
  if (!email.value || !password.value) return toast('Fill in all fields', { kind: 'warn' })
  loading.value = true
  try {
    await api.signIn({ email: email.value, password: password.value })
    // Auth state change listener in store handles navigation
  } catch (err) {
    toast(err.message, { kind: 'error' })
  } finally {
    loading.value = false
  }
}

function fillDemo() {
  email.value = 'demo@runlink.test'
  password.value = 'Demo12345!'
}
</script>

<template>
  <div class="auth-view-content">
    <h2 class="auth-heading">Welcome back</h2>
    <p class="auth-sub">Sign in to your RunLink account</p>

    <form @submit.prevent="handleLogin">
      <div class="field">
        <label>Email</label>
        <input v-model="email" type="email" placeholder="you@example.com" required />
      </div>
      <div class="field">
        <label>Password</label>
        <input v-model="password" type="password" placeholder="Your password" required />
      </div>
      <button class="btn block" type="submit" :disabled="loading">
        {{ loading ? 'Signing in…' : 'Sign in' }}
      </button>
    </form>

    <button class="btn ghost block" @click="fillDemo" style="margin-top:8px">
      Use demo account
    </button>

    <p class="auth-switch">
      Don't have an account? <router-link to="/signup">Sign up</router-link>
    </p>
  </div>
</template>
