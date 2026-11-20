import React, { useState, useEffect, useCallback, useMemo } from 'react';
import ResizableTable from '@client/src/components/ui/resizable-table';
import { Table, type TableProps } from '@client/src/compat/antd-table';
import { useI18n } from '@client/src/i18n';
import { Button } from '@client/src/components/ui/button';
import { Input } from '@client/src/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@client/src/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@client/src/components/ui/dialog';
import { Badge } from '@client/src/components/ui/badge';
import { Card, CardContent } from '@client/src/components/ui/card';
import {
  getLocationList,
  createLocation,
  updateLocation,
  deleteLocation,
  getAllWarehouses,
} from '@client/src/api/warehouse';
import type { WarehouseLocation, Warehouse, PaginatedResponse } from '@shared/api.interface';
import { toast } from 'sonner';
import { showConfirm } from '@client/src/compat';
import { useDialogDrag } from '@client/src/hooks/useDialogDrag';
import { useSearchPagination } from '@client/src/hooks/useSearchPagination';
import BatchLocationDialog from './BatchLocationDialog';
import LocationLabelPrint from './LocationLabelPrint';

const LocationList: React.FC = () => {
  const { t } = useI18n();

  /**
   * 筛选 + 分页统一管理（修复：翻页后筛选查不到 / 查询按钮失灵 / 边打字边请求）
   * 见 client/src/hooks/useSearchPagination.ts
   */
  const query = useSearchPagination<{
    locationCode: string;
    warehouseId: string;
    locationType: string;
    status: string;
  }>({ locationCode: '', warehouseId: '', locationType: '', status: '' });
  const {
    page, pageSize, params, draft, setDraft, search, reset: resetQuery,
    setPage, refresh, tick, list, total, loading, setList, setTotal, setLoading, onEnterSearch,
  } = query;

  // 系统全部仓库（含已停用）：供「仓库代码」查询筛选下拉使用
  const [allWarehouses, setAllWarehouses] = useState<Warehouse[]>([]);
  // 业务录入（新增/编辑库位、批量生成）只允许选择启用仓库，避免把库位挂到停用仓库
  const warehouseList = useMemo(
    () => allWarehouses.filter((wh) => wh.status === 'active'),
    [allWarehouses],
  );

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<Partial<WarehouseLocation>>({
    locationCode: '',
    warehouseId: '',
    areaCode: '',
    shelfCode: '',
    layerCode: '',
    positionCode: '',
    status: 'active',
  });

  const [batchDialogOpen, setBatchDialogOpen] = useState(false);
  const [printDialogOpen, setPrintDialogOpen] = useState(false);
  const [singlePrintLocation, setSinglePrintLocation] = useState<WarehouseLocation | null>(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState<React.Key[]>([]);

  useEffect(() => {
    getAllWarehouses(true).then(setAllWarehouses).catch(() => {});
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res: PaginatedResponse<WarehouseLocation> = await getLocationList({
        page,
        pageSize,
        locationCode: params.locationCode || undefined,
        warehouseId: params.warehouseId || undefined,
        locationType: params.locationType || undefined,
        status: params.status || undefined,
      });
      setList(res.items);
      setTotal(res.total);
    } catch (err) {
      toast.error(t('common.error'));
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, params, tick, t, setList, setTotal, setLoading]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleReset = () => {
    resetQuery();
  };

  const selectedWarehouse = useMemo(() => {
    // 从全部仓库里找，保证编辑停用仓库下的库位时也能取到仓库代码前缀
    return allWarehouses.find((wh) => wh.id === formData.warehouseId) || null;
  }, [allWarehouses, formData.warehouseId]);

  // 新增/编辑弹窗的仓库选项：只列启用仓库；若编辑的库位属于已停用仓库，则额外把该仓库带上以便正常回显
  const dialogWarehouseList = useMemo(() => {
    const extra = allWarehouses.filter(
      (wh) => wh.id === formData.warehouseId && wh.status !== 'active',
    );
    return extra.length > 0 ? [...warehouseList, ...extra] : warehouseList;
  }, [warehouseList, allWarehouses, formData.warehouseId]);

  const autoLocationCode = useMemo(() => {
    const parts: string[] = [];
    if (selectedWarehouse?.whCode) parts.push(selectedWarehouse.whCode);
    if (formData.areaCode) parts.push(formData.areaCode);
    if (formData.shelfCode) parts.push(formData.shelfCode);
    if (formData.layerCode) parts.push(formData.layerCode);
    if (formData.positionCode) parts.push(formData.positionCode);
    return parts.join('-');
  }, [selectedWarehouse, formData.areaCode, formData.shelfCode, formData.layerCode, formData.positionCode]);

  const { handleMouseDown, resetPosition } = useDialogDrag({ open: dialogOpen });

  const handleWarehouseChange = (val: string) => {
    const next = { ...formData, warehouseId: val };
    const wh = allWarehouses.find((w) => w.id === val);
    const parts: string[] = [];
    if (wh?.whCode) parts.push(wh.whCode);
    if (formData.areaCode) parts.push(formData.areaCode);
    if (formData.shelfCode) parts.push(formData.shelfCode);
    if (formData.layerCode) parts.push(formData.layerCode);
    if (formData.positionCode) parts.push(formData.positionCode);
    if (!editingId && parts.length > 0) {
      next.locationCode = parts.join('-');
    }
    setFormData(next);
  };

  // 过滤汉字，只保留字母、数字、符号
  const stripChinese = (val: string) => val.replace(/[\u4e00-\u9fa5]/g, '');

  const handleCodePartChange = (field: 'areaCode' | 'shelfCode' | 'layerCode' | 'positionCode', value: string) => {
    const clean = stripChinese(value);
    const next = { ...formData, [field]: clean };
    if (!editingId && selectedWarehouse?.whCode) {
      const parts: string[] = [selectedWarehouse.whCode];
      const area = field === 'areaCode' ? clean : formData.areaCode;
      const shelf = field === 'shelfCode' ? clean : formData.shelfCode;
      const layer = field === 'layerCode' ? clean : formData.layerCode;
      const position = field === 'positionCode' ? clean : formData.positionCode;
      if (area) parts.push(area);
      if (shelf) parts.push(shelf);
      if (layer) parts.push(layer);
      if (position) parts.push(position);
      next.locationCode = parts.join('-');
    }
    setFormData(next);
  };

  const openAddDialog = () => {
    setEditingId(null);
    setFormData({
      locationCode: '',
      warehouseId: '',
      areaCode: '',
      shelfCode: '',
      layerCode: '',
      positionCode: '',
      status: 'active',
    });
    setDialogOpen(true);
  };

  const openEditDialog = async (record: WarehouseLocation) => {
    setEditingId(record.id);
    setFormData({
      locationCode: record.locationCode,
      warehouseId: record.warehouseId,
      areaCode: record.areaCode,
      shelfCode: record.shelfCode,
      layerCode: record.layerCode,
      positionCode: record.positionCode,
      status: record.status,
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!formData.locationCode || !formData.warehouseId) {
      toast.error(t('common.required'));
      return;
    }
    try {
      if (editingId) {
        await updateLocation(editingId, formData);
      } else {
        await createLocation(formData as Omit<WarehouseLocation, 'id' | 'warehouseName'>);
      }
      toast.success(t('common.success'));
      setDialogOpen(false);
      refresh();
    } catch (err) {
      toast.error(t('common.error'));
    }
  };

  const handleDelete = async (id: string) => {
    if (!await showConfirm(t('common.confirm'))) return;
    try {
      await deleteLocation(id);
      toast.success(t('common.success'));
      refresh();
    } catch (err) {
      toast.error(t('common.error'));
    }
  };

  const selectedLocations = list.filter((item) =>
    selectedRowKeys.includes(item.id as unknown as React.Key)
  );

  const handleRemoveSelected = (id: string) => {
    setSelectedRowKeys((prev) => prev.filter((k) => k !== id));
  };

  const locTypeOptions = [
    { value: 'good', labelKey: 'warehouse.locGood' },
    { value: 'defective', labelKey: 'warehouse.locDefective' },
    { value: 'pending', labelKey: 'warehouse.locPending' },
  ];

  const rawColumns: TableProps<WarehouseLocation>['columns'] = [
    {
      title: t('warehouse.locationCode'),
      dataIndex: 'locationCode',
      width: 140,
      fixed: 'left',
    },
    {
      title: t('nav.warehouseList'),
      dataIndex: 'warehouseName',
      width: 160,
    },
    { title: t('warehouse.areaCode'), dataIndex: 'areaCode', width: 100 },
    { title: t('warehouse.shelfCode'), dataIndex: 'shelfCode', width: 100 },
    { title: t('warehouse.layerCode'), dataIndex: 'layerCode', width: 100 },
    { title: t('warehouse.positionCode'), dataIndex: 'positionCode', width: 100 },
    {
      title: t('warehouse.locationType'),
      dataIndex: 'locationType',
      width: 120,
      render: (val: string) => {
        const key = val === 'good' ? 'locGood' : val === 'defective' ? 'locDefective' : 'locPending';
        return t(`warehouse.${key}`) || val;
      },
    },
    {
      title: t('common.status'),
      dataIndex: 'status',
      width: 80,
        render: (val: string) => (
          <Badge variant={val === 'active' ? 'default' : 'secondary'}>
            {val === 'active' ? t('location.status_active') : t('location.status_inactive')}
          </Badge>
        ),
    },
    {
      title: t('common.operation'),
      key: 'action',
      width: 160,
      fixed: 'right',
      render: (_: any, record: WarehouseLocation) => (
        <div className="flex gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setSinglePrintLocation(record);
              setPrintDialogOpen(true);
            }}
          >
            {t('system.print')}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => openEditDialog(record)}>
            {t('common.edit')}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => handleDelete(record.id)}>
            {t('common.delete')}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="p-6 space-y-4">
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="flex flex-col gap-1">
              <label className="text-sm text-muted-foreground">{t('warehouse.locationCode')}</label>
              <Input
                value={draft.locationCode}
                onChange={(e) => setDraft('locationCode', e.target.value)}
                onKeyDown={onEnterSearch}
                className="w-44"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm text-muted-foreground">{t('warehouse.whCode')}</label>
              <Select value={draft.warehouseId} onValueChange={(v) => setDraft('warehouseId', v)}>
                <SelectTrigger className="w-44">
                  <SelectValue placeholder={t('common.all')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">{t('common.all')}</SelectItem>
                  {allWarehouses.map((wh) => (
                    <SelectItem key={wh.id} value={wh.id}>
                      {wh.whNameZh}（{wh.whCode}）
                      {wh.status !== 'active' ? ` · ${t('common.inactive')}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm text-muted-foreground">{t('warehouse.locationType')}</label>
              <Select value={draft.locationType} onValueChange={(v) => setDraft('locationType', v)}>
                <SelectTrigger className="w-36">
                  <SelectValue placeholder={t('common.all')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">{t('common.all')}</SelectItem>
                  {locTypeOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {t(opt.labelKey)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm text-muted-foreground">{t('common.status')}</label>
              <Select value={draft.status} onValueChange={(v) => setDraft('status', v)}>
                <SelectTrigger className="w-36">
                  <SelectValue placeholder={t('common.all')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">{t('common.all')}</SelectItem>
                  <SelectItem value="active">{t('common.active')}</SelectItem>
                  <SelectItem value="inactive">{t('common.inactive')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2">
              <Button onClick={search}>{t('common.search')}</Button>
              <Button variant="outline" onClick={handleReset}>
                {t('common.reset')}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold text-foreground">{t('nav.locationList')}</h2>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setBatchDialogOpen(true)}>
                {t('system.batchCreate')}
              </Button>
              <Button
                variant="outline"
                onClick={() => setPrintDialogOpen(true)}
                disabled={selectedRowKeys.length === 0}
              >
                {t('system.printLabel')}
                {selectedRowKeys.length > 0 && (
                  <span className="ml-1 px-1.5 py-0.5 bg-primary text-white text-xs rounded">
                    {selectedRowKeys.length}
                  </span>
                )}
              </Button>
              <Button onClick={openAddDialog}>+ {t('common.add')}</Button>
            </div>
          </div>
          <ResizableTable
            rowKey="id"
            columns={rawColumns}
            dataSource={list}
            loading={loading}
            scroll={{ x: 1280, y: 500 }}
            rowSelection={{
              selectedRowKeys,
              onChange: (keys) => setSelectedRowKeys(keys),
            }}
            pagination={{
              current: page,
              pageSize,
              total,
              showSizeChanger: false,
              onChange: (p) => setPage(p),
            }}
          />
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) resetPosition(); setDialogOpen(o); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader onMouseDown={handleMouseDown} style={{ cursor: 'move', userSelect: 'none' }}>
            <DialogTitle>
              {editingId ? t('common.edit') : t('common.add')} {t('nav.locationList')}
            </DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-2">
            <div className="flex flex-col gap-1">
              <label className="text-sm text-muted-foreground">
                {t('warehouse.locationCode')} <span className="text-destructive">*</span>
              </label>
              <Input
                value={formData.locationCode || ''}
                onChange={(e) =>
                  setFormData({ ...formData, locationCode: stripChinese(e.target.value) })
                }
              />
              {!editingId && autoLocationCode && (
                <span className="text-xs text-muted-foreground">{t('warehouse.autoGenerateHint')}: {autoLocationCode}</span>
              )}
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm text-muted-foreground">
                {t('warehouse.warehouseLabel')} <span className="text-destructive">*</span>
              </label>
              <Select
                value={formData.warehouseId || ''}
                onValueChange={handleWarehouseChange}
              >
                <SelectTrigger>
                   <SelectValue placeholder={t('common.pleaseSelect')} />
                </SelectTrigger>
                <SelectContent>
                  {dialogWarehouseList.map((wh) => (
                    <SelectItem key={wh.id} value={wh.id}>
                      {wh.whNameZh}（{wh.whCode}）
                      {wh.status !== 'active' ? ` · ${t('common.inactive')}` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedWarehouse && (
                <span className="text-xs text-muted-foreground">
                  {t('warehouse.whCode')}: {selectedWarehouse.whCode}
                </span>
              )}
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm text-muted-foreground">{t('warehouse.areaCode')}</label>
              <Input
                value={formData.areaCode || ''}
                onChange={(e) => handleCodePartChange('areaCode', e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm text-muted-foreground">{t('warehouse.shelfCode')}</label>
              <Input
                value={formData.shelfCode || ''}
                onChange={(e) => handleCodePartChange('shelfCode', e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm text-muted-foreground">{t('warehouse.layerCode')}</label>
              <Input
                value={formData.layerCode || ''}
                onChange={(e) => handleCodePartChange('layerCode', e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm text-muted-foreground">{t('warehouse.positionCode')}</label>
              <Input
                value={formData.positionCode || ''}
                onChange={(e) => handleCodePartChange('positionCode', e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm text-muted-foreground">{t('common.status')}</label>
              <Select
                value={formData.status || 'active'}
                onValueChange={(val) => setFormData({ ...formData, status: val })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">{t('common.active')}</SelectItem>
                  <SelectItem value="inactive">{t('common.inactive')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleSave}>{t('common.save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <BatchLocationDialog
        open={batchDialogOpen}
        onOpenChange={setBatchDialogOpen}
        warehouseList={warehouseList}
        onSuccess={refresh}
      />

      <LocationLabelPrint
        open={printDialogOpen}
        onOpenChange={(o) => {
          setPrintDialogOpen(o);
          if (!o) setSinglePrintLocation(null);
        }}
        selectedLocations={selectedLocations}
        onRemove={handleRemoveSelected}
        singleLocation={singlePrintLocation}
      />
    </div>
  );
};

export default LocationList;
