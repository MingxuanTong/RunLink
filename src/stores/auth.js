import { defineStore } from 'pinia'
import { supabase } from '@/lib/supabase'
import { invalidateUserCache } from '@/api'

export const useAuthStore = defineStore('auth', {
  state: () => ({
    session: null,
    user: null,
    ready: false,
  }),

  getters: {
    isAuthenticated: (state) => !!state.session,
    userId: (state) => state.user?.id ?? null,
  },

  actions: {
    async init() {
      const { data } = await supabase.auth.getSession()
      this.session = data.session
      this.user = data.session?.user ?? null
      this.ready = true
    },

    listenToAuthChanges(router) {
      supabase.auth.onAuthStateChange((event, session) => {
        this.session = session
        this.user = session?.user ?? null
        invalidateUserCache()

        if (event === 'SIGNED_IN') {
          router.push('/discover')
        } else if (event === 'SIGNED_OUT') {
          router.push('/login')
        }
      })
    },

    async signOut() {
      const { error } = await supabase.auth.signOut()
      if (error) throw error
    },
  },
})
