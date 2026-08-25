/**
 * AdapterManager — 设备适配器统一调度器
 * Grill: B统一框架+插件注册, 30秒采集, 内存缓存+checkpoint
 */

const { MesBridge } = require('./MesBridge');
const { ConfigStore } = require('./ConfigStore');

class AdapterManager {
  constructor() {
    this.adapters = new Map();
    this.mesBridge = new MesBridge();
    this.configStore = new ConfigStore();
    this.interval = 30000; // 30秒
    this.handles = new Map();
    this.checkpointData = new Map();
    this.stats = new Map();
  }

  register(adapter) {
    if (!(adapter instanceof BaseAdapter)) throw new Error('Adapter must extend BaseAdapter');
    this.adapters.set(adapter.deviceCode, adapter);
    this.stats.set(adapter.deviceCode, { ok: 0, fail: 0, lastTs: null });
    console.log(`[AdapterManager] Registered: ${adapter.deviceCode} (${adapter.deviceType})`);
  }

  startAll() {
    for (const [code, adapter] of this.adapters) {
      this._startAdapter(code, adapter);
    }
    console.log(`[AdapterManager] Started ${this.adapters.size} adapters`);
  }

  stopAll() {
    for (const [, handle] of this.handles) clearInterval(handle);
    this.handles.clear();
  }

  _startAdapter(code, adapter) {
    const run = async () => {
      try {
        const data = await adapter.poll();
        if (data) {
          await this.mesBridge.push(adapter.deviceType, adapter.deviceCode, data);
          const s = this.stats.get(code);
          s.ok++; s.lastTs = new Date();
          this.checkpointData.set(code, { ts: new Date(), seq: (this.checkpointData.get(code)?.seq||0)+1, data });
        }
      } catch(err) {
        this.stats.get(code).fail++;
        console.error(`[AdapterManager] ${code} error: ${err.message}`);
      }
    };
    run();
    const handle = setInterval(run, this.interval);
    this.handles.set(code, handle);
  }

  status() {
    const r = {};
    for (const [code, stat] of this.stats) r[code] = { ...stat, running: this.handles.has(code) };
    return r;
  }

  getCheckpoint(code) { return this.checkpointData.get(code) || null; }
}

class BaseAdapter {
  constructor(deviceCode, deviceType, config = {}) {
    this.deviceCode = deviceCode; this.deviceType = deviceType;
    this.config = config; this.connected = false;
  }
  async connect() { throw new Error('Not implemented'); }
  async disconnect() { this.connected = false; }
  async poll() { throw new Error('Not implemented'); }
}

module.exports = { AdapterManager, BaseAdapter };
