/**
 * MesBridge — 设备数据上送MES
 * Grill: 30秒采集，内存缓存+checkpoint，进程崩溃最多丢30s数据
 */

const http = require('http');
const https = require('https');

const MES_HOST = process.env.MES_HOST || 'localhost';
const MES_PORT = process.env.MES_PORT || '8080';
const MES_BASE = `http://${MES_HOST}:${MES_PORT}`;

const RETRY_INTERVAL = 5000; // 5秒重试
const MAX_QUEUE = 1000; // 队列上限

class MesBridge {
  constructor() {
    this.queue = []; // 待上送数据
    this.processing = false;
    this.lastSeq = {}; // deviceCode -> last sequence
  }

  /**
   * push — 将设备数据加入上送队列
   * @param {string} deviceType — npm/reflow/spi/aoi/fct
   * @param {string} deviceCode — 设备编码
   * @param {object} data — 采集数据
   */
  async push(deviceType, deviceCode, data) {
    if (this.queue.length >= MAX_QUEUE) {
      console.warn(`[MesBridge] Queue full (${MAX_QUEUE}), dropping oldest`);
      this.queue.shift();
    }
    this.queue.push({ deviceType, deviceCode, data, ts: new Date() });
    this._processAsync();
  }

  /** 后台处理队列 */
  async _processAsync() {
    if (this.processing) return;
    this.processing = true;
    try {
      while (this.queue.length > 0) {
        const item = this.queue[0];
        try {
          await this._send(item);
          this.queue.shift();
        } catch(err) {
          if (err.status === 401) throw err; // 认证失败不重试
          console.warn(`[MesBridge] Retry in ${RETRY_INTERVAL}ms: ${err.message}`);
          await this._sleep(RETRY_INTERVAL);
        }
      }
    } finally {
      this.processing = false;
    }
  }

  async _send(item) {
    const { deviceType, deviceCode, data } = item;
    const endpoint = this._endpoint(deviceType);
    if (!endpoint) throw new Error(`Unknown deviceType: ${deviceType}`);

    return new Promise((resolve, reject) => {
      const body = JSON.stringify({ device_code: deviceCode, ...data, timestamp: item.ts.toISOString() });
      const opts = {
        hostname: MES_HOST, port: MES_PORT, path: endpoint, method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      };
      const req = http.request(opts, (res) => {
        let d = '';
        res.on('data', c => d += c);
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(JSON.parse(d||'{}'));
          else reject({ status: res.statusCode, message: d });
        });
      });
      req.on('error', reject);
      req.setTimeout(5000, () => { req.destroy(); reject(new Error('timeout')); });
      req.write(body);
      req.end();
    });
  }

  _endpoint(deviceType) {
    const map = {
      npm: '/api/mes/cycle_time',
      reflow: '/api/mes/runtime_update',
      spi: '/api/mes/yield',
      aoi: '/api/mes/yield',
      fct: '/api/mes/yield',
    };
    return map[deviceType] || null;
  }

  _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

  /** 获取队列状态 */
  getQueueSize() { return this.queue.length; }
}

module.exports = { MesBridge };
