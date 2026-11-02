<script setup>
import { computed, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { Fold, Expand, Switch, CaretBottom } from '@element-plus/icons-vue'
import { menu } from '@/config/menu'
import { useAppStore } from '@/stores/app'
import { useAuthStore } from '@/stores/auth'
import http from '@/api/client'

const app = useAppStore()
const auth = useAuthStore()
const route = useRoute()
const router = useRouter()
const { t } = useI18n()

const activeMenu = computed(() =>
  route.path === '/' ? '/' : '/' + route.path.split('/')[1]
)
const pageTitle = computed(() =>
  route.meta?.titleKey ? t(route.meta.titleKey) : t('common.appName')
)
const avatarText = computed(() => (auth.displayName || '?').slice(0, 1).toUpperCase())
const langLabel = computed(
  () => ({ zh: '中文', vi: 'Tiếng Việt', en: 'English' }[app.lang] || '中文')
)

function changeLang(l) {
  app.setLang(l)
  if (auth.isLoggedIn) {
    http.put('/api/auth/language', { language: l }).catch(() => {})
  }
}

async function onUserCommand(cmd) {
  if (cmd === 'password') {
    router.push({ name: 'change-password' })
    return
  }
  if (cmd === 'logout') {
    await auth.logout()
    router.replace({ name: 'login' })
  }
}

onMounted(async () => {
  auth.hydrate()
  try {
    await auth.fetchProfile()
  } catch {
    /* 401 由全局处理 */
  }
})
</script>

<template>
  <el-container class="layout">
    <el-aside :width="app.sidebarCollapsed ? '64px' : '224px'" class="aside">
      <div class="logo">
        <div class="logo-mark">OA</div>
        <span v-show="!app.sidebarCollapsed" class="logo-text">{{ t('common.appName') }}</span>
      </div>
      <el-scrollbar class="menu-scroll">
        <el-menu
          :default-active="activeMenu"
          :collapse="app.sidebarCollapsed"
          :collapse-transition="false"
          router
          background-color="transparent"
          text-color="var(--oa-sidebar-text)"
          active-text-color="var(--oa-sidebar-text-active)"
          class="menu"
        >
          <el-menu-item v-for="item in menu" :key="item.path" :index="item.path">
            <el-icon><component :is="item.icon" /></el-icon>
            <template #title>{{ t(item.titleKey) }}</template>
          </el-menu-item>
        </el-menu>
      </el-scrollbar>
    </el-aside>

    <el-container class="body">
      <el-header class="header">
        <div class="header-left">
          <el-icon class="collapse-btn" @click="app.toggleSidebar()">
            <Fold v-if="!app.sidebarCollapsed" />
            <Expand v-else />
          </el-icon>
          <span class="page-title">{{ pageTitle }}</span>
        </div>

        <div class="header-right">
          <el-dropdown trigger="click" @command="changeLang">
            <span class="header-action">
              <el-icon><Switch /></el-icon>
              <span class="lang-label">{{ langLabel }}</span>
            </span>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="zh">简体中文</el-dropdown-item>
                <el-dropdown-item command="vi">Tiếng Việt</el-dropdown-item>
                <el-dropdown-item command="en">English</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>

          <el-dropdown trigger="click" @command="onUserCommand">
            <span class="header-action user-action">
              <el-avatar :size="28" class="avatar">{{ avatarText }}</el-avatar>
              <span class="user-name">{{ auth.displayName }}</span>
              <el-icon><CaretBottom /></el-icon>
            </span>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item disabled>
                  {{ auth.user?.dept_name || auth.user?.username || '' }}
                </el-dropdown-item>
                <el-dropdown-item command="password" divided>
                  {{ t('common.changePassword') }}
                </el-dropdown-item>
                <el-dropdown-item command="logout">{{ t('common.logout') }}</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </el-header>

      <el-main class="main">
        <router-view v-slot="{ Component }">
          <transition name="fade" mode="out-in">
            <component :is="Component" />
          </transition>
        </router-view>
      </el-main>
    </el-container>
  </el-container>
</template>

<style scoped>
.layout {
  height: 100vh;
}

.aside {
  background: var(--oa-sidebar-bg);
  display: flex;
  flex-direction: column;
  transition: width 0.2s ease;
  overflow: hidden;
}

.logo {
  height: 60px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 16px;
  flex-shrink: 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}
.logo-mark {
  width: 34px;
  height: 34px;
  border-radius: 9px;
  background: linear-gradient(135deg, #3b82f6, #1d4ed8);
  color: #fff;
  font-weight: 700;
  font-size: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.logo-text {
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
}

.menu-scroll {
  flex: 1;
}
.menu {
  border-right: none;
  padding: 8px;
}
.menu :deep(.el-menu-item) {
  height: 44px;
  border-radius: 8px;
  margin-bottom: 4px;
}
.menu :deep(.el-menu-item:hover) {
  background: rgba(255, 255, 255, 0.08);
}
.menu :deep(.el-menu-item.is-active) {
  background: var(--oa-sidebar-active-bg);
  color: #fff;
}

.body {
  min-width: 0;
}

.header {
  height: 60px;
  background: var(--oa-header-bg);
  border-bottom: 1px solid var(--oa-border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
}
.header-left {
  display: flex;
  align-items: center;
  gap: 14px;
}
.collapse-btn {
  font-size: 18px;
  cursor: pointer;
  color: var(--oa-text-secondary);
}
.collapse-btn:hover {
  color: var(--oa-brand);
}
.page-title {
  font-size: 15px;
  font-weight: 600;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 20px;
}
.header-action {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  color: var(--oa-text-secondary);
  font-size: 13px;
  outline: none;
}
.header-action:hover {
  color: var(--oa-brand);
}
.avatar {
  background: var(--oa-brand);
  color: #fff;
  font-size: 13px;
}
.user-name {
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.main {
  padding: 0;
  background: var(--oa-bg);
  overflow-y: auto;
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.15s ease;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
