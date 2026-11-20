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
import { Checkbox } from '@client/src/components/ui/checkbox';
import {
  getSysRoleList,
  createRole,
  updateRole,
  deleteRole,
} from '@client/src/api/system';
import type { SysRole, PaginatedResponse } from '@shared/api.interface';
import { toast } from 'sonner';
import { showConfirm } from '@client/src/compat';
import { useSearchPagination } from '@client/src/hooks/useSearchPagination';

const MENU_GROUPS: { groupKey: string; items: { path: string; labelKey: string }[] }[] = [
  {
    groupKey: 'system.dashboard',
    items: [
      { path: '/', labelKey: 'nav.dashboard' },
    ],
  },
  {
    groupKey: 'system.warehouse',
    items: [
      { path: '/warehouse', labelKey: 'nav.warehouse' },
      { path: '/warehouse/list', labelKey: 'nav.warehouseList' },
      { path: '/warehouse/location', labelKey: 'nav.locationList' },
    ],
  },
  {
    groupKey: 'system.material',
    items: [
      { path: '/material', labelKey: 'nav.material' },
      { path: '/material/list', labelKey: 'nav.materialList' },
      { path: '/material/supplier', labelKey: 'nav.supplierList' },
    ],
  },
  {
    groupKey: 'system.receipt',
    items: [
      { path: '/receipt', labelKey: 'nav.receipt' },
      { path: '/receipt/scan', labelKey: 'nav.receiptScan' },
      { path: '/receipt/list', labelKey: 'nav.receiptOrder' },
    ],
  },
  {
    groupKey: 'system.iqc',
    items: [
      { path: '/iqc', labelKey: 'nav.iqc' },
      { path: '/iqc/pending', labelKey: 'nav.iqcPending' },
      { path: '/iqc/record', labelKey: 'nav.iqcRecord' },
      { path: '/iqc/report', labelKey: 'nav.iqcReport' },
      { path: '/iqc/template', labelKey: 'nav.iqcTemplate' },
    ],
  },
  {
    groupKey: 'system.inventory',
    items: [
      { path: '/inventory', labelKey: 'nav.inventory' },
      { path: '/inventory/query', labelKey: 'nav.inventoryQuery' },
      { path: '/inventory/intra-transfer', labelKey: 'nav.intraTransfer' },
      { path: '/inventory/transfer', labelKey: 'nav.stockTransfer' },
      { path: '/inventory/stock-take', labelKey: 'nav.stockTake' },
    ],
  },
  {
    groupKey: 'system.bom',
    items: [
      { path: '/bom', labelKey: 'nav.bom' },
      { path: '/bom/list', labelKey: 'nav.bomList' },
    ],
  },
  {
    groupKey: 'system.workorder',
    items: [
      { path: '/workorder', labelKey: 'nav.workorder' },
      { path: '/workorder/list', labelKey: 'nav.workOrderList' },
      { path: '/workorder/requirement', labelKey: 'nav.materialRequirement' },
      { path: '/workorder/picking', labelKey: 'nav.pickingOrder' },
      { path: '/production/picking-approval', labelKey: 'nav.pickingApproval' },
      { path: '/production/supplement-record', labelKey: 'nav.supplementRecord' },
    ],
  },
  {
    groupKey: 'system.issuing',
    items: [
      { path: '/issuing', labelKey: 'nav.issuing' },
      { path: '/issuing/list', labelKey: 'nav.issuingList' },
    ],
  },
  {
    groupKey: 'system.mrb',
    items: [
      { path: '/mrb', labelKey: 'nav.mrb' },
      { path: '/mrb/list', labelKey: 'nav.mrbList' },
      { path: '/mrb/task', labelKey: 'nav.mrbTask' },
    ],
  },
  {
    groupKey: 'system.system',
    items: [
      { path: '/system', labelKey: 'nav.system' },
      { path: '/system/param', labelKey: 'nav.sysParam' },
      { path: '/system/role', labelKey: 'system.roleManagement' },
      { path: '/system/account', labelKey: 'system.accountManagement' },
    ],
  },
];

const RoleList: React.FC = () => {
  const { t } = useI18n();

  /**
   * 筛选 + 分页统一管理（修复：翻页后筛选查不到 / 查询按钮失灵 / 边打字边请求）
   * 见 client/src/hooks/useSearchPagination.ts
   */
  const query = useSearchPagination<{
    roleName: string;
    status: string;
  }>({ roleName: '', status: '' });
  const {
    page, pageSize, params, draft, setDraft, search, reset: resetQuery,
    setPage, refresh, tick, list, total, loading, setList, setTotal, setLoading, onEnterSearch,
  } = query;

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    roleCode: '',
    roleName: '',
    description: '',
    menuPermissions: [] as string[],
  });
  const [saving, setSaving] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getSysRoleList({
        page,
        pageSize,
        roleName: params.roleName || undefined,
        status: params.status || undefined,
      });
      if (res.code === 0) {
        setList(res.data.items);
        setTotal(res.data.total);
      }
    } catch {
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

  const openAddDialog = () => {
    setEditingId(null);
    setFormData({
      roleCode: '',
      roleName: '',
      description: '',
      menuPermissions: [],
    });
    setDialogOpen(true);
  };

  const openEditDialog = (record: SysRole) => {
    setEditingId(record.id);
    setFormData({
      roleCode: record.roleCode,
      roleName: record.roleName,
      description: record.description || '',
      menuPermissions: record.menuPermissions || [],
    });
    setDialogOpen(true);
  };

  const togglePermission = (path: string, checked: boolean) => {
    setFormData(prev => ({
      ...prev,
      menuPermissions: checked
        ? [...prev.menuPermissions, path]
        : prev.menuPermissions.filter(p => p !== path),
    }));
  };

  const toggleGroup = (group: typeof MENU_GROUPS[0], checked: boolean) => {
    const groupPaths = group.items.map(i => i.path);
    setFormData(prev => {
      const existing = prev.menuPermissions.filter(p => !groupPaths.includes(p));
      if (checked) {
        return { ...prev, menuPermissions: [...existing, ...groupPaths] };
      }
      return { ...prev, menuPermissions: existing };
    });
  };

  const isGroupAllChecked = (group: typeof MENU_GROUPS[0]) => {
    return group.items.every(item => formData.menuPermissions.includes(item.path));
  };

  const isGroupIndeterminate = (group: typeof MENU_GROUPS[0]) => {
    const count = group.items.filter(item => formData.menuPermissions.includes(item.path)).length;
    return count > 0 && count < group.items.length;
  };

  const handleSave = async () => {
    if (!formData.roleCode || !formData.roleName) {
      toast.error(t('common.required'));
      return;
    }
    setSaving(true);
    try {
      if (editingId) {
        const res = await updateRole(editingId, {
          roleName: formData.roleName,
          description: formData.description,
          menuPermissions: formData.menuPermissions,
        });
        if (res.code === 0) {
          toast.success(t('message.updateSuccess'));
          setDialogOpen(false);
          refresh();
        } else {
          toast.error(res.message || t('message.updateFailed'));
        }
      } else {
        const res = await createRole({
          roleCode: formData.roleCode,
          roleName: formData.roleName,
          description: formData.description,
          menuPermissions: formData.menuPermissions,
        });
        if (res.code === 0) {
          toast.success(t('message.createSuccess'));
          setDialogOpen(false);
          refresh();
        } else {
          toast.error(res.message || t('message.createFailed'));
        }
      }
    } catch {
      toast.error(t('common.error'));
    } finally {
      setSaving(false);
    }
  };

  const handleToggleStatus = async (record: SysRole) => {
    const isActive = record.status === 'active';
    const confirmed = await showConfirm(
      isActive ? t('common.inactive') : t('common.active')
    );
    if (!confirmed) return;
    try {
      const res = await updateRole(record.id, {
        status: isActive ? 'inactive' : 'active',
      });
      if (res.code === 0) {
        toast.success(t('message.updateSuccess'));
        refresh();
      } else {
        toast.error(res.message || t('message.updateFailed'));
      }
    } catch {
      toast.error(t('common.error'));
    }
  };

  const SYSTEM_ROLES = ['admin', 'warehouse_manager', 'picking_operator', 'iqc_inspector', 'mrb_reviewer', 'viewer'];

  const handleDelete = async (record: SysRole) => {
    const confirmed = await showConfirm(t('message.confirmDelete'));
    if (!confirmed) return;
    try {
      const res = await deleteRole(record.id);
      if (res.code === 0) {
        toast.success(t('message.deleteSuccess'));
        refresh();
      } else {
        toast.error(res.message || t('message.deleteFailed'));
      }
    } catch (err: any) {
      toast.error(err?.response?.data?.message || t('message.deleteFailed'));
    }
  };

  const columns: TableProps<SysRole>['columns'] = [
    {
      title: t('system.roleCode'),
      dataIndex: 'roleCode',
      width: 160,
      fixed: 'left',
    },
    {
      title: t('system.roleName'),
      dataIndex: 'roleName',
      width: 160,
    },
    {
      title: t('common.description'),
      dataIndex: 'description',
      width: 200,
      ellipsis: true,
    },
    {
      title: t('system.permissionCount'),
      dataIndex: 'menuPermissions',
      width: 100,
      render: (val: string[]) => val?.length || 0,
    },
    {
      title: t('common.status'),
      dataIndex: 'status',
      width: 100,
      render: (val: string) => (
        <Badge variant={val === 'active' ? 'default' : 'secondary'}>
          {val === 'active' ? t('common.active') : t('common.inactive')}
        </Badge>
      ),
    },
    {
      title: t('common.operation'),
      key: 'action',
      width: 200,
      fixed: 'right',
      render: (_: unknown, record: SysRole) => (
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => openEditDialog(record)}>
            {t('common.edit')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleToggleStatus(record)}
            className={record.status === 'active' ? 'text-destructive' : 'text-primary'}
          >
            {record.status === 'active' ? t('common.inactive') : t('common.active')}
          </Button>
          {!SYSTEM_ROLES.includes(record.roleCode) && (
            <Button variant="ghost" size="sm" onClick={() => handleDelete(record)} className="text-destructive">
              {t('common.delete')}
            </Button>
          )}
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
              <label className="text-sm text-muted-foreground">{t('system.roleName')}</label>
              <Input
                value={draft.roleName}
                onChange={(e) => setDraft('roleName', e.target.value)}
                onKeyDown={onEnterSearch}
                className="w-44"
              />
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
            <h2 className="text-lg font-semibold text-foreground">{t('system.roleManagement')}</h2>
            <Button onClick={openAddDialog}>+ {t('system.newRole')}</Button>
          </div>
          <ResizableTable
            rowKey="id"
            columns={columns}
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

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingId ? t('system.editRole') : t('system.newRole')}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-4">
              <div className="flex flex-col gap-1">
                <label className="text-sm text-muted-foreground">
                  {t('system.roleCode')} <span className="text-destructive">*</span>
                </label>
                <Input
                  value={formData.roleCode}
                  onChange={(e) => setFormData({ ...formData, roleCode: e.target.value })}
                  disabled={!!editingId}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-sm text-muted-foreground">
                  {t('system.roleName')} <span className="text-destructive">*</span>
                </label>
                <Input
                  value={formData.roleName}
                  onChange={(e) => setFormData({ ...formData, roleName: e.target.value })}
                />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm text-muted-foreground">{t('common.description')}</label>
              <Input
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium text-foreground">
                {t('system.menuPermissions')}
              </label>
              <div className="border border-border rounded-[8px] p-4 space-y-4 max-h-80 overflow-y-auto">
                {MENU_GROUPS.map((group) => (
                  <div key={group.groupKey} className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Checkbox
                        checked={isGroupIndeterminate(group) ? 'indeterminate' : isGroupAllChecked(group)}
                        onCheckedChange={(checked) => toggleGroup(group, !!checked)}
                      />
                      <span className="text-sm font-medium text-foreground">{t(group.groupKey)}</span>
                    </div>
                    <div className="pl-6 grid grid-cols-2 md:grid-cols-3 gap-2">
                      {group.items.map((item) => (
                        <div key={item.path} className="flex items-center gap-2">
                          <Checkbox
                            checked={formData.menuPermissions.includes(item.path)}
                            onCheckedChange={(checked) => togglePermission(item.path, !!checked)}
                          />
                          <span className="text-sm text-foreground">{t(item.labelKey)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? t('common.loading') : t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default RoleList;
