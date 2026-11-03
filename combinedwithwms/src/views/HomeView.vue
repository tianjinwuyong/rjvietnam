<script setup lang="ts">
import { useRouter } from 'vue-router';

const router = useRouter();
</script>

<template>
  <section class="home">
    <h1>欢迎使用瑞晶 WMS 综合前端</h1>
    <p>
      本应用是 <strong>combinedwithwms</strong>，与仓库内的
      <code>wms/</code> 独立服务对接，用于聚合 WMS 各业务模块的视图与看板。
    </p>
    <button class="cta" @click="router.push('/dashboard')">
      进入综合看板 →
    </button>
  </section>
</template>

<style scoped>
.home {
  max-width: 720px;
}
.home h1 {
  font-size: 24px;
  margin-bottom: 12px;
}
.home p {
  color: #475569;
  line-height: 1.7;
}
.cta {
  margin-top: 16px;
  padding: 10px 18px;
  border: none;
  border-radius: 8px;
  background: #0ea5e9;
  color: #fff;
  cursor: pointer;
  font-size: 14px;
}
.cta:hover {
  background: #0284c7;
}
</style>
