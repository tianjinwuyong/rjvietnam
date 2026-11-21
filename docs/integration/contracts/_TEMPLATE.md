# 契约模板：<子系统名称>（<domain>）
> 复制本文件为 `docs/integration/contracts/<subsystem>.md` 并填写。
> 门禁 `npm run check:integration` 校验五个必备小节标题（§1–§5 的标题文字不可改名）。
> 协议依据：`docs/integration/smt-subsystem-protocol.md`。

- 子系统 code（integration_app.code）：``（如 `mes-ruijing`）
- 业务域 domain：``（wms / oa / mes / agv）
- 部署形态：独立主机（Tailscale IP：``）
- 接入日期 / 状态：`` / `draft | active | paused | retired`

---

## 1. 字段与写权威

> 逐字段声明谁 owns 写入。一张表里混多方写权威是对账永远对不平的根因。

| 字段 | 类型 | 写权威（源系统 / SMT 只读） | 说明 |
|---|---|---|---|
| | | 源系统 | |
| | | SMT 只读镜像 | |

镜像表名（SMT 侧）：`ext_<code>__<table>`，附加列 `_smt_synced_at`、`_smt_sync_job_id`。

## 2. external_id 映射

> 源系统主键 ↔ SMT 规范 ID 的翻译规则。映射表：`rjvn_canonical` / `rjvn_external_id_map`。

| 源字段 | 规范字段 | 翻译规则 / 查找表 |
|---|---|---|
| `source_id` | `` | |
| | | |

## 3. 幂等键

- 指令接口幂等键：`X-Idempotency-Key`（UUID），子系统持久化时长：``（建议 ≥7 天）
- 同 key 同 payload → 返回上次结果；同 key 不同 payload → 409
- 事件侧去重键：`source_id + source_version`

## 4. 频率与 SLA

| 项 | 值 |
|---|---|
| 增量同步频率 | （MES 30s~2min / WMS 1~5min / OA 2~10min） |
| 回看窗口 | 5 分钟 |
| 健康探测 | 30s，连续 3 次失败熔断 / 连续 2 次成功恢复 |
| 指令超时 | 8s；重试 3 次（3s/10s/30s）后死信 |
| 数据延迟 SLA | 源变更 → 镜像可见 ≤ `` |
| 对账频率 | 每 `` 一次 |

## 5. 变更评审人

| 项 | 值 |
|---|---|
| 子系统侧评审人 | `` |
| SMT 侧评审人 | `` |
| 变更通知方式 | ``（提前 ≥`` 个工作日） |
| 契约更新流程 | 改本文件 → 双侧评审人确认 → 合并后 `npm run check:integration` 必须绿 |

---

## 附：接入自检

- [ ] 协议 §2 五条裁决已知悉（直连豁免、归属区分、health 双轨、幂等语义、`/api/auth/me` 保护）
- [ ] `npm run check:integration` 绿
- [ ] WorkBuddy 运行手册 §2 的 11 项上线校验全过
