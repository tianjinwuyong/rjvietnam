/**
 * ConfigStore — 设备适配器配置管理
 * 从 config.yaml 读取设备连接配置，支持多设备
 */

const fs = require('fs');
const path = require('path');

class ConfigStore {
  constructor(configPath = null) {
    this.configPath = configPath || path.join(__dirname, '..', 'config.yaml');
    this.config = this._load();
  }

  _load() {
    try {
      const yaml = require('js-yaml');
      const content = fs.readFileSync(this.configPath, 'utf8');
      return yaml.load(content) || {};
    } catch(e) {
      console.warn(`[ConfigStore] Using defaults: ${e.message}`);
      return { devices: [], settings: {} };
    }
  }

  /** 获取设备配置 */
  getDevice(deviceCode) {
    return (this.config.devices || []).find(d => d.code === deviceCode) || null;
  }

  /** 获取设备列表 */
  getAllDevices() {
    return this.config.devices || [];
  }

  /** 获取全局设置 */
  getSetting(key, defaultValue = null) {
    return this.config.settings?.[key] ?? defaultValue;
  }

  /** 热重载 */
  reload() { this.config = this._load(); }
}

module.exports = { ConfigStore };
