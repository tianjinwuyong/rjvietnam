import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useI18n, tui } from '@client/src/i18n';
import { Input } from '@client/src/components/ui/input';
import { Button } from '@client/src/components/ui/button';
import { Badge } from '@client/src/components/ui/badge';
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
} from '@client/src/components/ui/dialog';
import ResizableTable from '@client/src/components/ui/resizable-table';
import { Table, type TableProps } from '@client/src/compat/antd-table';
import { logger } from '@client/src/utils/logger';
import { toast } from 'sonner';
import { getDefectiveMoveList, type DefectiveMoveTask } from '@client/src/api/defective-move';

const fmtTime = (v?: string | null) => (v ? new Date(v).toLocaleString('zh-CN') : '-');

/**
 * 不良品调拨单（台账）。
 *
 * 这里是「查账」的地方：谁在什么时候为哪批货开了调拨单、主管是否确认、最终搬到哪个库位。
 * 真正干活（制单 / 确认 / 扫码执行）统一在「库存 → 不良品调拨」作业台完成 ——
 * 一个入口执行，避免两套逻辑各写一遍、其中一套漏了校验。
 */
const DefectiveMoveList: React.FC = () => {
  const { t } = useI18n();
  const navigate = useNavigate();

  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [data, setData] = useState<DefectiveMoveTask[]>([]);
  const [loading, setLoading] = useState(false);

  const [status, setStatus] = useState('');
  const [keyword, setKeyword] = useState('');
  const [detailTask, setDetailTask] = useState<DefectiveMoveTask | null>(null);

  const fetchData = useCallback(
    async (p: number = page) => {
      setLoading(true);
      try {
        const res = await getDefectiveMoveList({
          page: p,
          pageSize,
          status: status || undefined,
          keyword: keyword || undefined,
        });
        setData(res.items || []);
        setTotal(Number(res.total || 0));
        setPage(p);
      } catch (error) {
        logger.error('get defective move list failed', error);
        toast.error(t('defectiveMove.loadFailed'));
      } finally {
        setLoading(false);
      }
    },
    [page, pageSize, status, keyword, t],
  );

  useEffect(() => {
    fetchData(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const goWorkbench = (task?: DefectiveMoveTask) => {
    navigate(task ? `/inventory/defective-transfer?task=${task.id}` : '/inventory/defective-transfer');
  };

  const statusBadge = (s: string) => {
    if (s === 'pending_confirm') {
      return <Badge variant="outline">{t('defectiveMove.status_pending_confirm')}</Badge>;
    }
    if (s === 'pending') {
      return <Badge variant="outline">{t('defectiveMove.status_pending')}</Badge>;
    }
    if (s === 'completed') {
      return <Badge variant="default">{t('defectiveMove.status_completed')}</Badge>;
    }
    if (s === 'cancelled') {
      return <Badge variant="secondary">{t('defectiveMove.status_cancelled')}</Badge>;
    }
    return <Badge variant="secondary">{s}</Badge>;
  };

  const sourceLabel = (s?: string | null) => {
    const map: Record<string, string> = {
      mrb_return: t('defectiveMove.source_mrb_return'),
      mrb_scrap: t('defectiveMove.source_mrb_scrap'),
      mrb_reject: t('defectiveMove.source_mrb_reject'),
      manual: t('defectiveMove.source_manual'),
    };
    return s ? map[s] || s : '-';
  };

  const columns: TableProps<DefectiveMoveTask>['columns'] = [
    {
      title: t('common.serialNo'),
      key: 'index',
      width: 64,
      fixed: 'left',
      render: (_: any, __: any, index: number) => (page - 1) * pageSize + index + 1,
    },
    {
      title: t('defectiveMove.moveNo'),
      dataIndex: 'moveNo',
      width: 180,
      render: (v: string, r: DefectiveMoveTask) => (
        <div className="flex flex-col">
          <span className="font-mono text-xs">{v || '-'}</span>
          {r.mrbNo && <span className="text-xs text-muted-foreground">{r.mrbNo}</span>}
        </div>
      ),
    },
    {
      title: t('defectiveMove.sourceInspectionNo'),
      dataIndex: 'sourceInspectionNo',
      width: 150,
      render: (v: string) => (v ? <span className="font-mono text-xs">{v}</span> : '-'),
    },
    {
      title: t('defectiveMove.source'),
      dataIndex: 'source',
      width: 130,
      render: (v: string) => sourceLabel(v),
    },
    {
      title: t('defectiveMove.material'),
      dataIndex: 'materialCode',
      width: 230,
      render: (v: string, r: DefectiveMoveTask) => (
        <div className="flex flex-col">
          <span className="font-mono text-xs">{v || '-'}</span>
          <span className="text-xs text-muted-foreground">{tui(r.materialName) || ''}</span>
        </div>
      ),
    },
    {
      title: t('defectiveMove.batchNo'),
      dataIndex: 'batchNo',
      width: 130,
      render: (v: string) => v || '-',
    },
    {
      title: t('defectiveMove.qty'),
      dataIndex: 'quantity',
      width: 110,
      align: 'right',
      render: (v: number, r: DefectiveMoveTask) => `${v} ${r.unit || ''}`,
    },
    {
      title: t('defectiveMove.fromLocation'),
      dataIndex: 'fromLocationCode',
      width: 150,
      render: (v: string) => v || '-',
    },
    {
      title: t('defectiveMove.toLocation'),
      dataIndex: 'toLocationCode',
      width: 150,
      render: (v: string) => v || t('defectiveMove.emptyLocation'),
    },
    {
      title: t('defectiveMove.status'),
      dataIndex: 'status',
      width: 120,
      render: (s: string) => statusBadge(s),
    },
    {
      title: t('defectiveMove.createdBy'),
      dataIndex: 'createdByName',
      width: 140,
      render: (v: string, r: DefectiveMoveTask) => (
        <div className="flex flex-col">
          <span>{v || '-'}</span>
          <span className="text-xs text-muted-foreground">{fmtTime(r.createdAt)}</span>
        </div>
      ),
    },
    {
      title: t('common.operation'),
      key: 'action',
      width: 190,
      fixed: 'right',
      render: (_: any, record: DefectiveMoveTask) => (
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => setDetailTask(record)}>
            {t('common.detail')}
          </Button>
          {(record.status === 'pending_confirm' || record.status === 'pending') && (
            <Button size="sm" onClick={() => goWorkbench(record)}>
              {t('defectiveMove.goScan')}
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="bg-card rounded-[12px] p-4 border border-border">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div>
            <h2 className="text-lg font-semibold text-foreground">{t('defectiveMove.title')}</h2>
            <p className="text-sm text-muted-foreground mt-1">{t('defectiveMove.ledgerSubtitle')}</p>
          </div>
          <Button onClick={() => goWorkbench()} className="shrink-0">
            {t('defectiveMove.openWorkbench')}
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              {t('defectiveMove.keyword')}
            </label>
            <Input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder={t('defectiveMove.keywordPlaceholder')}
              onKeyDown={(e) => e.key === 'Enter' && fetchData(1)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              {t('defectiveMove.status')}
            </label>
            <Select value={status || 'all'} onValueChange={(v) => setStatus(v === 'all' ? '' : v)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('common.all')}</SelectItem>
                <SelectItem value="pending_confirm">{t('defectiveMove.status_pending_confirm')}</SelectItem>
                <SelectItem value="pending">{t('defectiveMove.status_pending')}</SelectItem>
                <SelectItem value="completed">{t('defectiveMove.status_completed')}</SelectItem>
                <SelectItem value="cancelled">{t('defectiveMove.status_cancelled')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex gap-2 justify-end">
          <Button
            variant="secondary"
            onClick={() => {
              setStatus('');
              setKeyword('');
              setLoading(true);
              getDefectiveMoveList({ page: 1, pageSize })
                .then((res) => {
                  setData(res.items || []);
                  setTotal(Number(res.total || 0));
                  setPage(1);
                })
                .catch((e) => logger.error('reset defective move list failed', e))
                .finally(() => setLoading(false));
            }}
          >
            {t('common.reset')}
          </Button>
          <Button onClick={() => fetchData(1)}>{t('common.search')}</Button>
        </div>
      </div>

      <div className="bg-card rounded-[12px] p-4 border border-border">
        <ResizableTable
          columns={columns}
          dataSource={data}
          loading={loading}
          rowKey="id"
          scroll={{ x: 1850, y: 500 }}
          pagination={{
            current: page,
            pageSize,
            total,
            onChange: (p: number) => fetchData(p),
            showSizeChanger: false,
          }}
        />
      </div>

      <Dialog open={!!detailTask} onOpenChange={(open) => !open && setDetailTask(null)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {t('defectiveMove.detailTitle')}
              {detailTask?.moveNo ? ` - ${detailTask.moveNo}` : ''}
            </DialogTitle>
          </DialogHeader>
          {detailTask && (
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <span className="text-muted-foreground">{t('defectiveMove.source')}：</span>
                <span className="font-medium">{sourceLabel(detailTask.source)}</span>
              </div>
              <div>
                <span className="text-muted-foreground">{t('defectiveMove.status')}：</span>
                {statusBadge(detailTask.status)}
              </div>
              <div className="col-span-2">
                <span className="text-muted-foreground">{t('defectiveMove.material')}：</span>
                <span className="font-medium">
                  {detailTask.materialCode} {tui(detailTask.materialName) || ''}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">{t('defectiveMove.batchNo')}：</span>
                <span className="font-medium">{detailTask.batchNo || '-'}</span>
              </div>
              <div>
                <span className="text-muted-foreground">{t('defectiveMove.qty')}：</span>
                <span className="font-medium">
                  {detailTask.quantity} {detailTask.unit || ''}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">{t('defectiveMove.fromLocation')}：</span>
                <span className="font-medium">{detailTask.fromLocationCode || '-'}</span>
              </div>
              <div>
                <span className="text-muted-foreground">{t('defectiveMove.toLocation')}：</span>
                <span className="font-medium">
                  {detailTask.toLocationCode || t('defectiveMove.emptyLocation')}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">{t('defectiveMove.createdBy')}：</span>
                <span className="font-medium">{detailTask.createdByName || '-'}</span>
              </div>
              <div>
                <span className="text-muted-foreground">{t('defectiveMove.createdAt')}：</span>
                <span className="font-medium">{fmtTime(detailTask.createdAt)}</span>
              </div>
              <div>
                <span className="text-muted-foreground">{t('defectiveMove.confirmedByName')}：</span>
                <span className="font-medium">{detailTask.confirmedByName || '-'}</span>
              </div>
              <div>
                <span className="text-muted-foreground">{t('defectiveMove.confirmedAt')}：</span>
                <span className="font-medium">{fmtTime(detailTask.confirmedAt)}</span>
              </div>
              <div>
                <span className="text-muted-foreground">{t('defectiveMove.operator')}：</span>
                <span className="font-medium">{detailTask.operatorName || '-'}</span>
              </div>
              <div>
                <span className="text-muted-foreground">{t('defectiveMove.scanToCode')}：</span>
                <span className="font-medium">{detailTask.scanToCode || '-'}</span>
              </div>
              <div className="col-span-2">
                <span className="text-muted-foreground">{t('defectiveMove.reason')}：</span>
                <span className="font-medium">{detailTask.reason || '-'}</span>
              </div>
              <div className="col-span-2">
                <span className="text-muted-foreground">{t('defectiveMove.remark')}：</span>
                <span className="font-medium">{detailTask.remark || '-'}</span>
              </div>
              <div className="col-span-2">
                <span className="text-muted-foreground">{t('defectiveMove.confirmRemarkLabel')}：</span>
                <span className="font-medium">{detailTask.confirmRemark || '-'}</span>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default DefectiveMoveList;
