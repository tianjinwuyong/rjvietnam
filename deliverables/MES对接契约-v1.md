# MES ↔ OA 对接契约 v1

**日期**：2026-10-26
**适用系统**：MES（制造执行系统） ↔ OA（协同办公/审批中枢）
**当前状态**：OA 侧已就绪（接口、密钥体系、回写通道、告警、对账、测试工具全部可用）；**MES 侧尚未约定接口**，本文件即要约。

---

## 0. 一句话说清

- **MES 要审批**（工单变更、报废、领退料、设备停机之类）→ MES 调 OA 的 4 个接口，用 OA 发的 API Key。
- **OA 审完了要告诉 MES** → OA 往 MES 的回调地址 POST 一条带签名的 JSON，MES 验签后落库。
- 两边**都不直连对方数据库**。

---

## 1. 入站：MES → OA

Base：`http://192.168.1.61:8080`
鉴权：请求头 `X-Api-Key: oa_xxxxxxxx`（由 OA 管理员在「集成中枢 → API 密钥」生成，绑定一个服务账号）

### 1.1 提交单据

```
POST /api/open/v1/flow/submit
Content-Type: application/json
X-Api-Key: oa_xxxxxxxx

{
  "bizType": "mes_workorder_change",
  "bizKey": "WO-20261026-001",
  "title": "工单变更申请 WO-20261026-001",
  "applicantUserId": 1024,
  "formData": { "wo_no": "WO-20261026-001", "reason": "客户改单", "qty": 500 },
  "submitNow": true
}
```

| 字段 | 必填 | 说明 |
|---|---|---|
| `bizType` | ✅ | OA 侧配置的业务类型编码，需与「业务配置」里的一致，否则 400 |
| `bizKey` | ✅ | MES 侧业务主键。**同一 bizType + bizKey 的进行中单据只会存在一张**（数据库唯一约束，防重复提交） |
| `title` | 否 | 不传则用「业务名 + bizKey」 |
| `applicantUserId` | ✅ | OA 的用户 ID（先通过 `/master/users` 对齐人员） |
| `formData` | 否 | 业务字段。OA 侧会按「业务配置 → 字段映射」把 MES 的 key 换成 OA 表单的 key，**MES 不需要知道 OA 表单结构** |
| `submitNow` | 否 | 默认 `true`。传 `false` 只建草稿 |

返回：`{ code: 0, data: { instanceId, instanceNo, status, advance } }`

### 1.2 查审批状态

```
GET /api/open/v1/flow/{instanceId}/status
X-Api-Key: oa_xxxxxxxx
```
返回 `rawStatus`（OA 原始状态：draft/running/completed/terminated/withdrawn/archived）与 `status`（经「状态映射」翻译后的 MES 口径）。

### 1.3 增量变更（对账/补拉）

```
GET /api/open/v1/flow/changes?system=MES&since=2026-10-26T00:00:00Z&limit=200
X-Api-Key: oa_xxxxxxxx
```
返回 `{ since, nextSince, list[] }`，按 `updatedAt` 升序。**MES 定时拉这个接口即可自查有没有漏收的回调**，不需要 OA 主动补偿。

### 1.4 人员主数据

```
GET /api/open/v1/master/users?since=2026-10-01T00:00:00Z&limit=500
X-Api-Key: oa_xxxxxxxx
```

---

## 2. 出站：OA → MES

OA 审批状态变化时，向「系统连接 → MES → 回调地址」POST：

```
POST http://<MES>/api/oa/callback
Content-Type: application/json
X-OA-Signature: <hex hmac-sha256>
X-OA-System: MES

{
  "event": "completed",
  "instanceId": 14545,
  "instanceNo": "OA-20261026-0007",
  "bizSystem": "MES",
  "bizType": "mes_workorder_change",
  "bizKey": "WO-20261026-001",
  "status": "completed",
  "nodeIndex": 3,
  "approver": "张三",
  "comment": "同意",
  "finalResult": null,
  "occurredAt": "2026-10-26T05:30:00.000Z"
}
```

### 2.1 事件类型

| event | 何时发 | MES 该怎么处理 |
|---|---|---|
| `node_passed` | 每过一个审批节点 | 只更新进度，不要动业务状态 |
| `completed` | 全部审批完成 | ✅ **这里才落业务动作** |
| `rejected` | 被驳回 | 退回 |
| `ping` | 管理员在控制台点「发一条测试事件」 | 只验签并回 200，不落库 |

### 2.2 验签（必须做）

`X-OA-Signature = HMAC-SHA256(原始请求体字节, 密钥)`，密钥即「系统连接 → MES → 回调密钥」。

⚠️ **必须用原始字节验签**，不能先 JSON 解析再重新序列化（键顺序/空格一变签名就不对）。

Node.js：
```js
const crypto = require('crypto');
const raw = req.rawBody;                    // 原始字符串，未 parse
const expect = crypto.createHmac('sha256', SECRET).update(raw).digest('hex');
const ok = expect.length === String(req.headers['x-oa-signature']).length
  && crypto.timingSafeEqual(Buffer.from(expect), Buffer.from(req.headers['x-oa-signature']));
if (!ok) return res.status(401).end();
```

Java（Spring，需要读原始 body 的过滤器）：
```java
String raw = new String(bodyBytes, StandardCharsets.UTF_8);
Mac mac = Mac.getInstance("HmacSHA256");
mac.init(new SecretKeySpec(SECRET.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
String expect = HexFormat.of().formatHex(mac.doFinal(raw.getBytes(StandardCharsets.UTF_8)));
if (!MessageDigest.isEqual(expect.getBytes(), sig.getBytes())) return 401;
```

### 2.3 响应约定

- **2xx** = 收到并已处理（OA 标记 `sent`，不再重发）
- **非 2xx / 超时 8 秒** = 失败，OA 自动重试，退避：20s → 40s → 80s … 最多 8 次
- 8 次都失败 → 状态转 `failed`，**同时在 OA 产生红色告警并通知系统管理员**，可在控制台点「重放」
- 因此 MES 侧务必**幂等**：同一个 `instanceId + event` 收到多次只处理一次

---

## 3. MES 侧还需提供的信息（阻塞项）

| # | 需要 MES 提供 | 用途 |
|---|---|---|
| 1 | 回调地址（能公网/内网访问到） | 填到「系统连接 → MES → 回调地址」 |
| 2 | 回调密钥（双方约定的随机串） | 填到「回调密钥」，用于 HMAC |
| 3 | 要走的业务类型清单（工单变更 / 报废 / 停机 / 领退料…） | 每种在 OA「业务配置」建一条，绑 OA 流程 + 字段映射 |
| 4 | 每种业务的字段对照（MES key → 含义） | 配「字段映射」 |
| 5 | 接收回调的失败重试策略（是否也自己重试） | 避免双向重试放大 |

---

## 4. OA 侧如何自证通路

| 动作 | 位置 | 期望结果 |
|---|---|---|
| 连通性 | 系统连接 → MES → 测试连接 | HTTP 200 |
| 验签通路 | 告警与对账 → MES 连接器 → 发一条测试事件 | 「MES 已收到并验签通过」 |
| 端到端 | 造一张 bizSystem=MES 的单据走完审批 | MES 收到 `completed`，控制台事件日志 `sent` |
| 对账 | 告警与对账 → 立即对账 | 回写差异 0 |

本地自测（无需真 MES）：
```bash
MES_TEST_SECRET=mes-test-secret node tools/mes-mock.mjs
# 再把 MES 回调地址临时指向 http://127.0.0.1:4099/mes/oa
```

---

## 5. 已知边界

- OA 目前**不会主动轮询 MES**，只有回写；需要补拉时用 `/flow/changes`。
- 单条回调超时 8 秒，MES 侧处理要快，重活异步化。
- 回调地址目前不限内网/回环，管理员需自行确认填的是 MES 真实地址（误填成别的地址会把审批结果发给别人）。
