import { defineStore } from 'pinia'
import { ref } from 'vue'

export const useAppStore = defineStore('app', () => {
  const lang = ref(localStorage.getItem('oa_lang') || 'zh')
  const theme = ref(localStorage.getItem('oa_theme') || 'classic')
  const sidebarCollapsed = ref(localStorage.getItem('oa_sidebar') === '1')

  function setLang(l) {
    if (!['zh', 'vi', 'en'].includes(l)) return
    lang.value = l
    localStorage.setItem('oa_lang', l)
    document.documentElement.lang = l
  }
  function setTheme(t) {
    theme.value = t
    localStorage.setItem('oa_theme', t)
  }
  function toggleSidebar() {
    sidebarCollapsed.value = !sidebarCollapsed.value
    localStorage.setItem('oa_sidebar', sidebarCollapsed.value ? '1' : '0')
  }

  return { lang, theme, sidebarCollapsed, setLang, setTheme, toggleSidebar }
})
