import { createRouter, createWebHistory } from 'vue-router'
import { getToken } from '@/api/client'
import { menu } from '@/config/menu'

const children = [
  {
    path: '',
    name: 'dashboard',
    component: () => import('@/views/Dashboard.vue'),
    meta: { titleKey: 'nav.workbench' },
  },
  ...menu
    .filter((m) => m.path !== '/')
    .map((m) => {
      const seg = m.path.replace(/^\//, '')
      // 公共盘已实现为真实模块，其余仍为占位页
      const component =
        seg === 'drive'
          ? () => import('@/views/drive/DriveView.vue')
          : () => import('@/views/ModulePlaceholder.vue')
      return {
        path: seg,
        name: seg,
        component,
        meta: {
          titleKey: m.titleKey,
          descKey: m.descKey,
          endpoints: m.endpoints,
          modulePath: m.path,
        },
      }
    }),
  {
    path: 'change-password',
    name: 'change-password',
    component: () => import('@/views/ChangePassword.vue'),
    meta: { titleKey: 'common.changePassword' },
  },
]

const routes = [
  {
    path: '/login',
    name: 'login',
    component: () => import('@/views/Login.vue'),
    meta: { public: true },
  },
  {
    path: '/',
    component: () => import('@/layouts/BasicLayout.vue'),
    children,
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'notfound',
    component: () => import('@/views/NotFound.vue'),
    meta: { public: true },
  },
]

const router = createRouter({
  history: createWebHistory(),
  routes,
})

router.beforeEach((to) => {
  const token = getToken()
  if (!to.meta.public && !token) {
    return { name: 'login', query: { redirect: to.fullPath } }
  }
  if (to.name === 'login' && token) {
    return { name: 'dashboard' }
  }
  return true
})

export default router
