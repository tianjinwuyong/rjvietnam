// DataSourceRecordTable — Live scrolling feed of records from all data source adapters
import { useState, useEffect, useRef } from 'react';
import { db } from '../db.js';
import { t } from '../i18n.js';
import type { DataSourceRecord } from '../db.js';
import type { NormalizedRecord } from '../adapters/DataAdapter.js';

interface Props {
  records: NormalizedRecord[];   // live records from DataSourceManager
  maxDisplay?: number;
}

export function DataSourceRecordTable({ records, maxDisplay = 200 }: Props) {
  const [dbRecords, setDbRecords] = useState<DataSourceRecord[]>([]);
  const [filterSn, setFilterSn] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const prevCountRef = useRef(0);

  // Load historical from DB
  useEffect(() => {
    db.dataSourceRecords.orderBy('timestamp').reverse().limit(maxDisplay).toArray()
      .then(setDbRecords);
  }, []);

  // Auto-scroll on new records
  useEffect(() => {
    if (records.length > prevCountRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
    prevCountRef.current = records.length;
  }, [records.length]);

  const allRecords: NormalizedRecord[] = [...records, ...dbRecords].slice(0, maxDisplay);
  const filtered = filterSn
    ? allRecords.filter(r => r.sn?.toLowerCase().includes(filterSn.toLowerCase()))
    : allRecords;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
        <h3>{t('datasource_live_feed')}</h3>
        <span style={{ fontSize: 12, color: '#666' }}>{records.length} live / {dbRecords.length} stored</span>
        <input
          placeholder={`${t('datasource_filter_sn')}...`}
          value={filterSn}
          onChange={(e) => setFilterSn(e.target.value)}
          style={{ marginLeft: 'auto', width: 180 }}
        />
      </div>

      <div style={{
        height: 300,
        overflowY: 'auto',
        border: '1px solid #ddd',
        borderRadius: 6,
        fontSize: 12,
        fontFamily: 'monospace',
        background: '#fafafa',
      }}>
        {filtered.length === 0 && (
          <div style={{ padding: 20, color: '#999', textAlign: 'center' }}>
            {t('datasource_no_records')}
          </div>
        )}

        {filtered.map((record, i) => (
          <div key={`${record.source}-${record.timestamp}-${i}`} style={{
            padding: '5px 10px',
            borderBottom: '1px solid #f0f0f0',
            display: 'grid',
            gridTemplateColumns: '140px 100px 80px 80px 1fr',
            gap: 8,
            alignItems: 'start',
          }}>
            <span style={{ color: '#888' }}>{record.timestamp.slice(11, 19)}</span>
            <span style={{
              padding: '1px 5px', borderRadius: 3, fontSize: 10, textAlign: 'center',
              background: record.adapterType === 'file' ? '#e3f2fd' :
                          record.adapterType === 'http' ? '#e8f5e9' :
                          record.adapterType === 'mqtt' ? '#fff3e0' : '#f3e5f5',
            }}>
              {record.adapterType}
            </span>
            <span style={{
              padding: '1px 5px', borderRadius: 3, fontSize: 10, textAlign: 'center',
              background: record.sn ? '#d4edda' : '#e9ecef',
              color: record.sn ? '#155724' : '#666',
            }}>
              {record.sn ?? '—'}
            </span>
            <span style={{ fontSize: 10, color: '#666' }}>{record.type}</span>
            <span title={JSON.stringify(record.data)} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: '#333' }}>
              {JSON.stringify(record.data).slice(0, 120)}
            </span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
