import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import http, { setToken, getToken } from '@/api/client'

const USER_KEY = 'oa_user'

export const useAuthStore = defineStore('auth', () => {
  const token = ref(getToken())
  const user = ref(null)
  const counts = ref({ todo: 0, drafts: 0, cc: 0, notifications: 0 })

  const isLoggedIn = computed(() => !!token.value)
  const isAdmin = computed(() => !!user.value?.isAdmin)
  const permissions = computed(() => user.value?.permissions || [])
  const displayName = computed(
    () => user.value?.real_name || user.value?.username || ''
  )

  function has(perm) {
    return isAdmin.value || permissions.value.includes(perm)
  }

  function hydrate() {
    if (user.value) return
    const raw = localStorage.getItem(USER_KEY)
    if (raw) {
      try {
        user.value = JSON.parse(raw)
      } catch {
        /* ignore */
      }
    }
  }

  async function login(username, password) {
    const data = await http.post('/api/auth/login', { username, password })
    token.value = data.token
    setToken(data.token)
    user.value = data.user
    localStorage.setItem(USER_KEY, JSON.stringify(data.user))
    return data.user
  }

  async function fetchProfile() {
    const data = await http.get('/api/auth/profile')
    user.value = data
    if (data?.counts) counts.value = data.counts
    localStorage.setItem(USER_KEY, JSON.stringify(data))
    return data
  }

  async function changePassword(oldPassword, newPassword) {
    await http.post('/api/auth/password', { oldPassword, newPassword })
  }

  async function logout() {
    try {
      await http.post('/api/auth/logout')
    } catch {
      /* 登出失败也让本地状态失效 */
    }
    token.value = ''
    user.value = null
    counts.value = { todo: 0, drafts: 0, cc: 0, notifications: 0 }
    setToken('')
    localStorage.removeItem(USER_KEY)
  }

  return {
    token, user, counts,
    isLoggedIn, isAdmin, permissions, displayName,
    has, hydrate, login, fetchProfile, changePassword, logout,
  }
})
