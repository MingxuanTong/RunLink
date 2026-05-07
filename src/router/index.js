import { createRouter, createWebHashHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const routes = [
  {
    path: '/login',
    component: () => import('@/views/LoginView.vue'),
    meta: { auth: false, shell: 'auth' },
  },
  {
    path: '/signup',
    component: () => import('@/views/SignupView.vue'),
    meta: { auth: false, shell: 'auth' },
  },
  {
    path: '/discover',
    component: () => import('@/views/DiscoverView.vue'),
    meta: { auth: true, shell: 'default' },
  },
  {
    path: '/running',
    component: () => import('@/views/RunningView.vue'),
    meta: { auth: true, shell: 'default' },
  },
  {
    path: '/community',
    component: () => import('@/views/CommunityView.vue'),
    meta: { auth: true, shell: 'default' },
  },
  {
    path: '/profile',
    component: () => import('@/views/ProfileView.vue'),
    meta: { auth: true, shell: 'default' },
  },
  {
    path: '/profile/edit',
    component: () => import('@/views/EditProfileView.vue'),
    meta: { auth: true, shell: 'default' },
  },
  {
    path: '/stats',
    component: () => import('@/views/StatsView.vue'),
    meta: { auth: true, shell: 'default' },
  },
  {
    path: '/my-activities',
    component: () => import('@/views/MyActivitiesView.vue'),
    meta: { auth: true, shell: 'default' },
  },
  {
    path: '/clubs',
    component: () => import('@/views/ClubsView.vue'),
    meta: { auth: true, shell: 'default' },
  },
  {
    path: '/activity/:activityId/dashboard',
    component: () => import('@/views/DataDashboardView.vue'),
    meta: { auth: true, shell: 'default' },
    props: true,
  },
  {
    path: '/activity/:id',
    component: () => import('@/views/ActivityView.vue'),
    meta: { auth: true, shell: 'default' },
    props: true,
  },
  {
    path: '/club/:id/manage',
    component: () => import('@/views/ManageClubView.vue'),
    meta: { auth: true, shell: 'default' },
    props: true,
  },
  {
    path: '/club/:clubId/publish',
    component: () => import('@/views/PublishActivityView.vue'),
    meta: { auth: true, shell: 'default' },
    props: true,
  },
  {
    path: '/organizer/dashboard',
    component: () => import('@/views/OrganizerDashboardView.vue'),
    meta: { auth: true, shell: 'default' },
  },
  {
    path: '/',
    redirect: '/discover',
  },
  {
    path: '/:pathMatch(.*)*',
    redirect: '/discover',
  },
]

const router = createRouter({
  history: createWebHashHistory(),
  routes,
})

router.beforeEach((to) => {
  const auth = useAuthStore()

  if (!auth.ready) return false // block navigation until auth init completes

  if (to.meta.auth !== false && !auth.isAuthenticated) {
    return '/login'
  }
  if (to.meta.auth === false && auth.isAuthenticated) {
    return '/discover'
  }
})

export default router
