// Master data (/wms/warehouses, /wms/zones, /wms/storage-locations, /wms/material-*,
// /wms/units, /wms/bom-*, /system/domains), moved out of services/api/server.js.
//
// 21 registrations: the physical model (warehouses, zones, storage locations and their
// material rules), the material taxonomy (categories, units, naming, material master and
// supplier materials), and the BOM governance/review surface.
//
// Pure registrations, no module-level statements in the block.
export function registerMasterDataRoutes(app, deps) {
  const {
    query, requirePermission, listEnvelope, errorEnvelope, mutateEnvelope, envelope,
    auditWmsMaster,
  } = deps;

app.get("/wms/warehouses", requirePermission("wms.execute"), async (_req, res) => {
  const rows = await query(`SELECT id,code,name_zh,name_en,name_vi,warehouse_type AS "warehouseType",site_code AS "siteCode",status,manager_id AS "managerId" FROM wms_warehouses ORDER BY code`);
  res.json(listEnvelope(rows.rows));
});

app.post("/wms/warehouses", requirePermission("wms.execute"), async (req, res) => {
  try {
    const p = req.body?.payload ?? req.body ?? {};
    if (!p.code || !p.nameZh) return res.status(400).json(errorEnvelope("VALIDATION", "code and nameZh required"));
    const result = await query(
      `INSERT INTO wms_warehouses(code,name_zh,name_en,name_vi,warehouse_type,site_code,status,manager_id)
       VALUES(upper($1),$2,$3,$4,coalesce($5,'RAW_MATERIAL'),coalesce($6,'VN-01'),coalesce(upper($7),'ACTIVE'),$8) RETURNING *`,
      [p.code,p.nameZh,p.nameEn ?? null,p.nameVi ?? null,p.warehouseType ?? null,p.siteCode ?? null,p.status ?? null,p.managerId ?? null],
    );
    await auditWmsMaster(req,"CREATE","WAREHOUSE",result.rows[0].code,null,result.rows[0]);
    res.status(201).json(mutateEnvelope(result.rows[0]));
  } catch (err) { res.status(400).json(errorEnvelope("WMS_MASTER_ERROR",err.message)); }
});

app.patch("/wms/warehouses/:id", requirePermission("wms.execute"), async (req, res) => {
  try {
    const before = await query("SELECT * FROM wms_warehouses WHERE id=$1",[req.params.id]);
    if (!before.rows[0]) return res.status(404).json(errorEnvelope("NOT_FOUND","warehouse not found"));
    const p=req.body?.payload ?? req.body ?? {};
    const result=await query(`UPDATE wms_warehouses SET name_zh=coalesce($2,name_zh),name_en=coalesce($3,name_en),name_vi=coalesce($4,name_vi),warehouse_type=coalesce($5,warehouse_type),site_code=coalesce($6,site_code),status=coalesce(upper($7),status),manager_id=coalesce($8,manager_id),updated_at=now() WHERE id=$1 RETURNING *`,[req.params.id,p.nameZh ?? null,p.nameEn ?? null,p.nameVi ?? null,p.warehouseType ?? null,p.siteCode ?? null,p.status ?? null,p.managerId ?? null]);
    await auditWmsMaster(req,"UPDATE","WAREHOUSE",before.rows[0].code,before.rows[0],result.rows[0]);
    res.json(mutateEnvelope(result.rows[0]));
  } catch(err){res.status(400).json(errorEnvelope("WMS_MASTER_ERROR",err.message));}
});

app.get("/wms/zones", requirePermission("wms.execute"), async (req,res) => {
  const params=[]; let where="";
  if(req.query.warehouseId){params.push(req.query.warehouseId);where="WHERE z.warehouse_id=$1";}
  const rows=await query(`SELECT z.*,w.code AS "warehouseCode" FROM wms_zones z JOIN wms_warehouses w ON w.id=z.warehouse_id ${where} ORDER BY w.code,z.code`,params);
  res.json(listEnvelope(rows.rows));
});

app.post("/wms/zones", requirePermission("wms.execute"), async(req,res)=>{
  try{
    const p=req.body?.payload ?? req.body ?? {};
    if(!p.warehouseId||!p.code||!p.nameZh||!p.zoneType)return res.status(400).json(errorEnvelope("VALIDATION","warehouseId, code, nameZh and zoneType required"));
    const wh=await query("SELECT id,status FROM wms_warehouses WHERE id=$1",[p.warehouseId]);
    if(!wh.rows[0]||wh.rows[0].status!=="ACTIVE")return res.status(400).json(errorEnvelope("VALIDATION","active warehouse required"));
    const result=await query(`INSERT INTO wms_zones(warehouse_id,code,name_zh,name_en,name_vi,zone_type,temperature_min,temperature_max,humidity_min,humidity_max,status) VALUES($1,upper($2),$3,$4,$5,$6,$7,$8,$9,$10,coalesce(upper($11),'ACTIVE')) RETURNING *`,[p.warehouseId,p.code,p.nameZh,p.nameEn??null,p.nameVi??null,p.zoneType,p.temperatureMin??null,p.temperatureMax??null,p.humidityMin??null,p.humidityMax??null,p.status??null]);
    await auditWmsMaster(req,"CREATE","WAREHOUSE_ZONE",result.rows[0].id,null,result.rows[0]);
    res.status(201).json(mutateEnvelope(result.rows[0]));
  }catch(err){res.status(400).json(errorEnvelope("WMS_MASTER_ERROR",err.message));}
});

app.patch("/wms/zones/:id", requirePermission("wms.execute"), async(req,res)=>{
  try {
    const before=(await query("SELECT * FROM wms_zones WHERE id=$1",[req.params.id])).rows[0];
    if(!before)return res.status(404).json(errorEnvelope("NOT_FOUND","zone not found"));
    const p=req.body?.payload??req.body??{};
    const result=await query(`UPDATE wms_zones SET name_zh=coalesce($2,name_zh),name_en=coalesce($3,name_en),name_vi=coalesce($4,name_vi),zone_type=coalesce($5,zone_type),temperature_min=coalesce($6,temperature_min),temperature_max=coalesce($7,temperature_max),humidity_min=coalesce($8,humidity_min),humidity_max=coalesce($9,humidity_max),status=coalesce(upper($10),status),updated_at=now() WHERE id=$1 RETURNING *`,[req.params.id,p.nameZh??null,p.nameEn??null,p.nameVi??null,p.zoneType??null,p.temperatureMin??null,p.temperatureMax??null,p.humidityMin??null,p.humidityMax??null,p.status??null]);
    await auditWmsMaster(req,"UPDATE","WAREHOUSE_ZONE",before.id,before,result.rows[0]);
    res.json(mutateEnvelope(result.rows[0]));
  } catch(err){res.status(400).json(errorEnvelope("WMS_MASTER_ERROR",err.message));}
});

app.post("/wms/storage-locations", requirePermission("wms.execute"), async(req,res)=>{
  try{
    const p=req.body?.payload ?? req.body ?? {};
    if(!p.code||!p.area||!p.nameZh||!p.warehouseId||!p.zoneId)return res.status(400).json(errorEnvelope("VALIDATION","code, area, nameZh, warehouseId and zoneId required"));
    const zone=await query("SELECT id FROM wms_zones WHERE id=$1 AND warehouse_id=$2 AND status='ACTIVE'",[p.zoneId,p.warehouseId]);
    if(!zone.rows[0])return res.status(400).json(errorEnvelope("VALIDATION","active zone must belong to warehouse"));
    const result=await query(`INSERT INTO storage_locations(code,qr_code,area,name_zh,name_en,name_vi,status,warehouse_id,zone_id,capacity_qty,location_type,length_cm,width_cm,height_cm,allow_receiving,allow_transfer,allow_putaway,x_coord,y_coord,coordinate_system,aisle_code,rack_code,level_code,bin_code,temperature_min,temperature_max,humidity_min,humidity_max,msd_allowed,max_pallets)
      VALUES(upper($1),coalesce($2,upper($1)),$3,$4,coalesce($5,$4),coalesce($6,$4),'active',$7,$8,$9,coalesce($10,'STANDARD'),$11,$12,$13,coalesce($14,true),coalesce($15,true),coalesce($16,true),$17,$18,coalesce($19,'WAREHOUSE_MAP'),$20,$21,$22,$23,$24,$25,$26,$27,coalesce($28,true),$29) RETURNING *`,[p.code,p.qrCode??null,p.area,p.nameZh,p.nameEn??null,p.nameVi??null,p.warehouseId,p.zoneId,p.capacityQty??null,p.locationType??null,p.lengthCm??null,p.widthCm??null,p.heightCm??null,p.allowReceiving,p.allowTransfer,p.allowPutaway,p.xCoord??null,p.yCoord??null,p.coordinateSystem??null,p.aisleCode??null,p.rackCode??null,p.levelCode??null,p.binCode??null,p.temperatureMin??null,p.temperatureMax??null,p.humidityMin??null,p.humidityMax??null,p.msdAllowed,p.maxPallets??null]);
    await auditWmsMaster(req,"CREATE","STORAGE_LOCATION",result.rows[0].code,null,result.rows[0]);
    res.status(201).json(mutateEnvelope(result.rows[0]));
  }catch(err){res.status(400).json(errorEnvelope("WMS_MASTER_ERROR",err.message));}
});

app.patch("/wms/storage-locations/:id", requirePermission("wms.execute"), async(req,res)=>{
  try {
    const before=(await query("SELECT * FROM storage_locations WHERE id=$1",[req.params.id])).rows[0];
    if(!before)return res.status(404).json(errorEnvelope("NOT_FOUND","location not found"));
    const p=req.body?.payload??req.body??{};
    if(p.zoneId||p.warehouseId){
      const zone=await query("SELECT id FROM wms_zones WHERE id=$1 AND warehouse_id=$2 AND status='ACTIVE'",[p.zoneId??before.zone_id,p.warehouseId??before.warehouse_id]);
      if(!zone.rows[0])return res.status(400).json(errorEnvelope("VALIDATION","active zone must belong to warehouse"));
    }
    const result=await query(`UPDATE storage_locations SET qr_code=coalesce($2,qr_code),area=coalesce($3,area),name_zh=coalesce($4,name_zh),name_en=coalesce($5,name_en),name_vi=coalesce($6,name_vi),status=coalesce(lower($7),status),warehouse_id=coalesce($8,warehouse_id),zone_id=coalesce($9,zone_id),capacity_qty=coalesce($10,capacity_qty),location_type=coalesce($11,location_type),length_cm=coalesce($12,length_cm),width_cm=coalesce($13,width_cm),height_cm=coalesce($14,height_cm),allow_receiving=coalesce($15,allow_receiving),allow_transfer=coalesce($16,allow_transfer),allow_putaway=coalesce($17,allow_putaway),locked_reason=$18,x_coord=coalesce($19,x_coord),y_coord=coalesce($20,y_coord),coordinate_system=coalesce($21,coordinate_system),aisle_code=coalesce($22,aisle_code),rack_code=coalesce($23,rack_code),level_code=coalesce($24,level_code),bin_code=coalesce($25,bin_code),temperature_min=coalesce($26,temperature_min),temperature_max=coalesce($27,temperature_max),humidity_min=coalesce($28,humidity_min),humidity_max=coalesce($29,humidity_max),msd_allowed=coalesce($30,msd_allowed),max_pallets=coalesce($31,max_pallets) WHERE id=$1 RETURNING *`,[req.params.id,p.qrCode??null,p.area??null,p.nameZh??null,p.nameEn??null,p.nameVi??null,p.status??null,p.warehouseId??null,p.zoneId??null,p.capacityQty??null,p.locationType??null,p.lengthCm??null,p.widthCm??null,p.heightCm??null,p.allowReceiving,p.allowTransfer,p.allowPutaway,Object.prototype.hasOwnProperty.call(p,"lockedReason")?p.lockedReason:before.locked_reason,p.xCoord??null,p.yCoord??null,p.coordinateSystem??null,p.aisleCode??null,p.rackCode??null,p.levelCode??null,p.binCode??null,p.temperatureMin??null,p.temperatureMax??null,p.humidityMin??null,p.humidityMax??null,p.msdAllowed,p.maxPallets??null]);
    await auditWmsMaster(req,"UPDATE","STORAGE_LOCATION",before.code,before,result.rows[0]);
    res.json(mutateEnvelope(result.rows[0]));
  } catch(err){res.status(400).json(errorEnvelope("WMS_MASTER_ERROR",err.message));}
});

app.put("/wms/storage-locations/:id/material-rules", requirePermission("wms.execute"), async(req,res)=>{
  try {
    const locationId=Number(req.params.id); const rules=Array.isArray(req.body?.rules) ? req.body.rules : (req.body?.payload?.rules ?? []);
    await query("DELETE FROM wms_location_material_rules WHERE location_id=$1",[locationId]);
    for (const rule of rules) {
      if (!rule.materialId || !['ALLOW','BLOCK'].includes(String(rule.ruleType).toUpperCase())) continue;
      await query("INSERT INTO wms_location_material_rules(location_id,material_id,rule_type,reason) VALUES($1,$2,$3,$4)",[locationId,Number(rule.materialId),String(rule.ruleType).toUpperCase(),rule.reason??null]);
    }
    res.json(mutateEnvelope({locationId,rules}));
  } catch(err){ res.status(400).json(errorEnvelope("WMS_MASTER_ERROR",err.message)); }
});

app.post("/wms/storage-locations/:id/validate", requirePermission("wms.execute"), async(req,res)=>{
  try {
    const p=req.body?.payload??req.body??{};
    const row=(await query(`SELECT sl.*,w.status AS warehouse_status,z.status AS zone_status,z.temperature_min,z.temperature_max,z.humidity_min,z.humidity_max,coalesce(sum(ml.received_qty),0) AS current_qty FROM storage_locations sl LEFT JOIN wms_warehouses w ON w.id=sl.warehouse_id LEFT JOIN wms_zones z ON z.id=sl.zone_id LEFT JOIN material_lots ml ON ml.storage_location_id=sl.id WHERE sl.id=$1 GROUP BY sl.id,w.status,z.status,z.temperature_min,z.temperature_max,z.humidity_min,z.humidity_max`,[req.params.id])).rows[0];
    if(!row)return res.status(404).json(errorEnvelope("NOT_FOUND","location not found"));
    const reasons=[];
    if(String(row.status).toLowerCase()!=="active")reasons.push("LOCATION_INACTIVE");
    if(row.locked_reason)reasons.push("LOCATION_LOCKED");
    if(row.warehouse_status!=="ACTIVE")reasons.push("WAREHOUSE_INACTIVE");
    if(row.zone_status!=="ACTIVE")reasons.push("ZONE_INACTIVE");
    const requested=Number(p.quantity??0),current=Number(row.current_qty??0),capacity=row.capacity_qty==null?null:Number(row.capacity_qty);
    if(capacity!=null&&requested>0&&current+requested>capacity)reasons.push("CAPACITY_EXCEEDED");
    const temp=p.temperature==null?null:Number(p.temperature),humidity=p.humidity==null?null:Number(p.humidity);
    if(temp!=null&&((row.temperature_min!=null&&temp<Number(row.temperature_min))||(row.temperature_max!=null&&temp>Number(row.temperature_max))))reasons.push("TEMPERATURE_OUT_OF_RANGE");
    if(humidity!=null&&((row.humidity_min!=null&&humidity<Number(row.humidity_min))||(row.humidity_max!=null&&humidity>Number(row.humidity_max))))reasons.push("HUMIDITY_OUT_OF_RANGE");
    res.json(envelope({eligible:reasons.length===0,reasons,currentQty:current,capacityQty:capacity,remainingQty:capacity==null?null:capacity-current}));
  }catch(err){res.status(400).json(errorEnvelope("WMS_LOCATION_VALIDATION_ERROR",err.message));}
});

app.get("/wms/material-categories", requirePermission("wms.execute"), async(_req,res)=>{
  const rows=await query(`SELECT id,code,name_zh,name_en,name_vi,parent_id AS "parentId",iqc_required AS "iqcRequired",fifo_method AS "fifoMethod",status FROM wms_material_categories ORDER BY code`);
  res.json(listEnvelope(rows.rows));
});

app.post("/wms/material-categories", requirePermission("wms.execute"), async(req,res)=>{
  try{
    const p=req.body?.payload ?? req.body ?? {};
    if(!p.code||!p.nameZh)return res.status(400).json(errorEnvelope("VALIDATION","code and nameZh required"));
    const result=await query(`INSERT INTO wms_material_categories(code,name_zh,name_en,name_vi,parent_id,iqc_required,fifo_method,status) VALUES(upper($1),$2,$3,$4,$5,coalesce($6,true),coalesce(upper($7),'FIFO'),coalesce(upper($8),'ACTIVE')) RETURNING *`,[p.code,p.nameZh,p.nameEn??null,p.nameVi??null,p.parentId??null,p.iqcRequired??null,p.fifoMethod??null,p.status??null]);
    await auditWmsMaster(req,"CREATE","MATERIAL_CATEGORY",result.rows[0].code,null,result.rows[0]);
    res.status(201).json(mutateEnvelope(result.rows[0]));
  }catch(err){res.status(400).json(errorEnvelope("WMS_MASTER_ERROR",err.message));}
});

app.patch("/wms/material-categories/:id", requirePermission("wms.execute"), async(req,res)=>{
  try{const before=(await query("SELECT * FROM wms_material_categories WHERE id=$1",[req.params.id])).rows[0];if(!before)return res.status(404).json(errorEnvelope("NOT_FOUND","category not found"));const p=req.body?.payload??req.body??{};const result=await query(`UPDATE wms_material_categories SET name_zh=coalesce($2,name_zh),name_en=coalesce($3,name_en),name_vi=coalesce($4,name_vi),parent_id=coalesce($5,parent_id),iqc_required=coalesce($6,iqc_required),fifo_method=coalesce(upper($7),fifo_method),status=coalesce(upper($8),status),updated_at=now() WHERE id=$1 RETURNING *`,[req.params.id,p.nameZh??null,p.nameEn??null,p.nameVi??null,p.parentId??null,p.iqcRequired??null,p.fifoMethod??null,p.status??null]);await auditWmsMaster(req,"UPDATE","MATERIAL_CATEGORY",before.code,before,result.rows[0]);res.json(mutateEnvelope(result.rows[0]));}catch(err){res.status(400).json(errorEnvelope("WMS_MASTER_ERROR",err.message));}
});

app.get("/wms/units", requirePermission("wms.execute"), async(_req,res)=>{
  const rows=await query(`SELECT code,name_zh,name_en,name_vi,decimal_places AS "decimalPlaces",status FROM wms_units_of_measure ORDER BY code`);
  res.json(listEnvelope(rows.rows));
});

app.post("/wms/units", requirePermission("wms.execute"), async(req,res)=>{
  try{
    const p=req.body?.payload ?? req.body ?? {};
    if(!p.code||!p.nameZh)return res.status(400).json(errorEnvelope("VALIDATION","code and nameZh required"));
    const result=await query(`INSERT INTO wms_units_of_measure(code,name_zh,name_en,name_vi,decimal_places,status) VALUES(upper($1),$2,$3,$4,coalesce($5,4),coalesce(upper($6),'ACTIVE')) RETURNING *`,[p.code,p.nameZh,p.nameEn??null,p.nameVi??null,p.decimalPlaces??null,p.status??null]);
    await auditWmsMaster(req,"CREATE","UNIT",result.rows[0].code,null,result.rows[0]);
    res.status(201).json(mutateEnvelope(result.rows[0]));
  }catch(err){res.status(400).json(errorEnvelope("WMS_MASTER_ERROR",err.message));}
});

app.patch("/wms/units/:code", requirePermission("wms.execute"), async(req,res)=>{
  try{const before=(await query("SELECT * FROM wms_units_of_measure WHERE code=$1",[req.params.code.toUpperCase()])).rows[0];if(!before)return res.status(404).json(errorEnvelope("NOT_FOUND","unit not found"));const p=req.body?.payload??req.body??{};const result=await query(`UPDATE wms_units_of_measure SET name_zh=coalesce($2,name_zh),name_en=coalesce($3,name_en),name_vi=coalesce($4,name_vi),decimal_places=coalesce($5,decimal_places),status=coalesce(upper($6),status) WHERE code=$1 RETURNING *`,[before.code,p.nameZh??null,p.nameEn??null,p.nameVi??null,p.decimalPlaces??null,p.status??null]);await auditWmsMaster(req,"UPDATE","UNIT",before.code,before,result.rows[0]);res.json(mutateEnvelope(result.rows[0]));}catch(err){res.status(400).json(errorEnvelope("WMS_MASTER_ERROR",err.message));}
});

app.get("/wms/material-master", requirePermission("wms.execute"), async(req,res)=>{
  const params=[];let where="";if(req.query.q){params.push(`%${req.query.q}%`);where="WHERE m.code ILIKE $1 OR m.name_zh ILIKE $1";}
  const rows=await query(`SELECT m.id,m.code,m.name_zh,m.name_en,m.name_vi,m.uom,m.material_type AS "materialType",m.msd_level AS "msdLevel",m.shelf_life_days AS "shelfLifeDays",m.category_id AS "categoryId",m.min_stock_qty AS "minStockQty",m.max_stock_qty AS "maxStockQty",m.safety_stock_qty AS "safetyStockQty",m.storage_condition AS "storageCondition",m.domain_code AS "domainCode",m.naming_version AS "namingVersion",m.naming_status AS "namingStatus",m.status FROM materials m ${where} ORDER BY m.code LIMIT 500`,params);
  res.json(listEnvelope(rows.rows));
});

app.get("/system/domains", requirePermission("master_data.read"), async(_req,res)=>{
  try{const rows=await query(`SELECT domain_code AS "domainCode",name_zh,name_en,name_vi,system_owner AS "systemOwner",description,status FROM system_domains ORDER BY domain_code`);res.json(listEnvelope(rows.rows));}
  catch(err){res.status(500).json(errorEnvelope("SERVER_ERROR",err.message));}
});

app.get("/wms/material-naming", requirePermission("wms.view"), async(req,res)=>{
  try{const q=String(req.query.q??"");const rows=await query(`SELECT * FROM v_material_canonical_names WHERE ($1='' OR official_code ILIKE $2 OR name_zh ILIKE $2 OR name_en ILIKE $2) ORDER BY official_code LIMIT 500`,[q,`%${q}%`]);res.json(listEnvelope(rows.rows));}
  catch(err){res.status(500).json(errorEnvelope("SERVER_ERROR",err.message));}
});

app.get("/wms/bom-material-governance", requirePermission("wms.view"), async(req,res)=>{
  try{const params=[];let where="";if(req.query.bomId){params.push(req.query.bomId);where="WHERE bom_id=$1";}const rows=await query(`SELECT * FROM v_bom_canonical_materials ${where} ORDER BY bom_id,bom_line_id`,params);res.json(listEnvelope(rows.rows));}
  catch(err){res.status(500).json(errorEnvelope("SERVER_ERROR",err.message));}
});

app.get("/wms/bom-material-reviews", requirePermission("wms.view"), async(req,res)=>{
  try{const status=String(req.query.status??"PENDING");const rows=await query(`SELECT q.*,b.revision,m.code AS material_code,p.code AS product_code FROM bom_material_review_queue q JOIN boms b ON b.id=q.bom_id JOIN products p ON p.id=b.product_id JOIN materials m ON m.id=q.material_id WHERE ($1='' OR q.status=$1) ORDER BY q.created_at DESC`,[status]);res.json(listEnvelope(rows.rows));}
  catch(err){res.status(500).json(errorEnvelope("SERVER_ERROR",err.message));}
});
}
