<script setup lang="ts">
defineProps<{
  title: string;
  loading?: boolean;
}>();
</script>

<template>
  <div class="card">
    <div class="card-title">{{ title }}</div>
    <div class="card-body">
      <slot />
      <p v-if="loading" class="loading">加载中…</p>
      <p v-if="!$slots.default && !loading" class="empty">暂无数据</p>
    </div>
  </div>
</template>

<style scoped>
.card {
  background: #fff;
  border: 1px solid #e2e8f0;
  border-radius: 12px;
  padding: 16px;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.04);
}
.card-title {
  font-size: 14px;
  font-weight: 600;
  color: #334155;
  margin-bottom: 10px;
}
.loading {
  color: #94a3b8;
  font-size: 13px;
}
.empty {
  color: #cbd5e1;
  font-size: 13px;
}
</style>
