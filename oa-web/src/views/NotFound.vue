<script setup>
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

const { t } = useI18n()
const router = useRouter()
</script>

<template>
  <div class="nf">
    <div class="nf-code">404</div>
    <h2 class="nf-title">{{ t('notFound.title') }}</h2>
    <p class="nf-desc oa-muted">{{ t('notFound.desc') }}</p>
    <el-button type="primary" @click="router.replace('/')">
      {{ t('common.backHome') }}
    </el-button>
  </div>
</template>

<style scoped>
.nf {
  height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  background: var(--oa-bg);
}
.nf-code {
  font-size: 64px;
  font-weight: 800;
  color: var(--oa-brand);
  line-height: 1;
}
.nf-title {
  margin: 0;
  font-size: 20px;
}
.nf-desc {
  margin: 0 0 12px;
  font-size: 13px;
}
</style>
