<script setup>
import { ref, computed, onMounted } from 'vue'
import { useRouter } from 'vue-router'
import * as api from '@/api'
import { fmtDate, fmtDistance, fmtDuration, fmtPace } from '@/utils/formatters'

const router = useRouter()
const loading = ref(true)
const runs = ref([])

onMounted(async () => {
  try {
    runs.value = await api.listMyRuns({ limit: 200 })
  } finally {
    loading.value = false
  }
})

const totalM = computed(() => runs.value.reduce((s, r) => s + (r.distance_m || 0), 0))
const totalS = computed(() => runs.value.reduce((s, r) => s + (r.duration_s || 0), 0))
const avgPace = computed(() => totalM.value ? Math.round((totalS.value * 1000) / totalM.value) : null)
const longest = computed(() => runs.value.reduce((a, b) => (b.distance_m > a.distance_m ? b : a), { distance_m: 0 }))
</script>

<template>
  <div>
    <van-nav-bar title="My stats" left-arrow @click-left="router.back()" />

    <div v-if="loading">
      <div v-for="n in 3" :key="n" class="card"><div class="skeleton" style="height:72px;border-radius:10px"></div></div>
    </div>

    <template v-else-if="runs.length">
      <div class="stat-grid">
        <div class="stat"><div class="v">{{ runs.length }}</div><div class="l">Runs</div></div>
        <div class="stat"><div class="v">{{ (totalM/1000).toFixed(1) }}</div><div class="l">Total km</div></div>
        <div class="stat"><div class="v">{{ fmtDuration(totalS) }}</div><div class="l">Total time</div></div>
        <div class="stat"><div class="v">{{ fmtPace(avgPace) }}</div><div class="l">Avg pace</div></div>
      </div>

      <div class="section-title"><h2>Longest run</h2></div>
      <div class="card">
        <div style="font-family:var(--font-display);font-size:28px;color:var(--ink-900)">{{ fmtDistance(longest.distance_m) }}</div>
        <div style="color:var(--ink-500);font-size:12px">{{ fmtDate(longest.started_at) }} · {{ fmtDuration(longest.duration_s) }} · {{ fmtPace(longest.avg_pace_s_per_km) }}</div>
      </div>

      <div class="section-title"><h2>Recent</h2><span class="count">{{ runs.length }} total</span></div>
      <div>
        <div v-for="r in runs.slice(0, 20)" :key="r.id" class="card card-compact">
          <div style="display:flex;align-items:center;gap:10px">
            <div style="width:40px;height:40px;border-radius:10px;background:var(--brand-soft);display:flex;align-items:center;justify-content:center;color:var(--brand)">
              <i class="fa-solid fa-person-running"></i>
            </div>
            <div style="flex:1">
              <div style="font-weight:700;color:var(--ink-900)">{{ fmtDistance(r.distance_m) }} · {{ fmtDuration(r.duration_s) }}</div>
              <div style="color:var(--ink-500);font-size:12px">{{ fmtDate(r.started_at) }} · {{ fmtPace(r.avg_pace_s_per_km) }}{{ r.activity_id ? ' · linked activity' : ' · free run' }}</div>
            </div>
          </div>
        </div>
      </div>
    </template>

    <div v-else class="empty">
      <i class="fa-solid fa-chart-line"></i>
      <h3>No runs recorded</h3>
      <p>Your runs will appear here once you finish one.</p>
    </div>
  </div>
</template>
