<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { Tools } from '@element-plus/icons-vue'

const route = useRoute()
const { t } = useI18n()

const titleKey = computed(() => route.meta?.titleKey)
const descKey = computed(() => route.meta?.descKey)
const endpoints = computed(() => route.meta?.endpoints || 0)
</script>

<template>
  <div class="oa-page">
    <div class="oa-card ph-wrap">
      <div class="ph-icon">
        <el-icon :size="34"><Tools /></el-icon>
      </div>
      <h2 class="ph-title">{{ titleKey ? t(titleKey) : '' }}</h2>
      <p v-if="descKey" class="ph-desc">{{ t(descKey) }}</p>

      <el-tag type="warning" effect="plain" round class="ph-tag">
        {{ t('placeholder.title') }}
      </el-tag>

      <p class="ph-note">{{ t('placeholder.desc') }}</p>
      <p class="ph-meta">
        {{ t('placeholder.endpoints') }}: <b>{{ endpoints }}</b>
      </p>
      <p class="ph-hint oa-muted">{{ t('placeholder.note') }}</p>
    </div>
  </div>
</template>

<style scoped>
.ph-wrap {
  max-width: 640px;
  margin: 40px auto;
  padding: 48px 40px;
  text-align: center;
}
.ph-icon {
  width: 72px;
  height: 72px;
  border-radius: 18px;
  background: var(--oa-brand-soft);
  color: var(--oa-brand);
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0 auto 20px;
}
.ph-title {
  font-size: 20px;
  margin: 0 0 8px;
}
.ph-desc {
  color: var(--oa-text-secondary);
  font-size: 13px;
  margin: 0 0 18px;
  line-height: 1.7;
}
.ph-tag {
  margin-bottom: 16px;
}
.ph-note {
  font-size: 13px;
  margin: 0 0 6px;
}
.ph-meta {
  font-size: 13px;
  margin: 0 0 10px;
  color: var(--oa-text-secondary);
}
.ph-hint {
  font-size: 12px;
  margin: 0;
}
</style>
