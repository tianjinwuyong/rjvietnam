import React, { useState, useEffect } from 'react';
import {
  Input,
  Select,
  Button,
  Card,
  Space,
  Tag,
  Modal,
  Descriptions,
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
// 与其它列表页统一走兼容层：表头左对齐、列宽可拖动（直连 antd 的 Table 会漏掉表头规则）
import { Table } from '@client/src/compat/antd-table';
import { apiGet } from '@client/src/api/request';
import { useI18n } from '../../i18n';

interface SupplierDebt {
  id: string;
  debt_no: string;
  supplier_code: string;
  supplier_name: string;
  material_code: string;
  material_name: string;
  origin_qty: string;
  settled_qty: string;
  remaining_qty: string;
  source_type: string;
  source_no: string;
  status: string;
  remark: string;
  _created_at: string;
  settlements?: Array<{
    id: string;
    receipt_no: string;
    qty: string;
    iqc_result: string;
    _created_at: string;
  }>;
}

const SupplierDebtList: React.FC = () => {
  const { t } = useI18n();
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<SupplierDebt[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [supplierName, setSupplierName] = useState('');
  const [materialCode, setMaterialCode] = useState('');
  const [status, setStatus] = useState<string>('');
  const [detailVisible, setDetailVisible] = useState(false);
  const [currentDetail, setCurrentDetail] = useState<SupplierDebt | null>(null);

  const fetchData = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      });
      if (supplierName) params.append('supplierName', supplierName);
      if (materialCode) params.append('materialCode', materialCode);
      if (status) params.append('status', status);
      const res = await apiGet<{ code: number; message: string; data: { items: SupplierDebt[]; total: number } }>(
        `/api/supplier-debt/list?${params.toString()}`
      );
      setData(res.data.items);
      setTotal(res.data.total);
    } catch (err) {
      console.error('Failed to fetch supplier debt list:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [page, pageSize]);

  const handleSearch = () => {
    // setPage(1) 是异步的：紧接着调 fetchData() 用的是闭包里的旧 page，
    // 与 useEffect 里那次正确请求形成竞态 —— 旧结果后到就会闪出一张空表。
    // 已在第 1 页时 setPage(1) 不触发重渲染，才需要手动刷新。
    if (page === 1) fetchData();
    else setPage(1);
  };

  const handleReset = () => {
    setSupplierName('');
    setMaterialCode('');
    setStatus('');
    // setPage(1) 是异步的：紧接着调 fetchData() 用的是闭包里的旧 page，
    // 与 useEffect 里那次正确请求形成竞态 —— 旧结果后到就会闪出一张空表。
    // 已在第 1 页时 setPage(1) 不触发重渲染，才需要手动刷新。
    if (page === 1) fetchData();
    else setPage(1);
  };

  const showDetail = async (id: string) => {
    try {
      const res = await apiGet<{ code: number; message: string; data: SupplierDebt }>(
        `/api/supplier-debt/${id}`
      );
      setCurrentDetail(res.data);
      setDetailVisible(true);
    } catch (err) {
      console.error('Failed to fetch debt detail:', err);
    }
  };

  const columns: ColumnsType<SupplierDebt> = [
    {
      title: t('ui.欠料单号'),
      dataIndex: 'debt_no',
      key: 'debt_no',
      width: 150,
    },
    {
      title: t('print.supplier'),
      dataIndex: 'supplier_name',
      key: 'supplier_name',
      width: 200,
    },
    {
      title: t('iqc.materialCode'),
      dataIndex: 'material_code',
      key: 'material_code',
      width: 150,
    },
    {
      title: t('iqc.materialName'),
      dataIndex: 'material_name',
      key: 'material_name',
      width: 180,
    },
    {
      title: t('ui.初始欠料'),
      dataIndex: 'origin_qty',
      key: 'origin_qty',
      width: 100,
      align: 'right',
    },
    {
      title: t('ui.已补合格'),
      dataIndex: 'settled_qty',
      key: 'settled_qty',
      width: 100,
      align: 'right',
    },
    {
      title: t('ui.剩余未平账'),
      dataIndex: 'remaining_qty',
      key: 'remaining_qty',
      width: 110,
      align: 'right',
      render: (val: string) => (
        <span style={{ color: Number(val) > 0 ? '#ff4d4f' : '#52c41a', fontWeight: 'bold' }}>
          {val}
        </span>
      ),
    },
    {
      title: t('ui.来源单据'),
      dataIndex: 'source_no',
      key: 'source_no',
      width: 150,
    },
    {
      title: t('common.status'),
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (val: string) => {
        if (val === 'pending') return <Tag color="orange">{t('ui.未平账')}</Tag>;
        if (val === 'settled') return <Tag color="green">{t('ui.已平账')}</Tag>;
        return <Tag>{val}</Tag>;
      },
    },
    {
      title: t('bom.createTime'),
      dataIndex: '_created_at',
      key: '_created_at',
      width: 160,
      render: (val: string) => (val ? new Date(val).toLocaleString('zh-CN') : ''),
    },
    {
      title: t('common.action'),
      key: 'action',
      width: 100,
      render: (_, record) => (
        <Button type="link" size="small" onClick={() => showDetail(record.id)}>
          {t('common.detail')}
        </Button>
      ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <Card title={t('nav.supplierDebt')}>
        <Space style={{ marginBottom: 16 }}>
          <Input
            placeholder={t('iqc.supplierName')}
            value={supplierName}
            onChange={(e) => setSupplierName(e.target.value)}
            style={{ width: 200 }}
          />
          <Input
            placeholder={t('iqc.materialCode')}
            value={materialCode}
            onChange={(e) => setMaterialCode(e.target.value)}
            style={{ width: 180 }}
          />
          <Select
            placeholder={t('common.status')}
            value={status || undefined}
            onChange={(val) => setStatus(val || '')}
            style={{ width: 120 }}
            allowClear
          >
            <Select.Option value="pending">{t('ui.未平账')}</Select.Option>
            <Select.Option value="settled">{t('ui.已平账')}</Select.Option>
          </Select>
          <Button type="primary" onClick={handleSearch}>{t('common.search')}</Button>
          <Button onClick={handleReset}>{t('common.reset')}</Button>
        </Space>

        <Table
          columns={columns}
          dataSource={data}
          rowKey="id"
          loading={loading}
          pagination={{
            current: page,
            pageSize: pageSize,
            total: total,
            onChange: (p, ps) => {
              setPage(p);
              setPageSize(ps);
            },
          }}
          scroll={{ x: 1400 }}
        />
      </Card>

      <Modal
        title={t('ui.欠料详情')}
        open={detailVisible}
        onCancel={() => setDetailVisible(false)}
        footer={null}
        width={800}
      >
        {currentDetail && (
          <>
            <Descriptions bordered column={2} size="small" style={{ marginBottom: 16 }}>
              <Descriptions.Item label={t('ui.欠料单号')}>{currentDetail.debt_no}</Descriptions.Item>
              <Descriptions.Item label={t('common.status')}>
                {currentDetail.status === 'pending' ? t('ui.未平账') : t('ui.已平账')}
              </Descriptions.Item>
              <Descriptions.Item label={t('print.supplier')}>{currentDetail.supplier_name}</Descriptions.Item>
              <Descriptions.Item label={t('iqc.materialCode')}>{currentDetail.material_code}</Descriptions.Item>
              <Descriptions.Item label={t('iqc.materialName')}>{currentDetail.material_name}</Descriptions.Item>
              <Descriptions.Item label={t('ui.来源单据')}>{currentDetail.source_no}</Descriptions.Item>
              <Descriptions.Item label={t('ui.初始欠料')}>{currentDetail.origin_qty}</Descriptions.Item>
              <Descriptions.Item label={t('ui.已补合格')}>{currentDetail.settled_qty}</Descriptions.Item>
              <Descriptions.Item label={t('ui.剩余未平账')} span={2}>
                <span style={{ color: Number(currentDetail.remaining_qty) > 0 ? '#ff4d4f' : '#52c41a', fontWeight: 'bold' }}>
                  {currentDetail.remaining_qty}
                </span>
              </Descriptions.Item>
            </Descriptions>

            <h4>{t('ui.补料冲减记录')}</h4>
            <Table
              dataSource={currentDetail.settlements || []}
              rowKey="id"
              size="small"
              pagination={false}
              columns={[
                { title: t('iqc.receiptNo'), dataIndex: 'receipt_no', key: 'receipt_no' },
                { title: t('ui.冲减数量'), dataIndex: 'qty', key: 'qty', align: 'right' },
                {
                  title: t('ui.IQC结果'),
                  dataIndex: 'iqc_result',
                  key: 'iqc_result',
                  render: (val: string) =>
                    val === 'pass' ? <Tag color="green">Pass</Tag> : <Tag color="red">Fail</Tag>,
                },
                {
                  title: t('ui.冲减时间'),
                  dataIndex: '_created_at',
                  key: '_created_at',
                  render: (val: string) => (val ? new Date(val).toLocaleString('zh-CN') : ''),
                },
              ]}
            />
          </>
        )}
      </Modal>
    </div>
  );
};

export default SupplierDebtList;
