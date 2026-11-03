import { defineStore } from 'pinia';
import { ref } from 'vue';
import {
  getWmsHealth,
  getInventorySummary,
  type WmsHealth,
  type InventorySummary,
} from '@/api/wms';

export const useWmsStore = defineStore('wms', () => {
  const health = ref<WmsHealth | null>(null);
  const inventory = ref<InventorySummary | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function loadHealth() {
    loading.value = true;
    error.value = null;
    try {
      health.value = await getWmsHealth();
    } catch (e) {
      error.value = e instanceof Error ? e.message : '加载 WMS 状态失败';
    } finally {
      loading.value = false;
    }
  }

  async function loadInventory() {
    loading.value = true;
    error.value = null;
    try {
      inventory.value = await getInventorySummary();
    } catch (e) {
      error.value = e instanceof Error ? e.message : '加载库存概览失败';
    } finally {
      loading.value = false;
    }
  }

  return { health, inventory, loading, error, loadHealth, loadInventory };
});
