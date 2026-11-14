// Compatibility shim for @lark-apaas/client-toolkit/antd-table
// Re-exports antd Table with the same API —— 并内置「列宽鼠标拖动」能力：
// 所有使用该 Table 的列表（待检清单、收料单、库存…）都可以拖动表头右缘调整列宽。
import React from 'react';
import { Table as AntdTable } from 'antd';
import type { TableProps as AntdTableProps } from 'antd';
import { useI18n } from '@client/src/i18n';

export type { TableProps } from 'antd';

type AnyColumn = Record<string, any>;

function getColumnKey(col: AnyColumn, index: number): string {
  const k =
    col.key ??
    (Array.isArray(col.dataIndex) ? col.dataIndex.join('.') : col.dataIndex) ??
    index;
  return String(k);
}

const MIN_COL_WIDTH = 60;

/**
 * 列表内容对齐标准（3.7，4.0 修订）
 * ---------------------------------------------------------------------------
 * 之前 30 个页面各写各的：90 处 `align: 'right'`、16 处 `'center'`，
 * 同一张表里「数量」右对齐、紧邻的「单位」左对齐，单元格还好，**表头**一排看过去
 * 参差不齐，已经被业务反复提过两次（4.0）。
 *
 * 现行规则：
 *   · **表头（th）一律左对齐** —— 在 ResizableHeaderCell 里用行内 style 强制，
 *     与左侧文本列的起始位置对齐，不再跟着列的 align 移动；
 *   · **单元格（td）保留列语义** —— 数值/单位右对齐、操作列居中、其余左对齐，
 *     由下方 normalizeColumnAlign 按 dataIndex 推断（页面显式 align 优先）。
 *
 * 放在兼容层而不是逐页改 30 个文件：这是**表格的通用规则**，
 * 集中一处才能保证以后新增的列表页自动符合。
 */
const NUMERIC_FIELDS = new Set([
  'quantity', 'qty', 'unit',
  'amount', 'price', 'total', 'totalQty', 'totalAmount',
  'goodQty', 'defectQty', 'incomingDefectQty', 'operationDefectQty',
  'actualQty', 'pickQty', 'planQty', 'issuedQty', 'receivedQty', 'returnQty',
  'rate', 'percent', 'sampleSize', 'ac', 're', 'boxCount', 'weight',
]);

const ACTION_KEYS = new Set(['action', 'actions', 'operation', 'operations']);

function normalizeColumnAlign(col: AnyColumn): AnyColumn {
  if (col.align) return col;
  if (ACTION_KEYS.has(String(col.key ?? ''))) return { ...col, align: 'center' };
  const dataIndex = col.dataIndex;
  const field =
    typeof dataIndex === 'string'
      ? dataIndex
      : Array.isArray(dataIndex)
        ? String(dataIndex[dataIndex.length - 1] ?? '')
        : '';
  if (NUMERIC_FIELDS.has(field)) return { ...col, align: 'right' };
  return col;
}

/** 表头单元格：在真实列边（th 右缘）挂一个拖动柄 */
const ResizableHeaderCell: React.ComponentType<any> = (props: any) => {
  const { onResizeStart, resizeWidth, style, ...rest } = props;
  const { t } = useI18n();
  const canResize = typeof resizeWidth === 'number' && typeof onResizeStart === 'function';
  return (
    // th 必须是定位元素，拖动柄的 absolute 定位才能贴住列边
    // 表头文字一律左对齐（4.0）：antd 的 column.align 会同时作用到 th，
    // 导致「数量/操作」等列的表头右对齐或居中、与左侧文本列参差不齐。
    // 行内 style 能压过 antd 的 ant-table-cell-align-* 类，且不影响单元格 td 的语义对齐。
    <th {...rest} style={{ position: 'relative', ...style, textAlign: 'left' }}>
      {rest.children}
      {canResize && (
        <div
          className="col-resize-handle"
          title={t('common.dragToResizeColumn')}
          onMouseDown={(e) => onResizeStart(e, resizeWidth)}
        />
      )}
    </th>
  );
};

function ResizableHeaderTable<T extends Record<string, any>>({
  columns,
  components,
  scroll,
  ...restProps
}: AntdTableProps<T>) {
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const [widths, setWidths] = useStateWidths(columns as AnyColumn[] | undefined);

  const handleResizeStart = React.useCallback(
    (e: React.MouseEvent, colKey: string, startWidth: number) => {
      e.preventDefault();
      e.stopPropagation();
      const startX = e.clientX;
      const handleMouseMove = (moveEvent: MouseEvent) => {
        const diff = moveEvent.clientX - startX;
        const newWidth = Math.max(MIN_COL_WIDTH, startWidth + diff);
        setWidths((prev: Record<string, number>) => {
          if (prev[colKey] === newWidth) return prev;
          return { ...prev, [colKey]: newWidth };
        });
      };
      const handleMouseUp = () => {
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      };
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [],
  );

  const { liveWidths, allWidthed, totalWidth } = React.useMemo(() => {
    const cols = (columns as AnyColumn[]) || [];
    const map: Record<string, number> = {};
    let sum = 0;
    let allWidthed = cols.length > 0;
    cols.forEach((col, index) => {
      const key = getColumnKey(col, index);
      const hasWidth = typeof col.width === 'number';
      if (!hasWidth) allWidthed = false;
      const w = typeof widths[key] === 'number' ? widths[key] : (hasWidth ? col.width : undefined);
      if (typeof w === 'number') {
        map[key] = w;
        sum += w;
      }
    });
    return { liveWidths: map, allWidthed, totalWidth: sum };
  }, [columns, widths]);

  // 列定义变化时，为「有确定宽度」的列挂上拖动柄（onHeaderCell → 自定义表头单元格）
  const resizableColumns = React.useMemo(() => {
    if (!columns) return columns;
    const cols = columns as AnyColumn[];
    return cols.map((col, index) => {
      const aligned = normalizeColumnAlign(col);
      const colKey = getColumnKey(aligned, index);
      const isLast = index === cols.length - 1;
      const startWidth = liveWidths[colKey];
      if (typeof startWidth !== 'number' || isLast) return aligned;
      const originalOnHeaderCell = aligned.onHeaderCell;
      return {
        ...aligned,
        onHeaderCell: (c: AnyColumn) => ({
          ...(typeof originalOnHeaderCell === 'function' ? originalOnHeaderCell(c) : {}),
          onResizeStart: (e: React.MouseEvent) => handleResizeStart(e, colKey, startWidth),
          resizeWidth: startWidth,
        }),
      };
    }) as AntdTableProps<T>['columns'];
  }, [columns, liveWidths, handleResizeStart]);

  // 全部列都有确定宽度时，横向滚动宽度同步为实时列宽之和：
  // 拖宽某列时表格整体变宽出横向滚动条，而不是挤压其它列
  const scrollConfig = React.useMemo(() => {
    const s = scroll as { x?: number | string; y?: number | string } | undefined;
    if (allWidthed && totalWidth > 0) {
      return { ...s, x: totalWidth };
    }
    return s;
  }, [scroll, allWidthed, totalWidth]);

  const mergedComponents = React.useMemo(() => {
    const c: any = components || {};
    return { ...c, header: { ...(c.header || {}), cell: ResizableHeaderCell } };
  }, [components]);

  // 列宽变化后直接同步到 colgroup / table 宽度（antd 内部对列宽的重渲染不可靠，这里兜底保证拖动即时生效）
  React.useEffect(() => {
    const root = wrapRef.current;
    if (!root || !columns) return;
    const cols = columns as AnyColumn[];
    const colgroups = root.querySelectorAll<HTMLTableColElement>('table > colgroup');
    colgroups.forEach((cg) => {
      const colEls = cg.querySelectorAll('col');
      if (colEls.length !== cols.length) return;
      cols.forEach((col, idx) => {
        const key = getColumnKey(col, idx);
        const w = liveWidths[key];
        if (typeof w === 'number') colEls[idx].style.width = `${w}px`;
      });
    });
    if (allWidthed && totalWidth > 0) {
      root.querySelectorAll('table').forEach((t) => {
        t.style.width = `${totalWidth}px`;
        t.style.minWidth = `${totalWidth}px`;
      });
    }
  });

  return (
    <div ref={wrapRef} className="compat-resizable-table">
      <AntdTable<T>
        {...restProps}
        components={mergedComponents}
        columns={resizableColumns}
        scroll={scrollConfig}
      />
    </div>
  );
}

/** 列宽状态：列定义变化时补齐新增列的初始宽度（保留用户已拖动过的宽度） */
function useStateWidths(columns: AnyColumn[] | undefined) {
  const [widths, setWidths] = React.useState<Record<string, number>>({});
  React.useEffect(() => {
    if (!columns) return;
    setWidths((prev) => {
      const next: Record<string, number> = { ...prev };
      let changed = false;
      columns.forEach((col, index) => {
        const key = getColumnKey(col, index);
        if (next[key] === undefined && typeof col.width === 'number') {
          next[key] = col.width;
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [columns]);
  return [widths, setWidths] as const;
}

export const Table = ResizableHeaderTable as <RecordType extends Record<string, any> = any>(
  props: AntdTableProps<RecordType>,
) => React.ReactElement;
