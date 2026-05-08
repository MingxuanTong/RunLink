<script setup>
import { computed } from 'vue'

const props = defineProps({
  show: { type: Boolean, default: false },
  distance: { type: Number, default: null },
  radius: { type: Number, default: 50 },
  accuracy: { type: Number, default: null },
  reason: { type: String, default: '' },
  meetupName: { type: String, default: 'Meetup' },
  activity: { type: Object, default: null },
  checkingIn: { type: Boolean, default: false },
})

const emit = defineEmits(['close', 'retry', 'manual-checkin'])

const hasDistance = computed(() => props.distance != null && props.distance > 0)

const distanceText = computed(() => {
  if (!hasDistance.value) return '--'
  return props.distance < 1000
    ? `${Math.round(props.distance)} m`
    : `${(props.distance / 1000).toFixed(1)} km`
})

const statusClass = computed(() => {
  if (!hasDistance.value) return 'far'
  if (props.distance <= props.radius) return 'close'
  if (props.distance <= props.radius * 3) return 'mid'
  return 'far'
})

const statusMessage = computed(() => {
  if (props.reason === 'gps_error') return 'Could not get your location'
  if (props.reason === 'low_accuracy') return 'Location accuracy is too low'
  if (!hasDistance.value) return 'Unable to determine distance'
  if (props.distance <= props.radius * 1.5) return "You're almost there!"
  if (props.distance <= props.radius * 3) return 'Getting closer'
  return 'Outside check-in range'
})

const progressPercent = computed(() => {
  if (!hasDistance.value) return 0
  const ratio = props.distance / (props.radius * 4)
  return Math.max(5, Math.min(100, Math.round((1 - ratio) * 100)))
})
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="show" class="modal-backdrop" @click.self="emit('close')">
        <div class="checkin-modal" @click.stop>
          <button class="modal-close" @click="emit('close')" aria-label="Close">
            <i class="fa-solid fa-xmark"></i>
          </button>

          <div class="modal-header">
            <div :class="['modal-icon', statusClass]">
              <i class="fa-solid fa-location-crosshairs"></i>
            </div>
            <h3>Not in check-in range</h3>
            <p class="modal-sub">{{ statusMessage }}</p>
          </div>

          <div v-if="hasDistance" class="modal-distance">
            <div :class="['distance-value', statusClass]">{{ distanceText }}</div>
            <div class="distance-label">from {{ meetupName }}</div>
            <div class="progress-bar">
              <div :class="['progress-fill', statusClass]" :style="{ width: progressPercent + '%' }"></div>
            </div>
            <div class="progress-labels">
              <span>{{ radius }} m</span>
              <span>Required range</span>
            </div>
          </div>

          <div v-if="reason === 'low_accuracy' && accuracy" class="modal-info">
            <i class="fa-solid fa-signal"></i>
            <span>GPS accuracy: {{ Math.round(accuracy) }} m (need &lt; 80 m)</span>
          </div>

          <div v-if="reason === 'gps_error'" class="modal-info warn">
            <i class="fa-solid fa-triangle-exclamation"></i>
            <span>{{ accuracy != null ? 'Location unavailable' : 'GPS signal lost' }} — try moving to an open area</span>
          </div>

          <div class="modal-actions">
            <button class="btn ghost block" :disabled="checkingIn" @click="emit('retry')">
              <i :class="checkingIn ? 'fa-solid fa-spinner fa-spin' : 'fa-solid fa-rotate'"></i>
              {{ checkingIn ? 'Locating…' : 'Try again' }}
            </button>
            <button class="btn block" @click="emit('manual-checkin')">
              <i class="fa-solid fa-hand-pointer"></i> Manual check-in
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
