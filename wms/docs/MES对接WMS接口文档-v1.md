# WMS 开放接口文档（MES 对接用）v1.0

**提供方**：WMS 仓库管理系统
**使用方**：MES 制造执行系统
**接口版本**：v1（路径前缀 `/api/mes/v1`）
**更新日期**：2026-10-23
**接口性质**：**只读查询**（不写业务数据、不触发审批、不改变库存）

---

## 一、能力范围

| 能力 | 接口 | 说明 |
|---|---|---|
| 连通性自检 | `GET /ping` | 联调第一步，确认网络/Key/数据库都通 |
| 库存现有量（明细） | `GET /stock` | 按物料、仓库、库位、批次查，逐行返回 |
| 库存现有量（统计） | `GET /stock/summary` | 按物料汇总或按仓库汇总 |
| 领料单查询 | `GET /picking-orders`、`GET /picking-orders/{pickingNo}` | 含审批状态、实发/实收数量、明细 |
| 产线退料单查询 | `GET /returns`、`GET /returns/{returnNo}` | 含已入库数量、待入库数量 |

> 本版本**不提供**写入类接口（创建领料申请、提交退料、报工扣料）。如需要，另行评估后开放 v2。

---

## 二、接入准备

### 2.1 网络

| 项 | 值 |
|---|---|
| 协议 | HTTP（内网）／HTTPS（可选，端口 3443，自签证书需信任或跳过校验） |
| 地址 | `http://<WMS服务器IP>:3000` |
| 端口 | 3000（HTTP）。如 WMS 改过端口，以实际配置为准 |
| 来源限制 | 无 IP 白名单，靠 API Key 鉴权；建议 MES 侧固定出口 IP 便于排查 |

### 2.2 开通步骤（WMS 管理员操作）

1. 编辑 WMS 安装目录下的 `.env`，追加一行：

```ini
# 逗号分隔，可写「Key:调用方名称」，名称只用于日志
MES_API_KEYS=7f3c9a1e5b2d4c6f8a0e:mes-prod
```

2. 重启 WMS 服务：

```powershell
Restart-Service WMS
```

3. 用下面的命令验证（把 Key 换成实际值）：

```bash
curl -H "X-Api-Key: 7f3c9a1e5b2d4c6f8a0e" http://<WMS服务器IP>:3000/api/mes/v1/ping
```

返回 `{"code":0,...}` 即开通成功。

> **未配置 Key 时接口整体关闭**，所有请求返回 `503 / code=50301`，这是有意的 fail-closed 设计，不是故障。

### 2.3 Key 管理

- 每个调用方一把 Key，便于单独吊销；轮换时先在 `.env` 里同时保留新旧两把，切换完成后再删旧的。
- Key 只通过安全渠道传递，不要写进代码仓库或前端页面。

---

## 三、公共约定

### 3.1 请求头

| 头 | 必填 | 说明 |
|---|---|---|
| `X-Api-Key` | 是 | 分配给你的 Key |
| `Accept` | 否 | 固定 `application/json` |

### 3.2 响应结构

统一包装，**HTTP 状态码与 code 同时有效**：

```json
{
  "code": 0,
  "message": "ok",
  "data": { },
  "requestId": "5a87fdf5-ced5-49b3-86cb-e4ca975f570d"
}
```

- `code = 0` 表示成功；
- `requestId` 每次唯一，报障时请提供，WMS 侧可据此定位日志；
- 失败时没有 `data` 字段，只有 `code` / `message` / `requestId`。

### 3.3 数据类型

| 类型 | 约定 |
|---|---|
| 时间 | **ISO 8601 UTC**，如 `2026-10-23T12:48:53.952Z`；空值为 `null` |
| 日期 | `YYYY-MM-DD`，如 `2026-08-07` |
| 数量 | JSON number（不是字符串），如 `30000`、`480.5`；调用方按需做精度处理 |
| 编码 | UTF-8 |

### 3.4 分页

| 参数 | 默认 | 上限 | 说明 |
|---|---|---|---|
| `page` | 1 | — | 页码，从 1 开始 |
| `pageSize` | 100 | **500** | 超过 500 按 500 处理 |

列表响应固定包含 `items` / `page` / `pageSize` / `total`。

> 单页上限 500 是为了保护数据库。需要全量同步时请按页拉取，不要尝试绕过。

### 3.5 错误码

| HTTP | code | 含义 | 处理建议 |
|---|---|---|---|
| 400 | 40001 | 参数不合法（如日期格式错误） | 修正参数后重试 |
| 401 | 40101 | 缺少或错误的 `X-Api-Key` | 检查 Key，不要重试 |
| 404 | 40401 | 单据不存在 | 视为无此单据 |
| 503 | 50301 | WMS 未启用 MES 接口（未配置 Key） | 联系 WMS 管理员开通 |
| 500 | 50000 | WMS 内部错误 | 记录 `requestId` 并联系 WMS 方 |

---

## 四、接口明细

### 4.1 连通性自检

```
GET /api/mes/v1/ping
```

**响应**

```json
{
  "code": 0, "message": "ok",
  "data": {
    "ok": true,
    "serverTime": "2026-10-23T12:48:14.692Z",
    "database": { "connected": true, "name": "wms", "time": "2026-10-23 19:48:14.707498+07" }
  },
  "requestId": "d9d5264e-2dd7-42ee-b140-bfeccf9db551"
}
```

> `database.time` 是数据库原样返回的本地时间，仅供参考；做时间比较请用 `serverTime`。

---

### 4.2 库存现有量（明细）

```
GET /api/mes/v1/stock
```

**请求参数**（全部可选，多条件为 AND）

| 参数 | 类型 | 说明 |
|---|---|---|
| `materialCode` | string | 物料编码，精确匹配 |
| `warehouseCode` | string | 仓库编码，如 `001` |
| `locationCode` | string | 库位编码，如 `001-A-0-1` |
| `batchNo` | string | 批次号 |
| `stockStatus` | string | 库存状态，见「状态字典」 |
| `keyword` | string | 物料编码/名称模糊搜索 |
| `onlyAvailable` | bool | 默认 `true` 只返回数量 > 0 的行；传 `false` 连零库存一起返回 |
| `page` / `pageSize` | int | 分页 |

**响应示例**

```json
{
  "code": 0, "message": "ok",
  "data": {
    "items": [
      {
        "materialCode": "0.00.00.02.0043B-HF",
        "materialName": "贴片电阻",
        "specification": "10KΩ ±1% 0603 1/10W 无卤 品牌：厚声",
        "unit": "PCS",
        "warehouseCode": "001",
        "warehouseName": "原料仓",
        "locationCode": "001-A-0-1",
        "batchNo": "19066724",
        "quantity": 30000,
        "stockStatus": "pending_qc",
        "locked": true,
        "lockReason": "IQC待检",
        "productionDate": "2026-08-07",
        "labelNo": "LBL261023000055",
        "updatedAt": "2026-10-23T10:23:43.690Z"
      }
    ],
    "page": 1, "pageSize": 100, "total": 38
  },
  "requestId": "a77d67ed-aa16-4225-8c36-db44913365f6"
}
```

**字段说明**

| 字段 | 说明 |
|---|---|
| `quantity` | 该库位+批次+状态下的现有量 |
| `locked` | 是否被锁定（如 MRB 隔离、IQC 待检占用），`true` 时 MES 不应视为可用库存 |
| `stockStatus` | `good` 良品 / `pending_qc` 待检 |
| `labelNo` | 库存标签号，盘装料（reel）以此为准 |

> **可用库存 = `quantity` 且 `locked=false` 且 `stockStatus='good'`**。MES 排产取数请按这个口径。

---

### 4.3 库存现有量（统计）

```
GET /api/mes/v1/stock/summary
```

**请求参数**

| 参数 | 类型 | 说明 |
|---|---|---|
| `groupBy` | string | `material`（默认，按物料汇总）/ `warehouse`（按仓库汇总） |
| `materialCode` | string | 可选，限定单个物料 |
| `warehouseCode` | string | 可选，限定单个仓库 |
| `stockStatus` | string | 可选 |
| `onlyAvailable` | bool | 默认 `true` |

**按物料汇总** `groupBy=material`

```json
{
  "code": 0, "message": "ok",
  "data": {
    "groupBy": "material",
    "items": [
      {
        "materialCode": "0.00.00.02.0043B-HF",
        "materialName": "贴片电阻",
        "specification": "10KΩ ±1% 0603 …",
        "unit": "PCS",
        "totalQty": 135000,
        "lockedQty": 135000,
        "lotCount": 8,
        "warehouseCount": 1
      }
    ]
  },
  "requestId": "64e5ce6f-…"
}
```

**按仓库汇总** `groupBy=warehouse`

```json
{
  "code": 0, "message": "ok",
  "data": {
    "groupBy": "warehouse",
    "items": [
      {
        "warehouseCode": "001",
        "warehouseName": "原料仓",
        "totalQty": 561779,
        "lockedQty": 561779,
        "materialCount": 9,
        "lotCount": 38
      }
    ]
  },
  "requestId": "64e5ce6f-…"
}
```

> 统计接口**不分页**（按物料/仓库聚合后行数有限）。库存物料种类很多时，按 `groupBy=material` 拉全量前建议先评估行数。

---

### 4.4 领料单列表

```
GET /api/mes/v1/picking-orders
```

**请求参数**

| 参数 | 类型 | 说明 |
|---|---|---|
| `pickingNo` | string | 领料单号，精确匹配 |
| `workOrderNo` | string | 工单号 |
| `workSection` | string | 工段，如 `smt`、`dip`、`assembly`、`packing` |
| `status` | string | 单据状态，见「状态字典」 |
| `from` / `to` | string | 创建时间范围，`YYYY-MM-DD` 或完整 ISO；按 WMS 服务器时区理解 |
| `page` / `pageSize` | int | 分页 |

**响应示例**

```json
{
  "code": 0, "message": "ok",
  "data": {
    "items": [
      {
        "pickingNo": "PK-MES-0001",
        "workOrderNo": "WO-MES-TEST",
        "productCode": "PROD-001",
        "productName": "测试产品",
        "workSection": "smt",
        "isSupplement": false,
        "totalQty": 500,
        "status": "issued",
        "oaStatus": null,
        "itemCount": 1,
        "createdAt": "2026-10-23T12:48:53.952Z",
        "pickTime": "2026-10-23T12:48:53.952Z",
        "receivedTime": null
      }
    ],
    "page": 1, "pageSize": 100, "total": 1
  },
  "requestId": "f13a7ac9-…"
}
```

---

### 4.5 领料单详情

```
GET /api/mes/v1/picking-orders/{pickingNo}
```

**响应示例**

```json
{
  "code": 0, "message": "ok",
  "data": {
    "pickingNo": "PK-MES-0001",
    "workOrderNo": "WO-MES-TEST",
    "productCode": "PROD-001",
    "productName": "测试产品",
    "planQty": 1000,
    "workSection": "smt",
    "isSupplement": false,
    "totalQty": 500,
    "status": "issued",
    "oaStatus": null,
    "remark": null,
    "createdAt": "2026-10-23T12:48:53.952Z",
    "pickTime": "2026-10-23T12:48:53.952Z",
    "receivedTime": null,
    "receiveRemark": null,
    "items": [
      {
        "materialCode": "MES-MAT-001",
        "materialName": "MES测试物料",
        "specification": "10K 0603",
        "packagingType": "normal",
        "unit": "PCS",
        "pickQty": 500,
        "actualQty": 480,
        "receivedQty": 0,
        "actualMaterialCode": null
      }
    ]
  },
  "requestId": "46d05803-…"
}
```

**明细字段说明**

| 字段 | 说明 |
|---|---|
| `pickQty` | 申请领用数量（BOM 需求量） |
| `actualQty` | 仓库实发数量 |
| `receivedQty` | 领料方确认的实收数量（差异 = `actualQty - receivedQty`） |
| `actualMaterialCode` | 替代料编码，非替代时为 `null` |
| `packagingType` | `normal` 普通 / `reel` 盘装料（必须扫盘号收发） |

单据不存在返回 `404 / code=40401`。

---

### 4.6 退料单列表

```
GET /api/mes/v1/returns
```

**请求参数**

| 参数 | 类型 | 说明 |
|---|---|---|
| `returnNo` | string | 退料单号 |
| `workOrderNo` | string | 工单号 |
| `materialCode` | string | 物料编码 |
| `status` | string | 见「状态字典」 |
| `from` / `to` | string | 创建时间范围 |
| `page` / `pageSize` | int | 分页 |

**响应示例**

```json
{
  "code": 0, "message": "ok",
  "data": {
    "items": [
      {
        "returnNo": "TL-MES-0001",
        "materialCode": "MES-MAT-001",
        "materialName": "MES测试物料",
        "unit": "PCS",
        "quantity": 20,
        "batchNo": null,
        "productionDate": null,
        "workOrderNo": "WO-MES-TEST",
        "status": "received",
        "returnReason": null,
        "receivedQty": 20,
        "pendingQty": 0,
        "createdAt": "2026-10-23T12:48:53.954Z"
      }
    ],
    "page": 1, "pageSize": 100, "total": 1
  },
  "requestId": "c15e8720-…"
}
```

| 字段 | 说明 |
|---|---|
| `quantity` | 退料申报数量 |
| `receivedQty` | 已入库数量（良品 + 来料不良 + 作业不良） |
| `pendingQty` | 尚未入库的数量 = `quantity - receivedQty` |

---

### 4.7 退料单详情

```
GET /api/mes/v1/returns/{returnNo}
```

在列表字段基础上增加：

```json
{
  "supplierCode": null,
  "supplierName": null,
  "receivedQty": { "good": 20, "incomingDefect": 0, "operationDefect": 0 },
  "updatedAt": "2026-10-23T12:48:53.954Z"
}
```

> 注意：**详情接口的 `receivedQty` 是对象**（分类数量），列表接口的 `receivedQty` 是数字（合计）。两者字段名相同、结构不同，请按接口区分。

---

## 五、状态字典

### 领料单 `picking-orders.status`

| 值 | 含义 | MES 处理建议 |
|---|---|---|
| `pending_approval` | 待审批 | 不可发料 |
| `approved` | 审批通过，待发料 | 等待仓库发料 |
| `issued` | 已发料 | 可做领料确认 |
| `received` | 已签收 | — |
| `closed` | 已结案 | 终态 |
| `rejected` | 已驳回 | 终态，需重新申请 |

### 产线退料 `returns.status`

| 值 | 含义 |
|---|---|
| `draft` | 草稿（未提交） |
| `submitted_iqc` | 已提交 IQC |
| `iqc_completed` | 检验完成 |
| `received` | 已入库（终态） |

### 库存 `stock.stockStatus`

| 值 | 含义 |
|---|---|
| `good` | 良品，可发料 |
| `pending_qc` | 待检（IQC 未放行），不可发料 |

> 状态值以接口实际返回为准。WMS 后续可能新增状态，MES 侧请对**未知值做兜底**（按不可用处理），不要硬编码白名单。

---

## 六、联调用例

```bash
# 1. 自检
curl -H "X-Api-Key: $KEY" http://10.0.0.10:3000/api/mes/v1/ping

# 2. 某物料的库存明细
curl -H "X-Api-Key: $KEY" \
  "http://10.0.0.10:3000/api/mes/v1/stock?materialCode=0.00.00.02.0043B-HF&pageSize=50"

# 3. 只看可用库存（良品且未锁定）
curl -H "X-Api-Key: $KEY" \
  "http://10.0.0.10:3000/api/mes/v1/stock?stockStatus=good&onlyAvailable=true"

# 4. 按仓库统计
curl -H "X-Api-Key: $KEY" \
  "http://10.0.0.10:3000/api/mes/v1/stock/summary?groupBy=warehouse"

# 5. 某工单的领料单
curl -H "X-Api-Key: $KEY" \
  "http://10.0.0.10:3000/api/mes/v1/picking-orders?workOrderNo=WO20261023001"

# 6. 今天新增的退料单
curl -H "X-Api-Key: $KEY" \
  "http://10.0.0.10:3000/api/mes/v1/returns?from=2026-10-23&to=2026-10-23"

# 7. 错误示例：不带 Key → 401
curl -i http://10.0.0.10:3000/api/mes/v1/ping
```

---

## 七、对接建议

1. **轮询频率**：库存类建议 30–60 秒一次，单据类 5 分钟一次。不要做秒级全量轮询，500 行/页 × 高频会明显加重数据库负担。
2. **增量同步**：单据用 `from`/`to` 按创建时间拉增量；库存没有"变更时间"过滤参数，按物料编码集合定向查询（例如只查当前工单涉及的物料）。
3. **超时与重试**：建议连接超时 3 秒、读超时 10 秒；只对 5xx 和网络错误重试，`4xx` 不要重试（参数/Key 问题重试也没用）。
4. **不要拿库存做扣减依据**：本接口是快照，不是事务。MES 侧的发料/耗料必须以 WMS 的单据状态为准，不要自行用 `quantity` 做本地扣减。
5. **未知状态兜底**：见状态字典末段。

---

## 八、常见问题

**Q：调用返回 503 / code=50301**
WMS 没有配置 `MES_API_KEYS`，接口整体关闭。联系 WMS 管理员开通并重启服务。

**Q：返回 401 但 Key 看起来没错**
检查请求头名字是否写成了 `Authorization` 或 `x-api-key` 之外的形式；必须是 `X-Api-Key`（HTTP 头不区分大小写，但不要加 `Bearer` 前缀）。

**Q：库存查不到物料**
默认只返回数量 > 0 的行。确需看零库存请加 `onlyAvailable=false`；另外确认物料编码与 WMS 主数据一致（有前导零，如 `0.00.00.02.0043B-HF`）。

**Q：时间比自己服务器早了 7 小时**
接口统一返回 UTC。请用 `serverTime` 校准，不要在两端混用本地时区。

**Q：能否提供写入接口（MES 发起领料/退料）**
本版本不提供。WMS 侧写入涉及审批、库存事务与并发控制，需要单独设计（幂等键、单据号规则、异常补偿），可另立需求评估。

---

## 九、变更记录

| 版本 | 日期 | 变更 |
|---|---|---|
| v1.0 | 2026-10-23 | 首版：库存现有量/统计、领料单、产线退料单查询，API Key 鉴权 |
