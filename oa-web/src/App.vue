<script setup>
import { computed, watchEffect } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAppStore } from '@/stores/app'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import vi from 'element-plus/es/locale/lang/vi'
import en from 'element-plus/es/locale/lang/en'

const app = useAppStore()
const { locale } = useI18n()

const locales = { zh: zhCn, vi, en }
const elLocale = computed(() => locales[app.lang] || zhCn)

watchEffect(() => {
  locale.value = app.lang
  document.documentElement.lang = app.lang
})
</script>

<template>
  <el-config-provider :locale="elLocale">
    <router-view />
  </el-config-provider>
</template>
