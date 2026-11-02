import { Inject, Injectable, Logger, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { DRIZZLE_DATABASE, type PostgresJsDatabase } from '../../database/database.provider';
import { eq, and, like, gte, lt, desc, sql, count, isNull, inArray, notInArray } from 'drizzle-orm';
import type { ReceiptOrder, PaginatedResponse, QrParseResult, SubmitIqcResult } from '@shared/api.interface';

import {
  receiptOrder,
  supplier,
  material,
  warehouseLocation,
  inventory,
  sysParam,
  warehouse,
  iqcLot,
  iqcLotReceipt,
  sysAccount,
} from '@server/database/schema';
import { INVENTORY_STOCK_CONFLICT_TARGET } from '../../common/db/inventory-conflict';

export interface VerifyQrResult {
  valid: boolean;
  supplierCode: string;
  materialCode: string;
  productionDate: string;
  quantity: number;
  batchNo: string;
  serialNo: string;
  supplierName?: string;
  materialName?: string;
  mslLevel?: string;
  unit?: string;
  errorMessage?: string;
  errorCode?: 'invalid_supplier' | 'unregistered_material' | 'unqualified_supplier' | 'duplicate_serial' | 'invalid_format';
}

@Injectable()
export class ReceiptService {
  private readonly logger = new Logger(ReceiptService.name);

  constructor(
    @Inject(DRIZZLE_DATABASE) private readonly db: PostgresJsDatabase,
  ) {}

  /**
   * 批量补全操作人姓名。
   *
   * ⚠️ 连接池死锁要点（BUG-005 并发死锁根因之二）：
   *   本方法**必须**复用调用方传入的连接（`conn`）。
   *   若在事务内无条件用 `this.db`，就会在事务仍占着 1 条连接时再去池里申请第 2 条；
   *   当并发数 = 连接池上限（max=10）时，10 个事务各占满全部连接、又都在等第 11 条，
   *   形成死锁，整个服务挂死（实测 10 路并发同码扫码必现）。
   */
  private async attachUserNames(
    items: any[],
    idField: string,
    nameField: string,
    conn?: any,
  ): Promise<void> {
    const ids = [...new Set(items.map((it) => it[idField]).filter(Boolean))];
    if (ids.length === 0) return;
    const dbConn = conn || this.db;
    const users = await dbConn.select({ id: sysAccount.id, name: sysAccount.name }).from(sysAccount).where(inArray(sysAccount.id, ids));
    const nameMap = new Map<string, string>();
    users.forEach((u: any) => {
      if (u.name) nameMap.set(u.id, u.name);
    });
    for (const it of items) {
      it[nameField] = nameMap.get(it[idField]) || '';
    }
  }

  /**
   * BUG-001 修复（方案 B：全局重编）：
   * 供应商在不同物料/批次间复用流水号是客观事实，而 inventory.label_no 曾是全局唯一约束，
   * 导致合法收料直接 500。
   *
   * 现改为：入库时生成**全局唯一**的标签号，格式 `LBL{YYMMDD}{6位序号}`；
   * 原始供应商流水号仍保留在返回值中（用于打印/追溯），由调用方决定是否拼接展示。
   *
   * 使用数据库序列而非 MAX+1，避免并发下生成重复标签号。
   */
  private async generateLabelNo(tx: any): Promise<string> {
    const now = new Date();
    const dateStr = `${String(now.getFullYear()).slice(2)}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    const raw = (await tx.execute(
      sql`SELECT nextval('seq_inventory_label_no') AS seq`,
    )) as unknown as Array<{ seq: string }>;
    const seq = Number(raw[0]?.seq ?? 1);
    return `LBL${dateStr}${String(seq).padStart(6, '0')}`;
  }

  /**
   * 在**事务外**预取标签号。
   *
   * 为什么要提到事务外（并发死锁根治）：
   *   `nextval()` 是非事务性操作，但它会持有该 sequence 对象的锁直到本事务提交/回滚。
   *   收料事务内的锁获取顺序是「sequence → receipt_order 唯一索引 → inventory」，
   *   当 10 个并发请求同时收同一二维码时，序号锁与唯一索引锁形成交叉等待：
   *     事务 A 抢到 receipt_order，卡在等 sequence；事务 B 抢到 sequence，卡在等 receipt_order。
   *   连接池 max=10 被这些互相等待的事务占满，服务整体挂死。
   *
   * 把 nextval 挪到事务开始之前（不持有其它锁），事务内的锁顺序就只剩
   * 「receipt_order → inventory」这一条单向链，不再可能成环。
   *
   * @param n 需要预取的标签号个数（批量收货时一次取够）
   */
  private async reserveLabelNos(n: number): Promise<string[]> {
    if (n <= 0) return [];
    const now = new Date();
    const dateStr = `${String(now.getFullYear()).slice(2)}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    // setval 批量预留：一次调用推进 n 个，避免 n 次往返（也避免 n 次依次加锁）
    const raw = (await this.db.execute(
      sql`SELECT nextval('seq_inventory_label_no') AS start, setval('seq_inventory_label_no', currval('seq_inventory_label_no') + ${n} - 1) AS last`,
    )) as unknown as Array<{ start: string }>;
    const start = Number(raw[0]?.start ?? 1);
    return Array.from({ length: n }, (_, i) => `LBL${dateStr}${String(start + i).padStart(6, '0')}`);
  }


  parseQr(qrContent: string): QrParseResult {
    // 防御性校验（task #118）：调用方漏传 / 传了非字符串时，直接给 400 语义的
    // BadRequestException，而不是让 undefined.split 抛 TypeError 变成 500。
    // 覆盖 scan / verify-qr / batch-receipt 明细项等所有调用点。
    if (typeof qrContent !== 'string' || qrContent.trim() === '') {
      throw new BadRequestException('二维码内容不能为空');
    }
    const parts = qrContent.split('*');
    if (parts.length !== 6) {
      throw new BadRequestException('二维码格式错误，应为：供应商代码*料号*生产日期*数量*批次*流水号（共6段）');
    }
    const [supplierCode, materialCode, productionDate, qtyStr, batchNo, serialNo] = parts;
    if (!supplierCode || !materialCode || !productionDate || !batchNo || !serialNo) {
      throw new BadRequestException('二维码格式错误，六段码中存在空值');
    }
    const quantity = Number(qtyStr);
    if (isNaN(quantity) || quantity <= 0) {
      throw new BadRequestException('二维码中数量格式错误');
    }
    return { supplierCode, materialCode, productionDate, quantity, batchNo, serialNo };
  }

  async verifyQr(qrContent: string): Promise<VerifyQrResult> {
    try {
      const parsed = this.parseQr(qrContent);

      const matResult = await this.db
        .select({ id: material.id, materialName: material.materialName, unit: material.unit, mslLevel: material.mslLevel, supplierCode: material.supplierCode })
        .from(material)
        .where(eq(material.materialCode, parsed.materialCode))
        .limit(1);

      if (matResult.length === 0) {
        return {
          valid: false,
          ...parsed,
          supplierCode: parsed.supplierCode,
          errorMessage: '非认可物料',
          errorCode: 'unregistered_material',
        };
      }

      if (!matResult[0].supplierCode || matResult[0].supplierCode !== parsed.supplierCode) {
        return {
          valid: false,
          ...parsed,
          materialName: matResult[0].materialName,
          unit: matResult[0].unit,
          mslLevel: matResult[0].mslLevel || '不管控',
          errorMessage: '非合格供应商',
          errorCode: 'unqualified_supplier',
        };
      }

      // 重码校验：完整六段码严格校对（供应商+料号+生产日期+数量+批次+流水号）
      const dupResult = await this.db
        .select({ id: receiptOrder.id })
        .from(receiptOrder)
        .where(eq(receiptOrder.qrContent, qrContent))
        .limit(1);

      if (dupResult.length > 0) {
        return {
          valid: false,
          ...parsed,
          materialName: matResult[0].materialName,
          unit: matResult[0].unit,
          mslLevel: matResult[0].mslLevel || '不管控',
          errorMessage: '该标签已收过料，重复扫码（六段码完全相同）',
          errorCode: 'duplicate_serial',
        };
      }

      return {
        valid: true,
        ...parsed,
        materialName: matResult[0].materialName,
        unit: matResult[0].unit,
        mslLevel: matResult[0].mslLevel || '不管控',
      };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      this.logger.error(`verifyQr error: ${JSON.stringify(error)}`);
      throw error;
    }
  }

  private async generateReceiptNo(receiptDateStr: string): Promise<string> {
    const datePart = receiptDateStr.replace(/-/g, '');
    const prefix = `RK${datePart}`;

    const result = await this.db.execute<{ seq: string }>(
      sql`SELECT nextval('seq_receipt_no') AS seq`,
    );
    const seq = Number(result[0]?.seq ?? 1);

    return `${prefix}${seq.toString().padStart(4, '0')}`;
  }

  /**
   * 在**事务外**批量预取收货单号。
   *
   * 与 reserveLabelNos 同样的理由：`nextval()` 持有 sequence 锁直到事务结束，
   * 若在事务内调用，会与 `receipt_order.qr_content` 唯一索引锁形成交叉等待，
   * 并发同码收货时把连接池 max=10 占满，服务整体挂死。
   */
  private async reserveReceiptNos(receiptDateStr: string, n: number): Promise<string[]> {
    if (n <= 0) return [];
    const datePart = receiptDateStr.replace(/-/g, '');
    const prefix = `RK${datePart}`;
    const raw = (await this.db.execute(
      sql`SELECT nextval('seq_receipt_no') AS start, setval('seq_receipt_no', currval('seq_receipt_no') + ${n} - 1) AS last`,
    )) as unknown as Array<{ start: string }>;
    const start = Number(raw[0]?.start ?? 1);
    return Array.from({ length: n }, (_, i) => `${prefix}${String(start + i).padStart(4, '0')}`);
  }


  async scanReceipt(
    qrContent: string,
    locationId: string | undefined,
    actualQty: number | undefined,
    userId: string,
  ): Promise<ReceiptOrder> {
    const verifyResult = await this.verifyQr(qrContent);
    if (!verifyResult.valid) {
      throw new BadRequestException({
        message: verifyResult.errorMessage || '二维码校验失败',
        errorCode: verifyResult.errorCode || 'invalid_format',
        data: verifyResult,
      });
    }

    const supResult = await this.db
      .select({ id: supplier.id })
      .from(supplier)
      .where(eq(supplier.supplierCode, verifyResult.supplierCode))
      .limit(1);

    const matResult = await this.db
      .select({ id: material.id, materialName: material.materialName, unit: material.unit })
      .from(material)
      .where(eq(material.materialCode, verifyResult.materialCode))
      .limit(1);

    const supplierId = supResult.length > 0 ? supResult[0].id : null;
    const materialId = matResult[0].id;
    const quantity = actualQty && actualQty > 0 ? actualQty : verifyResult.quantity;
    const receiptDateStr = new Date().toISOString().slice(0, 10);

    if (!locationId) {
      throw new BadRequestException('请指定收货库位');
    }

    const locResult = await this.db
      .select({
        locationCode: warehouseLocation.locationCode,
        warehouseId: warehouseLocation.warehouseId,
      })
      .from(warehouseLocation)
      .where(eq(warehouseLocation.id, locationId))
      .limit(1);
    if (locResult.length === 0) {
      throw new BadRequestException('库位不存在');
    }

    const whResult = await this.db
      .select({ whType: warehouse.whType })
      .from(warehouse)
      .where(eq(warehouse.id, locResult[0].warehouseId))
      .limit(1);
    if (whResult.length === 0 || whResult[0].whType !== 'normal') {
      throw new BadRequestException('收货库位必须属于普通仓');
    }

    const targetLocationId = locationId;

    const receiptNo = await this.generateReceiptNo(receiptDateStr);

    // 事务外预取标签号：避免 nextval 的 sequence 锁与事务内的唯一索引锁形成交叉等待（见 reserveLabelNos 注释）
    const labelNo = (await this.reserveLabelNos(1))[0];

    return await this.db.transaction(async (tx) => {
      // BUG-005 修复（并发死锁根治）：见 batchReceipt 中的同款说明。
      // 「SELECT ... FOR UPDATE 查重 + 无条件 INSERT」在 0 行时并不加锁，无法串行化；
      // 改为让 INSERT 自身依赖 qr_content 唯一索引，用 ON CONFLICT DO NOTHING 做不阻塞消解，
      // 返回 0 行即判定重码（不再额外抛 23505，避免连接被索引锁长时间挂住）。
      const ins = (await tx
        .insert(receiptOrder)
        .values({
          receiptNo,
          receiptDate: receiptDateStr,
          supplierId,
          materialId,
          quantity: String(quantity),
          unit: matResult[0].unit,
          productionDate: verifyResult.productionDate,
          batchNo: verifyResult.batchNo,
          serialNo: verifyResult.serialNo,
          locationId: targetLocationId,
          keeperId: userId,
          qrContent,
          status: 'received',
        })
        .onConflictDoNothing({
          target: [receiptOrder.qrContent],
          where: sql`${receiptOrder.qrContent} IS NOT NULL`,
        })
        .returning({ id: receiptOrder.id })) as Array<{ id: string }>;
      if (ins.length === 0) {
        throw new ConflictException('该标签已被扫码收货，请勿重复扫描');
      }
      const inserted = ins;

      const receiptId = inserted[0].id;

      // F-01 修复（P0）：库存合并改为「单条原子 UPSERT」，以唯一索引为唯一权威。
      //
      // 原实现：事务内 SELECT 查重 → 命中则 UPDATE inventory SET quantity = <旧值> + qty，
      // 未命中则无条件 INSERT。并发同批次收货时有两个致命缺陷：
      //   (a) 丢失更新：currentQty 是普通读，无行锁、无 CAS，两个并发事务各自读到同一旧值，
      //       后写覆盖先写 → 库存数量少算（账实不符）；
      //   (b) 合法收料被 409 误拒：两个事务同时查不到行 → 都 INSERT → 后者违反唯一索引
      //       inventory_material_id_location_id_batch_no_stock_status_key → PG 23505，
      //       被全局异常过滤器映射为 409 CONFLICT，把正常业务当成冲突拒绝；
      //   (c) 查重口径与唯一索引不一致：SELECT 多了 locked=true，而唯一索引不含 locked，
      //       于是「同料号+库位+批次+status 但 locked=false」的行查不到却会挡 INSERT → 同样 409。
      //
      // 现改为让 INSERT 自身成为唯一权威，用 ON CONFLICT DO UPDATE 原子累加：
      //   - 冲突目标严格对齐唯一索引 (material_id, location_id, batch_no, stock_status)，不再 SELECT 预判；
      //   - 冲突时 quantity = inventory.quantity + excluded.quantity（引用既有行的当前值，原子自增，无丢失更新）；
      //   - 冲突时不覆盖既有行的 label_no / locked / lock_reason（新收数量沿用原标签号，见 BUG-001 意图）。
      //
      // ⚠️ 语义变化（需业务确认，见 F-01(c) 评估）：冲突目标改为唯一索引后，若同批次已存在
      //    locked=false（IQC 已放行）的行，新收数量会合并进那一行、不会被置为 locked=true「IQC待检」。
      const batchNo = verifyResult.batchNo || '';
      await tx
        .insert(inventory)
        .values({
          materialId,
          locationId: targetLocationId,
          // batchNo 统一走 '' 兜底：parseQr 已强制非空，这里再兜底一次保证与唯一索引口径一致
          // （PG 中 NULL 在唯一索引里互不相等，会让 ON CONFLICT 永不命中而失效）
          batchNo,
          supplierId,
          quantity: String(quantity),
          unit: matResult[0].unit,
          stockStatus: 'pending_qc',
          productionDate: verifyResult.productionDate,
          // BUG-001 修复（方案 B：全局重编）：
          // 原实现直接写供应商流水号（六段码第6段），但供应商跨物料复用流水号会让唯一约束冲突 → 收料 500。
          // 现改为写入全局唯一标签号；供应商原始流水号仍可通过批次/二维码追溯。
          // 标签号已由事务外的 reserveLabelNos 预取（避免 sequence 锁参与事务锁序）。
          labelNo,
          locked: true,
          lockReason: 'IQC待检',
        })
        .onConflictDoUpdate({
          // 冲突目标 = 库上唯一索引 (material_id, location_id, batch_no, stock_status)
          target: INVENTORY_STOCK_CONFLICT_TARGET,
          set: {
            quantity: sql`${inventory.quantity} + ${String(quantity)}::numeric`,
          },
        });

      return this.getReceiptDetail(receiptId, tx);
    });
  }

  async getActiveWarehouses() {
    const result = await this.db
      .select({
        id: warehouse.id,
        whCode: warehouse.whCode,
        whNameZh: warehouse.whNameZh,
        whNameEn: warehouse.whNameEn,
        whNameVi: warehouse.whNameVi,
        whType: warehouse.whType,
      })
      .from(warehouse)
      .where(
        and(
          eq(warehouse.status, 'active'),
          eq(warehouse.whType, 'normal'),
        ),
      )
      .orderBy(warehouse.whCode);
    return result;
  }

  async verifyLocationCode(locationCode: string, warehouseId: string) {
    if (!locationCode) {
      throw new BadRequestException('请提供库位编码');
    }
    if (!warehouseId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(warehouseId)) {
      throw new BadRequestException('仓库ID格式错误');
    }
    const result = await this.db
      .select({
        id: warehouseLocation.id,
        locationCode: warehouseLocation.locationCode,
        warehouseId: warehouseLocation.warehouseId,
        status: warehouseLocation.status,
      })
      .from(warehouseLocation)
      .where(
        and(
          eq(warehouseLocation.locationCode, locationCode),
          eq(warehouseLocation.warehouseId, warehouseId),
        ),
      )
      .limit(1);

    if (result.length === 0) {
      const anyResult = await this.db
        .select({ id: warehouseLocation.id, warehouseId: warehouseLocation.warehouseId })
        .from(warehouseLocation)
        .where(eq(warehouseLocation.locationCode, locationCode))
        .limit(1);
      if (anyResult.length > 0) {
        throw new BadRequestException('该仓库地址码不属于所选仓库');
      }
      throw new BadRequestException('仓库地址码不存在');
    }

    if (result[0].status !== 'active') {
      throw new BadRequestException('仓库地址码已停用');
    }

    return result[0];
  }

  async batchReceipt(
    items: Array<{ qrContent: string; quantity?: number }>,
    locationId: string,
    userId: string,
  ): Promise<ReceiptOrder[]> {
    // 入参校验：items 缺失时应返回 400，而不是 items.length 抛 TypeError 变成 500
    if (!Array.isArray(items) || items.length === 0) {
      throw new BadRequestException('没有可收货的物料');
    }

    const locResult = await this.db
      .select({
        locationCode: warehouseLocation.locationCode,
        warehouseId: warehouseLocation.warehouseId,
      })
      .from(warehouseLocation)
      .where(eq(warehouseLocation.id, locationId))
      .limit(1);
    if (locResult.length === 0) {
      throw new BadRequestException('库位不存在');
    }

    const whResult = await this.db
      .select({ whType: warehouse.whType })
      .from(warehouse)
      .where(eq(warehouse.id, locResult[0].warehouseId))
      .limit(1);
    if (whResult.length === 0 || whResult[0].whType !== 'normal') {
      throw new BadRequestException('收货库位必须属于普通仓');
    }

    const receiptDateStr = new Date().toISOString().slice(0, 10);

    const verifyResults: (VerifyQrResult & { qrContent: string; actualQty: number })[] = [];
    const serialsOfToday: string[] = [];

    for (const item of items) {
      const parsed = this.parseQr(item.qrContent);
      const verifyResult = await this.verifyQr(item.qrContent);
      if (!verifyResult.valid) {
        throw new BadRequestException({
          message: `[${parsed.materialCode}] ${verifyResult.errorMessage || '校验失败'}`,
          errorCode: verifyResult.errorCode || 'invalid_format',
          data: verifyResult,
        });
      }
      const actualQty = item.quantity && item.quantity > 0 ? item.quantity : verifyResult.quantity;
      // 批次内重码检查：完整六段码严格校对
      const dupInBatch = verifyResults.find(r => r.qrContent === item.qrContent);
      if (dupInBatch) {
        throw new BadRequestException({
          message: `[${parsed.materialCode}] 批次内重复扫码（六段码完全相同）`,
          errorCode: 'duplicate_serial',
          data: verifyResult,
        });
      }
      verifyResults.push({ ...verifyResult, qrContent: item.qrContent, actualQty });
      serialsOfToday.push(verifyResult.serialNo);
    }

    // 事务外一次性预取本批次所需的全部标签号与收货单号。
    // 二者底层都是 nextval()，必须放在事务外，避免 sequence 锁与唯一索引锁交叉等待（连接池 max=10 会整体挂死）。
    const reservedLabels = await this.reserveLabelNos(verifyResults.length);
    const reservedReceiptNos = await this.reserveReceiptNos(receiptDateStr, verifyResults.length);
    let labelCursor = 0;
    let receiptNoCursor = 0;

    return await this.db.transaction(async (tx) => {
      const created: ReceiptOrder[] = [];

      for (let i = 0; i < verifyResults.length; i++) {
        const v = verifyResults[i];
        const supResult = await tx
          .select({ id: supplier.id })
          .from(supplier)
          .where(eq(supplier.supplierCode, v.supplierCode))
          .limit(1);

        const matResult = await tx
          .select({ id: material.id, materialName: material.materialName, unit: material.unit })
          .from(material)
          .where(eq(material.materialCode, v.materialCode))
          .limit(1);

        const supplierId = supResult.length > 0 ? supResult[0].id : null;
        const materialId = matResult[0].id;

        const receiptNo = reservedReceiptNos[receiptNoCursor++];
        // F-01：每条明细消耗一个预取标签号（无论最终走 INSERT 还是合并到既有行）。
        // 合并到既有行时该标签号不会写库，仅产生跳号；跳号本就在并发/重试路径存在，可接受。
        const labelNo = reservedLabels[labelCursor++];

        // BUG-005 修复（并发死锁根治）：
        // 旧实现是「先 SELECT ... FOR UPDATE 查重，再无条件 INSERT」。
        // 但 PostgreSQL 的 FOR UPDATE 只在**命中行**时加锁，0 行结果集不加任何锁，
        // 所以这个前置查重对并发同码完全无效；而当行已存在时它反而先拿一把行锁，
        // 与下面的 INSERT 争同一索引项，在连接池只有 10 条时会整池卡死。
        // 正确做法：让 INSERT 自身成为唯一权威（依赖 qr_content 的部分唯一索引），
        // 用 ON CONFLICT DO NOTHING 做「不阻塞」的冲突消解：
        //   - 抢到的返回 1 行 → 正常继续
        //   - 抢不到的返回 0 行 → 直接判定重码
        let inserted: Array<{ id: string }>;
        {
          const ins = (await tx
            .insert(receiptOrder)
            .values({
              receiptNo,
              receiptDate: receiptDateStr,
              supplierId,
              materialId,
              quantity: String(v.actualQty),
              unit: matResult[0].unit,
              productionDate: v.productionDate,
              batchNo: v.batchNo,
              serialNo: v.serialNo,
              locationId,
              keeperId: userId,
              qrContent: v.qrContent,
              status: 'received',
            })
            .onConflictDoNothing({
              target: [receiptOrder.qrContent],
              where: sql`${receiptOrder.qrContent} IS NOT NULL`,
            })
            .returning({ id: receiptOrder.id })) as Array<{ id: string }>;
          if (ins.length === 0) {
            throw new ConflictException(`该标签已被扫码收货，请勿重复扫描：${v.qrContent}`);
          }
          inserted = ins;
        }

        const receiptId = inserted[0].id;

        // F-01 修复（P0）：与 scanReceipt 同源，改为单条原子 UPSERT（详见 scanReceipt 处注释）。
        // 批量收货按「每条明细」做一次 upsert，冲突目标对齐唯一索引，冲突时原子累加数量、
        // 不覆盖既有行的 label_no / locked / lock_reason。
        const batchNo = v.batchNo || '';
        await tx
          .insert(inventory)
          .values({
            materialId,
            locationId,
            batchNo,
            supplierId,
            quantity: String(v.actualQty),
            unit: matResult[0].unit,
            stockStatus: 'pending_qc',
            productionDate: v.productionDate,
            locked: true,
            lockReason: 'IQC待检',
            // BUG-001 修复（方案 B：全局重编）：批量收货同样写入全局唯一标签号
            // 标签号由事务外预取（reservedLabels），避免 sequence 锁参与事务锁序
            labelNo,
          })
          .onConflictDoUpdate({
            target: INVENTORY_STOCK_CONFLICT_TARGET,
            set: {
              quantity: sql`${inventory.quantity} + ${String(v.actualQty)}::numeric`,
            },
          });

        const detail = await this.getReceiptDetail(receiptId, tx);
        created.push(detail);
      }

      return created;
    });
  }

  async getReceiptList(params: {
    page: number;
    pageSize: number;
    receiptNo?: string;
    supplierCode?: string;
    materialCode?: string;
    batchNo?: string;
    startDate?: string;
    endDate?: string;
    status?: string;
  }): Promise<PaginatedResponse<ReceiptOrder>> {
    const { page, pageSize, receiptNo, supplierCode, materialCode, batchNo, startDate, endDate, status } = params;

    const conditions = [];
    if (receiptNo) conditions.push(like(receiptOrder.receiptNo, `%${receiptNo}%`));
    if (supplierCode) conditions.push(like(supplier.supplierCode, `%${supplierCode}%`));
    if (materialCode) conditions.push(eq(material.materialCode, materialCode));
    if (batchNo) conditions.push(like(receiptOrder.batchNo, `%${batchNo}%`));
    if (startDate) conditions.push(gte(receiptOrder.receiptDate, startDate));
    if (endDate) conditions.push(lt(receiptOrder.receiptDate, endDate));
    if (status) conditions.push(eq(receiptOrder.status, status));
    else {
      // 已提交 IQC 检验的单据不再出现在默认列表（用户口径 2026-10-24）：
      // 仓库只关心「还没交出去」的单子，交出去之后由 IQC 模块负责。
      // 显式按状态筛选时照常返回，保留账务追溯与检验结论查询。
      conditions.push(notInArray(receiptOrder.status, ['pending_iqc', 'iqc_pass', 'iqc_fail']));
    }

    const baseQuery = this.db
      .select({
        id: receiptOrder.id,
        receiptNo: receiptOrder.receiptNo,
        receiptDate: receiptOrder.receiptDate,
        supplierId: receiptOrder.supplierId,
        supplierCode: supplier.supplierCode,
        // 供应商名称按「供应商档案」的 code→name 对应关系带出。
        // 存量数据里 348/365 供应商的名称是空串（早期导入未校验必填所致），
        // 直接返回空会让列表一片空白、看着像 bug，故回退为供应商代码：
        // 既能定位到具体供应商，也提示该档案名称待补。
        supplierName: sql<string>`COALESCE(NULLIF(BTRIM(${supplier.supplierName}), ''), ${supplier.supplierCode})`,
        materialId: receiptOrder.materialId,
        materialCode: material.materialCode,
        materialName: material.materialName,
        quantity: receiptOrder.quantity,
        unit: receiptOrder.unit,
        productionDate: receiptOrder.productionDate,
        batchNo: receiptOrder.batchNo,
        serialNo: receiptOrder.serialNo,
        locationId: receiptOrder.locationId,
        locationCode: warehouseLocation.locationCode,
        keeperId: receiptOrder.keeperId,
        status: receiptOrder.status,
        qrContent: receiptOrder.qrContent,
        remark: receiptOrder.remark,
      })
      .from(receiptOrder)
      .leftJoin(supplier, eq(receiptOrder.supplierId, supplier.id))
      .leftJoin(material, eq(receiptOrder.materialId, material.id))
      .leftJoin(warehouseLocation, eq(receiptOrder.locationId, warehouseLocation.id));

    const whereQuery = conditions.length > 0
      ? baseQuery.where(and(...conditions))
      : baseQuery;

    const countResult = await this.db
      .select({ count: count() })
      .from(receiptOrder)
      .leftJoin(supplier, eq(receiptOrder.supplierId, supplier.id))
      .leftJoin(material, eq(receiptOrder.materialId, material.id))
      .where(conditions.length > 0 ? and(...conditions) : undefined);

    const total = Number(countResult[0]?.count || 0);

    const items = await whereQuery
      .orderBy(desc(receiptOrder.receiptDate), desc(receiptOrder.createdAt))
      .limit(pageSize)
      .offset((page - 1) * pageSize);

    const rawItems = items.map((item: any) => ({
      ...item,
      quantity: Number(item.quantity),
      receiptDate: typeof item.receiptDate === 'string' ? item.receiptDate : item.receiptDate.toISOString().slice(0, 10),
      productionDate: item.productionDate
        ? (typeof item.productionDate === 'string' ? item.productionDate : item.productionDate.toISOString().slice(0, 10))
        : undefined,
    }));
    await this.attachUserNames(rawItems, 'keeperId', 'keeperName');
    return {
      items: rawItems,
      total,
      page,
      pageSize,
    };
  }

  /**
   * 取下一个检验编号：JY + yyyyMMdd + 4位流水（仓库提交报检时生成）
   * IQC 检验报告的报告编号直接使用该编号。
   */
  private async nextInspectionNo(tx: any, datePart: string): Promise<string> {
    const rows = (await tx.execute(
      sql`SELECT nextval('seq_iqc_inspection_no') AS seq`,
    )) as Array<{ seq: string }>;
    const seq = Number(rows[0]?.seq ?? 1);
    return `JY${datePart}${seq.toString().padStart(4, '0')}`;
  }

  /**
   * 只读预览：本次「提交 IQC 检验」会覆盖多少张收料单、合并成多少个检验批次。
   * 与 submitIqc 用同一筛选口径（status='received' 且未关联 IQC 批次），但不写库。
   *
   * 之所以必须有它：submitIqc 的范围是**全库**、不受列表页筛选条件影响，
   * 而按钮就叫「提交IQC检验」、位于筛选卡片左下角 —— 仓管员会以为只提交当前筛选结果。
   * 一次误点可能把 60 个批次推给检验员，且无反向接口。
   */
  async previewSubmitIqc(): Promise<{ receiptCount: number; lotCount: number }> {
    const rows = await this.db
      .select({
        id: receiptOrder.id,
        materialId: receiptOrder.materialId,
        supplierId: receiptOrder.supplierId,
        productionDate: receiptOrder.productionDate,
        batchNo: receiptOrder.batchNo,
      })
      .from(receiptOrder)
      .leftJoin(iqcLotReceipt, eq(receiptOrder.id, iqcLotReceipt.receiptId))
      .where(
        and(
          eq(receiptOrder.status, 'received'),
          isNull(iqcLotReceipt.id),
        ),
      );

    // 与 submitIqc 的分组键保持一致：物料 + 供应商 + 生产日期 + 批次
    const keys = new Set(
      rows.map((r) =>
        [r.materialId, r.supplierId ?? '', String(r.productionDate ?? ''), r.batchNo ?? ''].join('|'),
      ),
    );

    return { receiptCount: rows.length, lotCount: keys.size };
  }

  async submitIqc(operatorId: string): Promise<SubmitIqcResult> {
    return await this.db.transaction(async (tx) => {
      // 1. 查询所有 pending_iqc 且尚未关联 IQC 批次的收料单
      const pendingReceipts = await tx
        .select({
          id: receiptOrder.id,
          receiptNo: receiptOrder.receiptNo,
          receiptDate: receiptOrder.receiptDate,
          supplierId: receiptOrder.supplierId,
          materialId: receiptOrder.materialId,
          quantity: receiptOrder.quantity,
          unit: receiptOrder.unit,
          productionDate: receiptOrder.productionDate,
          batchNo: receiptOrder.batchNo,
          locationId: receiptOrder.locationId,
          locationCode: warehouseLocation.locationCode,
        })
        .from(receiptOrder)
        .leftJoin(
          iqcLotReceipt,
          eq(receiptOrder.id, iqcLotReceipt.receiptId),
        )
        .leftJoin(
          warehouseLocation,
          eq(receiptOrder.locationId, warehouseLocation.id),
        )
        .where(
          and(
            // 修复：暂收(received)的收货单才能提交检验；处理后再置为 pending_iqc
            eq(receiptOrder.status, 'received'),
            isNull(iqcLotReceipt.id),
          ),
        );

      if (pendingReceipts.length === 0) {
        return { createdLotCount: 0, submittedReceiptCount: 0, lotNos: [] };
      }

      // 2. 按 material_id + supplier_id + production_date + batch_no 分组
      interface GroupKey {
        materialId: string;
        supplierId: string;
        productionDate: string | null;
        batchNo: string | null;
      }

      const groupMap = new Map<string, typeof pendingReceipts>();

      for (const r of pendingReceipts) {
        const groupKey: GroupKey = {
          materialId: r.materialId,
          supplierId: r.supplierId,
          productionDate: r.productionDate ?? null,
          batchNo: r.batchNo ?? null,
        };
        const keyStr = JSON.stringify(groupKey);
        if (!groupMap.has(keyStr)) {
          groupMap.set(keyStr, []);
        }
        groupMap.get(keyStr)!.push(r);
      }

      const todayStr = new Date().toISOString().slice(0, 10);
      const datePart = todayStr.replace(/-/g, '');
      const lotPrefix = `IQC${datePart}`;

      const createdLotNos: string[] = [];
      const createdInspectionNos: string[] = [];
      let submittedReceiptCount = 0;

      // ★ 并发串行化（关键）：
      // 先把本次涉及的所有分组键**按字典序排序后依次加事务级 advisory lock**
      // （随事务提交/回滚自动释放）。排序是为了避免多分组并发时互相死锁。
      // 若不加锁，并发事务在「行尚不存在」时读到的都是同一份过期快照，
      // 会各自读到「无进行中批次」并把数量重复累加（实测 totalQty 被放大 10 倍）。
      const lockKeys = Array.from(groupMap.keys()).sort();

      // 【拒绝并批·前置扫描】（用户 2026-10-17）：整批原子，不做逐 key 部分成功；
      // 但 409 必须可操作——把所有「同键 active 批次处于 inspecting/review_pending」的键
      // 以「物料 / 批次 / 检验单 / 状态」拼进 message，让仓管明确知道在等哪一批。
      // 该扫描仅用于组装错误信息；真正的并发/终态守卫仍在下面带 advisory lock 的处理循环里。
      const blockedReporter: string[] = [];
      for (const keyStr of lockKeys) {
        const k: GroupKey = JSON.parse(keyStr);
        const blocked = await tx
          .select({ status: iqcLot.status, lotNo: iqcLot.lotNo, materialCode: material.materialCode })
          .from(iqcLot)
          .leftJoin(material, eq(iqcLot.materialId, material.id))
          .where(and(
            eq(iqcLot.supplierId, k.supplierId),
            eq(iqcLot.materialId, k.materialId),
            k.productionDate !== null ? eq(iqcLot.productionDate, k.productionDate) : isNull(iqcLot.productionDate),
            k.batchNo !== null ? eq(iqcLot.batchNo, k.batchNo) : isNull(iqcLot.batchNo),
            inArray(iqcLot.status, ['inspecting', 'review_pending']),
          ))
          .limit(1);
        if (blocked.length > 0) {
          const st = blocked[0].status === 'review_pending' ? '待审批' : '检验中';
          blockedReporter.push(`物料 ${blocked[0].materialCode ?? k.materialId} / 批次 ${k.batchNo ?? '(空)'}（检验单 ${blocked[0].lotNo}，状态 ${st}）`);
        }
      }
      if (blockedReporter.length > 0) {
        throw new ConflictException(`以下批次正在检验/审批中，请待其完成后再次报检：${blockedReporter.join('；')}`);
      }

      // 3. 每组生成/更新一个 IQC 待检批次
      for (const keyStr of lockKeys) {
        const key: GroupKey = JSON.parse(keyStr);

        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${keyStr}, 881001))`,
        );

        // ★ 加锁后**重读**该组的待提交收货单：
        // 后到的事务此时能看到前一个事务已把收货单置为 pending_iqc，
        // 从而自然变成「无可提交」而不是重复累加。
        const receipts = (await tx
          .select({
            id: receiptOrder.id,
            receiptNo: receiptOrder.receiptNo,
            receiptDate: receiptOrder.receiptDate,
            supplierId: receiptOrder.supplierId,
            materialId: receiptOrder.materialId,
            quantity: receiptOrder.quantity,
            unit: receiptOrder.unit,
            productionDate: receiptOrder.productionDate,
            batchNo: receiptOrder.batchNo,
            locationId: receiptOrder.locationId,
            locationCode: warehouseLocation.locationCode,
          })
          .from(receiptOrder)
          .leftJoin(iqcLotReceipt, eq(receiptOrder.id, iqcLotReceipt.receiptId))
          .leftJoin(warehouseLocation, eq(receiptOrder.locationId, warehouseLocation.id))
          .where(and(
            eq(receiptOrder.status, 'received'),
            isNull(iqcLotReceipt.id),
            eq(receiptOrder.materialId, key.materialId),
            key.supplierId ? eq(receiptOrder.supplierId, key.supplierId) : isNull(receiptOrder.supplierId),
            key.productionDate !== null ? eq(receiptOrder.productionDate, key.productionDate) : isNull(receiptOrder.productionDate),
            key.batchNo !== null ? eq(receiptOrder.batchNo, key.batchNo) : isNull(receiptOrder.batchNo),
          ))
          // 必须限定 `OF receiptOrder`：本查询 leftJoin 了 iqc_lot_receipt / warehouse_location，
          // 而 PostgreSQL 禁止对 outer join 的可空侧加 FOR UPDATE
          // （否则报 0A000 / make_outerjoininfo，提交接口直接 500）。
          .for('update', { of: receiptOrder })) as typeof pendingReceipts;

        // 已被前一个并发事务处理掉 → 跳过，避免数量被重复累加
        if (receipts.length === 0) continue;

        const totalQty = receipts.reduce(
          (sum: number, r: any) => sum + Number(r.quantity || 0),
          0,
        );
        const unit = receipts[0].unit || 'PCS';
        const boxCount = receipts.length;
        // 分组键不含 receipt_date（同物理批次跨日到货并入同一检验单号），
        // 故按组内收货日求「首次收货日(firstReceiptDate)」与「最近到货日(lastReceiptDate)」：
        //   - 新建批次：receiptDate=首次收货日，lastReceiptDate=最近到货日；
        //   - 并批：receiptDate 保持首次不变，lastReceiptDate 刷新为最近到货日。
        const receiptDates = receipts.map((r: any) => r.receiptDate).filter(Boolean).sort();
        const firstReceiptDate: string = receiptDates[0] ?? new Date().toISOString().slice(0, 10);
        const lastReceiptDate: string = receiptDates[receiptDates.length - 1] ?? firstReceiptDate;

        // 查询物料来源
        let materialSource: string | null = null;
        try {
          const matRows = await tx.select({ materialSource: material.materialSource })
            .from(material).where(eq(material.id, key.materialId)).limit(1);
          materialSource = matRows[0]?.materialSource ?? null;
        } catch { /* ignore */ }

        // 收集所有不同的 location_code
        const locationCodeSet = new Set<string>();
        for (const r of receipts) {
          if (r.locationCode) {
            locationCodeSet.add(r.locationCode);
          }
        }
        const locationCodesStr = Array.from(locationCodeSet).sort().join(',');

        // UPSERT: 按 receipt_date + supplier_id + material_id + production_date + batch_no 分组
        // 先尝试查找已存在的批次（只合并「进行中」的批次：
        // 已完成检验的老批次不允许并单，同键新到货会生成全新批次重新检验）
        const existingLot = await tx
          .select({
            id: iqcLot.id,
            lotNo: iqcLot.lotNo,
            status: iqcLot.status,
            totalQty: iqcLot.totalQty,
            locationCodes: iqcLot.locationCodes,
            boxCount: iqcLot.boxCount,
            lastReceiptDate: iqcLot.lastReceiptDate,
          })
          .from(iqcLot)
          .where(
            and(
              // F-11：active 去重键改为 4 列（不含 receipt_date）——同物理批次跨日到货也归同一检验单号
              eq(iqcLot.supplierId, key.supplierId),
              eq(iqcLot.materialId, key.materialId),
              key.productionDate !== null
                ? eq(iqcLot.productionDate, key.productionDate)
                : isNull(iqcLot.productionDate),
              key.batchNo !== null
                ? eq(iqcLot.batchNo, key.batchNo)
                : isNull(iqcLot.batchNo),
              inArray(iqcLot.status, ['pending', 'inspecting', 'review_pending', 'rejected']),
            ),
          )
          // 并发串行化：锁住命中的「进行中」批次行，避免同键下并发重复建批
          .for('update')
          .limit(1);

        let lotId: string;
        let finalLotNo: string;

        if (existingLot.length > 0) {
          const ex = existingLot[0];

          // 【并批策略：拒绝并批】（用户 2026-10-17 决策）
          // 同键 active 批次处于「检验中(inspecting)/待审批(review_pending)」时，新到货不得并入——
          // 否则 total_qty 会在判定后被改动、审批人看到的数量与判定时不一致。
          // 直接抛 409：整批不提交，新货留在 pending_qc 桶，待当前批次完成后再次报检。
          if (ex.status === 'inspecting' || ex.status === 'review_pending') {
            throw new ConflictException(`批次 ${key.batchNo ?? '(空)'}（检验单 ${ex.lotNo}）正在检验/审批中，请待其完成后再次报检`);
          }

          // pending / rejected → 正常并批：累加数量/箱数/库位，刷新 lastReceiptDate；
          // receiptDate 保持「首次收货日」不变。
          lotId = ex.id;
          finalLotNo = ex.lotNo;

          const newQty = Number(ex.totalQty || 0) + totalQty;
          const newBoxCount = Number(ex.boxCount || 0) + boxCount;

          const existingCodes = ex.locationCodes
            ? ex.locationCodes.split(',').filter(Boolean)
            : [];
          const mergedCodes = Array.from(
            new Set([...existingCodes, ...locationCodeSet]),
          ).sort().join(',');

          const prevLast = ex.lastReceiptDate ? String(ex.lastReceiptDate) : '';
          const mergedLast = prevLast && prevLast > lastReceiptDate ? prevLast : lastReceiptDate;

          await tx
            .update(iqcLot)
            .set({
              totalQty: String(newQty),
              locationCodes: mergedCodes,
              boxCount: newBoxCount,
              lastReceiptDate: mergedLast,
            })
            .where(eq(iqcLot.id, lotId));
        } else {
          // 不存在：新建批次，通过 SEQUENCE 原子取号
          const lotSeqRow = await tx.execute<{ seq: string }>(
            sql`SELECT nextval('seq_iqc_lot_no') AS seq`,
          );
          const lotSeq = Number(lotSeqRow[0]?.seq ?? 1);
          const lotNo = `${lotPrefix}${lotSeq.toString().padStart(4, '0')}`;
          // 检验编号：报检即生成，检验报告编号（report_no）直接复用它
          const inspectionNo = await this.nextInspectionNo(tx, datePart);
          const inserted = await tx
            .insert(iqcLot)
            .values({
              lotNo,
              inspectionNo,
              receiptDate: firstReceiptDate,
              lastReceiptDate,
              supplierId: key.supplierId,
              materialId: key.materialId,
              productionDate: key.productionDate ?? undefined,
              batchNo: key.batchNo ?? undefined,
              totalQty: String(totalQty),
              unit,
              locationCodes: locationCodesStr,
              boxCount,
              materialSource: materialSource ?? undefined,
              inspectionResult: 'pending',
              status: 'pending',
            })
            // 并发兜底：DB 侧 iqc_lot_active_dedup_uniq（部分唯一索引，4 列 + NULLS NOT DISTINCT）
            // 保证「同一供应商+物料+生产日期+批次号」在**进行中**状态只有一条。
            // 冲突目标与 WHERE 谓词必须与索引定义字面一致，否则 PG 无法推断仲裁索引 → 23505。
            // 若并发事务抢先插入，这里 do nothing → 回落到下面的复用分支重新读取。
            .onConflictDoNothing({
              target: [
                iqcLot.supplierId,
                iqcLot.materialId,
                iqcLot.productionDate,
                iqcLot.batchNo,
              ],
              where: sql`${iqcLot.status} in ('pending','inspecting','review_pending','rejected')`,
            })
            .returning({ id: iqcLot.id, lotNo: iqcLot.lotNo });

          if (inserted.length > 0) {
            lotId = inserted[0].id;
            finalLotNo = inserted[0].lotNo;
            createdLotNos.push(finalLotNo);
            createdInspectionNos.push(inspectionNo);
          } else {
            // 被并发事务抢先创建 → 复读该批次并并入本次数量
            const raced = await tx
              .select({ id: iqcLot.id, lotNo: iqcLot.lotNo, status: iqcLot.status, totalQty: iqcLot.totalQty, boxCount: iqcLot.boxCount, locationCodes: iqcLot.locationCodes, lastReceiptDate: iqcLot.lastReceiptDate })
              .from(iqcLot)
              .where(and(
                // F-11：4 列 active 键（不含 receipt_date）
                key.supplierId ? eq(iqcLot.supplierId, key.supplierId) : isNull(iqcLot.supplierId),
                eq(iqcLot.materialId, key.materialId),
                key.productionDate !== null ? eq(iqcLot.productionDate, key.productionDate) : isNull(iqcLot.productionDate),
                key.batchNo !== null ? eq(iqcLot.batchNo, key.batchNo) : isNull(iqcLot.batchNo),
                inArray(iqcLot.status, ['pending', 'inspecting', 'review_pending', 'rejected']),
              ))
              .for('update')
              .limit(1);

            if (raced.length === 0) {
              throw new ConflictException('IQC 批次正在被其他请求创建，请刷新后重试');
            }
            // 并发抢先建批成功 → 同样遵守「拒绝并批」：检验中/待审批不允许并入
            if (raced[0].status === 'inspecting' || raced[0].status === 'review_pending') {
              throw new ConflictException(`批次 ${key.batchNo ?? '(空)'}（检验单 ${raced[0].lotNo}）正在检验/审批中，请待其完成后再次报检`);
            }
            lotId = raced[0].id;
            finalLotNo = raced[0].lotNo;
            const mergedCodes = Array.from(new Set([
              ...(raced[0].locationCodes ? raced[0].locationCodes.split(',').filter(Boolean) : []),
              ...locationCodeSet,
            ])).sort().join(',');
            const prevLastR = raced[0].lastReceiptDate ? String(raced[0].lastReceiptDate) : '';
            await tx.update(iqcLot).set({
              totalQty: String(Number(raced[0].totalQty || 0) + totalQty),
              boxCount: Number(raced[0].boxCount || 0) + boxCount,
              locationCodes: mergedCodes,
              lastReceiptDate: prevLastR && prevLastR > lastReceiptDate ? prevLastR : lastReceiptDate,
            }).where(eq(iqcLot.id, lotId));
          }
        }

        // 4. 写入 iqc_lot_receipt 中间表（批量 insert，onConflictDoNothing）
        const lotReceiptValues = receipts.map((r: any) => ({
          lotId,
          receiptId: r.id,
        }));

        await tx
          .insert(iqcLotReceipt)
          .values(lotReceiptValues)
          .onConflictDoNothing();

        // 更新收货单状态：从 received（暂收）改成 pending_iqc（待检验）
        const receiptIds = receipts.map((r: any) => r.id);
        await tx
          .update(receiptOrder)
          .set({ status: 'pending_iqc' })
          .where(inArray(receiptOrder.id, receiptIds));

        submittedReceiptCount += receipts.length;
      }

      return {
        createdLotCount: createdLotNos.length,
        submittedReceiptCount,
        lotNos: createdLotNos,
        inspectionNos: createdInspectionNos,
      };
    });
  }

  async getReceiptDetail(id: string, tx?: any): Promise<ReceiptOrder> {
    const dbConn = tx || this.db;
    const result = await dbConn
      .select({
        id: receiptOrder.id,
        receiptNo: receiptOrder.receiptNo,
        receiptDate: receiptOrder.receiptDate,
        supplierId: receiptOrder.supplierId,
        supplierCode: supplier.supplierCode,
        // 供应商名称按「供应商档案」的 code→name 对应关系带出。
        // 存量数据里 348/365 供应商的名称是空串（早期导入未校验必填所致），
        // 直接返回空会让列表一片空白、看着像 bug，故回退为供应商代码：
        // 既能定位到具体供应商，也提示该档案名称待补。
        supplierName: sql<string>`COALESCE(NULLIF(BTRIM(${supplier.supplierName}), ''), ${supplier.supplierCode})`,
        materialId: receiptOrder.materialId,
        materialCode: material.materialCode,
        materialName: material.materialName,
        quantity: receiptOrder.quantity,
        unit: receiptOrder.unit,
        productionDate: receiptOrder.productionDate,
        batchNo: receiptOrder.batchNo,
        serialNo: receiptOrder.serialNo,
        locationId: receiptOrder.locationId,
        locationCode: warehouseLocation.locationCode,
        keeperId: receiptOrder.keeperId,
        status: receiptOrder.status,
        qrContent: receiptOrder.qrContent,
        remark: receiptOrder.remark,
      })
      .from(receiptOrder)
      .leftJoin(supplier, eq(receiptOrder.supplierId, supplier.id))
      .leftJoin(material, eq(receiptOrder.materialId, material.id))
      .leftJoin(warehouseLocation, eq(receiptOrder.locationId, warehouseLocation.id))
      .where(eq(receiptOrder.id, id))
      .limit(1);

    if (result.length === 0) {
      throw new NotFoundException('收料单不存在');
    }

    const item = result[0] as any;
    const detail = {
      ...item,
      quantity: Number(item.quantity),
      receiptDate: typeof item.receiptDate === 'string' ? item.receiptDate : item.receiptDate.toISOString().slice(0, 10),
      productionDate: item.productionDate
        ? (typeof item.productionDate === 'string' ? item.productionDate : item.productionDate.toISOString().slice(0, 10))
        : undefined,
    };
    await this.attachUserNames([detail], 'keeperId', 'keeperName', dbConn);
    return detail;
  }
}


