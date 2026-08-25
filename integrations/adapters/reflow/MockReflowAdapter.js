/**
 * MockReflowAdapter — 回流焊模拟适配器
 */
const { ReflowAdapter } = require('./ReflowAdapter');

class MockReflowAdapter extends ReflowAdapter {
  constructor(deviceCode, config = {}) {
    super(deviceCode, config);
    this._tick = 0;
    this._runtime = 360000; // 秒
    this._idle = 86400;
  }

  async connect() {
    this.connected = true;
    return Promise.resolve();
  }

  async poll() {
    this._tick++;
    const states = ['Heating', 'Soaking', 'Reflow', 'Cooling', 'Reflow', 'Soaking'];
    const status = states[this._tick % states.length];
    const actualTemps = ['235', '180', '245', '255', '240', '190', '170', '145'];
    const setTemps = ['230', '180', '250', '250', '240', '190', '170', '150'];

    return {
      device_code: this.deviceCode,
      status,
      zone_count: 8,
      actual_temps_c: actualTemps,
      set_temps_c: setTemps,
      temp_deviation_c: actualTemps.map((a, i) => (parseFloat(a) - parseFloat(setTemps[i])).toFixed(1)),
      conveyor_speed_mm_min: 650 + Math.floor(Math.random() * 50),
      runtime_seconds: this._runtime + this._tick * 30,
      idle_seconds: this._idle,
      timestamp: new Date().toISOString(),
    };
  }
}

module.exports = { MockReflowAdapter };
