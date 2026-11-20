import React, { useCallback, useEffect, useState } from 'react';
import ResizableTable from '@client/src/components/ui/resizable-table';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@client/src/components/ui/dialog';
import { Button } from '@client/src/components/ui/button';
import { Input } from '@client/src/components/ui/input';
import { Switch } from '@client/src/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@client/src/components/ui/select';
import { useI18n, tf } from '@client/src/i18n';
import { getStockSummary, exportStockSummary, type StockSummaryItem } from '@client/src/api/inventory';
import { getAllWarehouses } from '@client/src/api/warehouse';
import type { Warehouse } from '@shared/api.interface';
import { logger } from '@client/src/utils/logger';
import { toast } from 'sonner';
import { Download, Search } from 'lucide-react';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

/**
 * 库存现有量统计：按「仓库代码 + 物料编号」汇总整个仓库的库存数量。
 * 统计范围为全部库存状态（良品、待检、锁定、不良品），默认包含不良品仓。
 */
const StockSummaryDialog: React.FC<Props> = ({ open, onOpenChange }) => {
  const { t, lang } = useI18n();
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [filters, setFilters] = useState({ warehouseCode: '', materialCode: '', includeDefective: true });
  const [applied, setApplied] = useState({ warehouseCode: '', materialCode: '', includeDefective: true });
  const [page, setPage] = useState(1);
  const [pageSize] = useState(50);
  const [rows, setRows] = useState<StockSummaryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [grandQty, setGrandQty] = useState(0);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  /**
   * 表格可视高度跟随窗口。
   *
   * 原来写死 420，整个弹窗固定 765px 高：在 1080p 笔记本开了 125%/150% 缩放
   * （或浏览器缩放 110%）时可视高度只有 ~600，弹窗居中后顶部被顶出屏幕、
   * 底部按钮（导出 Excel / 关闭）掉到屏幕外且无法滚动 → 用户以为「没有导出入口」。
   */
  const [tableBodyHeight, setTableBodyHeight] = useState(420);

  useEffect(() => {
    const calc = () => {
      const h = window.innerHeight || 800;
      // 弹窗里除表格外还有标题/筛选行/表头/分页/页脚，约 420px，按剩余空间给表格
      setTableBodyHeight(Math.min(460, Math.max(160, Math.round(h - 430))));
    };
    calc();
    window.addEventListener('resize', calc);
    return () => window.removeEventListener('resize', calc);
  }, []);

  useEffect(() => {
    if (!open) return;
    getAllWarehouses(true)
      .then((list) => setWarehouses(list || []))
      .catch(() => setWarehouses([]));
  }, [open]);

  const fetchData = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const res = await getStockSummary({
        page: p,
        pageSize,
        warehouseCode: applied.warehouseCode || undefined,
        materialCode: applied.materialCode || undefined,
        includeDefective: applied.includeDefective,
      });
      setRows(res.items || []);
      setTotal(res.total || 0);
      setGrandQty(res.grandQty || 0);
    } catch (e: any) {
      logger.error('load stock summary failed', String(e));
      toast.error(e?.response?.data?.error?.message || t('ui.加载库存统计失败'));
      setRows([]);
      setTotal(0);
      setGrandQty(0);
    } finally {
      setLoading(false);
    }
  }, [applied, pageSize, t]);

  useEffect(() => {
    if (open) fetchData(page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, page, applied]);

  const handleSearch = () => {
    setPage(1);
    setApplied({ ...filters });
  };

  const handleReset = () => {
    const empty = { warehouseCode: '', materialCode: '', includeDefective: true };
    setFilters(empty);
    setApplied(empty);
    setPage(1);
  };

  /**
   * 导出 Excel。
   *
   * 由服务端生成 .xlsx（同一套聚合口径 + 全部行 + 合计行），
   * 前端只负责把二进制落盘 —— 不再用「页面上这几条拼 CSV」的方式，
   * 否则导出只有当前页、且中文 CSV 在 Excel 里容易被当文本。
   */
  const handleExport = async () => {
    setExporting(true);
    try {
      const blob = await exportStockSummary({
        warehouseCode: applied.warehouseCode || undefined,
        materialCode: applied.materialCode || undefined,
        includeDefective: applied.includeDefective,
        lang,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${t('ui.库存现有量统计')}_${new Date().toISOString().slice(0, 10)}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // 立即 revoke 会让部分浏览器中断下载，延后回收
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast.success(tf('ui.已导出全部 {n} 条明细（Excel）', { n: total }));
    } catch (e: any) {
      // 导出接口出错时响应体也是 blob，需要先取出里面的 JSON 才能显示原因
      let msg = '';
      const data = e?.response?.data;
      if (data instanceof Blob) {
        try {
          const parsed = JSON.parse(await data.text());
          msg = parsed?.error?.message || parsed?.message || '';
        } catch {
          msg = '';
        }
      } else {
        msg = e?.response?.data?.error?.message || '';
      }
      toast.error(msg || t('ui.导出失败'));
    } finally {
      setExporting(false);
    }
  };

  const columns: any[] = [
    {
      // 这里汇总的是 warehouse.wh_code（如 001 · 原料仓），
      // 不是库位编码（那个才叫「仓库地址码」），表头必须写「仓库代码」
      title: t('warehouse.whCode'),
      dataIndex: 'warehouseCode',
      width: 170,
      fixed: 'left' as const,
      render: (v: string, r: StockSummaryItem) => (
        <div className="flex flex-col">
          <span className="font-medium">{v}</span>
          <span className="text-xs text-muted-foreground">
            {r.warehouseName || '-'}
            {r.whType === 'defective' ? ` · ${t('ui.不良品仓')}` : ''}
          </span>
        </div>
      ),
    },
    { title: t('material.materialCode'), dataIndex: 'materialCode', width: 170 },
    {
      title: t('material.materialName'),
      dataIndex: 'materialName',
      width: 180,
      render: (v: string) => v || '-',
    },
    { title: t('material.unit'), dataIndex: 'unit', width: 70, render: (v: string) => v || '-' },
    { title: t('ui.库位数'), dataIndex: 'locations', width: 80, align: 'right' as const },
    { title: t('ui.批次数'), dataIndex: 'batches', width: 80, align: 'right' as const },
    {
      title: t('ui.库存数量'),
      dataIndex: 'qty',
      width: 140,
      align: 'right' as const,
      render: (v: number) => <span className="font-semibold tabular-nums">{v.toLocaleString()}</span>,
    },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* max-h + overflow-y-auto：小屏/高缩放时弹窗不再顶出屏幕，内容可滚动，
          不会出现「按钮在屏幕外点不到」的情况 */}
      <DialogContent className="max-w-6xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('ui.库存现有量统计')}</DialogTitle>
          <div className="text-xs text-muted-foreground">
            {t('ui.按仓库代码、物料编号汇总现有库存，含不良品仓、待检与锁定库存')}
          </div>
        </DialogHeader>

        <div className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">{t('warehouse.whCode')}</label>
            <Select
              value={filters.warehouseCode || 'all'}
              onValueChange={(v) => setFilters({ ...filters, warehouseCode: v === 'all' ? '' : v })}
            >
              <SelectTrigger className="w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('common.all')}</SelectItem>
                {warehouses.map((w) => (
                  <SelectItem key={w.id} value={(w as any).whCode || (w as any).code || ''}>
                    {(w as any).whCode || (w as any).code} · {(w as any).whNameZh || (w as any).name || ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs text-muted-foreground">{t('material.materialCode')}</label>
            <Input
              className="w-56"
              value={filters.materialCode}
              placeholder={t('ui.支持物料编码或名称模糊匹配')}
              onChange={(e) => setFilters({ ...filters, materialCode: e.target.value })}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSearch();
              }}
            />
          </div>
          <label className="flex items-center gap-2 text-sm cursor-pointer pb-2">
            <Switch
              checked={filters.includeDefective}
              onCheckedChange={(v: boolean) => setFilters({ ...filters, includeDefective: v })}
            />
            {t('ui.包含不良品仓')}
          </label>
          <div className="flex gap-2 pb-0.5">
            <Button onClick={handleSearch}>
              <Search size={15} className="mr-1" />
              {t('common.search')}
            </Button>
            <Button variant="outline" onClick={handleReset}>
              {t('common.reset')}
            </Button>
            {/* 导出放在筛选行末尾（和查询/重置同一行），打开弹窗就能看到，
                不用滚到页脚去找 */}
            <Button
              variant="outline"
              onClick={handleExport}
              disabled={exporting || total === 0}
              title={t('ui.按当前筛选条件导出全部明细（Excel）')}
            >
              <Download size={15} className="mr-1" />
              {exporting ? t('common.processing') : t('ui.导出Excel')}
            </Button>
          </div>
        </div>

        <div className="border rounded-lg">
          <ResizableTable
            columns={columns}
            dataSource={rows}
            loading={loading}
            rowKey={(r: StockSummaryItem) => `${r.warehouseCode}-${r.materialCode}-${r.unit || ''}`}
            scroll={{ x: 900, y: tableBodyHeight }}
            pagination={{
              current: page,
              pageSize,
              total,
              showSizeChanger: false,
              showTotal: (n: number) => `${t('common.total')} ${n} ${t('common.items')}`,
              onChange: (p: number) => setPage(p),
            }}
          />
        </div>

        <DialogFooter className="flex items-center justify-between sm:justify-between">
          <div className="text-sm text-muted-foreground">
            {tf('ui.共 {n} 条 · 库存数量合计 {qty}', {
              n: total,
              qty: grandQty.toLocaleString(),
            })}
          </div>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t('common.close')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default StockSummaryDialog;
