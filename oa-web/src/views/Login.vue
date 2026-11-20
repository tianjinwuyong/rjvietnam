<script setup>
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { User, Lock, Switch } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { useAuthStore } from '@/stores/auth'
import { useAppStore } from '@/stores/app'

const auth = useAuthStore()
const app = useAppStore()
const router = useRouter()
const route = useRoute()
const { t } = useI18n()

const form = ref({ username: '', password: '' })
const loading = ref(false)
const errorMsg = ref('')

const langLabel = () => ({ zh: '中文', vi: 'Tiếng Việt', en: 'English' }[app.lang] || '中文')

function changeLang(l) {
  app.setLang(l)
}

async function submit() {
  errorMsg.value = ''
  if (!form.value.username || !form.value.password) {
    errorMsg.value = t('login.empty')
    return
  }
  loading.value = true
  try {
    await auth.login(form.value.username.trim(), form.value.password)
    ElMessage.success(t('common.welcome'))
    const redirect = route.query.redirect
    router.replace(typeof redirect === 'string' && redirect ? redirect : '/')
  } catch (e) {
    errorMsg.value = e.message || t('common.error')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="login-page">
    <div class="brand-panel">
      <div class="brand-inner">
        <div class="brand-logo">OA</div>
        <h1 class="brand-title">{{ t('login.title') }}</h1>
        <p class="brand-sub">{{ t('login.subtitle') }}</p>
        <ul class="brand-points">
          <li>{{ t('modules.flow') }}</li>
          <li>{{ t('modules.attendance') }}</li>
          <li>{{ t('modules.quality') }}</li>
          <li>{{ t('modules.equipment') }}</li>
        </ul>
      </div>
      <div class="brand-footer">{{ t('login.footer') }}</div>
    </div>

    <div class="form-panel">
      <div class="lang-switch">
        <el-dropdown trigger="click" @command="changeLang">
          <span class="lang-trigger">
            <el-icon><Switch /></el-icon>
            {{ langLabel() }}
          </span>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="zh">简体中文</el-dropdown-item>
              <el-dropdown-item command="vi">Tiếng Việt</el-dropdown-item>
              <el-dropdown-item command="en">English</el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>

      <div class="form-box">
        <h2 class="form-title">{{ t('common.login') }}</h2>
        <p class="form-sub oa-muted">{{ t('login.subtitle') }}</p>

        <el-form @submit.prevent="submit">
          <el-input
            v-model="form.username"
            size="large"
            :prefix-icon="User"
            :placeholder="t('login.usernamePlaceholder')"
            autocomplete="username"
            class="field"
            @keyup.enter="submit"
          />
          <el-input
            v-model="form.password"
            size="large"
            type="password"
            show-password
            :prefix-icon="Lock"
            :placeholder="t('login.passwordPlaceholder')"
            autocomplete="current-password"
            class="field"
            @keyup.enter="submit"
          />

          <div v-if="errorMsg" class="error-msg">{{ errorMsg }}</div>

          <el-button
            type="primary"
            size="large"
            class="submit-btn"
            :loading="loading"
            @click="submit"
          >
            {{ t('login.submit') }}
          </el-button>
        </el-form>
      </div>
    </div>
  </div>
</template>

<style scoped>
.login-page {
  display: flex;
  height: 100vh;
  background: #f5f7fb;
}

.brand-panel {
  flex: 1.1;
  background: linear-gradient(150deg, #0f2a4f 0%, #1d4ed8 100%);
  color: #fff;
  padding: 56px 56px 32px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  position: relative;
  overflow: hidden;
}
.brand-panel::after {
  content: '';
  position: absolute;
  width: 420px;
  height: 420px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.06);
  right: -120px;
  bottom: -120px;
}
.brand-inner {
  position: relative;
  z-index: 1;
  max-width: 420px;
}
.brand-logo {
  width: 52px;
  height: 52px;
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.16);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 18px;
  margin-bottom: 28px;
}
.brand-title {
  font-size: 30px;
  margin: 0 0 12px;
  font-weight: 700;
  letter-spacing: 0.5px;
}
.brand-sub {
  font-size: 15px;
  opacity: 0.85;
  margin: 0 0 32px;
}
.brand-points {
  list-style: none;
  padding: 0;
  margin: 0;
}
.brand-points li {
  font-size: 14px;
  opacity: 0.9;
  padding: 8px 0 8px 22px;
  position: relative;
}
.brand-points li::before {
  content: '';
  position: absolute;
  left: 0;
  top: 15px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #93c5fd;
}
.brand-footer {
  font-size: 12px;
  opacity: 0.6;
  position: relative;
  z-index: 1;
}

.form-panel {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
  padding: 32px;
}
.lang-switch {
  position: absolute;
  top: 24px;
  right: 32px;
}
.lang-trigger {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  color: var(--oa-text-secondary);
  font-size: 13px;
}
.form-box {
  width: 100%;
  max-width: 360px;
}
.form-title {
  font-size: 24px;
  margin: 0 0 6px;
}
.form-sub {
  margin: 0 0 28px;
  font-size: 13px;
}
.field {
  margin-bottom: 16px;
}
.error-msg {
  color: #dc2626;
  font-size: 13px;
  margin-bottom: 12px;
  padding: 8px 12px;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 8px;
}
.submit-btn {
  width: 100%;
  margin-top: 4px;
}

@media (max-width: 820px) {
  .brand-panel {
    display: none;
  }
}
</style>
