import React, { useState, useEffect, useCallback, useRef } from 'react';
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
  getAccountList,
  createAccount,
  updateAccount,
  resetAccountPassword,
  deleteAccount,
  importAccounts,
  getAllRoles,
} from '@client/src/api/system';
import type { SysAccount, SysRole, SysAccountImportResult, PaginatedResponse } from '@shared/api.interface';
import { downloadAccountTemplate } from '@client/src/utils/account-import';
import { toast } from 'sonner';
import { showConfirm } from '@client/src/compat';
import { useSearchPagination } from '@client/src/hooks/useSearchPagination';
import { Download, Upload } from 'lucide-react';
import dayjs from 'dayjs';

const WORK_SECTION_OPTIONS = [
  { value: '', key: 'system.noLimit' },
  { value: 'smt', label: 'SMT' },
  { value: 'dip', key: 'bom.dip' },
  { value: 'assembly', key: 'bom.assembly' },
  { value: 'packing', key: 'bom.packing' },
];

const AccountList: React.FC = () => {
  const { t, lang } = useI18n();

  /**
   * 筛选 + 分页统一管理（修复：翻页后筛选查不到 / 查询按钮失灵 / 边打字边请求）
   * 见 client/src/hooks/useSearchPagination.ts
   */
  const query = useSearchPagination<{
    account: string;
    name: string;
    roleCode: string;
    status: string;
  }>({ account: '', name: '', roleCode: '', status: '' });
  const {
    page, pageSize, params, draft, setDraft, search, reset: resetQuery,
    setPage, refresh, tick, list, total, loading, setList, setTotal, setLoading, onEnterSearch,
  } = query;

  const [roleList, setRoleList] = useState<SysRole[]>([]);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    account: '',
    name: '',
    roleCode: '',
    workSection: '',
  });
  const [saving, setSaving] = useState(false);

  // ===== 批量导入（模版 → 人工填写 → 导入） =====
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  /** 服务端返回的逐行错误明细（原子拒绝时才有值） */
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [importRejected, setImportRejected] = useState(false);

  useEffect(() => {
    getAllRoles().then((res) => {
      if (res.code === 0) setRoleList(res.data);
    }).catch(() => {});
  }, [t]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getAccountList({
        page,
        pageSize,
        account: params.account || undefined,
        name: params.name || undefined,
        roleCode: params.roleCode || undefined,
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
      account: '',
      name: '',
      roleCode: '',
      workSection: '',
    });
    setDialogOpen(true);
  };

  const openEditDialog = (record: SysAccount) => {
    setEditingId(record.id);
    setFormData({
      account: record.account,
      name: record.name,
      roleCode: record.roleCode,
      workSection: record.workSection || '',
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!formData.account || !formData.name || !formData.roleCode) {
      toast.error(t('common.required'));
      return;
    }
    setSaving(true);
    try {
      if (editingId) {
        const res = await updateAccount(editingId, {
          name: formData.name,
          roleCode: formData.roleCode,
          workSection: formData.workSection || undefined,
        });
        if (res.code === 0) {
          toast.success(t('message.updateSuccess'));
          setDialogOpen(false);
          refresh();
        } else {
          toast.error(res.message || t('message.updateFailed'));
        }
      } else {
        const res = await createAccount({
          account: formData.account,
          name: formData.name,
          roleCode: formData.roleCode,
          workSection: formData.workSection || undefined,
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

  const handleResetPassword = async (record: SysAccount) => {
    const confirmed = await showConfirm(t('system.resetPassword'));
    if (!confirmed) return;
    try {
      const res = await resetAccountPassword(record.id);
      if (res.code === 0) {
        toast.success(t('system.passwordResetTip'));
      } else {
        toast.error(res.message || t('common.error'));
      }
    } catch {
      toast.error(t('common.error'));
    }
  };

  const handleDelete = async (record: SysAccount) => {
    const confirmed = await showConfirm(t('message.confirmDelete'));
    if (!confirmed) return;
    try {
      const res = await deleteAccount(record.id);
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

  const handleToggleStatus = async (record: SysAccount) => {
    const isActive = record.status === 'active';
    const confirmed = await showConfirm(
      isActive ? t('common.inactive') : t('common.active')
    );
    if (!confirmed) return;
    try {
      const res = await updateAccount(record.id, {
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

  /** 下载导入模版；把系统当前的角色清单一起写进「填写说明」表，避免用户写错角色编码 */
  const handleDownloadTemplate = () => {
    try {
      downloadAccountTemplate(
        (lang as 'zh' | 'en' | 'vi') || 'zh',
        roleList.map((r) => ({ roleCode: r.roleCode, roleName: r.roleName })),
      );
    } catch {
      toast.error(t('common.error'));
    }
  };

  const openImportDialog = () => {
    setImportFile(null);
    setImportErrors([]);
    setImportRejected(false);
    setImportOpen(true);
  };

  /**
   * 批量导入。
   * 服务端是「全量校验 + 原子写入」：只要有一行不合法就一个账号都不建，
   * 因此这里把逐行错误原样展示出来，让管理员一次改完再传。
   */
  const handleImport = async () => {
    if (!importFile) {
      toast.error(t('common.required'));
      return;
    }
    setImporting(true);
    setImportErrors([]);
    setImportRejected(false);
    try {
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = String(reader.result || '');
          const commaIdx = result.indexOf(',');
          resolve(commaIdx >= 0 ? result.slice(commaIdx + 1) : result);
        };
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(importFile);
      });

      const res = await importAccounts({ fileBase64: base64 });
      if (res.code !== 0) {
        toast.error(res.message || t('common.error'));
        return;
      }

      const result: SysAccountImportResult = res.data;
      if (result.atomicRejected) {
        setImportErrors(result.errors);
        setImportRejected(true);
        toast.error(
          t('system.accountImportRejected').replace('{count}', String(result.errorCount)),
        );
        return;
      }

      toast.success(
        t('system.accountImportDone').replace('{count}', String(result.successCount)),
      );
      setImportOpen(false);
      setImportFile(null);
      refresh();
    } catch (err: any) {
      const msg =
        err?.response?.data?.message ||
        err?.response?.data?.error?.message ||
        err?.message ||
        t('common.error');
      toast.error(msg);
    } finally {
      setImporting(false);
    }
  };

  const getRoleName = (code: string): string => {
    const role = roleList.find(r => r.roleCode === code);
    return role?.roleName || code;
  };

  const getWorkSectionLabel = (val?: string): string => {
    if (!val) return t('system.noLimit');
    const opt = WORK_SECTION_OPTIONS.find(o => o.value === val);
    if (!opt) return val;
    return opt.key ? t(opt.key) : opt.label || val;
  };

  const columns: TableProps<SysAccount>['columns'] = [
    {
      title: t('system.account'),
      dataIndex: 'account',
      width: 140,
      fixed: 'left',
    },
    {
      title: t('system.name'),
      dataIndex: 'name',
      width: 120,
    },
    {
      title: t('common.role'),
      dataIndex: 'roleCode',
      width: 140,
      render: (val: string) => getRoleName(val),
    },
    {
      title: t('system.workSection'),
      dataIndex: 'workSection',
      width: 120,
      render: (val?: string) => getWorkSectionLabel(val),
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
      title: t('system.lastLogin'),
      dataIndex: 'lastLoginAt',
      width: 160,
      render: (val?: string) => val ? dayjs(val).format('YYYY-MM-DD HH:mm') : '-',
    },
    {
      title: t('common.operation'),
      key: 'action',
      width: 280,
      fixed: 'right',
      render: (_: unknown, record: SysAccount) => (
        <div className="flex gap-1 flex-wrap">
          <Button variant="ghost" size="sm" onClick={() => openEditDialog(record)}>
            {t('common.edit')}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => handleResetPassword(record)}>
            {t('system.resetPassword')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => handleToggleStatus(record)}
            className={record.status === 'active' ? 'text-destructive' : 'text-primary'}
          >
            {record.status === 'active' ? t('common.inactive') : t('common.active')}
          </Button>
          {record.account !== 'admin' && (
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
              <label className="text-sm text-muted-foreground">{t('system.account')}</label>
              <Input
                value={draft.account}
                onChange={(e) => setDraft('account', e.target.value)}
                onKeyDown={onEnterSearch}
                className="w-40"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm text-muted-foreground">{t('system.name')}</label>
              <Input
                value={draft.name}
                onChange={(e) => setDraft('name', e.target.value)}
                onKeyDown={onEnterSearch}
                className="w-40"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm text-muted-foreground">{t('common.role')}</label>
              <Select value={draft.roleCode} onValueChange={(v) => setDraft('roleCode', v)}>
                <SelectTrigger className="w-40">
                  <SelectValue placeholder={t('common.all')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">{t('common.all')}</SelectItem>
                  {roleList.map((r) => (
                    <SelectItem key={r.id} value={r.roleCode}>
                      {r.roleName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm text-muted-foreground">{t('common.status')}</label>
              <Select value={draft.status} onValueChange={(v) => setDraft('status', v)}>
                <SelectTrigger className="w-32">
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
            <h2 className="text-lg font-semibold text-foreground">{t('system.accountManagement')}</h2>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={handleDownloadTemplate} className="gap-2">
                <Download size={16} />
                {t('system.accountTemplateDownload')}
              </Button>
              <Button variant="outline" onClick={openImportDialog} className="gap-2">
                <Upload size={16} />
                {t('system.accountImport')}
              </Button>
              <Button onClick={openAddDialog}>+ {t('system.newAccount')}</Button>
            </div>
          </div>
          <ResizableTable
            rowKey="id"
            columns={columns}
            dataSource={list}
            loading={loading}
            scroll={{ x: 1000, y: 500 }}
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
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editingId ? t('system.editAccount') : t('system.newAccount')}
            </DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-2">
            <div className="flex flex-col gap-1">
              <label className="text-sm text-muted-foreground">
                {t('system.account')} <span className="text-destructive">*</span>
              </label>
              <Input
                value={formData.account}
                onChange={(e) => setFormData({ ...formData, account: e.target.value })}
                disabled={!!editingId}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm text-muted-foreground">
                {t('system.name')} <span className="text-destructive">*</span>
              </label>
              <Input
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm text-muted-foreground">
                {t('common.role')} <span className="text-destructive">*</span>
              </label>
              <Select
                value={formData.roleCode}
                onValueChange={(val) => setFormData({ ...formData, roleCode: val })}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t('common.role')} />
                </SelectTrigger>
                <SelectContent>
                  {roleList.map((r) => (
                    <SelectItem key={r.id} value={r.roleCode}>
                      {r.roleName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm text-muted-foreground">{t('system.workSection')}</label>
              <Select
                value={formData.workSection}
                onValueChange={(val) => setFormData({ ...formData, workSection: val })}
              >
                <SelectTrigger>
                  <SelectValue placeholder={t('system.noLimit')} />
                </SelectTrigger>
                <SelectContent>
                  {WORK_SECTION_OPTIONS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.key ? t(opt.key) : opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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

      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{t('system.accountImport')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="text-sm text-muted-foreground bg-muted/50 p-3 rounded-md whitespace-pre-line">
              {t('system.accountImportTip')}
            </div>
            <div className="flex flex-col gap-2">
              <label className="text-sm font-medium">{t('system.accountImportFile')}</label>
              <Input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    setImportFile(file);
                    setImportErrors([]);
                    setImportRejected(false);
                  }
                  // 清空原生 input，这样同一个文件改完后再选一次也能触发 change
                  if (fileInputRef.current) fileInputRef.current.value = '';
                }}
              />
              {importFile && (
                <div className="text-xs text-muted-foreground">{importFile.name}</div>
              )}
            </div>

            {importRejected && importErrors.length > 0 && (
              <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3">
                <div className="text-sm font-medium text-destructive mb-2">
                  {t('system.accountImportErrors')}
                </div>
                <div className="max-h-64 overflow-auto space-y-1">
                  {importErrors.map((msg, idx) => (
                    <div key={idx} className="text-xs text-destructive font-mono break-all">
                      {msg}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleImport} disabled={importing || !importFile}>
              {importing ? t('common.loading') : t('system.accountImport')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default AccountList;
