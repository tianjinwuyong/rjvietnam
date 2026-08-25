# AOI Station Deployable Package

## Overview
Complete AOI (Automated Optical Inspection) quality station module for the SMT factory system.

**Data source:** MySQL (root / root1234, database: smt_factory)

---

## Files Included

### Database
- `database/072_aoi_station.sql` — MySQL migration (3 tables + seed data)

### Backend (Node.js / Express)
- `backend/mysql.js` — MySQL connection pool helper
- `backend/aoi-api-patch.js` — All AOI API route handlers (patch for server.js)

### Frontend (React / TypeScript)
- `frontend/AoiStation.tsx` — Main station UI component
- `frontend/api-index.ts` — API client (aoiApi)
- `frontend/types-index.ts` — TypeScript type definitions
- `frontend/i18n-index.ts` — i18n translation strings
- `frontend/package-index.ts` — Package barrel export

---

## Deployment Steps

### 1. Database Migration

Run the MySQL migration against your `smt_factory` database:

```bash
mysql -u root -proot1234 smt_factory < database/072_aoi_station.sql
```

This creates:
- `aoi_stations` — station configuration (2 seeded stations: AOI-01, AOI-02)
- `aoi_defect_codes` — 12 AOI defect codes (solder, placement, visual, component)
- `aoi_inspection_records` — inspection records with JSON defect codes/locations

---

### 2. Backend Changes

#### 2a. Install MySQL2 driver

```bash
cd services/api
npm install mysql2
```

#### 2b. Add import to server.js

Find the import section at the top of `services/api/server.js`, add:

```javascript
import { mysqlQuery, mysqlGetOne } from "./src/mysql.js";
```

#### 2c. Add AOI routes to server.js

Copy the entire contents of `backend/aoi-api-patch.js` and paste it into `server.js`
**just before** the line that says:

```javascript
// ── SPA fallback: serve index.html for all non-API routes ──────────
```

#### 2d. Restart the API server

```bash
node services/api/server.js
```

---

### 3. Frontend Changes

Copy the frontend files to these exact paths:

| Source | Destination |
|--------|-------------|
| `frontend/AoiStation.tsx` | `apps/web/src/aoi/AoiStation.tsx` |
| `frontend/api-index.ts` | `apps/web/src/aoi/api/index.ts` |
| `frontend/types-index.ts` | `apps/web/src/aoi/types/index.ts` |
| `frontend/i18n-index.ts` | `apps/web/src/aoi/i18n/index.ts` |
| `frontend/package-index.ts` | `apps/web/src/aoi/index.ts` |

Then add to `apps/web/src/App.tsx`:

```tsx
import { AoiStation } from "./aoi/AoiStation";
```

Add the AOI tab button inside the Quality component toolbar:

```tsx
<button type="button" className="action-button"
  style={{ background: activeTab === "aoi" ? "var(--info)" : "var(--nav)" }}
  onClick={() => setActiveTab("aoi")}>
  {t("aoi.title", locale)}
</button>
```

Then add the tab rendering in `Quality()`:

```tsx
if (activeTab === "aoi") {
  return (
    <div className="screen-stack">
      <SurfacePanel>
        <SectionHeader title={t("nav.quality", locale)} subtitle={t("page.quality", locale)} />
        <div className="toolbar">
          <button ... onClick={() => setActiveTab("dashboard")>{t("quality.dashboard", locale)}</button>
          <button ... onClick={() => setActiveTab("aoi")>{t("aoi.title", locale)}</button>
        </div>
      </SurfacePanel>
      <AoiStation locale={locale} />
    </div>
  );
}
```

#### Update App.tsx Quality tab state

Change the state type from:
```tsx
const [activeTab, setActiveTab] = useState<"dashboard" | "aoi">("dashboard");
```

Rebuild the frontend:
```bash
cd apps/web && npm run build
```

---

## API Endpoints

| Method | Path | Description |
|--------|-------|-------------|
| GET | `/quality/aoi/records` | List AOI inspection records |
| POST | `/quality/aoi/records` | Create inspection record |
| GET | `/quality/aoi/defect-codes` | List defect code reference |
| GET | `/quality/aoi/stats` | Get yield/defect statistics |
| GET | `/quality/aoi/defect-pareto` | Defect Pareto analysis |
| GET | `/quality/aoi/stations` | List configured AOI stations |

All endpoints require `quality.read` or `quality.write` permission.

---

## Environment Variables

```env
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=root
MYSQL_PASSWORD=root1234
MYSQL_DATABASE=smt_factory
```

---

## AOI Station Workflow

1. Operator scans PCB serial barcode
2. Station shows board info (PCB SN, work order, board ID, program)
3. Operator presses **PASS** or **FAIL**
4. If FAIL: operator enters defect code + location
5. Record saved to MySQL `aoi_inspection_records`
6. MES station event posted for traceability
7. Recent inspections table and stats update live
