import {
  HomeFilled, Share, Files, Reading, Clock, Money, School, Box,
  Odometer, FolderOpened, Calendar, OfficeBuilding, Setting, DataAnalysis,
} from '@element-plus/icons-vue'

// 顶层导航（每个域一个入口）。endpoints 为该域后端可用接口大致数量（来自 API 契约提取）。
export const menu = [
  { path: '/', titleKey: 'nav.workbench', icon: HomeFilled, descKey: 'modules.workbench', endpoints: 9 },
  { path: '/flows', titleKey: 'nav.flow', icon: Share, descKey: 'modules.flow', endpoints: 34 },
  { path: '/docs', titleKey: 'nav.docs', icon: Files, descKey: 'modules.docs', endpoints: 49 },
  { path: '/knowledge', titleKey: 'nav.knowledge', icon: Reading, descKey: 'modules.knowledge', endpoints: 93 },
  { path: '/attendance', titleKey: 'nav.attendance', icon: Clock, descKey: 'modules.attendance', endpoints: 58 },
  { path: '/salary', titleKey: 'nav.salary', icon: Money, descKey: 'modules.salary', endpoints: 58 },
  { path: '/training', titleKey: 'nav.training', icon: School, descKey: 'modules.training', endpoints: 34 },
  { path: '/equipment', titleKey: 'nav.equipment', icon: Box, descKey: 'modules.equipment', endpoints: 93 },
  { path: '/quality', titleKey: 'nav.quality', icon: Odometer, descKey: 'modules.quality', endpoints: 46 },
  { path: '/drive', titleKey: 'nav.drive', icon: FolderOpened, descKey: 'modules.drive', endpoints: 26 },
  { path: '/meeting', titleKey: 'nav.meeting', icon: Calendar, descKey: 'modules.meeting', endpoints: 52 },
  { path: '/org', titleKey: 'nav.org', icon: OfficeBuilding, descKey: 'modules.org', endpoints: 45 },
  { path: '/system', titleKey: 'nav.system', icon: Setting, descKey: 'modules.system', endpoints: 45 },
  { path: '/stats', titleKey: 'nav.stats', icon: DataAnalysis, descKey: 'modules.stats', endpoints: 34 },
]
