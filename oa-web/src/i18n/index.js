import { createI18n } from 'vue-i18n'
import zh from './zh'
import vi from './vi'
import en from './en'

const saved = localStorage.getItem('oa_lang') || 'zh'

const i18n = createI18n({
  legacy: false,
  locale: saved,
  fallbackLocale: 'zh',
  messages: { zh, vi, en },
  // 业务枚举缺失时用中文兜底，避免出现裸 key
  missingWarn: false,
  fallbackWarn: false,
})

export default i18n
