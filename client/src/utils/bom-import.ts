// xlsx 只在「下载模板 / 解析导入文件」时才用得到，没必要进首屏包。
// 改为按需动态加载（首次点击时才下载 chunk），可把约 800KB 移出首屏。
let xlsxModule: Promise<typeof import('xlsx')> | null = null;
const loadXLSX = () => (xlsxModule ??= import('xlsx'));
import type { BomItemInput } from '@client/src/api/bom';
import { translate, tf } from '@client/src/i18n';

export const BOM_TEMPLATE_HEADERS_ZH = [
  '序号',
  '物料编码',
  '越南料号',
  '物料名称',
  '规格',
  '单位(PCS)',
  '用量',
  '工段(SMT/插件/组装/包装)',
  '备注',
];

export const BOM_TEMPLATE_HEADERS_EN = [
  'No.',
  'Material Code',
  'Vietnam Code',
  'Material Name',
  'Specification',
  'Unit',
  'Qty',
  'Work Section (SMT/DIP/Assembly/Packing)',
  'Remark',
];

export const BOM_TEMPLATE_HEADERS_VI = [
  'STT',
  'Mã vật tư',
  'Mã Việt Nam',
  'Tên vật tư',
  'Quy cách',
  'Đơn vị',
  'Số lượng',
  'Công đoạn (SMT/DIP/Lắp ráp/Đóng gói)',
  'Ghi chú',
];

// 可通过表头识别的字段名
 type HeaderField = 'seqNo' | 'materialCode' | 'vietnamCode' | 'materialName' |
  'specification' | 'unit' | 'quantity' | 'workSection' | 'remark';

// 列字段同义词映射（中/英/越混合，表头可能为任意一种语言）
const HEADER_SYNONYMS: Record<HeaderField, string[]> = {
  seqNo: ['序号', 'No.', 'STT', '编号'],
  materialCode: ['物料编码', 'Material Code', 'Mã vật tư', '料号', '物料号', 'Part No.', 'Part Number'],
  vietnamCode: ['越南料号', 'Vietnam Code', 'Mã Việt Nam', '越南料号编码', 'VN Code', '越南编码', '越料号', '越料'],
  materialName: ['物料名称', 'Material Name', 'Tên vật tư', '品名', '名称', 'Description'],
  specification: ['规格', 'Specification', 'Quy cách', '规格型号', '型号', 'Spec'],
  unit: ['单位', 'Unit', 'Đơn vị', '单位(PCS)', '单位（PCS）', '计量单位', '单位(个)', '单位（PCS）', '单 位'],
  quantity: ['用量', 'Qty', 'Số lượng', '数量', '使用量', 'Quantity', '单耗', '标准用量', '定额'],
  workSection: ['工段', 'Work Section', 'Công đoạn', '工序', '生产工段', '工段(SMT/插件/组装/包装)', '工段(SMT/DIP/Assembly/Packing)'],
  remark: ['备注', 'Remark', 'Ghi chú', '说明', 'Note', '备注说明'],
};

// 标准工段映射（未匹配到的按原文保存）
const WORK_SECTION_MAP: Record<string, string> = {
  'SMT': 'smt',
  'SMT贴片': 'smt',
  'smt': 'smt',
  'DIP': 'dip',
  'DIP插件': 'dip',
  'dip': 'dip',
  '插件': 'dip',
  'Assembly': 'assembly',
  'assembly': 'assembly',
  '组装': 'assembly',
  'Packing': 'packing',
  'packing': 'packing',
  '包装': 'packing',
  'Lắp ráp': 'assembly',
  'Đóng gói': 'packing',
};

export interface ImportResult {
  items: BomItemInput[];
  errors: string[];
}

/**
 * 表头列索引 → 字段名 的映射
 * 排除 seqNo（序号列仅跳过）
 */
type ColumnMapping = Partial<Record<Exclude<keyof BomItemInput, 'materialId' | 'sortOrder'>, number>>;

/**
 * 根据表头行构建列名 → 列索引的映射
 * 使用模糊匹配（includes），trim 后比较
 */
function buildColumnMapping(headerRow: unknown[]): ColumnMapping {
  const mapping: ColumnMapping = {};
  const targetFields = Object.keys(HEADER_SYNONYMS).filter(
    (f): f is Exclude<HeaderField, 'seqNo'> => f !== 'seqNo',
  );

  headerRow.forEach((cell, colIndex) => {
    const header = String(cell ?? '').trim();
    if (!header) return;

    for (const field of targetFields) {
      const synonyms = HEADER_SYNONYMS[field];
      const matched = synonyms.some((syn: string) => header.includes(syn));
      if (matched) {
        // 已匹配过的字段不再覆盖（取第一列）
        if (mapping[field as keyof ColumnMapping] === undefined) {
          mapping[field as keyof ColumnMapping] = colIndex;
        }
        break;
      }
    }
  });

  return mapping;
}

export async function downloadBomTemplate(lang: 'zh' | 'en' | 'vi' = 'zh'): Promise<void> {
  const XLSX = await loadXLSX();
  const headers =
    lang === 'en'
      ? BOM_TEMPLATE_HEADERS_EN
      : lang === 'vi'
        ? BOM_TEMPLATE_HEADERS_VI
        : BOM_TEMPLATE_HEADERS_ZH;

  const sampleRow =
    lang === 'en'
      ? ['1', 'MAT001', 'VN-MAT001', 'Resistor 10K', '0805 1%', 'PCS', 100, 'SMT', 'Sample']
      : lang === 'vi'
        ? ['1', 'MAT001', 'VN-MAT001', 'Điện trở 10K', '0805 1%', 'PCS', 100, 'SMT', 'Mẫu']
        : ['1', 'MAT001', 'VN-MAT001', '电阻 10K', '0805 1%', 'PCS', 100, 'SMT', '示例'];

  const ws = XLSX.utils.aoa_to_sheet([headers, sampleRow]);
  ws['!cols'] = [
    { wch: 6 },
    { wch: 16 },
    { wch: 16 },
    { wch: 24 },
    { wch: 16 },
    { wch: 10 },
    { wch: 10 },
    { wch: 28 },
    { wch: 16 },
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'BOM');
  XLSX.writeFile(wb, 'BOM_template.xlsx');
}

/**
 * 解析 BOM Excel 文件
 * 支持 .xls 和 .xlsx 格式（xlsx 库底层自动识别）
 * @param file - 上传的 Excel 文件（.xls 或 .xlsx）
 */
export async function parseBomExcel(file: File): Promise<ImportResult> {
  const XLSX = await loadXLSX();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target?.result as ArrayBuffer);
        // XLSX.read 的 type: 'array' 同时支持 .xlsx 和 .xls (BIFF) 格式
        const workbook = XLSX.read(data, { type: 'array', cellDates: true, cellNF: false });
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        const jsonRows = XLSX.utils.sheet_to_json<unknown[]>(worksheet, { header: 1 });

        if (jsonRows.length < 2) {
          resolve({ items: [], errors: [translate('ui.Excel 内容为空或缺少数据行')] });
          return;
        }

        // 智能定位表头行：跳过空行/标题行，找到包含"物料编码"或"料号"的行作为表头
        let headerRowIndex = 0;
        for (let i = 0; i < Math.min(jsonRows.length, 10); i++) {
          const row = jsonRows[i];
          if (!row || row.length === 0) continue;
          const hasMaterialCode = row.some((cell: unknown) => {
            const s = String(cell ?? '').trim();
            return s.includes('物料编码') || s.includes('料号') || s.includes('Material Code') || s.includes('Mã vật tư') || s.includes('Part No');
          });
          if (hasMaterialCode) {
            headerRowIndex = i;
            break;
          }
        }

        const headerRow = jsonRows[headerRowIndex];
        const colMap = buildColumnMapping(headerRow);

        // 物料编码和用量是必填列，必须识别到
        if (colMap.materialCode === undefined) {
          resolve({ items: [], errors: [translate('ui.未识别到物料编码列，请检查表头格式')] });
          return;
        }
        if (colMap.quantity === undefined) {
          resolve({ items: [], errors: [translate('ui.未识别到用量列，请检查表头格式')] });
          return;
        }

        const dataRows = jsonRows.slice(headerRowIndex + 1);
        const items: BomItemInput[] = [];
        const errors: string[] = [];

        dataRows.forEach((row, idx) => {
          const rowNum = idx + 2;

          const getCell = (field: keyof ColumnMapping): string => {
            const colIndex = colMap[field];
            if (colIndex === undefined) return '';
            return String(row[colIndex] ?? '').trim();
          };

          const materialCode = getCell('materialCode');
          const vietnamCode = getCell('vietnamCode');
          const materialName = getCell('materialName');
          const specification = getCell('specification');
          const unitRaw = getCell('unit');
          const qtyRaw = colMap.quantity !== undefined ? row[colMap.quantity] : '';
          const workSectionRaw = getCell('workSection');
          const remark = getCell('remark');

          // 完全空行跳过（物料编码、物料名称、用量都为空时跳过）
          if (!materialCode && !materialName && (qtyRaw === '' || qtyRaw === undefined || qtyRaw === null)) {
            return;
          }

          const rowErrors: string[] = [];

          if (!materialCode) {
            rowErrors.push(translate('ui.物料编码不能为空'));
          }

          const qty = Number(qtyRaw);
          if (qtyRaw === undefined || qtyRaw === null || qtyRaw === '' || isNaN(qty)) {
            rowErrors.push(translate('ui.用量必须是数字'));
          }

          if (rowErrors.length > 0) {
            errors.push(tf('ui.第 {n} 行：{msgs}', { n: rowNum, msgs: rowErrors.join('；') }));
            return;
          }

          // 工段：匹配到标准工段则规范化，否则按原文保存（工段允许为空，默认 smt）
          const workSectionNormalized = WORK_SECTION_MAP[workSectionRaw];
          const workSection = workSectionRaw
            ? (workSectionNormalized ?? workSectionRaw)
            : 'smt';

          // 单位：原文存储，空则默认 'PCS'
          const unit = unitRaw || 'PCS';

          // 越南料号允许为空（用户真实文件中整列可能为空）
          // 物料名称允许为空时取物料编码兜底
          const finalMaterialName = materialName || materialCode;

          items.push({
            materialId: undefined,
            materialCode,
            vietnamCode: vietnamCode || undefined,
            materialName: finalMaterialName,
            specification: specification || undefined,
            unit,
            quantity: qty,
            workSection,
            sortOrder: items.length,
            remark: remark || undefined,
          });
        });

        resolve({ items, errors });
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}
