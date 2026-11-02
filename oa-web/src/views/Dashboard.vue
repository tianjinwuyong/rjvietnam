<script setup>
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { List, EditPen, Promotion, Bell } from '@element-plus/icons-vue'
import { useAuthStore } from '@/stores/auth'
import { menu } from '@/config/menu'
import http from '@/api/client'

const { t } = useI18n()
const auth = useAuthStore()
const router = useRouter()

const envInfo = ref(null)

const cards = computed(() => [
  { key: 'todo', label: t('dashboard.todo'), value: auth.counts.todo ?? 0, icon: List, color: '#2563eb', bg: '#eff6ff' },
  { key: 'drafts', label: t('dashboard.drafts'), value: auth.counts.drafts ?? 0, icon: EditPen, color: '#7c3aed', bg: '#f5f3ff' },
  { key: 'cc', label: t('dashboard.cc'), value: auth.counts.cc ?? 0, icon: Promotion, color: '#0891b2', bg: '#ecfeff' },
  { key: 'notifications', label: t('dashboard.notifications'), value: auth.counts.notifications ?? 0, icon: Bell, color: '#ea580c', bg: '#fff7ed' },
])

const quickLinks = computed(() => menu.filter((m) => m.path !== '/'))

const roleText = computed(() => {
  const names = auth.user?.roleNames
  if (Array.isArray(names) && names.length) return names.join(' / ')
  return (auth.user?.roles || []).join(' / ') || '—'
})

onMounted(async () => {
  try {
    await auth.fetchProfile()
  } catch {
    /* ignore */
  }
  try {
    envInfo.value = await http.get('/api/health')
  } catch {
    /* ignore */
  }
})
</script>

<template>
  <div class="oa-page dashboard">
    <div class="hero">
      <div>
        <h1 class="hero-title">
          {{ t('dashboard.greeting') }}，{{ auth.displayName || t('common.welcome') }}
        </h1>
        <p class="hero-sub">{{ t('dashboard.subtitle') }}</p>
      </div>
      <el-tag v-if="envInfo?.env" round effect="plain" type="info">
        {{ t('dashboard.env') }}: {{ envInfo.env }}
      </el-tag>
    </div>

    <div class="stat-grid">
      <div v-for="c in cards" :key="c.key" class="oa-card stat-card">
        <div class="stat-icon" :style="{ background: c.bg, color: c.color }">
          <el-icon :size="22"><component :is="c.icon" /></el-icon>
        </div>
        <div class="stat-body">
          <div class="stat-value">{{ c.value }}</div>
          <div class="stat-label oa-muted">{{ c.label }}</div>
        </div>
      </div>
    </div>

    <div class="panel-grid">
      <div class="oa-card panel">
        <div class="panel-head">
          <span class="panel-title">{{ t('dashboard.quickAccess') }}</span>
        </div>
        <div class="quick-grid">
          <button
            v-for="m in quickLinks"
            :key="m.path"
            class="quick-item"
            @click="router.push(m.path)"
          >
            <el-icon :size="20" class="quick-icon"><component :is="m.icon" /></el-icon>
            <span class="quick-label">{{ t(m.titleKey) }}</span>
          </button>
        </div>
      </div>

      <div class="oa-card panel">
        <div class="panel-head">
          <span class="panel-title">{{ t('dashboard.systemInfo') }}</span>
        </div>
        <ul class="info-list">
          <li>
            <span class="oa-muted">{{ t('dashboard.account') }}</span>
            <span>{{ auth.user?.username || '—' }}</span>
          </li>
          <li>
            <span class="oa-muted">{{ t('dashboard.dept') }}</span>
            <span>{{ auth.user?.dept_name || '—' }}</span>
          </li>
          <li>
            <span class="oa-muted">{{ t('dashboard.roles') }}</span>
            <span class="ellipsis">{{ roleText }}</span>
          </li>
          <li>
            <span class="oa-muted">{{ t('dashboard.env') }}</span>
            <span>{{ envInfo?.env || '—' }}</span>
          </li>
          <li>
            <span class="oa-muted">{{ t('dashboard.rebuild') }}</span>
            <span class="rebuild-text">{{ t('dashboard.rebuildValue') }}</span>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>

<style scoped>
.hero {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
}
.hero-title {
  font-size: 22px;
  font-weight: 700;
  margin: 0 0 6px;
}
.hero-sub {
  margin: 0;
  color: var(--oa-text-secondary);
  font-size: 13px;
}

.stat-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
  margin-bottom: 16px;
}
.stat-card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 18px 20px;
}
.stat-icon {
  width: 46px;
  height: 46px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}
.stat-value {
  font-size: 24px;
  font-weight: 700;
  line-height: 1.1;
}
.stat-label {
  font-size: 12px;
  margin-top: 2px;
}

.panel-grid {
  display: grid;
  grid-template-columns: 1.6fr 1fr;
  gap: 16px;
}
.panel {
  padding: 18px 20px;
}
.panel-head {
  margin-bottom: 16px;
}
.panel-title {
  font-size: 15px;
  font-weight: 600;
}

.quick-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px;
}
.quick-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 14px 8px;
  border: 1px solid var(--oa-border);
  border-radius: 10px;
  background: #fff;
  cursor: pointer;
  transition: all 0.15s ease;
  color: var(--oa-text);
  font-size: 12px;
}
.quick-item:hover {
  border-color: var(--oa-brand);
  background: var(--oa-brand-soft);
  color: var(--oa-brand);
  transform: translateY(-1px);
}
.quick-icon {
  color: var(--oa-brand);
}

.info-list {
  list-style: none;
  padding: 0;
  margin: 0;
}
.info-list li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 10px 0;
  border-bottom: 1px dashed var(--oa-border);
  font-size: 13px;
}
.info-list li:last-child {
  border-bottom: none;
}
.ellipsis {
  max-width: 60%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: right;
}
.rebuild-text {
  max-width: 60%;
  text-align: right;
  color: var(--oa-text-secondary);
}

@media (max-width: 1000px) {
  .stat-grid {
    grid-template-columns: repeat(2, 1fr);
  }
  .panel-grid {
    grid-template-columns: 1fr;
  }
  .quick-grid {
    grid-template-columns: repeat(3, 1fr);
  }
}
</style>
