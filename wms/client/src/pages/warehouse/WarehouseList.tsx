import React, { useState, useEffect, useCallback } from 'react';
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
  getWarehouseList,
  createWarehouse,
  updateWarehouse,
  deleteWarehouse,
} from '@client/src/api/warehouse';
import type { Warehouse, PaginatedResponse } from '@shared/api.interface';
import { toast } from 'sonner';
import { showConfirm } from '@client/src/compat';
import { useDialogDrag } from '@client/src/hooks/useDialogDrag';

const WarehouseList: React.FC = () => {
  const { t } = useI18n();

  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [list, setList] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(false);

  // filters
  const [whCode, setWhCode] = useState('');
  const [whName, setWhName] = useState('');
  const [status, setStatus] = useState<string>('');

  // dialog
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState<Partial<Warehouse>>({
    whCode: '',
    whNameZh: '',
    whNameVi: '',
    whNameEn: '',
    whType: 'normal',
    status: 'active',
    address: '',
    description: '',
  });

  const { handleMouseDown, resetPosition } = useDialogDrag({ open: dialogOpen });

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res: PaginatedResponse<Warehouse> = await getWarehouseList({
        page,
        pageSize,
        whCode: whCode || undefined,
        whName: whName || undefined,
        status: status || undefined,
      });
      setList(res.items);
      setTotal(res.total);
    } catch (err) {
      toast.error(t('common.error'));
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, whCode, whName, status, t]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSearch = () => {
    setPage(1);
  };

  const handleReset = () => {
    setWhCode('');
    setWhName('');
    setStatus('');
    setPage(1);
  };

  const openAddDialog = () => {
    setEditingId(null);
    setFormData({
      whCode: '',
      whNameZh: '',
      whNameVi: '',
      whNameEn: '',
      whType: 'normal',
      status: 'active',
      address: '',
      description: '',
    });
    setDialogOpen(true);
  };

  const openEditDialog = async (record: Warehouse) => {
    setEditingId(record.id);
    setFormData({
      whCode: record.whCode,
      whNameZh: record.whNameZh,
      whNameVi: record.whNameVi,
      whNameEn: record.whNameEn,
      whType: record.whType,
      status: record.status,
      address: record.address,
      description: record.description,
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!formData.whCode || !formData.whNameZh) {
      toast.error(t('common.required'));
      return;
    }
    try {
      if (editingId) {
        await updateWarehouse(editingId, formData);
      } else {
        await createWarehouse(formData as Omit<Warehouse, 'id'>);
      }
      toast.success(t('common.success'));
      setDialogOpen(false);
      fetchData();
    } catch (err) {
      toast.error(t('common.error'));
    }
  };

  const handleDelete = async (id: string) => {
    if (!await showConfirm(t('common.confirm'))) return;
    try {
      await deleteWarehouse(id);
      toast.success(t('common.success'));
      fetchData();
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.message || t('common.error');
      toast.error(msg);
    }
  };

  const whTypeOptions = [
    { value: 'normal', labelKey: 'warehouse.normal' },
    { value: 'defective', labelKey: 'warehouse.defective' },
  ];

  const rawColumns: TableProps<Warehouse>['columns'] = [
    { title: t('warehouse.whCode'), dataIndex: 'whCode', width: 140, fixed: 'left' },
    { title: t('warehouse.whName'), dataIndex: 'whNameZh', width: 180 },
    {
      title: t('warehouse.whType'),
      dataIndex: 'whType',
      width: 120,
      render: (val: string) => t(`warehouse.${val}`) || val,
    },
    {
      title: t('common.status'),
      dataIndex: 'status',
      width: 100,
        render: (val: string) => (
          <Badge variant={val === 'active' ? 'default' : 'secondary'}>
            {val === 'active' ? t('warehouse.status_active') : t('warehouse.status_inactive')}
          </Badge>
        ),
    },
    { title: t('warehouse.address'), dataIndex: 'address', width: 200, ellipsis: true },
    {
      title: t('common.operation'),
      key: 'action',
      width: 150,
      fixed: 'right',
      render: (_: any, record: Warehouse) => (
        <div className="flex gap-2">
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
      {/* Filter */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="flex flex-col gap-1">
              <label className="text-sm text-muted-foreground">{t('warehouse.whCode')}</label>
              <Input
                value={whCode}
                onChange={(e) => setWhCode(e.target.value)}
                placeholder={t('warehouse.whCode')}
                className="w-44"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm text-muted-foreground">{t('warehouse.whName')}</label>
              <Input
                value={whName}
                onChange={(e) => setWhName(e.target.value)}
                placeholder={t('warehouse.whName')}
                className="w-44"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm text-muted-foreground">{t('common.status')}</label>
              <Select value={status} onValueChange={setStatus}>
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
              <Button onClick={handleSearch}>{t('common.search')}</Button>
              <Button variant="outline" onClick={handleReset}>
                {t('common.reset')}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Toolbar + Table */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold text-foreground">{t('nav.warehouseList')}</h2>
            <Button onClick={openAddDialog}>+ {t('common.add')}</Button>
          </div>
          <ResizableTable
             rowKey="id"
             columns={rawColumns}
            dataSource={list}
            loading={loading}
            scroll={{ x: 900, y: 500 }}
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

      {/* Dialog */}
      <Dialog open={dialogOpen} onOpenChange={(o) => { if (!o) resetPosition(); setDialogOpen(o); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader onMouseDown={handleMouseDown} style={{ cursor: 'move', userSelect: 'none' }}>
            <DialogTitle>
              {editingId ? t('common.edit') : t('common.add')} {t('nav.warehouseList')}
            </DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-2">
            <div className="flex flex-col gap-1">
              <label className="text-sm text-muted-foreground">
                {t('warehouse.whCode')} <span className="text-destructive">*</span>
              </label>
              <Input
                value={formData.whCode || ''}
                onChange={(e) => setFormData({ ...formData, whCode: e.target.value.replace(/[\u4e00-\u9fa5]/g, '') })}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm text-muted-foreground">
                {t('warehouse.whName')} (ZH) <span className="text-destructive">*</span>
              </label>
              <Input
                value={formData.whNameZh || ''}
                onChange={(e) => setFormData({ ...formData, whNameZh: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm text-muted-foreground">{t('warehouse.whName')} (VI)</label>
              <Input
                value={formData.whNameVi || ''}
                onChange={(e) => setFormData({ ...formData, whNameVi: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm text-muted-foreground">{t('warehouse.whName')} (EN)</label>
              <Input
                value={formData.whNameEn || ''}
                onChange={(e) => setFormData({ ...formData, whNameEn: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm text-muted-foreground">{t('warehouse.whType')}</label>
              <Select
                value={formData.whType || 'normal'}
                onValueChange={(val) => setFormData({ ...formData, whType: val })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {whTypeOptions.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {t(opt.labelKey)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
            <div className="flex flex-col gap-1 col-span-2">
              <label className="text-sm text-muted-foreground">{t('warehouse.address')}</label>
              <Input
                value={formData.address || ''}
                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1 col-span-2">
              <label className="text-sm text-muted-foreground">{t('common.remark')}</label>
              <Input
                value={formData.description || ''}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              />
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
    </div>
  );
};

export default WarehouseList;
