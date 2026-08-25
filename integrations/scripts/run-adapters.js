/**
 * run-adapters.js — 设备适配器启动脚本
 * 用法: node run-adapters.js [mock|prod]
 */

const { AdapterManager } = require('../core/AdapterManager');
const { ConfigStore } = require('../core/ConfigStore');

const mode = process.argv[2] || 'mock';
const manager = new AdapterManager();

async function main() {
  console.log(`[run-adapters] Mode: ${mode}`);

  if (mode === 'mock') {
    // NPM x3
    const { MockNpmAdapter } = require('../adapters/npm');
    for (let i = 1; i <= 3; i++) {
      const a = new MockNpmAdapter(`NPM-0${i}`);
      await a.connect();
      manager.register(a);
    }
    // Reflow x2
    const { MockReflowAdapter } = require('../adapters/reflow');
    for (let i = 1; i <= 2; i++) {
      const a = new MockReflowAdapter(`REFLOW-0${i}`);
      await a.connect();
      manager.register(a);
    }
    // SPI x1
    const { MockSpiAdapter } = require('../adapters/spi');
    const spi = new MockSpiAdapter('SPI-01');
    await spi.connect();
    manager.register(spi);
    // AOI x1
    const { MockAoiAdapter } = require('../adapters/aoi');
    const aoi = new MockAoiAdapter('AOI-01');
    await aoi.connect();
    manager.register(aoi);
    // FCT x1
    const { MockFctAdapter } = require('../adapters/fct');
    const fct = new MockFctAdapter('FCT-01');
    await fct.connect();
    manager.register(fct);

    console.log('[run-adapters] Mock: 3xNPM + 2xReflow + 1xSPI + 1xAOI + 1xFCT');
  } else {
    const configStore = new ConfigStore();
    const devices = configStore.getAllDevices();
    for (const dev of devices) {
      if (!dev.enabled) continue;
      const AdapterClass = getAdapterClass(dev.type);
      if (!AdapterClass) { console.warn(`[run] No adapter: ${dev.type}`); continue; }
      try {
        const adapter = new AdapterClass(dev.code, dev);
        await adapter.connect();
        manager.register(adapter);
      } catch(e) { console.error(`[run] ${dev.code} failed: ${e.message}`); }
    }
  }

  manager.startAll();
  setInterval(() => console.log('[run] Status:', JSON.stringify(manager.status())), 60000);
  process.on('SIGINT', () => { manager.stopAll(); process.exit(0); });
}

function getAdapterClass(type) {
  try {
    switch(type) {
      case 'npm':    return require('../adapters/npm').MockNpmAdapter;
      case 'reflow': return require('../adapters/reflow').MockReflowAdapter;
      case 'spi':    return require('../adapters/spi').MockSpiAdapter;
      case 'aoi':    return require('../adapters/aoi').MockAoiAdapter;
      case 'fct':    return require('../adapters/fct').MockFctAdapter;
      default: return null;
    }
  } catch(e) { return null; }
}

main().catch(console.error);
