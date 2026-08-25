const { AoiAdapter } = require('./AoiAdapter');

class MockAoiAdapter extends AoiAdapter {
  constructor(deviceCode, config = {}) {
    super(deviceCode, config);
    this._total = 15000; this._ng = 180;
  }
  async connect() { this.connected = true; return Promise.resolve(); }
  async poll() {
    this._total += Math.floor(Math.random() * 5);
    if (Math.random() < 0.04) this._ng++;
    return {
      device_code: this.deviceCode,
      status: 'Scanning',
      total_inspected: this._total,
      total_ok: this._total - this._ng,
      total_ng: this._ng,
      yield_rate_pct: parseFloat(((this._total-this._ng)/this._total*100).toFixed(2)),
      defects: { shift: Math.floor(this._ng*0.3), bridge: Math.floor(this._ng*0.25), insufficient: Math.floor(this._ng*0.2), excess: Math.floor(this._ng*0.15), cold_solder: Math.floor(this._ng*0.1) },
      timestamp: new Date().toISOString(),
    };
  }
}
module.exports = { MockAoiAdapter };
