/**
 * IQC 进料检验报告 —— 报告稿（屏幕预览 + 打印共用同一份模板）
 *
 * 针对「打印命令不生效 / 排版差」的根因做的设计：
 * 1. 打印稿通过 portal 独立挂在 body 下，打印时直接把整个应用界面 display:none，
 *    只留报告稿。旧实现用 `body * { visibility: hidden }` + 绝对定位，
 *    被隐藏的元素仍然占据布局高度，导致内容被挤到第 2 页、产生大片空白页。
 * 2. 报告稿是纯静态内容（没有 <input>/<Badge>），打印结果与屏幕预览完全一致，
 *    不会出现输入框边框、单元格被裁切、值显示不全等屏幕组件带进打印的问题。
 * 3. 表头放在 <thead>，表格跨页时自动重复表头；数据行 break-inside:avoid，不被拦腰截断。
 * 4. 同一份模板既用于屏幕预览（.iqc-preview-frame 白纸效果）也用于打印，
 *    所见即所得，不再有两套排版各自演化。
 */
import React from 'react';
import { createPortal } from 'react-dom';
import { isOutOfSpec } from '@client/src/utils/spec-parser';
import { useI18n } from '@client/src/i18n';

/** 打印时间按当前界面语言格式化 */
function getDateTimeLocale(): string {
  try {
    const saved = localStorage.getItem('wms-lang');
    if (saved === 'vi') return 'vi-VN';
    if (saved === 'en') return 'en-US';
  } catch {
    /* 忽略 */
  }
  return 'zh-CN';
}
import type { PrintSection } from './printModel';

export interface PrintHeaderPair {
  label: string;
  value: React.ReactNode;
  /** 独占一整行（如备注、仓库地址码） */
  full?: boolean;
}

export interface IqcReportSheetProps {
  /** 表头字段（每行 4 组「标签 + 值」，full=true 独占一行） */
  pairs: PrintHeaderPair[];
  /** 右上角文件编号 */
  docNo?: string;
  /** 报告编号 */
  reportNo?: string;
  sections: PrintSection[];
  remark?: string;
  /** 是否输出签字行 */
  showSignRow?: boolean;
  passLabel?: string;
  failLabel?: string;
}

type IqcReportPrintDocProps = IqcReportSheetProps;

/**
 * 尺寸&功能 列宽（9 列）
 * 依「Spec / 检验项目收窄、测量数据加宽」调整：
 * 抽样方案/AQL、抽样数、Ac、Re、检验项目、Spec、测量数据、不良数、判定
 */
const DIM_COLS = ['14%', '6%', '4%', '4%', '12%', '9%', '35%', '8%', '8%'];
/** 其余分节 列宽（10 列，含序号） */
const STD_COLS = ['4%', '13%', '21%', '11%', '7%', '5%', '5%', '6%', '19%', '9%'];

/**
 * 报告稿样式：.iqc-sheet 的视觉规则屏幕与打印通用。
 * 只有「打印稿在屏幕隐藏」「打印时隐藏应用界面」「纸张尺寸」是分媒体的。
 */
const SHEET_CSS = `
/* ===== 屏幕：打印稿（portal）不显示，应用内用 .iqc-preview-frame 预览 ===== */
#iqc-print-root { display: none !important; }

/* ===== 报告稿视觉（屏幕预览与打印共用） ===== */
.iqc-sheet {
  font-family: "Microsoft YaHei", "微软雅黑", "PingFang SC", "Heiti SC", SimSun, sans-serif;
  color: #000;
  background: #fff;
  line-height: 1.35;
}
.iqc-sheet table {
  width: 100%;
  max-width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}
.iqc-sheet th,
.iqc-sheet td {
  border: 1px solid #000;
  padding: 2px 3px;
  vertical-align: middle;
  word-break: break-word;
  overflow-wrap: anywhere;
  white-space: normal;
  /* 内容自适应：绝不裁切，放不下就换行、撑高行 */
  overflow: visible;
  text-overflow: clip;
}
.iqc-sheet thead { display: table-header-group; }
.iqc-sheet tr { break-inside: avoid; page-break-inside: avoid; }

.iqc-sheet .c { text-align: center; }
.iqc-sheet .l { text-align: left; }
.iqc-sheet .b { font-weight: 700; }

.iqc-sheet .doc-hd {
  position: relative;
  text-align: center;
  font-size: 2em;
  font-weight: 700;
  letter-spacing: 2px;
  padding: 6px 3px !important;
}
.iqc-sheet .doc-hd-no {
  position: absolute;
  right: 4px;
  top: 50%;
  transform: translateY(-50%);
  font-size: 0.5em;
  font-weight: 400;
  letter-spacing: 0;
  text-align: right;
  line-height: 1.5;
}

/* ===== 底色：报告全局纯白（不铺任何灰底/底色） ===== */
.iqc-sheet .lbl {
  text-align: center;
  font-weight: 700;
  background: #fff;
}

.iqc-sheet .sec-hd {
  text-align: left;
  font-weight: 700;
  background: #fff;
  padding-left: 6px !important;
  break-after: avoid;
  page-break-after: avoid;
}
.iqc-sheet .col-hd { background: #fff; }

/* 测量数据：不设最小宽度、按内容自适应，支持小数点后 2~3 位不换行截断 */
.iqc-sheet .measured-wrap {
  line-height: 1.75;
  font-size: 0.94em;
  padding: 2px 2px !important;
}
.iqc-sheet .mv {
  display: inline-block;
  min-width: 0;
  text-align: center;
  border: 1px solid #999;
  padding: 0 2px;
  margin: 0 1px 1px 0;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
/* 超差数值：纯白底 + 加粗加框突出（不铺底色） */
.iqc-sheet .mv-ng {
  background: #fff;
  font-weight: 700;
  border: 1.2px solid #000;
}

.iqc-sheet .ok { color: #0a7d28; font-weight: 700; }
.iqc-sheet .ng { color: #c00000; font-weight: 700; }
.iqc-sheet .foot { font-size: 0.95em; color: #333; }
.iqc-sheet .sign-line { height: 24px; }

/* ===== 应用内预览：白纸观感（同纯白底，靠描边区分纸张边界） ===== */
.iqc-preview-frame {
  background: #fff;
  padding: 16px;
  overflow-x: auto;
}
.iqc-preview-frame .iqc-sheet {
  width: 1120px;
  margin: 0 auto;
  padding: 10mm 8mm;
  border: 1px solid #d9d9d9;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.16);
  font-size: 10px;
}

/* ===== 打印 ===== */
@media print {
  @page { size: A4 landscape; margin: 8mm 8mm 9mm; }

  /* 打印时移除整个应用界面，只留报告稿 */
  body > *:not(#iqc-print-root):not(style):not(script):not(link) { display: none !important; }
  #iqc-print-root { display: block !important; }

  html, body {
    margin: 0 !important;
    padding: 0 !important;
    background: #fff !important;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }

  #iqc-print-root .iqc-sheet {
    width: auto !important;
    margin: 0 !important;
    padding: 0 !important;
    box-shadow: none !important;
    font-size: 8.5pt;
  }
  #iqc-print-root .iqc-sheet th,
  #iqc-print-root .iqc-sheet td {
    border: 0.6pt solid #000 !important;
    padding: 2px 3px !important;
  }
}
`;

/** 把标签值对按每行 4 组切分 */
function buildHeaderRows(pairs: PrintHeaderPair[]): PrintHeaderPair[][] {
  const rows: PrintHeaderPair[][] = [];
  let cur: PrintHeaderPair[] = [];
  for (const p of pairs) {
    if (p.full) {
      if (cur.length) {
        rows.push(cur);
        cur = [];
      }
      rows.push([p]);
    } else {
      cur.push(p);
      if (cur.length === 4) {
        rows.push(cur);
        cur = [];
      }
    }
  }
  if (cur.length) rows.push(cur);
  return rows;
}

/** 报告稿本体：屏幕预览与打印共用，保证所见即所得 */
export const IqcReportSheet: React.FC<IqcReportSheetProps> = ({
  pairs,
  docNo = 'DT/IQC/JY-001 1.0',
  reportNo,
  sections,
  remark,
  /** 是否输出签字行（表头已有检验员/批准信息，默认不输出） */
  showSignRow = false,
  passLabel,
  failLabel,
}) => {
  const { t } = useI18n();
  // 判定列文案兜底：调用方（报告查看页 / 检验填写页）都没传 passLabel/failLabel，
  // 原来直接渲染 undefined，导致每个小项后面的「判定」整列空白。
  const okText = passLabel ?? t('iqc.passed');
  const ngText = failLabel ?? t('iqc.failed');
  const headerRows = buildHeaderRows(pairs);
  const printTime = new Date().toLocaleString(getDateTimeLocale(), { hour12: false });

  return (
    <div className="iqc-sheet">
      {/* ---------- 表头信息 ---------- */}
      <table>
        <colgroup>
          <col style={{ width: '11%' }} />
          <col style={{ width: '14%' }} />
          <col style={{ width: '11%' }} />
          <col style={{ width: '14%' }} />
          <col style={{ width: '11%' }} />
          <col style={{ width: '14%' }} />
          <col style={{ width: '11%' }} />
          <col style={{ width: '14%' }} />
        </colgroup>
        <tbody>
          <tr>
            <td colSpan={8} className="doc-hd">
              {t('print.reportTitle')}
              <span className="doc-hd-no">
                {t('print.docNo')}{docNo}
                {reportNo ? (
                  <>
                    <br />
                    {t('iqc.reportNo')}：{reportNo}
                  </>
                ) : null}
              </span>
            </td>
          </tr>
          {headerRows.map((row, ri) => {
            if (row.length === 1 && row[0].full) {
              return (
                <tr key={ri}>
                  <td className="lbl">{row[0].label}</td>
                  <td colSpan={7} className="l">
                    {row[0].value ?? ''}
                  </td>
                </tr>
              );
            }
            const padCells = (4 - row.length) * 2;
            return (
              <tr key={ri}>
                {row.map((p, pi) => (
                  <React.Fragment key={pi}>
                    <td className="lbl">{p.label}</td>
                    <td className="l">{p.value ?? ''}</td>
                  </React.Fragment>
                ))}
                {padCells > 0
                  ? Array.from({ length: padCells }).map((_, pi) => <td key={`pad-${pi}`} />)
                  : null}
              </tr>
            );
          })}
          {remark ? (
            <tr>
              <td className="lbl">{t('common.remark')}</td>
              <td colSpan={7} className="l">
                {remark}
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>

      {/* ---------- 检验项目分节 ---------- */}
      {sections.map((section) => (
        <table key={section.sectionType} style={{ marginTop: '2px' }}>
          <colgroup>
            {(section.isDimension ? DIM_COLS : STD_COLS).map((w, i) => (
              <col key={i} style={{ width: w }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <td colSpan={section.isDimension ? 9 : 10} className="sec-hd">
                {section.title}
              </td>
            </tr>
            <tr className="col-hd">
              {section.isDimension ? (
                <>
                  <td className="c b">{t('print.samplingPlanAql')}</td>
                  <td className="c b">{t('iqc.sampleSize')}</td>
                  <td className="c b">Ac</td>
                  <td className="c b">Re</td>
                  <td className="c b">{t('iqc.itemName')}</td>
                  <td className="c b">Spec</td>
                  <td className="c b">{t('print.measureData')}</td>
                  <td className="c b">{t('iqc.defectQty')}</td>
                  <td className="c b">{t('iqc.isPass')}</td>
                </>
              ) : (
                <>
                  <td className="c b">{t('common.serialNo')}</td>
                  <td className="c b">{t('iqc.itemName')}</td>
                  <td className="c b">{t('iqc.standard')}</td>
                  <td className="c b">{t('print.samplingPlanAql')}</td>
                  <td className="c b">{t('iqc.sampleSize')}</td>
                  <td className="c b">Ac</td>
                  <td className="c b">Re</td>
                  <td className="c b">{t('iqc.defectQty')}</td>
                  <td className="c b">{t('iqc.defectDescription')}</td>
                  <td className="c b">{t('iqc.isPass')}</td>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {section.rows.map((row, idx) => (
              <tr key={idx}>
                {section.isDimension ? (
                  <>
                    <td>{row.samplingText}</td>
                    <td className="c">{row.sampleSize}</td>
                    <td className="c">{row.ac}</td>
                    <td className="c">{row.re}</td>
                    <td>{row.itemName}</td>
                    <td className="c">{row.spec || '-'}</td>
                    <td className="measured-wrap">
                      {row.measuredValues.length === 0
                        ? '-'
                        : row.measuredValues.map((v, mi) => (
                            <span
                              key={mi}
                              className={`mv${v && isOutOfSpec(v, row.spec) ? ' mv-ng' : ''}`}
                            >
                              {v || '\u00A0'}
                            </span>
                          ))}
                    </td>
                    <td className="c">{row.defectQty}</td>
                    <td className="c">
                      <span className={row.isPass ? 'ok' : 'ng'}>
                        {row.isPass ? okText : ngText}
                      </span>
                    </td>
                  </>
                ) : (
                  <>
                    <td className="c">{idx + 1}</td>
                    <td>{row.itemName}</td>
                    <td>{row.standard}</td>
                    <td>{row.samplingText}</td>
                    <td className="c">{row.sampleSize}</td>
                    <td className="c">{row.ac}</td>
                    <td className="c">{row.re}</td>
                    <td className="c">{row.defectQty}</td>
                    <td>{row.defectDescription || ''}</td>
                    <td className="c">
                      <span className={row.isPass ? 'ok' : 'ng'}>
                        {row.isPass ? okText : ngText}
                      </span>
                    </td>
                  </>
                )}
              </tr>
            ))}
            {section.rows.length === 0 ? (
              <tr>
                <td colSpan={section.isDimension ? 9 : 10} className="c">
                  {t('print.noItems')}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      ))}

      {/* ---------- 签字行（默认关闭）+ 打印时间页脚 ---------- */}
      {showSignRow ? (
        <table style={{ marginTop: '2px' }}>
          <tbody>
            <tr>
              <td className="lbl" style={{ width: '11%' }}>
                {t('print.inspectorSign')}
              </td>
              <td className="sign-line" style={{ width: '14%' }} />
              <td className="lbl" style={{ width: '11%' }}>
                {t('print.reviewedBy')}
              </td>
              <td className="sign-line" style={{ width: '14%' }} />
              <td className="lbl" style={{ width: '11%' }}>
                {t('print.approvedBy')}
              </td>
              <td className="sign-line" style={{ width: '14%' }} />
              <td className="lbl" style={{ width: '11%' }}>
                {t('print.signDate')}
              </td>
              <td className="sign-line" style={{ width: '14%' }} />
            </tr>
          </tbody>
        </table>
      ) : null}
      <table style={{ marginTop: '2px' }}>
        <tbody>
          <tr className="foot">
            <td colSpan={8} className="l">
              {t('print.printTime')}{printTime}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
};

/** 打印稿：portal 挂到 body，屏幕隐藏、打印独占页面 */
const IqcReportPrintDoc: React.FC<IqcReportPrintDocProps> = (props) => {
  return createPortal(
    <>
      <style>{SHEET_CSS}</style>
      <div id="iqc-print-root">
        <IqcReportSheet {...props} />
      </div>
    </>,
    document.body,
  );
};

export default IqcReportPrintDoc;
