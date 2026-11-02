import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import * as ElementPlusIconsVue from '@element-plus/icons-vue'
import App from './App.vue'
import router from './router'
import i18n from './i18n'
import './styles/index.css'
import { setUnauthorizedHandler } from './api/client'
import { useAuthStore } from './stores/auth'

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)
app.use(router)
app.use(i18n)
app.use(ElementPlus)

for (const [key, comp] of Object.entries(ElementPlusIconsVue)) {
  app.component(key, comp)
}

// 令牌失效 → 清理并跳转登录
setUnauthorizedHandler(() => {
  if (router.currentRoute.value.name !== 'login') {
    router.push({ name: 'login', query: { redirect: router.currentRoute.value.fullPath } })
  }
})

document.documentElement.lang = localStorage.getItem('oa_lang') || 'zh'

app.mount('#app')
