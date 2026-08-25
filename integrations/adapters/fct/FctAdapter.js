/**
 * FctAdapter — FCT功能测试适配器
 * Grill: c — 状态+测试结果+良率
 *
 * 适配器工厂: 充电器/适配器 FCT 测试台
 * 协议: TCP私有协议 或 RS232
 *
 * 关键数据:
 * - 测试结果 (Pass/Fail)
 * - 测试项 (输入电压/输出电压/纹波/保护/效率)
 * - 良率
 * - UUT序列号
 */

const { BaseAdapter } = require('../../core/AdapterManager');

const FCT_STATUS = {
  0: 'Idle',        // 待机
  1: 'Testing',     // 测试中
  2: 'Pass',        // 通过
  3: 'Fail',        // 失败
  4: 'Error',       // 设备错误
  5: 'Calibrating', // 校准中
};

const FCT_TEST_ITEMS = [
  'input_voltage',  // 输入电压
  'output_voltage', // 输出电压
  'ripple',         // 纹波
  'ocp',            // 过流保护
  'ovp',            // 过压保护
  'efficiency',     // 效率
  'standby_power',  // 待机功耗
  'hipot',          // 耐压
];

class FctAdapter extends BaseAdapter {
  constructor(deviceCode, config = {}) {
    super(deviceCode, 'fct', config);
    this.host = config.host || '192.168.1.105';
    this.port = config.port || 8082;
    this._lastData = null;
  }

  async connect() {
    return new Promise((resolve, reject) => {
      const net = require('net');
      this.socket = net.createConnection(this.port, this.host);
      this.socket.setTimeout(5000);
      this.socket.on('connect', () => { this.connected = true; console.log(`[FCT:${this.deviceCode}] Connected`); resolve(); });
      this.socket.on('error', (err) => reject(err));
      this.socket.on('timeout', () => { this.socket.destroy(); reject(new Error('FCT timeout')); });
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
      // FCT测试统计 (TCP私有协议)
      // 格式: JSON over TCP: {"cmd":"get_stats"}
      const req = JSON.stringify({ cmd: 'get_stats', device: this.deviceCode });
      const resp = await this._sendRecv(req);
      if (!resp) return null;

      let data;
      try { data = JSON.parse(resp); } catch { return null; }

      const totalTested = data.total_tested || 0;
      const totalPass = data.total_pass || 0;
      const totalFail = data.total_fail || 0;
      const yieldRate = totalTested > 0 ? parseFloat(((totalPass / totalTested) * 100).toFixed(2)) : 100;

      // 提取各测试项数据
      const testResults = {};
      for (const item of FCT_TEST_ITEMS) {
        if (data[item] !== undefined) testResults[item] = data[item];
      }

      const parsed = {
        device_code: this.deviceCode,
        status: FCT_STATUS[data.status] || `Status${data.status}`,
        total_tested: totalTested,
        total_pass: totalPass,
        total_fail: totalFail,
        yield_rate_pct: yieldRate,
        test_results: testResults,
        current_uut_sn: data.uut_sn || null,
        timestamp: new Date().toISOString(),
      };

      if (this._equals(parsed)) return null;
      this._lastData = parsed;
      return parsed;
    } catch(err) {
      console.error(`[FCT:${this.deviceCode}] poll error: ${err.message}`);
      this.connected = false;
      return null;
    }
  }

  _sendRecv(req) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { this.socket.destroy(); reject(new Error('FCT timeout')); }, 5000);
      let data = '';
      const parser = (chunk) => { data += chunk.toString(); try { clearTimeout(timeout); this.socket.removeListener('data', parser); resolve(JSON.parse(data)); } catch {} };
      this.socket.on('data', parser);
      this.socket.write(req + '\n', (err) => { if (err) { clearTimeout(timeout); reject(err); } });
    });
  }

  _equals(d) {
    if (!this._lastData) return false;
    return this._lastData.total_tested === d.total_tested;
  }
}

module.exports = { FctAdapter, FCT_TEST_ITEMS };
