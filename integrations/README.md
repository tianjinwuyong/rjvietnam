# SMT设备集成适配器

## 概述
SMT贴片设备数据采集适配器框架，将设备数据上送MES系统。

**Grill决策**:
- 架构: B — 统一框架+插件式注册
- 数据: c — 状态+计数+节拍时间+抛料率+吸嘴(各设备关键数据)
- 采集频率: 30秒
- 容错: 内存缓存+checkpoint，进程崩溃最多丢30s数据

## 目录结构

```
integrations/
├── config.yaml              # 设备配置 (IP/端口/协议)
├── core/
│   ├── AdapterManager.js   # 适配器调度器
│   ├── MesBridge.js        # MES数据上送
│   └── ConfigStore.js      # 配置管理
├── adapters/
│   ├── npm/                # Panasonic NPM贴片机
│   ├── reflow/             # 回流焊 (Vitronics/Samsung/Heller)
│   ├── spi/                # SPI锡膏检测 (SII/MIRTECH)
│   ├── aoi/                # AOI光学检测 (Omron/Saki/VI)
│   └── fct/                # FCT功能测试 (适配器工厂)
└── scripts/
    └── run-adapters.js     # 启动脚本
```

## 快速启动

```bash
# Mock模式 (无需真实设备，测试用)
node integrations/scripts/run-adapters.js mock

# 生产模式 (需要config.yaml配置)
node integrations/scripts/run-adapters.js prod
```

Mock模式注册设备:
- 3x NPM贴片机 (NPM-01/02/03)
- 2x 回流焊 (REFLOW-01/02)
- 1x SPI (SPI-01)
- 1x AOI (AOI-01)
- 1x FCT (FCT-01)

## MES API端点

| 设备类型 | 端点 | 主要数据 |
|---------|------|---------|
| npm | POST /api/mes/cycle_time | 状态/计数/节拍/抛料率 |
| reflow | POST /api/mes/runtime_update | 温区温度/链速/运行时间 |
| spi | POST /api/mes/yield | SPI检测结果/良率/不良分布 |
| aoi | POST /api/mes/yield | AOI检测结果/良率/不良分布 |
| fct | POST /api/mes/yield | FCT测试结果/良率/测试项 |

## 设备协议

| 设备 | 协议 | 端口 |
|-----|------|------|
| Panasonic NPM | TCP proprietary (IPC-NET) | 5000 |
| 回流焊 (Vitronics) | Modbus TCP | 502 |
| SPI (SII) | SMIC | 8080 |
| AOI (Omron/Saki) | SMIC | 8081 |
| FCT | TCP JSON | 8082 |

## 适配器实现状态

| 适配器 | 状态 | 协议 | 关键数据 |
|-------|------|------|---------|
| NPM贴片机 | ✅ 已实现 | TCP proprietary | 状态+计数+节拍+抛料 |
| 回流焊 | ✅ 已实现 | Modbus TCP | 温区温度+链速+运行时间 |
| SPI | ✅ 已实现 | SMIC | 检测结果+良率+6种不良 |
| AOI | ✅ 已实现 | SMIC | 检测结果+良率+8种不良 |
| FCT | ✅ 已实现 | TCP JSON | Pass/Fail+8测试项+SN |

## TODO

- [ ] OPC-UA统一采集层 (Vitocs)
- [ ] 波峰焊适配器
- [ ] ICT在线测试适配器
- [ ] 老化测试适配器
- [ ] 耐压测试适配器
- [ ] 设备告警实时推送 (Andon联动)
