# ICT / FCT / Depanel 手动线 — Grill Session Notes

> grill-me 方法逐个决策，全部D（全功能），不分阶段一次全做

---

## 12个决策结论

### Q1 ✅ 目标范围
**D — 全功能（3D视觉+数据流+功能补全），不分阶段一次全做**

### Q2 ✅ 分阶段
**D — 不分阶段，一次全做**

### Q3 ✅ Depanel独立3D场景
**D — B+C全做**
- DepanelScene3D组件（PCB治具+V-Cut刀+传送带+分板后产品滑槽）
- 真实数据绑定（router bit使用次数+分板方法+panelsCount）

### Q4 ✅ ICT 3D增强
**D — B+C全做**
- ICT治具托盘可视化（12个探针接触点+已测/未测颜色）
- 实时探针下压动画

### Q5 ✅ FCT 3D增强
**D — B+C全做**
- FCT测试夹具可视化（12通道夹具+安全门状态）
- 测试过程动画（推入→夹具闭合→测试→结果灯）

### Q6 ✅ SSE实时推送
**D — B+C全做**
- 接入已有 /api/pda/events 和 /api/station/events
- 新建 /api/station/sse/:stationCode 工位级SSE端点

### Q7 ✅ SPC统计过程控制
**D — B+C全做**
- PassRate趋势图（每小时/班次）
- 不良项帕累托图（Top3不良代码+占比）
- CPK能力指数

### Q8 ✅ 设备OEE/稼动率
**D — C + Andon**
- OEE三率：可用率×性能率×质量率，各工位独立
- 设备状态灯（运行中/空闲/NG维修/待料）
- Andon推送到看板

### Q9 ✅ Depanel NG合并后路由
**D — C + CAPA + 邮件**
- ICT_ONLY_NG → 维修站
- FCT_ONLY_NG → FCT复测
- ICT+FCT_NG → 维修 + 8D报告
- 超过阈值自动触发CAPA
- 邮件通知组长

### Q10 ✅ Depanel合并逻辑处理
**D — C + DepanelMergeEngine**
- DepanelMergePanel.tsx（独立组件，ICT+FCT合并+母板布局+路由）
- DepanelMergeEngine.ts（纯函数引擎，输入ICT+FCT records，输出合并母板+NG分类）

### Q11 ✅ Depanel NG迁移维修工单
**D — C + NG超时升级**
- /api/station/maintenance-handovers/depanel 专用端点（批量+来源标记）
- NG超时自动升级（超时→班长→工程师+邮件）

### Q12 ✅ 文件组织
**D — 全独立 + 共享模块**
- IctStationMonitor.tsx（独立ICT）
- FctStationMonitor.tsx（独立FCT）
- DepanelStationMonitor.tsx（独立Depanel，含3D场景）
- DepanelMergeEngine.ts（纯函数引擎）
- SPCPanel.tsx（共用SPC面板）
- OeePanel.tsx（共用OEE面板）

---

## 实施清单

### 新增文件
1. `src/mes/DepanelScene3D.tsx` — Depanel独立3D场景（V-Cut刀+治具+滑槽）
2. `src/mes/IctScene3D.tsx` — ICT 3D增强版（治具托盘+探针动画）
3. `src/mes/FctScene3D.tsx` — FCT 3D增强版（夹具+安全门+测试动画）
4. `src/mes/DepanelMergeEngine.ts` — Depanel合并纯函数引擎
5. `src/mes/DepanelMergePanel.tsx` — Depanel合并UI组件
6. `src/mes/SPCPanel.tsx` — 共用SPC面板（趋势+帕累托+CPK）
7. `src/mes/OeePanel.tsx` — 共用OEE面板
8. `src/mes/DepanelStationMonitor.tsx` — 重写Depanel独立监控（替换6行wrapper）
9. `src/mes/FctStationMonitor.tsx` — 重写FCT独立监控（替换6行wrapper）

### 修改文件
1. `src/mes/IctStationMonitor.tsx` — 集成IctScene3D + SPCPanel + OeePanel + SSE
2. `src/mes/FctStationMonitor.tsx` — 集成FctScene3D + SPCPanel + OeePanel + SSE
3. `src/mes/DepanelStationMonitor.tsx` — 集成DepanelScene3D + DepanelMergePanel + OeePanel + SSE
4. `src/mes/ManualLineDashboard.tsx` — 移除Depanel合并逻辑（5726行减负）
5. `services/api/server.js` — 新增 /api/station/sse/:stationCode 端点
6. `services/api/server.js` — 新增 /api/station/maintenance-handovers/depanel 端点

### API新增
- `GET /api/station/sse/:stationCode` — 工位级SSE实时推送
- `POST /api/station/maintenance-handovers/depanel` — Depanel NG批量迁移维修

### 数据增强
- Depanel 3D场景：router_bit_usage, method(手掰/铡刀/激光), panelsCount
- ICT 3D场景：probe_contact_state (12点数组), fixture_id
- FCT 3D场景：fixture_channel_states, door_status, test_progress
- SPC数据：每小时/班次pass_rate, defect_pareto, cpk
- OEE数据：availability × performance × quality, status_light

---

## 文件路径
- Grill存档: `smt-factory-system/ICT_FCT_DEPANEL_GRILLING.md`


---

## Implementation Status ✅

### Completed
- Q1-Q12 all D (全功能, 不分阶段)
- DepanelMergeEngine.ts (437 lines, 13.8KB) — 纯函数引擎, 4种NG分类, 帕累托分析
- DepanelScene3D.tsx (249 lines, 11.9KB) — V-Cut刀盘+治具+产品滑槽+信号灯塔
- DepanelMergePanel.tsx (291 lines, 13.9KB) — ICT+FCT合并面板+帕累托图+迁移按钮
- DepanelStationMonitor.tsx (374 lines, 18.5KB) — 完整独立3D组件, 3标签(3D/Merge/OEE)
- FctScene3D.tsx (259 lines, 12.0KB) — 12通道探针+安全门动画+进度LED灯条
- FctStationMonitor.tsx (319 lines, 22.3KB) — 完整独立3D组件, OEE+详情弹窗
- server.js (36,341 lines, 2.1MB) — SSE工位级端点+Depanel NG迁移端点

### Remaining (未实施)
- IctStationMonitor.tsx 增强 — 治具托盘可视化+探针下压动画 (grill Q4确认D)
- SPCPanel.tsx — PassRate趋势+不良帕累托+CPK能力指数
- OeePanel.tsx — OEE三率+设备状态灯+Andon推送

### Key Implementation Notes
- SSE: 轮询+变化检测(2s间隔, hashBuckets比较), 不改neuralBus
- Depanel端点: 复用maintenance-handovers主体逻辑, 加depanel专用校验
- 合并策略: strategy=MOTHERBOARD(默认)按batchId分组, INDEPENDENT按SN独立
- NG分类: ICT_ONLY_NG(橙)/FCT_ONLY_NG(红)/ICT_FCT_NG(紫)/PASS(绿)/EMPTY(灰)
