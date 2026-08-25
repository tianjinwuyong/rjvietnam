/**
 * NpmAdapter — Panasonic NPM 贴片机适配器
 * Grill: c — 状态+计数+节拍时间+抛料率+吸嘴状态
 * 协议: TCPproprietary (Panasonic IPC-NET 或 CM95 文件共享)
 *
 * NPM关键数据:
 * - 设备状态 (Running/Idle/Error/Maintenance)
 * - 生产计数 (Total/OK/NG)
 * - 节拍时间 (秒/cycle)
 * - 抛料数 (Feeder漏吸/飞达故障)
 * - 吸嘴状态 (真空度/磨损)
 * - 运行时间统计 (TACT time, 待机时间, 故障时间)
 */

const { BaseAdapter } = require('../../core/AdapterManager');
const net = require('net');

const NPM_STATUS = {
  0: 'Idle',      // 待机
  1: 'Running',   // 生产中
  2: 'Error',     // 故障
  3: 'Maintenance', // 维护中
  4: 'Paused',    // 暂停
};

const MACHINE_CODES = ['NPM-01', 'NPM-02', 'NPM-03']; // 越南工厂最多3台贴片机

class NpmAdapter extends BaseAdapter {
  constructor(deviceCode, config = {}) {
    super(deviceCode, 'npm', config);
    this.host = config.host || '192.168.1.101';
    this.port = config.port || 5000;
    this.socket = null;
    this._lastData = null; // 用于变化检测
  }

  /** TCP连接NPM设备 */
  async connect() {
    return new Promise((resolve, reject) => {
      this.socket = net.createConnection(this.port, this.host);
      this.socket.setTimeout(5000);

      this.socket.on('connect', () => {
        this.connected = true;
        console.log(`[NPM:${this.deviceCode}] Connected to ${this.host}:${this.port}`);
        resolve();
      });

      this.socket.on('error', (err) => {
        console.error(`[NPM:${this.deviceCode}] Connection error: ${err.message}`);
        reject(err);
      });

      this.socket.on('timeout', () => {
        this.socket.destroy();
        reject(new Error('Connection timeout'));
      });
    });
  }

  async disconnect() {
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
    this.connected = false;
  }

  /**
   * poll — 采集一次NPM数据
   * @returns {Object|null} 采集数据，变化时返回，非变化时返回null
   *
   * Panasonic NPM通信帧格式 (示例):
   * 发送: STX(0x02) + "IPC01" + CMD(0x30) + LEN + DATA + ETX(0x03) + CRC
   * 返回: 设备状态+计数+节拍时间
   */
  async poll() {
    if (!this.connected) {
      try { await this.connect(); } catch { return null; }
    }

    try {
      const data = await this._sendCommand(this._buildStatusQuery());
      const parsed = this._parse(data);
      if (!parsed) return null;

      // 变化检测: 与上次数据对比，无变化返回null
      if (this._equals(parsed)) {
        return null;
      }
      this._lastData = parsed;
      return parsed;
    } catch(err) {
      console.error(`[NPM:${this.deviceCode}] poll error: ${err.message}`);
      this.connected = false;
      return null;
    }
  }

  /** 构建状态查询命令 (Panasonic IPC-NET) */
  _buildStatusQuery() {
    // CMD 0x30: Status Request
    // STX(2) + "NPM01" + CMD(30) + LEN(00) + ETX(3) + CRC16
    const stx = 0x02;
    const cmd = 0x30;
    const data = Buffer.from([stx, ...Buffer.from('NPM01'), cmd, 0x00, 0x03]);
    const crc = this._crc16(data.slice(1));
    return Buffer.concat([data, Buffer.from([crc >> 8, crc & 0xff])]);
  }

  /** 发送命令并等待响应 */
  _sendCommand(cmd) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.socket.destroy();
        this.connected = false;
        reject(new Error('NPM command timeout'));
      }, 5000);

      const chunks = [];
      this.socket.once('data', (chunk) => {
        clearTimeout(timeout);
        chunks.push(chunk);
        // NPM响应通常一次性发完
        try {
          const buf = Buffer.concat(chunks);
          resolve(buf);
        } catch(e) { reject(e); }
      });

      this.socket.write(cmd, (err) => {
        if (err) { clearTimeout(timeout); reject(err); }
      });
    });
  }

  /** 解析NPM响应数据 */
  _parse(buf) {
    try {
      // 简化解析: 实际NPM协议更复杂，需参照具体型号协议文档
      // 偏移量: 0=STX, 1-4=设备码, 5=状态, 6-9=总计数, 10-13=OK计数, 14-17=NG计数, 18-21=节拍时间, 22=ETX
      if (buf.length < 23) return null;
      const status = NPM_STATUS[buf[5]] || 'Unknown';
      const totalCount = buf.readUInt32BE(6);
      const okCount = buf.readUInt32BE(10);
      const ngCount = buf.readUInt32BE(14);
      const cycleTime = buf.readUInt32BE(18); // 毫秒
      const tactTime = cycleTime / 1000; // 秒

      return {
        device_code: this.deviceCode,
        status,
        total_count: totalCount,
        ok_count: okCount,
        ng_count: ngCount,
        cycle_time_ms: cycleTime,
        tact_time_sec: parseFloat(tactTime.toFixed(3)),
        ng_rate: totalCount > 0 ? parseFloat(((ngCount / totalCount) * 100).toFixed(2)) : 0,
        timestamp: new Date().toISOString(),
      };
    } catch(e) {
      console.error(`[NPM:${this.deviceCode}] Parse error: ${e.message}`);
      return null;
    }
  }

  /** 变化检测 */
  _equals(newData) {
    if (!this._lastData) return false;
    return (
      this._lastData.status === newData.status &&
      this._lastData.total_count === newData.total_count &&
      this._lastData.ng_count === newData.ng_count
    );
  }

  /** CRC16 (Modbus CRC) */
  _crc16(buf) {
    let crc = 0xffff;
    for (const byte of buf) {
      crc ^= byte;
      for (let i = 0; i < 8; i++) {
        crc = (crc >> 1) ^ (crc & 1 ? 0xa001 : 0);
      }
    }
    return crc;
  }
}

module.exports = { NpmAdapter, NPM_STATUS };
