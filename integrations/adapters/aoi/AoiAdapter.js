/**
 * AoiAdapter — AOI自动光学检测适配器
 * Grill: c — 状态+检测结果+良率
 *
 * 常用设备: Omron VT-W8 / Saki / VI (V Technology)
 * 协议: SMIC 或 TCP私有协议
 *
 * 关键数据:
 * - 检测结果 (OK/NG)
 * - 不良类型 (偏移/桥连/少锡/多锡/假焊/气泡)
 * - 良率
 * - 检测数量
 */

const { BaseAdapter } = require('../../core/AdapterManager');

const AOI_STATUS = {
  0: 'Idle',
  1: 'Scanning',
  2: 'OK',
  3: 'NG',
  4: 'Error',
  5: 'Loading',
};

const AOI_DEFECT_TYPES = [
  'shift',     // 偏移
  'bridge',    // 桥连
  'insufficient', // 少锡
  'excess',    // 多锡
  'cold_solder', // 假焊
  'void',      // 气泡
  'lift',      // 立碑
  'coplanarity', // 共面性
];

class AoiAdapter extends BaseAdapter {
  constructor(deviceCode, config = {}) {
    super(deviceCode, 'aoi', config);
    this.host = config.host || '192.168.1.104';
    this.port = config.port || 8081;
    this._lastData = null;
  }

  async connect() {
    return new Promise((resolve, reject) => {
      const net = require('net');
      this.socket = net.createConnection(this.port, this.host);
      this.socket.setTimeout(5000);
      this.socket.on('connect', () => { this.connected = true; console.log(`[AOI:${this.deviceCode}] Connected`); resolve(); });
      this.socket.on('error', (err) => reject(err));
      this.socket.on('timeout', () => { this.socket.destroy(); reject(new Error('AOI timeout')); });
    });
  }

  async disconnect() {
    if (this.socket) { this.socket.destroy(); this.socket = null; }
    this.connected = false;
  }

  async poll() {
    if (!this.connected) {
      try { await this.connect(); } catch { return null; }
    }
    try {
      // 读取检测统计 (SMIC格式)
      const req = Buffer.from([0x02, 0x02, 0x00, 0x03, 0x00, 0x00]); // CMD=0x02 for AOI
      const crc = this._crc16(req.slice(0, 4));
      req.writeUInt16BE(crc, 4);

      const resp = await this._sendRecv(req);
      if (!resp || resp.length < 20) return null;

      const status = AOI_STATUS[resp[3]] || `Status${resp[3]}`;
      const totalInspected = resp.readUInt32BE(4);
      const totalOK = resp.readUInt32BE(8);
      const totalNG = resp.readUInt32BE(12);
      const defects = {};
      for (let i = 0; i < AOI_DEFECT_TYPES.length; i++) {
        defects[AOI_DEFECT_TYPES[i]] = resp.readUInt16BE(16 + i * 2);
      }
      const yieldRate = totalInspected > 0 ? parseFloat(((totalOK / totalInspected) * 100).toFixed(2)) : 100;

      const parsed = {
        device_code: this.deviceCode,
        status,
        total_inspected: totalInspected,
        total_ok: totalOK,
        total_ng: totalNG,
        yield_rate_pct: yieldRate,
        defects,
        timestamp: new Date().toISOString(),
      };

      if (this._equals(parsed)) return null;
      this._lastData = parsed;
      return parsed;
    } catch(err) {
      console.error(`[AOI:${this.deviceCode}] poll error: ${err.message}`);
      this.connected = false;
      return null;
    }
  }

  _sendRecv(req) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { this.socket.destroy(); reject(new Error('AOI timeout')); }, 5000);
      const chunks = [];
      this.socket.once('data', (c) => { clearTimeout(timeout); chunks.push(c); });
      this.socket.write(req, (err) => { if (err) { clearTimeout(timeout); reject(err); } });
      setTimeout(() => { try { resolve(Buffer.concat(chunks)); } catch(e) { reject(e); } }, 100);
    });
  }

  _crc16(buf) {
    let crc = 0xffff;
    for (const byte of buf) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >> 1) ^ (crc & 1 ? 0xa001 : 0); }
    return crc;
  }

  _equals(d) {
    if (!this._lastData) return false;
    return this._lastData.total_inspected === d.total_inspected;
  }
}

module.exports = { AoiAdapter, AOI_DEFECT_TYPES };
