import React from 'react';
import { Table, type TableProps } from '@client/src/compat/antd-table';

interface ResizableTableProps<T> extends TableProps<T> {
  minWidth?: number;
}

/**
 * 带样式修饰的表格包装。
 * 列宽拖动已内置于共享 Table（compat/antd-table），这里只保留原有视觉样式：
 * 固定布局、单行省略、表头左对齐（与内容一致）。
 *
 * 注意：这里**不再剥离 fixed 列**。旧版曾把 columns 上的 fixed 全部 delete，
 * 理由是"强制等宽表格下固定列会错位"；但 35 个文件里 66 处 fixed 声明因此全部失效，
 * 宽表滚到右侧后首列标识与末列操作都看不见了（UX-02）。
 * antd 的 fixed 依赖 scroll.x，调用方均已配置，故恢复原样透传。
 */
function ResizableTable<T extends Record<string, any>>({
  columns,
  ...restProps
}: ResizableTableProps<T>) {
  return (
    <div className="resizable-table-wrapper">
      <Table
        {...restProps}
        columns={columns}
      />
    </div>
  );
}

export default ResizableTable;
