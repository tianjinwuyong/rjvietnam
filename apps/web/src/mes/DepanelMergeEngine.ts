/**
 * DepanelMergeEngine — 纯函数引擎
 * 输入ICT records + FCT records → 输出合并母板 + NG分类
 *
 * NG分类规则：
 *   ICT_ONLY_NG  — ICT FAIL 且 FCT PASS（含FCT未测）
 *   FCT_ONLY_NG  — ICT PASS 且 FCT FAIL
 *   ICT_FCT_NG   — ICT FAIL 且 FCT FAIL（最严重，触发8D）
 *   PASS         — ICT PASS 且 FCT PASS
 *   EMPTY        — 无数据
 */

export type BoardResult = 'PASS' | 'FAIL' | 'NG' | 'EMPTY';
export type NgCategory = 'ICT_ONLY_NG' | 'FCT_ONLY_NG' | 'ICT_FCT_NG' | 'PASS' | 'EMPTY';
export type DepanelMethod = 'V_CUT' | 'ROUTER' | 'LASER' | 'BREAK' | 'UNKNOWN';

export interface TestRecord {
  sn?: string;
  pcbSerial?: string;
  result?: string;
  finalResult?: string;
  overallResult?: string;
  channel?: string | number;
  slot?: number;
  testCount?: number;
  retestRemaining?: number;
  errorCode?: string;
  defectCode?: string;
  defectDescription?: string;
  testTime?: string;
  batchId?: string;
  motherboardId?: string;
  testCycleId?: string;
  eventType?: string;
  time?: string | number;
  firstDetectedAt?: string | number;
  firstFailureTime?: string | number;
  createdAt?: string | number;
  // Depanel特有
  method?: DepanelMethod;
  routerBitUsage?: number;
  panelsCount?: number;
  // ICT特有
  fixture?: string;
  program?: string;
  failedItems?: unknown[];
  // FCT特有
  firmwareVersion?: string;
  testDuration?: number;
  failedTests?: unknown[];
}

export interface MergedBoard {
  /** 母板ID */
  boardId: string;
  /** 母板含板数 */
  panelsCount: number;
  /** 槽位数组（1-12） */
  slots: BoardSlot[];
  /** NG分类 */
  ngCategory: NgCategory;
  /** ICT结果 */
  ictResult: BoardResult;
  /** FCT结果 */
  fctResult: BoardResult;
  /** ICT NG总数 */
  ictNgCount: number;
  /** FCT NG总数 */
  fctNgCount: number;
  /** 合并时间 */
  mergedAt: number;
}

export interface BoardSlot {
  slot: number;
  sn: string;
  channel: string;
  ictResult: BoardResult;
  fctResult: BoardResult;
  defectCode: string;
  defectDescription: string;
  testCount: number;
  retestRemaining: number;
}

export interface DepanelMergeOptions {
  /** ICT记录 */
  ictRecords: TestRecord[];
  /** FCT记录 */
  fctRecords: TestRecord[];
  /** 槽位数（默认12） */
  slotCount?: number;
  /** 合并策略 */
  strategy?: 'MOTHERBOARD' | 'INDEPENDENT';
  /** FCT只测部分SN时，未测的SN是否标记为FCT_PASS（默认true） */
  treatUntestedAsPass?: boolean;
}

function resolveResult(record: TestRecord): BoardResult {
  const r = String(record.finalResult ?? record.result ?? record.overallResult ?? '').toUpperCase();
  if (r === 'FAIL' || r === 'NG') return 'FAIL';
  if (r === 'PASS') return 'PASS';
  return 'EMPTY';
}

function resolveSn(record: TestRecord): string {
  return String(record.sn ?? record.pcbSerial ?? '').trim().toUpperCase();
}

function resolveChannel(record: TestRecord): string {
  return String(record.channel ?? record.slot ?? '').trim();
}

function resolveBatchId(records: TestRecord[]): string {
  for (const r of records) {
    const id = String(r.batchId ?? r.motherboardId ?? '').trim();
    if (id) return id;
  }
  return '';
}

/**
 * 解析测试记录中的channel为L/R+数字格式
 * 例如: "L1"→{side:'L',pos:1}, "R3"→{side:'R',pos:3}
 */
function parseChannel(channel: string): { side: 'L' | 'R'; pos: number } | null {
  const m = /^([LR])([1-8])$/i.exec(channel.trim());
  if (!m) return null;
  return { side: m[1].toUpperCase() as 'L' | 'R', pos: Number(m[2]) };
}

/**
 * 将channel转换为槽位号（1-12）
 * L1→1, L2→2, ..., L8→8, R1→9, R2→10, ..., R8→16
 */
function channelToSlot(channel: string, slotCount = 12): number {
  const parsed = parseChannel(channel);
  if (!parsed) return 0;
  return parsed.side === 'L' ? parsed.pos : parsed.pos + slotCount / 2;
}

/**
 * 分类单个合并板的NG类别
 */
function categorizeBoard(
  ictResult: BoardResult,
  fctResult: BoardResult,
): NgCategory {
  if (ictResult === 'FAIL' && fctResult === 'FAIL') return 'ICT_FCT_NG';
  if (ictResult === 'FAIL') return 'ICT_ONLY_NG';
  if (fctResult === 'FAIL') return 'FCT_ONLY_NG';
  if (ictResult === 'EMPTY' && fctResult === 'EMPTY') return 'EMPTY';
  return 'PASS';
}

/**
 * 核心合并函数
 */
export function mergeDepanelRecords(options: DepanelMergeOptions): {
  boards: MergedBoard[];
  summary: {
    totalBoards: number;
    ictNgCount: number;
    fctNgCount: number;
    ictOnlyNgCount: number;
    fctOnlyNgCount: number;
    ictFctNgCount: number;
    passCount: number;
  };
} {
  const {
    ictRecords,
    fctRecords,
    slotCount = 12,
    strategy = 'MOTHERBOARD',
    treatUntestedAsPass = true,
  } = options;

  // 建立SN→ICT记录的映射
  const ictBySn = new Map<string, TestRecord>();
  for (const r of ictRecords) {
    const sn = resolveSn(r);
    if (sn) ictBySn.set(sn, r);
  }

  // 建立SN→FCT记录的映射
  const fctBySn = new Map<string, TestRecord>();
  for (const r of fctRecords) {
    const sn = resolveSn(r);
    if (sn) fctBySn.set(sn, r);
  }

  // 收集所有出现过的SN
  const allSn = new Set([...ictBySn.keys(), ...fctBySn.keys()]);

  if (strategy === 'MOTHERBOARD') {
    // 母板模式：以batchId分组
    const byBatch = new Map<string, { ict: TestRecord[]; fct: TestRecord[]; snSet: Set<string> }>();

    for (const [sn, ictRec] of ictBySn) {
      const batchId = String(ictRec.batchId ?? ictRec.motherboardId ?? sn).trim();
      if (!byBatch.has(batchId)) {
        byBatch.set(batchId, { ict: [], fct: [], snSet: new Set() });
      }
      byBatch.get(batchId)!.ict.push(ictRec);
      byBatch.get(batchId)!.snSet.add(sn);
    }

    for (const [sn, fctRec] of fctBySn) {
      const batchId = String(fctRec.batchId ?? fctRec.motherboardId ?? sn).trim();
      if (!byBatch.has(batchId)) {
        byBatch.set(batchId, { ict: [], fct: [], snSet: new Set() });
      }
      byBatch.get(batchId)!.fct.push(fctRec);
      byBatch.get(batchId)!.snSet.add(sn);
    }

    const boards: MergedBoard[] = [];
    let totalIctNg = 0;
    let totalFctNg = 0;

    for (const [batchId, { ict, fct }] of byBatch) {
      const ictByChannel = new Map<string, TestRecord>();
      for (const r of ict) {
        const ch = resolveChannel(r);
        if (ch) ictByChannel.set(ch, r);
      }

      const fctByChannel = new Map<string, TestRecord>();
      for (const r of fct) {
        const ch = resolveChannel(r);
        if (ch) fctByChannel.set(ch, r);
      }

      const slots: BoardSlot[] = Array.from({ length: slotCount }, (_, i) => {
        const ch = i < slotCount / 2 ? `L${i + 1}` : `R${i - slotCount / 2 + 1}`;
        const ictRec = ictByChannel.get(ch);
        const fctRec = fctByChannel.get(ch);

        const ictRes = ictRec ? resolveResult(ictRec) : 'EMPTY';
        const fctRes = fctRec ? resolveResult(fctRec)
          : (treatUntestedAsPass && (ictRes !== 'EMPTY' || fctBySn.size > 0)) ? 'PASS'
          : 'EMPTY';

        const defectCode = ictRec
          ? String(ictRec.errorCode ?? ictRec.defectCode ?? '')
          : (fctRec ? String(fctRec.errorCode ?? fctRec.defectCode ?? '') : '');

        return {
          slot: i + 1,
          sn: ictRec ? resolveSn(ictRec) : (fctRec ? resolveSn(fctRec) : ''),
          channel: ch,
          ictResult: ictRes,
          fctResult: fctRes,
          defectCode,
          defectDescription: ictRec
            ? String(ictRec.defectDescription ?? ictRec.defectCode ?? '')
            : String(fctRec?.defectDescription ?? fctRec?.defectCode ?? ''),
          testCount: Number(ictRec?.testCount ?? fctRec?.testCount ?? 1),
          retestRemaining: Number(ictRec?.retestRemaining ?? fctRec?.retestRemaining ?? 0),
        };
      });

      const ictNgCount = slots.filter(s => s.ictResult === 'FAIL').length;
      const fctNgCount = slots.filter(s => s.fctResult === 'FAIL').length;
      const ictRes0 = ictNgCount > 0 ? 'FAIL' : (ict.some(r => resolveResult(r) === 'PASS') ? 'PASS' : 'EMPTY');
      const fctRes0 = fctNgCount > 0 ? 'FAIL' : (fct.some(r => resolveResult(r) === 'PASS') ? 'PASS' : 'EMPTY');
      const ngCategory = categorizeBoard(ictRes0, fctRes0);

      boards.push({
        boardId: batchId,
        panelsCount: slots.filter(s => s.sn).length || slotCount,
        slots,
        ngCategory,
        ictResult: ictRes0,
        fctResult: fctRes0,
        ictNgCount,
        fctNgCount,
        mergedAt: Date.now(),
      });

      totalIctNg += ictNgCount;
      totalFctNg += fctNgCount;
    }

    return {
      boards,
      summary: {
        totalBoards: boards.length,
        ictNgCount: totalIctNg,
        fctNgCount: totalFctNg,
        ictOnlyNgCount: boards.filter(b => b.ngCategory === 'ICT_ONLY_NG').length,
        fctOnlyNgCount: boards.filter(b => b.ngCategory === 'FCT_ONLY_NG').length,
        ictFctNgCount: boards.filter(b => b.ngCategory === 'ICT_FCT_NG').length,
        passCount: boards.filter(b => b.ngCategory === 'PASS').length,
      },
    };
  } else {
    // 独立模式：每个SN独立一张板
    const boards: MergedBoard[] = [];
    let totalIctNg = 0;
    let totalFctNg = 0;

    for (const sn of allSn) {
      const ictRec = ictBySn.get(sn);
      const fctRec = fctBySn.get(sn);
      const ictRes = ictRec ? resolveResult(ictRec) : 'EMPTY';
      const fctRes = fctRec ? resolveResult(fctRec) : (treatUntestedAsPass ? 'PASS' : 'EMPTY');

      const defectCode = ictRec
        ? String(ictRec.errorCode ?? ictRec.defectCode ?? '')
        : String(fctRec?.errorCode ?? fctRec?.defectCode ?? '');

      const slot: BoardSlot = {
        slot: 1,
        sn,
        channel: resolveChannel(ictRec ?? fctRec ?? { channel: '' } as TestRecord),
        ictResult: ictRes,
        fctResult: fctRes,
        defectCode,
        defectDescription: ictRec
          ? String(ictRec.defectDescription ?? ictRec.defectCode ?? '')
          : String(fctRec?.defectDescription ?? fctRec?.defectCode ?? ''),
        testCount: Number(ictRec?.testCount ?? fctRec?.testCount ?? 1),
        retestRemaining: Number(ictRec?.retestRemaining ?? fctRec?.retestRemaining ?? 0),
      };

      const ictNgCount = ictRes === 'FAIL' ? 1 : 0;
      const fctNgCount = fctRes === 'FAIL' ? 1 : 0;

      boards.push({
        boardId: sn,
        panelsCount: 1,
        slots: [slot],
        ngCategory: categorizeBoard(ictRes, fctRes),
        ictResult: ictRes,
        fctResult: fctRes,
        ictNgCount,
        fctNgCount,
        mergedAt: Date.now(),
      });

      totalIctNg += ictNgCount;
      totalFctNg += fctNgCount;
    }

    return {
      boards,
      summary: {
        totalBoards: boards.length,
        ictNgCount: totalIctNg,
        fctNgCount: totalFctNg,
        ictOnlyNgCount: boards.filter(b => b.ngCategory === 'ICT_ONLY_NG').length,
        fctOnlyNgCount: boards.filter(b => b.ngCategory === 'FCT_ONLY_NG').length,
        ictFctNgCount: boards.filter(b => b.ngCategory === 'ICT_FCT_NG').length,
        passCount: boards.filter(b => b.ngCategory === 'PASS').length,
      },
    };
  }
}

/**
 * 按NG分类过滤boards
 */
export function filterByNgCategory(
  boards: MergedBoard[],
  categories: NgCategory[],
): MergedBoard[] {
  const catSet = new Set(categories);
  return boards.filter(b => catSet.has(b.ngCategory));
}

/**
 * 统计NG分类分布（用于帕累托）
 */
export function ngCategoryPareto(
  boards: MergedBoard[],
): { category: NgCategory; count: number; pct: number }[] {
  const counts: Partial<Record<NgCategory, number>> = {};
  for (const b of boards) {
    if (b.ngCategory !== 'PASS' && b.ngCategory !== 'EMPTY') {
      counts[b.ngCategory] = (counts[b.ngCategory] ?? 0) + 1;
    }
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return Object.entries(counts)
    .map(([category, count]) => ({ category: category as NgCategory, count: count ?? 0, pct: total > 0 ? ((count ?? 0) / total) * 100 : 0 }))
    .sort((a, b) => b.count - a.count);
}

/**
 * 生成Depanel NG迁移Payload（用于maintenance-handovers API）
 */
export function buildDepanelNgMigrationPayload(
  boards: MergedBoard[],
  category: NgCategory,
  operator: string,
  role: 'OPERATOR' | 'QC',
): object {
  const filtered = filterByNgCategory(boards, [category]);
  const items = filtered.flatMap(b =>
    b.slots
      .filter(s => {
        if (category === 'ICT_ONLY_NG') return s.ictResult === 'FAIL';
        if (category === 'FCT_ONLY_NG') return s.fctResult === 'FAIL';
        if (category === 'ICT_FCT_NG') return s.ictResult === 'FAIL' || s.fctResult === 'FAIL';
        return false;
      })
      .map(s => ({
        sn: s.sn,
        batchId: b.boardId,
        defectCode: s.defectCode,
        defectDescription: s.defectDescription,
        ictResult: s.ictResult,
        fctResult: s.fctResult,
      })),
  );

  return {
    sourceStation: 'manu_depanel',
    sourceStationName: 'Depanel',
    ngCategory: category,
    ngSn: items.map(i => i.sn).join(','),
    batchId: filtered.map(b => b.boardId).join(','),
    defectCode: category,
    defectType: category,
    members: items,
    confirmedBy: operator,
    confirmedRole: role,
    submittedBy: operator,
    submittedRole: role,
    clickedAt: Date.now(),
    firstDetectedAt: Date.now(),
    boardCount: filtered.length,
    unitCount: items.length,
  };
}
