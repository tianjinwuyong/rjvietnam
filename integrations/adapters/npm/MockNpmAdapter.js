/**
 * MockNpmAdapter — NPM贴片机模拟适配器 (测试用)
 * 模拟NPM贴片机的生产数据，无需真实设备连接
 */

const { NpmAdapter } = require('./NpmAdapter');

const MOCK_STATES = ['Running', 'Idle', 'Error', 'Running', 'Running'];

class MockNpmAdapter extends NpmAdapter {
  constructor(deviceCode, config = {}) {
    super(deviceCode, config);
    this._tick = 0;
    this._totalCount = 10000;
    this._ngCount = 15;
    this._cycleTime = 8500; // ms
  }

  async connect() {
    this.connected = true;
    console.log(`[MockNPM:${this.deviceCode}] Mock connected`);
    return Promise.resolve();
  }

  async poll() {
    this._tick++;
    // 模拟运行状态: 大部分时间Running，偶尔Error
    const stateIdx = this._tick % MOCK_STATES.length;
    const status = MOCK_STATES[stateIdx];

    // Running时增加计数
    if (status === 'Running') {
      this._totalCount += Math.floor(Math.random() * 3) + 1;
      this._ngCount += Math.random() < 0.05 ? 1 : 0;
      this._cycleTime = 8000 + Math.floor(Math.random() * 1000);
    }

    return {
      device_code: this.deviceCode,
      status,
      total_count: this._totalCount,
      ok_count: this._totalCount - this._ngCount,
      ng_count: this._ngCount,
      cycle_time_ms: this._cycleTime,
      tact_time_sec: parseFloat((this._cycleTime / 1000).toFixed(3)),
      ng_rate: parseFloat(((this._ngCount / this._totalCount) * 100).toFixed(2)),
      timestamp: new Date().toISOString(),
    };
  }
}

module.exports = { MockNpmAdapter };
