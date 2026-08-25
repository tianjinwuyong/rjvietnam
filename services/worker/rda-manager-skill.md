# RDA AI Manager — Virtual Agent Skills
# Report Data Analysis Manager — 报表数据分析管理员

## Agent Profile

**Name**: RDA AI Manager (`报表数据分析AI管理员`)
**Model**: Ornith-1.0-9B (local, privacy-first, no factory data leaves premises)
**Execution**: Node.js DB queries + API calls + LINE notifications
**Escalation**: LINE/Email alerts for anomaly detection, trend breakouts, retention warnings; human-in-the-loop for critical business decisions
**Memory**: Last-state JSON for delta detection between cycles; archive snapshot cache for trend window tracking
**Audit**: Every archive operation and analysis query logged with timestamp, operator, source, row_count, data checksum

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│  Scheduler (Windows Task Scheduler / cron)               │
│  Every 30 min: incremental archive patrol                │
│  07:30: morning analysis digest to LINE                  │
│  17:00: daily archive summary                            │
│  23:00: daily full report archive snapshot               │
│  Monday 08:00: weekly trend analysis report              │
│  1st of month: monthly cross-domain analysis             │
└─────────────────────────┬────────────────────────────────┘
                          │
                          ▼
┌──────────────────────────────────────────────────────────┐
│  rda-manager.js (Node.js)                                │
│  1. Query DB via rda-query.js                            │
│  2. Archive snapshots via API                            │
│  3. Analyze trends via rda-analyze.js                    │
│  4. Generate insights via Ornith                         │
│  5. Send alerts/reports via LINE                          │
└──────────┬───────────────────────────┬───────────────────┘
           │                           │
           ▼                           ▼
    ┌─────────────┐           ┌──────────────┐
    │  PostgreSQL  │           │   LINE API   │
    │ (archive DB) │           │ (alerts/digest)
    └─────────────┘           └──────────────┘
           │
           ▼
    ┌─────────────┐
    │   Ornith    │
    │  (analysis) │
    └─────────────┘
```

---

## Core Skills

### Skill 1: Report Auto-Archive Agent

**Trigger**: Every report API GET request; scheduled daily snapshot at 23:00

**Logic**:
```
FOR each report in REPORT_DEFS:
  1. Fetch report data from its SQL view
  2. Map report key → archive category_id (via source_key lookup)
  3. Build snapshot_data = { rows: [...], columns: [...], generatedAt: timestamp }
  4. INSERT into document_archives:
     - category_id: mapped from report domain
     - archive_type: 'report'
     - source_key: report key (e.g., 'oee-by-line')
     - parameter_snapshot: { period, filters, ... }
     - row_count: result.rows.length
     - snapshot_data: full JSON payload
     - user_agent: 'system:scheduled' or 'user:<username>'
  5. Log to archive_snapshots with total_archived count
```

**Scheduled Archive Matrix**:

| Schedule | Scope | Retention |
|---|---|---|
| Real-time (on API call) | Single report, current params | 5 years |
| Daily 23:00 | All 16 reports, daily/default period | 5 years |
| Weekly (Sun 23:00) | All period-aware reports, weekly | 5 years |
| Monthly (1st 23:00) | All period-aware reports, monthly | 5 years |
| Manual (on-demand) | Any report + params | 5 years / pinned |

**Tool**: `POST /api/archives/from-report` + `POST /api/archives/run-snapshot`

---

### Skill 2: Historical Trend Analysis Agent

**Trigger**: On-demand analysis request; weekly trend report (Monday 08:00); anomaly detection patrol

**Analysis Types**:

| Type | Description | Example |
|---|---|---|
| `trend` | Value over time for a single metric | OEE trend over last 12 weeks |
| `comparison` | Side-by-side metric across lines/groups | Yield comparison Line1 vs Line2 |
| `aggregation` | Sum/avg/min/max across archive window | Total defects by month, QoQ |
| `drill-down` | Break down aggregated data by dimension | Defects by station → defect code → severity |
| `cross-domain` | Correlation across different categories | OEE dip vs attendance dip vs downtime |

**Trend Query Flow**:
```
INPUT: source_key, metric_column, group_by, period, dateRange
  1. SELECT archived_at, snapshot_data->metric FROM document_archives
     WHERE source_key = $1 AND archived_at BETWEEN $2 AND $3
  2. Extract metric values from JSONB snapshot_data
  3. Group by period (daily/weekly/monthly)
  4. Calculate: avg, min, max, stddev, count
  5. Detect anomalies: value > avg + 2*stddev → flag
  6. RETURN { series: [...], stats: {...}, anomalies: [...] }
```

**Anomaly Detection Rules**:

| Pattern | Detection | Alert |
|---|---|---|
| Sudden drop > 20% MoM | Compare last 2 periods | 🟡 WARNING |
| Prolonged decline (3+ periods) | Linear regression slope negative | 🟠 ALERT |
| Spike > 3σ from mean | Statistical outlier | 🟡 WARNING |
| Zero data for expected period | Missing archive check | 🔴 MISSING DATA |

**Tool**: `rda-analyze.js trend|compare|aggregate|drill|cross`

---

### Skill 3: Cross-Domain Correlation Agent

**Trigger**: Weekly analysis report; on-demand correlation query

**Purpose**: Find relationships between metrics across different factory domains

**Correlation Matrix** (pre-registered):

| X Domain | Y Domain | Hypothesis | Query |
|---|---|---|---|
| Production (OEE) | Quality (FPY) | OEE dip → quality drop | Compare OEE vs yield over same weeks |
| Production (OEE) | Equipment (Downtime) | Downtime drives OEE loss | OEE vs downtime_minutes correlation |
| Warehouse (Inventory) | Production (WIP) | Stockout causes line stop | Material shortage events vs production halt |
| HR (Attendance) | Production (Output) | Absenteeism affects throughput | Attendance rate vs output per line |
| Quality (IQC reject) | Warehouse (Return) | Supplier issue → return spike | IQC reject rate vs material return rate |
| Finance (AR aging) | Customer (Orders) | Slow payment → delivery hold | AR days vs order volume per customer |

**Tool**: `rda-analyze.js cross --x <source> --y <source> --metricX <col> --metricY <col>`

---

### Skill 4: Archive Retention & Cleanup Agent

**Trigger**: Daily cleanup patrol (02:00); on-demand retention check

**Retention Policy**:

| Archive Type | Retention | Cleanup Action |
|---|---|---|
| Report snapshots (auto) | 5 years from archived_at | DELETE where expires_at < NOW() AND NOT is_pinned |
| Manual archives | 5 years (default) | DELETE where expires_at < NOW() AND NOT is_pinned |
| Pinned archives | Forever (until unpinned) | No action |
| System logs | 1 year | DELETE where created_at < NOW() - 1 year |

**Cleanup Flow**:
```
1. SELECT COUNT(*) FROM document_archives WHERE expires_at < NOW() AND NOT is_pinned
2. DELETE FROM document_archives WHERE expires_at < NOW() AND NOT is_pinned
3. VACUUM document_archives (reclaim space)
4. Log: "Cleaned up N expired archives (retention: 5 years)"
5. If deleted > 10000 rows → LINE notification to admin
```

**Pre-cleanup Report** (runs before deletion):
```
📋 归档清理预告 {date}
━━━━━━━━━━━━━━━━━━
即将过期: N 条记录
按类别:
  - production: N 条
  - warehouse: N 条
  - quality: N 条
  ...
保留策略: 5年 (固定归档不受影响)
━━━━━━━━━━━━━━━━━━
```

**Tool**: `rda-manager.js cleanup [--dry-run]` + `rda-manager.js retention-report`

---

### Skill 5: Insight Generator Agent

**Trigger**: Weekly analysis (Monday 08:00); monthly cross-domain (1st 08:00); on-demand

**Purpose**: Use Ornith LLM to generate natural-language insights from archive data

**Input**: Statistical analysis results from Skills 2-3
**Output**: Structured insight report in Chinese

**Insight Prompt Template**:

```
## RDA AI Manager — Insight Request

Archive analysis data — {dateRange}

<TREND_DATA>
{json}
</TREND_DATA>

<COMPARISON_DATA>
{json}
</COMPARISON_DATA>

<ANOMALIES>
{json}
</ANOMALIES>

Context: You are a Report Data Analysis Manager for a Vietnam SMT factory.
Language: Chinese (all output in Chinese)
Audience: Factory management team

Analyze the data and respond ONLY with this JSON block:

<INSIGHTS>
{{
  "summary": "一句话总结本周工厂状态",
  "key_findings": [
    {{
      "severity": "positive|warning|critical",
      "domain": "production|warehouse|quality|hr-equipment|finance",
      "title": "发现标题",
      "detail": "详细分析描述",
      "metric": "相关指标名称",
      "value": 数值,
      "change_vs_last_period": "+5%|-3%|持平",
      "recommendation": "建议行动"
    }}
  ],
  "cross_domain_insights": [
    {{
      "domains": ["生产", "质量"],
      "correlation": "OEE下降与FPY下降相关",
      "strength": "strong|moderate|weak",
      "detail": "分析详情"
    }}
  ],
  "alerts": [
    {{
      "severity": "info|warning|critical",
      "source_key": "oee-by-line|defect-analysis|...",
      "message": "警报信息",
      "recommended_action": "建议操作"
    }}
  ]
}}
</INSIGHTS>
```

**Tool**: `rda-manager.js insights [--days 7]`

---

### Skill 6: Category & Metadata Manager

**Trigger**: On-demand category management; new report type added

**Purpose**: Maintain archive category tree and analysis view registry

**Operations**:
- List full category tree with archive counts
- Register new analysis view for trending
- Update category metadata (i18n names, sort order)
- Archive counts per category (total archives, oldest/newest, size estimate)

**Tool**: `rda-query.js categories` + `rda-query.js register-analysis-view`

---

### Skill 7: Export & Report Generator Agent

**Trigger**: On-demand export request; scheduled report generation

**Export Formats**:

| Format | Use Case | Implementation |
|---|---|---|
| JSON | API consumption | Direct from document_archives.snapshot_data |
| CSV | Spreadsheet analysis | Flatten snapshot_data.rows to CSV |
| Excel (.xlsx) | Formal reporting | Build from snapshot_data + metadata |
| PDF | Print-ready | HTML template + puppeteer (future) |

**Scheduled Reports**:

| Report | Schedule | Recipient |
|---|---|---|
| Daily archive summary | 17:00 daily | System admin |
| Weekly trend analysis | Monday 08:00 | Management team |
| Monthly cross-domain report | 1st 08:00 | All virtual managers |
| Quarterly business review | Quarterly | Factory director |

**Tool**: `rda-manager.js export --id <archiveId> --format csv|xlsx`

---

### Skill 8: Data Integrity & Audit Agent

**Trigger**: Every archive insert; periodic integrity patrol (weekly)

**Integrity Checks**:

1. **Checksum Verification**
   - On INSERT: SHA-256(snapshot_data::text) stored in checksum column
   - On patrol: recalc checksum for random 5% sample → match stored value
   - Failure: 🔴 LINE alert: `存档 {id} 数据完整性校验失败 — 可能被篡改`

2. **Missing Data Detection**
   - Check expected archive frequency vs actual archives per source_key
   - If gap > 2x expected interval: 🟡 flag missing period
   - Example: OEE daily archive missing for 3 days → alert

3. **Orphan Category Check**
   - Archives referencing non-existent category_id
   - Action: auto-reassign to parent category, log warning

**Tool**: `rda-analyze.js integrity-check [--sample 5]` + `rda-analyze.js missing-data-detection`

---

## Task Schedule

| Time | Agent | Action |
|---|---|---|
| 02:00 daily | Retention Cleanup | Purge expired archives, VACUUM |
| 07:30 daily | Insight Generator | Morning analysis digest to LINE |
| 12:00 daily | Patrol | Incremental archive check, missing data detection |
| 17:00 daily | Export | Daily archive summary report |
| 23:00 daily | Auto-Archive | Full daily snapshot of all reports |
| Sun 23:00 weekly | Auto-Archive | Weekly period snapshot |
| Monday 08:00 | Insight Generator | Weekly trend analysis + LINE report |
| 1st 23:00 monthly | Auto-Archive | Monthly period snapshot |
| 1st 08:00 monthly | Insight Generator | Monthly cross-domain analysis |
| Monday 02:00 weekly | Integrity Check | Checksum validation on sample |
| Every 30 min | Patrol | Lightweight: check pending archives, anomaly scan |

---

## AI Prompt Template

Every Ornith analysis uses this structured prompt:

```
## RDA AI Manager — Analysis Request

Archive data snapshot — {timestamp}

<TREND_DATA>
{json}
</TREND_DATA>

<COMPARISON_DATA>
{json}
</COMPARISON_DATA>

<ARCHIVE_METADATA>
{json}
</ARCHIVE_METADATA>

<ANOMALY_FLAGS>
{json}
</ANOMALY_FLAGS>

Context: You are a Report Data Analysis Manager for a Vietnam SMT factory. You manage historical report archives with 5-year retention, perform cross-domain trend analysis, and generate management insights.

Language: Chinese (all output in Chinese)
Date format: YYYY-MM-DD

Analyze the data and respond ONLY with this JSON block:

<ANALYSIS>
{{
  "summary": "一句话总结当前数据状态",
  "archive_health": {{
    "total_archives": 0,
    "total_size_mb": 0,
    "oldest_archive": "日期",
    "newest_archive": "日期",
    "categories_covered": ["列表"],
    "missing_data_windows": ["如适用"]
  }},
  "key_insights": [
    {{
      "domain": "domain_code",
      "metric": "指标名称",
      "trend": "up|down|stable",
      "change_pct": 0,
      "significance": "high|medium|low",
      "detail": "分析详情"
    }}
  ],
  "alerts": [
    {{
      "severity": "info|warning|critical",
      "source_key": "来源标识",
      "message": "警报信息",
      "recommended_action": "建议操作"
    }}
  ],
  "recommended_analysis": ["建议的下一个分析方向"]
}}
</ANALYSIS>
```

---

## Tool Reference

### rda-query.js
```
node rda-query.js [scope] [options]
  scopes:
    archive-list      — list archives with filters (--source, --category, --dateFrom, --dateTo)
    archive-detail    — get single archive by id (--id)
    categories        — list category tree with archive counts
    archive-snapshot  — trigger archive of a specific source (--source, --period, --params)
    register-analysis — register a new analysis view
    retention-report  — show upcoming expirations
  common options:
    --source <key>     source_key filter (e.g., oee-by-line)
    --category <code>  category code filter
    --dateFrom, --dateTo  ISO date range
    --limit, --offset  pagination
    --period weekly|monthly  for period-aware archive
```

### rda-analyze.js
```
node rda-analyze.js <command> [options]
  commands:
    trend       — trend analysis: metric over time
                --source <key> --metric <column> --groupBy <col> --period daily|weekly|monthly
                --dateFrom, --dateTo
    compare     — compare across groups
                --source <key> --metric <col> --groups <col1,col2> --period weekly
    aggregate   — aggregate stats per period
                --source <key> --metric <col> --agg sum|avg|min|max|count --period monthly
    drill       — drill-down by dimension
                --source <key> --dimension <col> --metric <col> --agg count
    cross       — cross-domain correlation
                --x <source> --y <source> --metricX <col> --metricY <col> --period weekly
                --dateFrom, --dateTo
    integrity   — integrity check (--sample N percent, --fix)
    missing     — detect missing archive windows
                --source <key> --expectedInterval daily|weekly|monthly
```

### rda-manager.js
```
node rda-manager.js <command> [options]
  commands:
    patrol          — lightweight patrol: check missing, anomaly scan
    archive-daily   — full daily archive of all reports
    archive-weekly  — weekly period archive
    archive-monthly — monthly period archive
    insights        — generate Ornith insight report (--days N)
    cleanup         — purge expired archives (--dry-run to preview)
    retention-report— show retention stats
    export          --id <archiveId> --format csv|xlsx
    dashboard       — show current state summary
    once            — single run (one patrol cycle)
    watchdog        — continuous patrol loop
```

### API Endpoints Used
| Method | Endpoint | Auth | Purpose |
|---|---|---|---|
| GET | `/api/archives` | JWT | List archives with filters |
| GET | `/api/archives/:id` | JWT | Get single archive detail |
| POST | `/api/archives/from-report` | JWT | Archive a specific report |
| POST | `/api/archives/run-snapshot` | JWT | Batch archive all reports |
| GET | `/api/archives/categories` | JWT | List category tree |
| GET | `/api/archives/analysis/trend` | JWT | Trend analysis query |
| GET | `/api/archives/analysis/compare` | JWT | Comparison analysis |
| GET | `/api/archives/analysis/cross` | JWT | Cross-domain correlation |
| GET | `/api/archives/retention` | JWT | Retention report |
| DELETE | `/api/archives/:id` | JWT | Delete archive (admin only) |

### LINE Integration
- Token stored in `services/worker/line_token.txt`
- Endpoint: `https://notify-api.line.me/api/notify`
- Method: POST with `message` field
- Debounce: Same alert not re-sent within 24h unless severity increased

---

## Data Retention & Audit

- All archives stored in `document_archives` table with SHA-256 checksum
- Archive operations logged in `archive_snapshots` table
- Retention: 5 years by default (configurable per archive_type)
- Pinned archives bypass auto-expiry
- Human can pin/unpin any archive — overrides retention
- Weekly integrity check verifies random 5% sample against stored checksum
- Audit trail: every archive/analysis logged with timestamp, operator, source_key

---

## Known Limitations

1. **No real-time streaming**: Archives are point-in-time snapshots, not real-time data streams
2. **Storage growth**: ~100MB/year for daily snapshots of 16 reports (estimate); monitor disk
3. **No GPU acceleration**: Analysis runs on CPU — large cross-domain queries may take seconds
4. **Ornith dependency**: Insight generation requires Ornith LLM; falls back to statistical-only if unavailable
5. **No dashboard UI**: Archive browser and analysis results delivered via API + LINE only
6. **Single language**: Ornith prompt in Chinese; LINE output in Chinese; VT/VN staff need translation
7. **No automated schema migration**: Archive schema changes require manual migration
8. **JSONB query performance**: Large archives with thousands of rows may be slow; consider periodic aggregation
