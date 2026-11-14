import React, { useState, useEffect } from 'react';
import { useI18n, tf } from '@client/src/i18n';
import { Input } from '@client/src/components/ui/input';
import { Button } from '@client/src/components/ui/button';
import { Badge } from '@client/src/components/ui/badge';
import { Card, CardContent } from '@client/src/components/ui/card';
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
import { Textarea } from '@client/src/components/ui/textarea';
import ResizableTable from '@client/src/components/ui/resizable-table';
import { Table, type TableProps } from '@client/src/compat/antd-table';
import { logger } from '@client/src/utils/logger';
import { toast } from 'sonner';
import { useAuth } from '@client/src/auth/AuthContext';
import {
  getStrictnessList,
  getStrictnessTransferLogs,
  manualStrictnessAction,
} from '@client/src/api/iqc';
import type {
  IqcInspectionStrictness,
  IqcStrictnessTransferLog,
} from '@shared/api.interface';

const buildStrictnessMap = (
  t: (key: string) => string,
): Record<string, { variant: string; label: string; color: string }> => ({
  normal: { variant: 'default', label: t('ui.正常检验'), color: 'bg-green-100 text-green-800' },
  tightened: { variant: 'destructive', label: t('ui.加严检验'), color: 'bg-red-100 text-red-800' },
  reduced: { variant: 'secondary', label: t('ui.放宽检验'), color: 'bg-blue-100 text-blue-800' },
  exempt: { variant: 'outline', label: t('ui.免检'), color: 'bg-muted text-foreground' },
  suspended: { variant: 'destructive', label: t('ui.暂停检验'), color: 'bg-orange-100 text-orange-800' },
});

/** 人工操作动作 → 文案键（免检退出的两条通道：回正常 / 直接收紧为加严） */
const ACTION_LABEL: Record<string, string> = {
  to_normal: 'ui.人工调整为正常检验（任意状态）',
  to_tightened: 'ui.人工调整为加严检验（任意状态）',
  to_exempt: 'ui.放宽 → 免检（需连续10批合格）',
  to_reduced_from_exempt: 'ui.免检 → 放宽（退出免检，保留宽松抽样）',
  to_normal_from_exempt: 'ui.免检 → 正常（物料异常登记）',
  to_tightened_from_exempt: 'ui.免检 → 加严（免检物料收紧）',
  to_tightened_from_suspended: 'ui.暂停 → 加严（供应方改进确认）',
};

const IqcStrictness: React.FC = () => {
  const { t } = useI18n();
  const STRICTNESS_MAP = buildStrictnessMap(t);
  const { user } = useAuth();
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [data, setData] = useState<IqcInspectionStrictness[]>([]);
  const [loading, setLoading] = useState(false);

  const [materialCode, setMaterialCode] = useState('');
  const [materialName, setMaterialName] = useState('');
  const [strictness, setStrictness] = useState('');

  // Transfer log dialog
  const [logDialog, setLogDialog] = useState(false);
  const [logData, setLogData] = useState<IqcStrictnessTransferLog[]>([]);
  const [logLoading, setLogLoading] = useState(false);
  const [logTarget, setLogTarget] = useState<{ materialId: string; materialName: string } | null>(null);

  // Manual action dialog
  const [actionDialog, setActionDialog] = useState(false);
  const [actionTarget, setActionTarget] = useState<IqcInspectionStrictness | null>(null);
  const [actionType, setActionType] = useState<string>('');
  const [actionReason, setActionReason] = useState('');
  const [actionExceptionSource, setActionExceptionSource] = useState('production');
  const [actionSubmitting, setActionSubmitting] = useState(false);

  // 人工转移（放宽→免检、免检退出、暂停恢复）属品质主管审批权限，
  // 服务端已有角色校验，这里同步隐藏按钮，避免检验员点了才收到 403。
  const canManualAction = ['quality_manager', 'iqc_manager', 'admin'].includes(
    String((user as any)?.roleCode || ''),
  );

  const fetchData = async (p: number = page) => {
    setLoading(true);
    try {
      const result = await getStrictnessList({
        page: p,
        pageSize,
        materialCode: materialCode || undefined,
        materialName: materialName || undefined,
        strictness: strictness || undefined,
      });
      setData(result.items);
      setTotal(result.total);
      setPage(p);
    } catch (error) {
      logger.error('get strictness list failed', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData(1);
  }, []);

  const handleSearch = () => fetchData(1);
  const handleReset = () => {
    setMaterialCode('');
    setMaterialName('');
    setStrictness('');
    fetchData(1);
  };

  const handleViewLogs = async (record: IqcInspectionStrictness) => {
    setLogTarget({
      materialId: record.materialId,
      materialName: record.materialName || '',
    });
    setLogDialog(true);
    setLogLoading(true);
    try {
      const result = await getStrictnessTransferLogs({
        materialId: record.materialId,
        page: 1,
        pageSize: 100,
      });
      setLogData(result.items);
    } catch (error) {
      logger.error('get transfer logs failed', error);
      toast.error(t('ui.获取转移历史失败'));
    } finally {
      setLogLoading(false);
    }
  };

  const handleOpenAction = (record: IqcInspectionStrictness) => {
    const actions = getAvailableActions(record);
    setActionTarget(record);
    setActionType(actions[0] || '');
    setActionReason('');
    setActionExceptionSource('production');
    setActionDialog(true);
  };

  /** 放宽且连续 10 批接收：允许人工转免检（页面标绿） */
  const canConvertToExempt = (record: IqcInspectionStrictness) =>
    record.strictness === 'reduced' && Number(record.consecutiveAccepted || 0) >= 10;

  /**
   * 人工可执行的动作：
   * - 任意状态 → 正常 / 加严（理由必填，用于产线突发质量问题时临时收紧）
   * - 放宽且连续 10 批合格 → 免检
   * - 免检 → 放宽（退回宽松检验）
   */
  const getAvailableActions = (record: IqcInspectionStrictness): string[] => {
    const actions: string[] = [];
    if (canConvertToExempt(record)) actions.push('to_exempt');
    if (record.strictness !== 'normal') actions.push('to_normal');
    if (record.strictness !== 'tightened') actions.push('to_tightened');
    if (record.strictness === 'exempt') actions.push('to_reduced_from_exempt');
    return actions;
  };

  const handleSubmitAction = async () => {
    if (!actionTarget || !user) return;
    if (!actionType) return;
    if (!actionReason.trim()) {
      toast.error(t('ui.请填写调整理由'));
      return;
    }

    setActionSubmitting(true);
    try {
      await manualStrictnessAction({
        materialId: actionTarget.materialId,
        action: actionType as any,
        operatorId: user.account,
        operatorName: user.name || user.account,
        reason: actionReason || undefined,
        exceptionSource: actionExceptionSource,
      });
      toast.success(t('ui.操作成功'));
      setActionDialog(false);
      fetchData(page);
    } catch (error: any) {
      logger.error('manual action failed', error);
      toast.error(error?.message || '操作失败');
    } finally {
      setActionSubmitting(false);
    }
  };

  const getStrictnessBadge = (s: string) => {
    const cfg = STRICTNESS_MAP[s] || STRICTNESS_MAP.normal;
    return (
      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cfg.color}`}>
        {cfg.label}
      </span>
    );
  };

  const rawColumns: TableProps<IqcInspectionStrictness>['columns'] = [
    {
      title: t('common.serialNo'),
      key: 'index',
      width: 60,
      align: 'center',
      render: (_: any, __: any, index: number) => (page - 1) * pageSize + index + 1,
    },
    { title: t('iqc.materialCode'), dataIndex: 'materialCode', width: 150, align: 'center' },
    { title: t('iqc.materialName'), dataIndex: 'materialName', width: 180, align: 'center' },
    {
      title: t('ui.严格度状态'),
      dataIndex: 'strictness',
      width: 150,
      align: 'center',
      render: (v: string, record: IqcInspectionStrictness) => (
        <div className="flex flex-col items-center gap-1">
          {getStrictnessBadge(v)}
          {canConvertToExempt(record) && (
            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
              {t('ui.可转免检')}
            </span>
          )}
        </div>
      ),
    },
    { title: t('ui.检验水平'), dataIndex: 'inspectionLevel', width: 100, align: 'center' },
    { title: 'AQL', dataIndex: 'aql', width: 80, align: 'center' },
    {
      title: t('ui.连续接收'),
      dataIndex: 'consecutiveAccepted',
      width: 110,
      align: 'center',
      render: (v: number, record: IqcInspectionStrictness) => {
        const n = Number(v || 0);
        if (record.strictness === 'reduced') {
          const reached = n >= 10;
          return (
            <span
              className={
                reached
                  ? 'inline-flex px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800'
                  : 'text-xs text-muted-foreground'
              }
            >
              {n} / 10
            </span>
          );
        }
        return v;
      },
    },
    {
      title: t('ui.5批内不合格'),
      dataIndex: 'recentRejectedIn5',
      width: 110,
      align: 'center',
      render: (v: number) => v,
    },
    {
      title: t('ui.加严累计不合格'),
      dataIndex: 'tightenedRejectedTotal',
      width: 120,
      align: 'center',
      render: (v: number) => v,
    },
    {
      title: t('system.updateTime'),
      dataIndex: 'updatedAt',
      width: 160,
      align: 'center',
      render: (v: string) => v ? new Date(v).toLocaleString('zh-CN', { hour12: false }) : '-',
    },
    {
      title: t('common.action'),
      key: 'action',
      width: 180,
      align: 'center',
      render: (_: any, record: IqcInspectionStrictness) => (
        <div className="flex gap-1 justify-center">
          <Button variant="ghost" size="sm" onClick={() => handleViewLogs(record)}>
            {t('ui.转移历史')}
          </Button>
          {canManualAction && (
            <Button variant="outline" size="sm" onClick={() => handleOpenAction(record)}>
              {t('ui.人工操作')}
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">{t('iqc.materialCode')}</label>
              <Input value={materialCode} onChange={(e) => setMaterialCode(e.target.value)} placeholder={t('iqc.materialCode')} />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">{t('iqc.materialName')}</label>
              <Input value={materialName} onChange={(e) => setMaterialName(e.target.value)} placeholder={t('iqc.materialName')} />
            </div>
            <div>
              <label className="block text-sm font-medium text-foreground mb-1">{t('ui.严格度状态')}</label>
              <Select value={strictness} onValueChange={setStrictness}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={t('common.all')} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">{t('common.all')}</SelectItem>
                  <SelectItem value="normal">{t('print.attrNormal')}</SelectItem>
                  <SelectItem value="tightened">{t('print.attrTightened')}</SelectItem>
                  <SelectItem value="reduced">{t('print.attrReduced')}</SelectItem>
                  <SelectItem value="exempt">{t('print.attrExempt')}</SelectItem>
                  <SelectItem value="suspended">{t('ui.暂停检验')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="secondary" onClick={handleReset}>{t('common.reset')}</Button>
            <Button onClick={handleSearch}>{t('common.search')}</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-4">
          <ResizableTable
            columns={rawColumns}
            dataSource={data}
            loading={loading}
            rowKey="id"
            scroll={{ x: 1400, y: 500 }}
            pagination={{
              current: page,
              pageSize,
              total,
              onChange: (p: number) => fetchData(p),
              showSizeChanger: false,
            }}
          />
        </CardContent>
      </Card>

      {/* 转移历史弹窗 */}
      <Dialog open={logDialog} onOpenChange={setLogDialog}>
        <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {tf('ui.严格度转移历史 - {name}', { name: logTarget?.materialName ?? '' })}
            </DialogTitle>
          </DialogHeader>
          {logLoading ? (
            <div className="py-8 text-center text-muted-foreground">{t('pda.loading')}</div>
          ) : (
            <div className="border border-border rounded-md overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">{t('common.time')}</th>
                    <th className="px-3 py-2 text-left font-medium">{t('ui.转移类型')}</th>
                    <th className="px-3 py-2 text-left font-medium">{t('ui.从')}</th>
                    <th className="px-3 py-2 text-left font-medium">{t('ui.到')}</th>
                    <th className="px-3 py-2 text-left font-medium">{t('ui.原因')}</th>
                    <th className="px-3 py-2 text-left font-medium">{t('ui.操作员')}</th>
                  </tr>
                </thead>
                <tbody>
                  {logData.map((log) => (
                    <tr key={log.id} className="border-t border-border">
                      <td className="px-3 py-2 whitespace-nowrap">
                        {log.createdAt ? new Date(log.createdAt).toLocaleString('zh-CN', { hour12: false }) : '-'}
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant={log.transferType === 'auto' ? 'secondary' : 'default'}>
                          {log.transferType === 'auto' ? t('ui.自动') : t('ui.人工')}
                        </Badge>
                      </td>
                      <td className="px-3 py-2">{getStrictnessBadge(log.fromStrictness)}</td>
                      <td className="px-3 py-2">{getStrictnessBadge(log.toStrictness)}</td>
                      <td className="px-3 py-2 text-muted-foreground">{log.reason || '-'}</td>
                      <td className="px-3 py-2">{log.operatorName || '-'}</td>
                    </tr>
                  ))}
                  {logData.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">{t('ui.暂无转移记录')}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
          <DialogFooter>
            <Button onClick={() => setLogDialog(false)}>{t('pda.close')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 人工操作弹窗 */}
      <Dialog open={actionDialog} onOpenChange={setActionDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tf('ui.人工操作 - {name}', { name: actionTarget?.materialName ?? '' })}</DialogTitle>
          </DialogHeader>
          {actionTarget && (() => {
            const availableActions = getAvailableActions(actionTarget);
            return (
            <div className="space-y-4">
              <div className="bg-muted p-3 rounded-md text-sm">
                <div>{t('ui.当前状态: ')}{getStrictnessBadge(actionTarget.strictness)}</div>
                {availableActions.length === 1 && (
                  <div className="mt-1">{t('ui.操作: ')}{t(ACTION_LABEL[availableActions[0]] || '')}</div>
                )}
                {availableActions.length === 0 && (
                  <div className="mt-1 text-muted-foreground">{t('ui.当前状态无需人工转移，系统会按每批最终判定自动流转。')}</div>
                )}
              </div>

              {/* 免检态有两个可选动作：回正常（异常登记）/ 直接收紧为加严 */}
              {availableActions.length > 1 && (
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">
                    {t('ui.请选择人工操作')} <span className="text-red-500">*</span>
                  </label>
                  <Select value={actionType} onValueChange={setActionType}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {availableActions.map((a) => (
                        <SelectItem key={a} value={a}>{t(ACTION_LABEL[a] || a)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* 免检退出的两条通道都要求登记异常来源 */}
              {(actionType === 'to_normal_from_exempt' || actionType === 'to_tightened_from_exempt') && (
                <div>
                  <label className="block text-sm font-medium text-foreground mb-1">{t('ui.异常来源')} <span className="text-red-500">*</span></label>
                  <Select value={actionExceptionSource} onValueChange={setActionExceptionSource}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="production">{t('ui.生产异常')}</SelectItem>
                      <SelectItem value="maintenance">{t('ui.维修异常')}</SelectItem>
                      <SelectItem value="customer_complaint">{t('ui.市场客诉')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-foreground mb-1">
                  {t('ui.调整理由')} <span className="text-red-500">*</span>
                </label>
                <Textarea
                  value={actionReason}
                  onChange={(e) => setActionReason(e.target.value)}
                  placeholder={t('ui.请填写调整理由（例如：产线反馈批量外观不良，临时加严管控）')}
                  rows={3}
                />
              </div>
            </div>
            );
          })()}
          <DialogFooter>
            <Button variant="secondary" onClick={() => setActionDialog(false)}>{t('pda.cancel')}</Button>
            <Button
              onClick={handleSubmitAction}
              disabled={actionSubmitting || !actionType || !actionReason.trim()}
            >
              {actionSubmitting ? t('pda.submitting') : t('ui.确认操作')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default IqcStrictness;
