const { FctAdapter } = require('./FctAdapter');

class MockFctAdapter extends FctAdapter {
  constructor(deviceCode, config = {}) {
    super(deviceCode, config);
    this._total = 8000; this._fail = 95;
  }
  async connect() { this.connected = true; return Promise.resolve(); }
  async poll() {
    this._total += Math.floor(Math.random() * 3);
    if (Math.random() < 0.06) this._fail++;
    return {
      device_code: this.deviceCode,
      status: 'Testing',
      total_tested: this._total,
      total_pass: this._total - this._fail,
      total_fail: this._fail,
      yield_rate_pct: parseFloat(((this._total-this._fail)/this._total*100).toFixed(2)),
      test_results: { input_voltage: '220V', output_voltage: '12.1V', ripple: '28mV', ocp: '1.52A', efficiency: '88.5%', standby_power: '0.12W' },
      current_uut_sn: 'SN' + Date.now(),
      timestamp: new Date().toISOString(),
    };
  }
}
module.exports = { MockFctAdapter };
