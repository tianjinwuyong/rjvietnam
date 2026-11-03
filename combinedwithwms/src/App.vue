<script setup lang="ts">
import { RouterLink, RouterView } from 'vue-router';

const title = import.meta.env.VITE_APP_TITLE || '瑞晶 WMS 综合前端';
</script>

<template>
  <div class="app-shell">
    <header class="app-header">
      <div class="brand">{{ title }}</div>
      <nav class="app-nav">
        <RouterLink to="/">首页</RouterLink>
        <RouterLink to="/dashboard">看板</RouterLink>
      </nav>
    </header>
    <main class="app-main">
      <RouterView />
    </main>
    <footer class="app-footer">
      combinedwithwms · 与 wms 独立服务对接
    </footer>
  </div>
</template>

<style scoped>
.app-shell {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
}
.app-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
  height: 56px;
  background: #0f172a;
  color: #e2e8f0;
}
.brand {
  font-weight: 700;
  font-size: 16px;
}
.app-nav a {
  color: #cbd5e1;
  margin-left: 18px;
  text-decoration: none;
}
.app-nav a.router-link-active {
  color: #38bdf8;
}
.app-main {
  flex: 1;
  padding: 24px;
}
.app-footer {
  padding: 12px 24px;
  font-size: 12px;
  color: #94a3b8;
  border-top: 1px solid #e2e8f0;
}
</style>
