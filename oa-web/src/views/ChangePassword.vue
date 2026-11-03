<script setup>
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus'
import { useAuthStore } from '@/stores/auth'

const auth = useAuthStore()
const router = useRouter()
const { t } = useI18n()

const form = ref({ oldPassword: '', newPassword: '', confirmPassword: '' })
const loading = ref(false)
const errorMsg = ref('')

async function submit() {
  errorMsg.value = ''
  if (form.value.newPassword.length < 8) {
    errorMsg.value = t('changePwd.tooShort')
    return
  }
  if (form.value.newPassword !== form.value.confirmPassword) {
    errorMsg.value = t('changePwd.mismatch')
    return
  }
  loading.value = true
  try {
    await auth.changePassword(form.value.oldPassword, form.value.newPassword)
    ElMessage.success(t('changePwd.success'))
    await auth.logout()
    router.replace({ name: 'login' })
  } catch (e) {
    errorMsg.value = e.message || t('common.error')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="oa-page">
    <div class="oa-card cp-card">
      <h2 class="cp-title">{{ t('changePwd.title') }}</h2>
      <p class="cp-hint oa-muted">{{ t('changePwd.hint') }}</p>

      <el-form label-position="top" @submit.prevent="submit">
        <el-form-item :label="t('common.oldPassword')">
          <el-input v-model="form.oldPassword" type="password" show-password size="large" />
        </el-form-item>
        <el-form-item :label="t('common.newPassword')">
          <el-input v-model="form.newPassword" type="password" show-password size="large" />
        </el-form-item>
        <el-form-item :label="t('common.confirmPassword')">
          <el-input v-model="form.confirmPassword" type="password" show-password size="large" />
        </el-form-item>

        <div v-if="errorMsg" class="cp-error">{{ errorMsg }}</div>

        <el-button type="primary" size="large" :loading="loading" class="cp-btn" @click="submit">
          {{ t('common.submit') }}
        </el-button>
      </el-form>
    </div>
  </div>
</template>

<style scoped>
.cp-card {
  max-width: 420px;
  margin: 40px auto;
  padding: 32px;
}
.cp-title {
  font-size: 20px;
  margin: 0 0 6px;
}
.cp-hint {
  font-size: 13px;
  margin: 0 0 24px;
}
.cp-error {
  color: #dc2626;
  font-size: 13px;
  margin-bottom: 12px;
  padding: 8px 12px;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 8px;
}
.cp-btn {
  width: 100%;
}
</style>
