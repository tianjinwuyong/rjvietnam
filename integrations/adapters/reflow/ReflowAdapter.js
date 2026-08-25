/**
 * ReflowAdapter — 回流焊适配器
 * Grill: c — 状态+温度曲线+节拍时间
 *
 * 越南工厂常用: Vitronics Delta / Samsung MSP-300 / Heller 1800EXL
 * 协议: Modbus TCP (常用) 或 RS485/TCP
 *
 * 关键数据:
 * - 设备状态 (Idle/Heating/Soaking/Reflow/Cooling/Error)
 * - 温区温度 (通常6-10个温区)
 * - 链速 (传输速度 mm/min)
 * - 运行时间/待机时间/故障时间
 * - 温度曲线偏差 (实际 vs 设定)
 */

const { BaseAdapter } = require('../../core/AdapterManager');
const net = require('net');

const REFLOW_STATUS = {
  0: 'Idle',       // 待机
  1: 'Heating',    // 升温
  2: 'Soaking',    // 恒温
  3: 'Reflow',     // 回流
  4: 'Cooling',    // 冷却
  5: 'Error',      // 故障
  6: 'Standby',    // 预热待机
};

// Modbus功能码
const MODBUS_FUNC = {
  READ_HOLDING: 0x03,
  READ_INPUT: 0x04,
};

class ReflowAdapter extends BaseAdapter {
  constructor(deviceCode, config = {}) {
    super(deviceCode, 'reflow', config);
    this.host = config.host || '192.168.1.102';
    this.port = config.port || 502; // Modbus TCP default
    this.socket = null;
    this._lastData = null;
    this._zoneCount = config.zone_count || 8; // 默认8温区
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.socket = net.createConnection(this.port, this.host);
      this.socket.setTimeout(5000);
      this.socket.on('connect', () => {
        this.connected = true;
        console.log(`[Reflow:${this.deviceCode}] Connected ${this.host}:${this.port}`);
        resolve();
      });
      this.socket.on('error', (err) => {
        console.error(`[Reflow:${this.deviceCode}] error: ${err.message}`);
        reject(err);
      });
      this.socket.on('timeout', () => {
        this.socket.destroy();
        reject(new Error('Modbus connection timeout'));
      });
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
      // 读取保持寄存器 (功能码0x03)
      // 寄存器映射 (示例, 实际地址查设备手册):
      // 0x0000: 设备状态 (1寄存器)
      // 0x0001-0x0008: 温区1-8实际温度 (8寄存器, 温度×10 如 2450=245.0°C)
      // 0x0010-0x0017: 温区1-8设定温度 (8寄存器)
      // 0x0020: 链速 mm/min (1寄存器)
      // 0x0021: 运行时间 秒 (2寄存器, uint32)
      // 0x0023: 待机时间 秒 (2寄存器)
      const status = await this._readHolding(0x0000, 1);
      const actualTemps = await this._readHolding(0x0001, this._zoneCount);
      const setTemps = await this._readHolding(0x0010, this._zoneCount);
      const conveyorSpeed = await this._readHolding(0x0020, 1);
      const runtime = await this._readHolding(0x0021, 2);
      const idletime = await this._readHolding(0x0023, 2);

      const parsed = {
        device_code: this.deviceCode,
        status: REFLOW_STATUS[status[0]] || `Status${status[0]}`,
        zone_count: this._zoneCount,
        actual_temps_c: actualTemps.map(t => (t / 10).toFixed(1)), // 温度×10
        set_temps_c: setTemps.map(t => (t / 10).toFixed(1)),
        temp_deviation_c: actualTemps.map((a, i) => ((a - setTemps[i]) / 10).toFixed(1)),
        conveyor_speed_mm_min: conveyorSpeed[0] || 0,
        runtime_seconds: (runtime[0] | (runtime[1] << 16)),
        idle_seconds: (idletime[0] | (idletime[1] << 16)),
        timestamp: new Date().toISOString(),
      };

      if (this._equals(parsed)) return null;
      this._lastData = parsed;
      return parsed;
    } catch(err) {
      console.error(`[Reflow:${this.deviceCode}] poll error: ${err.message}`);
      this.connected = false;
      return null;
    }
  }

  /** 读取保持寄存器 */
  _readHolding(addr, count) {
    return new Promise((resolve, reject) => {
      // Modbus TCP 请求帧
      // [TransactionID(2) + ProtocolID(2) + Length(2) + UnitID(1) + FuncCode(1) + StartAddr(2) + Count(2)]
      const txnId = Math.floor(Math.random() * 65535);
      const bodyLen = 6; // unit+func+addr(2)+count(2)
      const req = Buffer.alloc(12 + bodyLen);
      req.writeUInt16BE(txnId, 0);       // Transaction ID
      req.writeUInt16BE(0, 2);            // Protocol ID = 0 (Modbus)
      req.writeUInt16BE(bodyLen, 4);       // Length
      req.writeUInt8(1, 6);               // Unit ID
      req.writeUInt8(MODBUS_FUNC.READ_HOLDING, 7); // Func code 0x03
      req.writeUInt16BE(addr, 8);         // Start address
      req.writeUInt16BE(count, 10);       // Quantity

      const timeout = setTimeout(() => {
        this.socket.destroy();
        reject(new Error('Modbus timeout'));
      }, 5000);

      const chunks = [];
      this.socket.once('data', (chunk) => {
        clearTimeout(timeout);
        chunks.push(chunk);
        try {
          const buf = Buffer.concat(chunks);
          // 响应: [TxnID(2)+Proto(2)+Len(2)+Unit(1)+Func(1)+ByteCount(1)+Data(N)]
          if (buf.length < 9 + count * 2) throw new Error('Modbus response too short');
          const byteCount = buf[8];
          const data = [];
          for (let i = 0; i < count; i++) {
            data.push(buf.readUInt16BE(9 + i * 2));
          }
          resolve(data);
        } catch(e) { reject(e); }
      });
      this.socket.write(req, (err) => { if (err) { clearTimeout(timeout); reject(err); } });
    });
  }

  _equals(newData) {
    if (!this._lastData) return false;
    return this._lastData.status === newData.status &&
           this._lastData.runtime_seconds === newData.runtime_seconds;
  }
}

module.exports = { ReflowAdapter, REFLOW_STATUS };
