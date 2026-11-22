# W18 frontend embedding — working state (2026-11-23)

## Mission
User: "100% frontend embedding (add on)" — close the 54 menu leaves that render 🚧 WipView
(grafting-standards §9 trap: WipView masks missing views).

## Verified facts (my own probes, NOT scout — scout output was corrupted)
- Live sweep of all 5 domains: 105 leaves wired, **54 show 🚧**.
- mesrj backends return envelope `{success,msg,data}`; data = array OR {rows,total} OR nested.
- Canonical SMT endpoints exist but use DIFFERENT envelopes:
  - `/api/procurement/{suppliers,pos,contracts}`, `/api/sales/orders`, `/api/equipment-archives`,
    `/api/sales/dashboard-summary` → `{data,meta}`
  - `/api/wms-sales/customers`, `/api/over-picking/list`, `/api/supplier-debt/list` → `{code,message,data}` (itf)
  - `/api/wms/iqc/inspections` → 403 (exists, needs perm)
  - `/api/mes/v1/*` → 401 (X-Api-Key, machine contract)
  - 404: /api/materials /api/wms/{warehouses,transfers,cycle-counts,transactions,inventory,material-lots,inbound,outbound}
        /api/finance/{receivables,payables} /api/erp/customers /api/pmc/customer-pos /api/bom/list
  - ⇒ the 24 erp.* leaves need an envelope-bridged client + per-entity canonical path; NOT a quick registry.

## Done this round
- `apps/web/src/mesrj/index.tsx`: LEAF_ALIAS map (6 leaves → existing views):
  exec.pass→exec.passlist, exec.trace→exec.tracesn, exec.momaterial→exec.momaterials,
  report.yield→exec.yield, qlt.oqcreport→report.tpl, exec.empcert→emp.cert. VERIFIED live (no 🚧).
- `apps/web/src/mesrj/GenericScreen.tsx`: registry-driven list screen (toRows runtime-narrow,
  autoCols, pick, filters, export CSV, actions). Typecheck clean.
- `apps/web/src/mesrj/screens.ts`: 12 registry entries (exec.emplogin, exec.health, sys.log,
  exec.paste, exec.pcb, exec.stencil, exec.machine, exec.aoi, md.model, exec.consume pick=items,
  qlt.oqcboard pick=stations). Dispatch fallback in index.tsx before WipView.
- `labels.ts`: +55 w18.* trilingual (engine UI + column labels). check:i18n 6082 OK.
- VERIFIED live: 10/10 tested registry screens render (no 🚧, table/export present).
  Total leaves no-longer-🚧 this round: 6 aliases + 12 registry = 18 (54 → ~36 remaining).

## Verified mesrj endpoints (200) for generic wiring (endpoint → shape / key cols)
- emp/duty → array; prd_emp_login: emp_no,emp_name,station_code,line_code,work_date,shift_code,in_at,out_at,status,station_name
- smt/baseline/list → array; prd_smt_baseline: line_code,model,material,slot_no,machine_no,locked,hits,by_user,created_at
- exec/device/health → array; device_id,device_name,device_type,status,last_heartbeat_at,registered_at,healthy
- oqc/list → {rows,total}
- audit → {rows,total}; user_name,module,action,target,detail,ip,created_at
- itf/config → {rows,total} (sys_api_key)
- smt/paste/list → {rows,total}; material_code,paste_type,batch_no,qty,out_time,plan_ready_time,recover_count,status
- smt/pcb/list → {rows,total}; reel_sn,rj_code,lot_no,qty,unseal_time,valid_hours,bake_count,status,operator
- smt/stencil/list → {rows,total}; sn,stencil_no,version,thickness,model,max_print_times,used_print_times,clean_count,warn_pct,status
- cfg/machine → {rows,total}; cfg/aoi → {rows,total} (file_name,device_name,pcb_sn,test_time,final_result,...)
- md/model/list → {rows,total}; model,cust_code,cust_name,codes,enabled,product_type
- md/product → CRUD resource (registerCrud /md/product) → {rows,total}
- smt/consumption → {mo_options,items} pick=items
- oqc/board → {kpi,stations,queue,...} pick=stations
- oqc/pending_queue → array
- exec/hourly → {day,hours,by_station,total} pick=by_station
- sys/param/list → array of {group,items[]} → needs custom (grouped), not flat
- smt/fa/status, smt/sn_trace → {success,msg} object, need form/search custom (NOT generic table)
- oqc/aql/std → object map, custom

## Remaining scope after generic wiring
- ~30 leaves still 🚧: 24 erp.* (canonical bridge needed) + sys.param/exec.fa/exec.tracebind/
  cfg.basic/qlt.aqlstd/qlt.oqccheck/exec.defect(no backend)/md.model? etc custom.
- exec.defect: NO target backend (/exec/defect 404) → must graft backend first.

## Gates to run before claiming done
node --check; npm run typecheck; check:i18n; test:unit; live sweep re-count 🚧 (target: only
no-backend + erp-pending remain).

## Files owned (CLAIM-mesrj-ruijing-mes-gap-api.md extended)
index.tsx, GenericScreen.tsx, screens.ts (new), labels.ts, menu.js (only if adding leaves).

## DECISION 2026-11-23: ERP leaves = (b) point at canonical SMT screens, NOT duplicate UI
User chose (b). Rationale (mine): a 2nd ERP-flavored UI over the same canonical tables is the
same drift failure the protocol forbids for shadow tables.

### Canonical screen inventory (verified files exist)
supplier→qms/QmsSupplierEval + procurement list; po→procurement/ProcurementPoList;
contract→procurement/ProcurementContractList; so/ship→sales/ (SalesOrders);
ar/ap→finance/FinancePaymentList + FinanceInvoiceList; inventory→wms/WmsInventory;
movement/transactions→wms/WmsTransactions; count→wms/WmsCycleCount;
equipment→maintenance/EquipmentAndonBoard; maint→maintenance/MaintenanceCard;
customer→pmc/PmcCustomerProductMaster; warehouse→mes/MesWarehouseStoragePage.
NO dedicated screen found yet for: transfer(调拨), iqc看板(has WMS iqc pages), bom(ERP bom vs canonical bom module).

### BLOCKER for (b): no cross-module nav hook
App.tsx:3127 `const [active,setActive]=useState<ModuleKey>(directView)`. Modules are top-level;
nothing inside mesrj can jump to another module's tab. (b) needs a nav primitive:
- Option B1: render canonical component INLINE in the mesrj leaf (import it; risk: prop/context
  mismatch — those screens expect their module's locale/api wiring).
- Option B2: add a jump hook (setActive + per-module tab select) passed down to MesrjModule;
  leaf renders a "在 SMT 中打开：<module> › <screen>" button. Honest, no fake table, but needs
  App.tsx surgery (shared file → extend CLAIM, add tab-select capability).
Recommend B2 (single source of truth, no duplicate render). Needs a way to select a tab inside
the target module (check each module's tab state / hash).

### RESOLVED 2026-11-23: URL-param precedent already exists → B2 is cheap
App.tsx:974 HR reads `?hrTab=` on mount to pick its tab. Same pattern works for any module:
deep-link `?module=<key>&<x>Tab=<tabKey>` selects module + tab, NO prop threading through the
shared App.tsx. Each module's tab is local `useState<XxxTabKey>` seeded from a search param
(HR does this; extend the same one-liner to procurement/sales/finance/wms/mes/pmc/maintenance).
So (b) = for each erp.* leaf, a jump card "在 SMT 打开 › <module> › <tab>" linking that URL.
Canonical screen inventory above maps each of 24 entities to a (module, tab) pair.

### Remaining after (b) chosen
- 24 erp.* → B2 jump cards (needs nav hook).
- ~11 custom workflow screens (上料防错/首件/SN绑定追溯/基础数据维护/系统参数/AQL标准/OQC抽检/OQC逐项…) → bespoke components.
- exec.defect → NO backend, must graft /exec/defect first (or point at existing /exec/repair/list defect view).

## DONE 2026-11-23 (later same session): 24 erp.* jump cards (decision b) COMPLETE
- `apps/web/src/mesrj/erpJump.ts`: ERP_JUMP map, 24 leaves → {module,labelKey}. All 24 module
  keys are real ModuleKey values (verified against App.tsx list).
- `GenericScreen.tsx`: added `JumpCard` (renders "在 SMT 打开 › <screen>" as `<a href="#<module>">`;
  module select is hash-driven App.tsx:3120, so NO App.tsx surgery).
- `index.tsx`: dispatch `if (ERP_JUMP[active]) return <JumpCard…/>` after SCREENS, before WipView.
- `labels.ts`: +24 w18j.* trilingual.
- VERIFIED live: 供应商/采购订单/销售订单/应收账款/设备保养台账/合同管理 all → wip:false,
  hasJump:true, correct href (#procurement/#sales/#finance/#maintenance). i18n 6082, test:unit 490 pass.
- 🚧 count now: 54 → (6 alias + 12 registry + 24 jump) = 42 handled → ~12 remain.

## STILL TODO (next session)
- ~11 custom workflow screens (bespoke, NOT generic table): exec.loading(上料防错 scan+recommend+confirm),
  exec.fa(首件与点检 form), exec.tracebind(SN绑定追溯 search), exec.dippass(DIP过站 scan+submit),
  cfg.basic(基础数据维护 tabs), sys.param(系统参数 grouped {group,items[]}), qlt.aqlstd(AQL标准 object),
  qlt.oqc(OQC出货抽检 workflow), qlt.oqccheck(OQC逐项检验录入 form), exec.empcert→done via alias?,
  qlt.oqclist(OQC检验记录 — may fit GenericScreen /oqc/list rows), report.yield→alias done.
  START by re-sweeping live 🚧 to get the exact remaining list (don't trust this guess).
- exec.defect(不良记录): /exec/defect 404 NO backend. Options: (1) graft /exec/defect reading
  prd_pass result=NG + prd_defect, or (2) point at existing exec.repairlist. Decide by reading
  source pages.js exec.defect body first.
- After each screen: typecheck + check:i18n + live browser verify (no 🚧, real content).
- Then re-screenshot the domains (user asked for video earlier) + ledger entry + commit (explicit paths).
