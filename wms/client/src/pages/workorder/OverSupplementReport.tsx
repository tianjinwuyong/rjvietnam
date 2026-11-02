import React, { useState, useEffect, useCallback } from 'react';
import ResizableTable from '@client/src/components/ui/resizable-table';
import { Table, type TableProps } from '@client/src/compat/antd-table';
import { Button } from '@client/src/components/ui/button';
import { Input } from '@client/src/components/ui/input';
import { Card, CardContent } from '@client/src/components/ui/card';
import { apiGet } from '@client/src/api/request';
import { toast } from 'sonner';
import { useI18n } from '../../i18n';

// ========== 金额汇总（按工单） ==========
interface AmountItem {
  workOrderId: string;
  workOrderNo: string;
  workOrderDate: string;
  productCode: string;
  normalAmount: number;
  overAmount: number;
  overSupplementRate: number;
}

interface AmountResponse {
  items: AmountItem[];
  summary: {
    normalAmount: number;
    overAmount: number;
    overSupplementRate: number;
  };
  total: number;
  page: number;
  pageSize: number;
}

// ========== 物料数量明细（展开行） ==========
interface OverSupplementItem {
  workOrderNo: string;
  materialCode: string;
  materialName: string;
  unitUsage: number;
  baseQty: number;
  overIssueQty: number;
  supplementQty: number;
  requiredQty: number;
  issuedQty: number;
  overSupplementRate: number;
}

interface OverSupplementResponse {
  items: OverSupplementItem[];
  total: number;
}

const fmtMoney = (v: number | undefined) =>
  '¥' + (Number(v) || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// 展开行：物料数量明细
const ExpandedDetail: React.FC<{ workOrderNo: string }> = ({ workOrderNo }) => {
  const { t } = useI18n();
  const [list, setList] = useState<OverSupplementItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiGet<OverSupplementResponse>('/api/workorder/requirement/over-supplement-report', {
      workOrderNo,
      page: 1,
      pageSize: 200,
    })
      .then((res) => setList(res.items || []))
      .catch(() => toast.error(t('ui.物料明细查询失败')))
      .finally(() => setLoading(false));
  }, [workOrderNo]);

  const detailColumns: TableProps<OverSupplementItem>['columns'] = [
    { title: t('iqc.materialCode'), dataIndex: 'materialCode', width: 140 },
    { title: t('iqc.materialName'), dataIndex: 'materialName', width: 180 },
    { title: t('ui.BOM用量'), dataIndex: 'unitUsage', width: 90, align: 'right', render: (v: number) => v ?? 0 },
    { title: t('ui.基础需求'), dataIndex: 'baseQty', width: 90, align: 'right', render: (v: number) => v ?? 0 },
    { title: t('ui.超领量'), dataIndex: 'overIssueQty', width: 90, align: 'right', render: (v: number) => v ?? 0 },
    { title: t('ui.补料量'), dataIndex: 'supplementQty', width: 90, align: 'right', render: (v: number) => v ?? 0 },
    { title: t('ui.实际需求'), dataIndex: 'requiredQty', width: 90, align: 'right', render: (v: number) => v ?? 0 },
    { title: t('ui.实际领料'), dataIndex: 'issuedQty', width: 90, align: 'right', render: (v: number) => v ?? 0 },
    {
      title: t('ui.数量超补率(%)'),
      dataIndex: 'overSupplementRate',
      width: 120,
      align: 'right',
      render: (v: number) => {
        const rate = Number(v) || 0;
        const color = rate > 0 ? 'text-orange-500 font-medium' : 'text-muted-foreground';
        return <span className={color}>{rate.toFixed(2)}%</span>;
      },
    },
  ];

  return (
    <Table<OverSupplementItem>
      rowKey={(record, index) => `${record.materialCode}-${index}`}
      columns={detailColumns}
      dataSource={list}
      loading={loading}
      pagination={false}
      size="small"
    />
  );
};

const OverSupplementReport: React.FC = () => {
  const { t } = useI18n();
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [list, setList] = useState<AmountItem[]>([]);
  const [summary, setSummary] = useState<AmountResponse['summary']>({
    normalAmount: 0,
    overAmount: 0,
    overSupplementRate: 0,
  });
  const [loading, setLoading] = useState(false);

  const [workOrderNo, setWorkOrderNo] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const fetchData = useCallback(async (p: number = page) => {
    setLoading(true);
    try {
      const res: AmountResponse = await apiGet(
        '/api/workorder/requirement/over-supplement-amount-report',
        {
          workOrderNo: workOrderNo || undefined,
          startDate: startDate || undefined,
          endDate: endDate || undefined,
          page: p,
          pageSize,
        },
      );
      setList(res.items || []);
      setSummary(res.summary || { normalAmount: 0, overAmount: 0, overSupplementRate: 0 });
      setTotal(res.total || 0);
      setPage(p);
    } catch {
      toast.error(t('pda.inventory.queryFailed'));
    } finally {
      setLoading(false);
    }
  }, [page, pageSize, workOrderNo, startDate, endDate]);

  useEffect(() => {
    fetchData(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSearch = () => fetchData(1);

  const handleReset = () => {
    setWorkOrderNo('');
    setStartDate('');
    setEndDate('');
    fetchData(1);
  };

  const columns: TableProps<AmountItem>['columns'] = [
    { title: t('pda.picking.wo'), dataIndex: 'workOrderNo', width: 170, fixed: 'left' },
    { title: t('bom.productCode'), dataIndex: 'productCode', width: 140 },
    { title: t('workorder.workOrderDate'), dataIndex: 'workOrderDate', width: 120 },
    {
      title: t('ui.正常物料金额'),
      dataIndex: 'normalAmount',
      width: 150,
      align: 'right',
      render: (v: number) => <span>{fmtMoney(v)}</span>,
    },
    {
      title: t('ui.超补物料金额'),
      dataIndex: 'overAmount',
      width: 150,
      align: 'right',
      render: (v: number) => {
        const amt = Number(v) || 0;
        const color = amt > 0 ? 'text-orange-600 font-medium' : 'text-muted-foreground';
        return <span className={color}>{fmtMoney(amt)}</span>;
      },
    },
    {
      title: t('ui.超补比例(%)'),
      dataIndex: 'overSupplementRate',
      width: 130,
      align: 'right',
      render: (v: number, record) => {
        const rate = Number(v) || 0;
        if (record.normalAmount <= 0) return <span className="text-muted-foreground">--</span>;
        const color = rate >= 10 ? 'text-red-600 font-semibold' : rate > 0 ? 'text-orange-500 font-medium' : 'text-muted-foreground';
        return <span className={color}>{rate.toFixed(2)}%</span>;
      },
    },
  ];

  return (
    <div className="p-6 space-y-4">
      <h2 className="text-lg font-semibold text-foreground">{t('ui.工单超补比例报表')}</h2>

      {/* 金额汇总卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-5 pb-4">
            <p className="text-sm text-muted-foreground">{t('ui.正常物料总金额')}</p>
            <p className="text-2xl font-semibold mt-1">{fmtMoney(summary.normalAmount)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-4">
            <p className="text-sm text-muted-foreground">{t('ui.超补物料总金额')}</p>
            <p className="text-2xl font-semibold mt-1 text-orange-600">{fmtMoney(summary.overAmount)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-5 pb-4">
            <p className="text-sm text-muted-foreground">{t('ui.综合超补比例（超补金额 ÷ 正常金额）')}</p>
            <p
              className={`text-2xl font-semibold mt-1 ${
                summary.overSupplementRate >= 10
                  ? 'text-red-600'
                  : summary.overSupplementRate > 0
                    ? 'text-orange-500'
                    : 'text-muted-foreground'
              }`}
            >
              {(Number(summary.overSupplementRate) || 0).toFixed(2)}%
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-wrap gap-3 items-end">
            <div className="flex flex-col gap-1">
              <label className="text-sm text-muted-foreground">{t('pda.picking.wo')}</label>
              <Input
                value={workOrderNo}
                onChange={(e) => setWorkOrderNo(e.target.value)}
                className="w-44"
                placeholder={t('overPicking.workOrderNoRequired')}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm text-muted-foreground">{t('common.startDate')}</label>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-44"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-sm text-muted-foreground">{t('common.endDate')}</label>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-44"
              />
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

      <Card>
        <CardContent className="pt-4">
          <ResizableTable
            rowKey="workOrderId"
            columns={columns}
            dataSource={list}
            loading={loading}
            scroll={{ x: 900, y: 500 }}
            expandable={{
              expandedRowRender: (record) => <ExpandedDetail workOrderNo={record.workOrderNo} />,
              rowExpandable: (record) => record.workOrderNo != null,
            }}
            pagination={{
              current: page,
              pageSize,
              total,
              showSizeChanger: false,
              onChange: (p) => fetchData(p),
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
};

export default OverSupplementReport;
