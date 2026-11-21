# WMS 物理位置主数据模型

## 标准层级

```text
厂区 Site
└─ 建筑 Building
   └─ 楼层 Floor
      └─ 仓库 Warehouse
         └─ 分区 Zone
            └─ 主巷道 / 横向巷道 Main aisle / Cross aisle
               └─ 货架 Rack
                  └─ 层位 Level
                     └─ 库格 Bin / Storage Location
```

每个库存批次和托盘最终绑定到 `storage_locations.id`。上层结构用于容量、环境、路径和管理责任，不能代替最终库位扫描。

## 物理属性

| 层级 | 核心属性 |
|---|---|
| Site | 编码、多语言名称、地址、时区、状态 |
| Building | 类型、长宽高、状态 |
| Floor | 楼层号、标高、净高、楼板承重 |
| Warehouse | 类型、楼层、收货月台及起点坐标 |
| Zone | 用途、温湿度范围、状态 |
| Location | 位置编码、主巷道、横向巷道、左右侧、存取方向、货架、层、库格、XYZ坐标、方向、长宽高、数量容量、托盘容量、承重、体积、堆码层数、MSL、ESD、危险品、冷藏、消防分区、搬运设备 |
| Route node | XYZ坐标、节点类型、叉车/AGV/行人权限、宽高和承重限制 |
| Route edge | 距离、时间、方向、通行工具、宽高和承重限制 |

## 放置决策顺序

1. 校验完整物理路径和状态。
2. 校验 IQC/隔离区域。
3. 校验 MSL、ESD、冷藏、危险品和温湿度。
4. 校验数量、托盘数、长宽高、体积、承重和堆码。
5. 校验搬运设备及路径边约束。
6. 在全部合格位置中优化同物料集中、容量利用率和最短安全路径。
7. 到达后扫描托盘 QR 与库位 QR；系统才允许确认上架。

迁移：`database/migrations/242_wms_physical_location_hierarchy.sql`。
