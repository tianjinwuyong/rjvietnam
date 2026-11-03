<script setup lang="ts">
import { onMounted } from 'vue';
import { storeToRefs } from 'pinia';
import { useWmsStore } from '@/stores/wms';
import WmsStatusCard from '@/components/WmsStatusCard.vue';

const store = useWmsStore();
const { health, inventory, loading, error } = storeToRefs(store);

onMounted(() => {
  store.loadHealth();
  store.loadInventory();
});
</script>

<template>
  <section class="dashboard">
    <h1>综合看板</h1>

    <p v-if="error" class="error">⚠️ {{ error }}</p>

    <div class="cards">
      <WmsStatusCard title="WMS 服务状态" :loading="loading">
        <template v-if="health">
          <span class="badge" :class="health.status">{{ health.status }}</span>
          <span v-if="health.uptime" class="meta">
            已运行 {{ Math.floor(health.uptime) }}s
          </span>
        </template>
      </WmsStatusCard>

      <WmsStatusCard title="库存概览" :loading="loading">
        <template v-if="inventory">
          <div class="metric">
            <span class="num">{{ inventory.totalSkus }}</span>
            <span class="label">SKU 数</span>
          </div>
          <div class="metric">
            <span class="num">{{ inventory.totalQty }}</span>
            <span class="label">总库存量</span>
          </div>
          <div class="metric">
            <span class="num warn">{{ inventory.pendingIqc }}</span>
            <span class="label">待检 IQC</span>
          </div>
        </template>
      </WmsStatusCard>
    </div>
  </section>
</template>

<style scoped>
.dashboard h1 {
  font-size: 22px;
  margin-bottom: 16px;
}
.error {
  color: #dc2626;
  margin-bottom: 12px;
}
.cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 16px;
}
.badge {
  display: inline-block;
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 600;
}
.badge.ok,
.badge.up {
  background: #dcfce7;
  color: #166534;
}
.badge.down,
.badge.error {
  background: #fee2e2;
  color: #991b1b;
}
.meta {
  margin-left: 8px;
  color: #64748b;
  font-size: 13px;
}
.metric {
  display: flex;
  flex-direction: column;
  margin: 6px 0;
}
.num {
  font-size: 22px;
  font-weight: 700;
  color: #0f172a;
}
.num.warn {
  color: #d97706;
}
.label {
  font-size: 12px;
  color: #64748b;
}
</style>
