import React, { useState, useEffect, useCallback } from 'react';
import ResizableTable from '@client/src/components/ui/resizable-table';
import { STOCK_STATUS, statusMeta } from '@client/src/constants/business-enums';
import type { TableProps } from '@client/src/compat/antd-table';
import { useI18n, tf } from '@client/src/i18n';
import { Input } from '@client/src/components/ui/input';
import { Button } from '@client/src/components/ui/button';
import { Badge } from '@client/src/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SelectSeparator,
  SelectLabel,
  SelectGroup,
} from '@client/src/components/ui/select';
import { inventory as inventoryApi } from '@client/src/api';
import type { Inventory } from '@shared/api.interface';
import { logger } from '@client/src/utils/logger';
import { renderDate } from '@client/src/utils/datetime';
import { Switch } from '@client/src/components/ui/switch';
import { BarChart3 } from 'lucide-react';
import StockSummaryDialog from './StockSummaryDialog';
import { toast } from 'sonner';

const InventoryQuery: React.FC = () => {
  const { t } = useI18n();
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<Inventory[]>([]);

  const [filters, setFilters] = useState({
    materialCode: '',
    locationCode: '',
    batchNo: '',
    warehouseId: '',
    stockStatus: '',
  });

  /** 仅看特采：MRB 终审判定特采后放行回良品仓的库存行 */
  const [onlySpecialAdmit, setOnlySpecialAdmit] = useState(false);
  /** 库存现有量统计弹窗 */
  const [summaryOpen, setSummaryOpen] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      // 下拉里既有库存状态，也有效期筛选（超期 / 超期预警）；两者互斥，分开传参
      const statusValue = filters.stockStatus;
      const isExpiry = statusValue === 'expired' || statusValue === 'warning';
      const res = await inventoryApi.getInventoryList({
        page,
        pageSize,
        materialCode: filters.materialCode || undefined,
        locationCode: filters.locationCode || undefined,
        batchNo: filters.batchNo || undefined,
        warehouseId: filters.warehouseId || undefined,
        stockStatus: !isExpiry && statusValue ? statusValue : undefined,
        expiryStatus: isExpiry ? (statusValue as 'expired' | 'warning') : undefined,
        specialAdmitOnly: onlySpecialAdmit ? '1' : undefined,
      });
      setData(res.items);
      setTotal(res.total);
    } catch (error) {
      logger.error('Failed to fetch inventory:', String(error));
      // 原实现只有 logger.error：断网时页面就是一张空表，操作员会判定"这个料没库存"，
      // 进而下重复请购单。失败必须可见，并给一个原地重试入口。
      toast.error(t('message.loadFailed'), {
        action: { label: t('common.retry'), onClick: () => { void fetchData(); } },
      });
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, filters, onlySpecialAdmit]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSearch = () => {
    // setPage(1) 是异步的：紧接着调 fetchData() 用的是闭包里的旧 page，
    // 与 useEffect 里那次正确请求形成竞态 —— 旧结果后到就会闪出一张空表。
    // 已在第 1 页时 setPage(1) 不触发重渲染，才需要手动刷新。
    if (page === 1) fetchData();
    else setPage(1);
  };

  const handleReset = () => {
    setFilters({
      materialCode: '',
      locationCode: '',
      batchNo: '',
      warehouseId: '',
      stockStatus: '',
    });
    setOnlySpecialAdmit(false);
    setPage(1);
  };

  const stockStatusBadge = (status: string, record?: any) => {
    if (record?.locked && record?.lockReason?.includes('待检')) {
      return <Badge variant="secondary">{t('inventory.status_pending')}</Badge>;
    }
    const cfg = statusMeta(STOCK_STATUS, status, t);
    return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
  };

  const getRowClassName = (record: Inventory): string => {
    if (!record.expiryDate) return '';
    const now = new Date();
    const expiry = new Date(record.expiryDate);
    const diffMs = expiry.getTime() - now.getTime();
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    if (diffDays <= 0) return 'bg-red-100';
    if (diffDays <= 30) return 'bg-yellow-100';
    return '';
  };

  /** 有效期列渲染：日期 + 已超期/预警剩余天数 文字标签 */
  const renderExpiryWithTag = (val: string) => {
    if (!val) return <span className="text-muted-foreground">-</span>;
    const expiry = new Date(val);
    const diffDays = Math.ceil((expiry.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    let tag: React.ReactNode = null;
    if (diffDays <= 0) {
      tag = <span className="px-1.5 py-0.5 text-xs bg-red-100 text-red-700 rounded ml-1.5">{t('inventory.expired')}</span>;
    } else if (diffDays <= 30) {
      tag = <span className="px-1.5 py-0.5 text-xs bg-yellow-100 text-yellow-800 rounded ml-1.5">{tf('ui.预警剩 {n} 天', { n: diffDays })}</span>;
    }
    return (
      <span className="flex items-center">
        <span className="text-foreground">{renderDate(val)}</span>
        {tag}
      </span>
    );
  };

  const rawColumns: TableProps<Inventory>['columns'] = [
    { title: t('material.materialCode'), dataIndex: 'materialCode', width: 140, fixed: 'left' },
    { title: t('material.materialName'), dataIndex: 'materialName', width: 180 },
    { title: t('warehouse.locationCode'), dataIndex: 'locationCode', width: 140 },
    { title: t('common.batch'), dataIndex: 'batchNo', width: 120 },
    { title: t('material.supplierName'), dataIndex: 'supplierName', width: 140 },
    { title: t('common.quantity'), dataIndex: 'quantity', width: 100, align: 'right' },
    { title: t('common.unit'), dataIndex: 'unit', width: 80 },
    {
      title: t('inventory.stockStatus'),
      dataIndex: 'stockStatus',
      width: 100,
      render: (status: string, record: any) => stockStatusBadge(status, record),
    },
    {
      // 特采标识：MRB 终审判定特采后放行回良品仓的库存行，次行显示来源 MRB 单号
      title: t('inventory.specialAdmit'),
      key: 'specialAdmit',
      width: 160,
      render: (_: any, record: Inventory) =>
        record.isSpecialAdmit ? (
          <div className="leading-tight">
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200">
              {t('inventory.specialAdmit')}
            </span>
            {record.specialAdmitRef && (
              <div className="text-xs text-muted-foreground break-all">{record.specialAdmitRef}</div>
            )}
          </div>
        ) : (
          <span className="text-xs text-muted-foreground">-</span>
        ),
    },
    { title: t('receipt.productionDate'), dataIndex: 'productionDate', width: 120, render: renderDate },
    { title: t('inventory.expiryDate'), dataIndex: 'expiryDate', width: 185, render: renderExpiryWithTag },
    {
      title: t('common.lock'),
      dataIndex: 'locked',
      width: 80,
      render: (locked: boolean) =>
        locked ? <Badge variant="destructive">{t('inventory.locked')}</Badge> : '-',
    },
  ];

  return (
    <div className="space-y-4">
      <div className="bg-card rounded-[12px] p-4 border border-border">
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4 mb-4">
          <div>
            <label className="text-sm text-muted-foreground mb-1 block">{t('material.materialCode')}</label>
            <Input
              value={filters.materialCode}
              onChange={(e) => setFilters({ ...filters, materialCode: e.target.value })}
              placeholder={t('material.materialCode')}
            />
          </div>
          <div>
            <label className="text-sm text-muted-foreground mb-1 block">{t('warehouse.locationCode')}</label>
            <Input
              value={filters.locationCode}
              onChange={(e) => setFilters({ ...filters, locationCode: e.target.value })}
              placeholder={t('warehouse.locationCode')}
            />
          </div>
          <div>
            <label className="text-sm text-muted-foreground mb-1 block">{t('common.batch')}</label>
            <Input
              value={filters.batchNo}
              onChange={(e) => setFilters({ ...filters, batchNo: e.target.value })}
              placeholder={t('common.batch')}
            />
          </div>
          <div>
            <label className="text-sm text-muted-foreground mb-1 block">{t('inventory.stockStatus')}</label>
            <Select value={filters.stockStatus} onValueChange={(val) => setFilters({ ...filters, stockStatus: val })}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder={t('common.all')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">{t('common.all')}</SelectItem>
                <SelectItem value="good">{t('inventory.good')}</SelectItem>
                <SelectItem value="pending_qc">{t('inventory.status_pending_qc')}</SelectItem>
                <SelectItem value="pending">{t('inventory.pending')}</SelectItem>
                <SelectItem value="locked">{t('inventory.locked')}</SelectItem>
                <SelectItem value="defective">{t('inventory.defective')}</SelectItem>
                {/* 效期维度：查「已超期 / 30 天内到期」且尚未延期处理过的库存。
                    Radix 要求 SelectLabel 必须包在 SelectGroup 里，否则整页抛错。 */}
                <SelectSeparator />
                <SelectGroup>
                  <SelectLabel>{t('ui.效期筛选')}</SelectLabel>
                  <SelectItem value="expired">{t('ui.超期（已过期）')}</SelectItem>
                  <SelectItem value="warning">{t('ui.超期预警（30 天内到期）')}</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end gap-2">
            <Button onClick={handleSearch}>{t('common.search')}</Button>
            <Button variant="outline" onClick={handleReset}>{t('common.reset')}</Button>
            <Button variant="outline" onClick={() => setSummaryOpen(true)}>
              <BarChart3 size={15} className="mr-1" />
              {t('ui.库存现有量统计')}
            </Button>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-5">
          <label className="flex items-center gap-2 text-sm text-foreground cursor-pointer">
            <Switch
              checked={onlySpecialAdmit}
              onCheckedChange={(v: boolean) => {
                setOnlySpecialAdmit(v);
                setPage(1);
              }}
            />
            {t('inventory.onlySpecialAdmit')}
          </label>
        </div>
      </div>

      <div className="bg-card rounded-[12px] p-4 border border-border">
        <ResizableTable
          columns={rawColumns}
          dataSource={data}
          loading={loading}
          rowKey="id"
          rowClassName={(record) => getRowClassName(record as Inventory)}
          scroll={{ x: 1360, y: 500 }}
          pagination={{
            current: page,
            pageSize,
            total,
            showSizeChanger: false,
            showTotal: (total) => `${t('common.total')} ${total} ${t('common.items')}`,
            onChange: (p) => setPage(p),
          }}
        />
      </div>

      <StockSummaryDialog open={summaryOpen} onOpenChange={setSummaryOpen} />
    </div>
  );
};

export default InventoryQuery;

