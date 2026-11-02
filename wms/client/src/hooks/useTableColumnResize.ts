import { useState, useCallback, useMemo, useEffect } from 'react';
import type { TableColumnsType } from 'antd';

interface UseTableColumnResizeOptions<T> {
  columns: TableColumnsType<T>;
  minWidth?: number;
}

function getColumnKey(col: Record<string, unknown>, index: number): string {
  const k =
    (col.key as string) ??
    (Array.isArray(col.dataIndex)
      ? (col.dataIndex as string[]).join('.')
      : (col.dataIndex as string)) ??
    index;
  return String(k);
}

export function useTableColumnResize<T>(
  options: UseTableColumnResizeOptions<T>,
) {
  const { columns, minWidth = 60 } = options;

  const [widths, setWidths] = useState<Record<string, number>>(() => {
    const map: Record<string, number> = {};
    columns.forEach((col, index) => {
      const key = getColumnKey(col as Record<string, unknown>, index);
      if (typeof col.width === 'number') {
        map[key] = col.width;
      }
    });
    return map;
  });

  const handleResizeStart = useCallback(
    (e: React.MouseEvent, colKey: string) => {
      e.preventDefault();
      e.stopPropagation();

      const startX = e.clientX;
      const startWidth =
        typeof widths[colKey] === 'number' ? widths[colKey] : minWidth;

      const handleMouseMove = (moveEvent: MouseEvent) => {
        const diff = moveEvent.clientX - startX;
        const newWidth = Math.max(minWidth, startWidth + diff);
        setWidths((prev) => ({ ...prev, [colKey]: newWidth }));
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
    [widths, minWidth],
  );

  const resizedColumns = useMemo(() => {
    return columns.map((col, index) => {
      const colKey = getColumnKey(col as Record<string, unknown>, index);
      const currentWidth =
        typeof widths[colKey] === 'number' ? widths[colKey] : col.width;
      return { ...col, width: currentWidth };
    }) as TableColumnsType<T>;
  }, [columns, widths]);

  useEffect(() => {
    setWidths((prev) => {
      const next: Record<string, number> = { ...prev };
      let changed = false;
      columns.forEach((col, index) => {
        const key = getColumnKey(col as Record<string, unknown>, index);
        if (next[key] === undefined && typeof col.width === 'number') {
          next[key] = col.width;
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [columns]);

  return { resizedColumns, handleResizeStart };
}
