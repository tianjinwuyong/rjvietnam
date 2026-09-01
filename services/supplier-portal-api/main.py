import hashlib, hmac, json, os, secrets, sqlite3, time
from pathlib import Path
from fastapi import FastAPI, HTTPException, Request, Response
from pydantic import BaseModel, Field

DB = Path(os.environ.get("SUPPLIER_PORTAL_DB", "/var/lib/ruijing-supplier-portal/portal.db"))
SESSION_TTL = 12 * 60 * 60
app = FastAPI(title="Ruijing Supplier Portal")

def db():
    DB.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB); conn.row_factory = sqlite3.Row
    conn.executescript("""
      CREATE TABLE IF NOT EXISTS users(id INTEGER PRIMARY KEY, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, salt TEXT NOT NULL, supplier_code TEXT NOT NULL, supplier_name TEXT NOT NULL, display_name TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY, user_id INTEGER, action TEXT NOT NULL, ip TEXT, created_at INTEGER NOT NULL, detail TEXT);
      CREATE TABLE IF NOT EXISTS portal_suppliers(supplier_code TEXT PRIMARY KEY, supplier_name TEXT NOT NULL, registration_status TEXT NOT NULL DEFAULT 'REGISTERED', portal_enabled INTEGER NOT NULL DEFAULT 0, label_enabled INTEGER NOT NULL DEFAULT 0, qualification_status TEXT NOT NULL DEFAULT 'PENDING', updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS shipments(id TEXT PRIMARY KEY, supplier_code TEXT NOT NULL, asn TEXT UNIQUE NOT NULL, po TEXT NOT NULL, eta TEXT NOT NULL, shipment_type TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'DRAFT', payload TEXT NOT NULL, created_by INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS purchase_orders(po_no TEXT PRIMARY KEY, supplier_code TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'OPEN', requested_delivery_date TEXT, expected_delivery_date TEXT, acknowledged_at INTEGER, response_note TEXT, payload TEXT NOT NULL, source_updated_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS sync_outbox(id INTEGER PRIMARY KEY, event_id TEXT UNIQUE NOT NULL, supplier_code TEXT NOT NULL, event_type TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL, acknowledged_at INTEGER);
      CREATE TABLE IF NOT EXISTS delivery_tracking(id INTEGER PRIMARY KEY,po_no TEXT NOT NULL,supplier_code TEXT NOT NULL,latitude REAL NOT NULL,longitude REAL NOT NULL,accuracy_m REAL,recorded_at INTEGER NOT NULL,reported_by INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS po_adjustment_requests(id INTEGER PRIMARY KEY,request_no TEXT UNIQUE NOT NULL,po_no TEXT NOT NULL,supplier_code TEXT NOT NULL,adjustment_type TEXT NOT NULL,line_no INTEGER,current_value TEXT,proposed_value TEXT NOT NULL,reason TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'PENDING',requested_by INTEGER NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS supplier_label_manifests(id INTEGER PRIMARY KEY,manifest_key TEXT UNIQUE NOT NULL,supplier_code TEXT NOT NULL,po_no TEXT,material_code TEXT NOT NULL,lot_no TEXT NOT NULL,total_quantity REAL NOT NULL,unit TEXT NOT NULL,outer_box_count INTEGER NOT NULL,sub_box_count INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'PRE_RECEIVING_UNCONFIRMED',payload TEXT NOT NULL,created_by INTEGER NOT NULL,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
    """); return conn

def ensure_schema():
    with db() as c:
      cols={r[1] for r in c.execute("PRAGMA table_info(users)")}
      for name,definition in (("role","TEXT NOT NULL DEFAULT 'SUPPLIER_ADMIN'"),("email","TEXT"),("updated_at","INTEGER")):
        if name not in cols: c.execute(f"ALTER TABLE users ADD COLUMN {name} {definition}")
      shipment_cols={r[1] for r in c.execute("PRAGMA table_info(shipments)")}
      if "receiving_payload" not in shipment_cols: c.execute("ALTER TABLE shipments ADD COLUMN receiving_payload TEXT")
      po_cols={r[1] for r in c.execute("PRAGMA table_info(purchase_orders)")}
      for name,definition in (("expected_boxes","INTEGER NOT NULL DEFAULT 0"),("expected_pallets","INTEGER NOT NULL DEFAULT 0"),("supplier_contact_name","TEXT"),("supplier_contact_email","TEXT"),("delivery_status","TEXT NOT NULL DEFAULT 'NOT_PLANNED'"),("carrier_name","TEXT"),("driver_name","TEXT"),("driver_phone","TEXT"),("vehicle_no","TEXT"),("tracking_no","TEXT")):
        if name not in po_cols: c.execute(f"ALTER TABLE purchase_orders ADD COLUMN {name} {definition}")
      manifest_cols={r[1] for r in c.execute("PRAGMA table_info(supplier_label_manifests)")}
      if "status" not in manifest_cols: c.execute("ALTER TABLE supplier_label_manifests ADD COLUMN status TEXT NOT NULL DEFAULT 'PRE_RECEIVING_UNCONFIRMED'")
      c.execute("INSERT OR IGNORE INTO portal_suppliers(supplier_code,supplier_name,registration_status,portal_enabled,label_enabled,qualification_status,updated_at) SELECT DISTINCT supplier_code,supplier_name,'REGISTERED',1,1,'QUALIFIED',? FROM users",(int(time.time()),))
      c.commit()
ensure_schema()

def password_hash(password, salt): return hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), 210000).hex()
def token_hash(token): return hashlib.sha256(token.encode()).hexdigest()
def current_user(request: Request):
    token=request.cookies.get("supplier_session")
    if not token: return None
    with db() as c:
      row=c.execute("SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id JOIN portal_suppliers p ON p.supplier_code=u.supplier_code WHERE s.token_hash=? AND s.expires_at>? AND u.active=1 AND p.registration_status='REGISTERED' AND p.portal_enabled=1",(token_hash(token),int(time.time()))).fetchone()
      return dict(row) if row else None

def require_user(request:Request):
    user=current_user(request)
    if not user: raise HTTPException(401,"Login required")
    return user

def require_write_user(request:Request):
    user=require_user(request)
    if user.get("role")=="VIEWER": raise HTTPException(403,"Read-only preview account")
    return user

def audit_event(c,user_id,action,request,detail=""):
    c.execute("INSERT INTO audit(user_id,action,ip,created_at,detail) VALUES(?,?,?,?,?)",(user_id,action,request.client.host if request.client else "",int(time.time()),detail))

def outbox(c,supplier_code,event_type,entity_type,entity_id,payload):
    c.execute("INSERT INTO sync_outbox(event_id,supplier_code,event_type,entity_type,entity_id,payload,created_at) VALUES(?,?,?,?,?,?,?)",(secrets.token_hex(16),supplier_code,event_type,entity_type,str(entity_id),json.dumps(payload,ensure_ascii=False),int(time.time())))

class Login(BaseModel): username:str; password:str
class PasswordChange(BaseModel): current_password:str; new_password:str=Field(min_length=10,max_length=128)
class ProfileChange(BaseModel): username:str=Field(min_length=3,max_length=120); display_name:str=Field(min_length=1,max_length=160); current_password:str
class PortalUserCreate(BaseModel): username:str=Field(min_length=3,max_length=120); display_name:str=Field(min_length=1,max_length=160); email:str|None=None; role:str="LABEL_OPERATOR"; temporary_password:str=Field(min_length=10,max_length=128)
class PortalUserUpdate(BaseModel): display_name:str|None=None; email:str|None=None; role:str|None=None; active:bool|None=None
class ShipmentCreate(BaseModel): id:str; asn:str; po:str; eta:str; type:str; status:str="DRAFT"; lines:list[dict]
class SupplierSync(BaseModel): supplier_name:str; registration_status:str="REGISTERED"; portal_enabled:bool=False; label_enabled:bool=False; qualification_status:str="PENDING"
class PurchaseOrderSync(BaseModel): status:str="OPEN"; requested_delivery_date:str|None=None; buyer_id:str|None=None; buyer_name:str|None=None; buyer_email:str|None=None; buyer_phone:str|None=None; supplier_contact_name:str|None=None; supplier_contact_email:str|None=None; lines:list[dict]=[]; currency:str="USD"; total_amount:float|None=None
class PurchaseOrderResponse(BaseModel): decision:str; expected_delivery_date:str; response_note:str|None=None; expected_boxes:int=0; expected_pallets:int=0; supplier_contact_name:str|None=None; supplier_contact_email:str|None=None; delivery_status:str="PLANNED"; carrier_name:str|None=None; driver_name:str|None=None; driver_phone:str|None=None; vehicle_no:str|None=None; tracking_no:str|None=None
class TrackingPoint(BaseModel): latitude:float=Field(ge=-90,le=90); longitude:float=Field(ge=-180,le=180); accuracy_m:float|None=None; recorded_at:int|None=None
class PoAdjustmentCreate(BaseModel): adjustment_type:str; line_no:int|None=None; current_value:str|None=None; proposed_value:str=Field(min_length=1,max_length=2000); reason:str=Field(min_length=3,max_length=2000)
class PoAdjustmentDecision(BaseModel): status:str; review_note:str|None=None; reviewed_by:str|None=None
class LabelManifestCreate(BaseModel): manifest_key:str=Field(min_length=6,max_length=500); po_no:str|None=None; material_code:str; lot_no:str; total_quantity:float=Field(gt=0); unit:str="PCS"; outer_box_count:int=Field(ge=1); sub_box_count:int=Field(ge=0); labels:list[dict]
class ReceivingStatusSync(BaseModel): status:str; expected_boxes:int=0; scanned_boxes:int=0; expected_quantity:float=0; received_quantity:float=0; accepted_quantity:float=0; hold_quantity:float=0; rejected_quantity:float=0; discrepancy_code:str|None=None; discrepancy_note:str|None=None; rejection_reason:str|None=None; affected_box_qrs:list[str]=[]; evidence_images:list[str]=[]; inspection_reference:str|None=None; inspector_name:str|None=None; iqc_status:str|None=None; received_at:str|None=None; inspected_at:str|None=None

@app.get("/health")
def health(): return {"ok": True}

@app.get("/me")
def me(request:Request):
    user=current_user(request)
    if not user: raise HTTPException(401,"Login required")
    return {k:user[k] for k in ("id","username","supplier_code","supplier_name","display_name","role","email")}

@app.post("/login")
def login(body:Login,request:Request,response:Response):
    with db() as c:
      row=c.execute("SELECT u.* FROM users u JOIN portal_suppliers p ON p.supplier_code=u.supplier_code WHERE u.username=? AND u.active=1 AND p.registration_status='REGISTERED' AND p.portal_enabled=1",(body.username.strip(),)).fetchone()
      valid=row and hmac.compare_digest(password_hash(body.password,row["salt"]),row["password_hash"])
      if not valid:
        c.execute("INSERT INTO audit(action,ip,created_at,detail) VALUES(?,?,?,?)",("LOGIN_FAILED",request.client.host if request.client else "",int(time.time()),body.username)); c.commit()
        raise HTTPException(401,"Invalid username or password")
      token=secrets.token_urlsafe(32); now=int(time.time())
      c.execute("INSERT INTO sessions VALUES(?,?,?,?)",(token_hash(token),row["id"],now+SESSION_TTL,now)); c.execute("INSERT INTO audit(user_id,action,ip,created_at) VALUES(?,?,?,?)",(row["id"],"LOGIN",request.client.host if request.client else "",now)); c.commit()
    response.set_cookie("supplier_session",token,max_age=SESSION_TTL,httponly=True,samesite="strict",secure=os.environ.get("COOKIE_SECURE","0")=="1",path="/")
    return {k:row[k] for k in ("id","username","supplier_code","supplier_name","display_name","role","email")}

@app.post("/preview-login")
def preview_login(request:Request,response:Response):
    if os.environ.get("ENABLE_PREVIEW_LOGIN","0")!="1": raise HTTPException(404,"Preview login disabled")
    with db() as c:
      row=c.execute("SELECT * FROM users WHERE role='VIEWER' AND active=1 ORDER BY id LIMIT 1").fetchone()
      if not row: raise HTTPException(503,"Preview user is not configured")
      token=secrets.token_urlsafe(32);now=int(time.time());c.execute("INSERT INTO sessions VALUES(?,?,?,?)",(token_hash(token),row["id"],now+3600,now));audit_event(c,row["id"],"PREVIEW_LOGIN",request);c.commit()
    response.set_cookie("supplier_session",token,max_age=3600,httponly=True,samesite="strict",secure=os.environ.get("COOKIE_SECURE","0")=="1",path="/")
    return {k:row[k] for k in ("id","username","supplier_code","supplier_name","display_name","role","email")}

@app.post("/test-supplier-login")
def test_supplier_login(request:Request,response:Response):
    if os.environ.get("ENABLE_TEST_LOGIN","0")!="1": raise HTTPException(404,"Test login disabled")
    with db() as c:
      row=c.execute("SELECT u.* FROM users u JOIN portal_suppliers p ON p.supplier_code=u.supplier_code WHERE u.username='sim-supplier-admin' AND u.supplier_code='SIM-SUP-001' AND u.active=1 AND p.registration_status='REGISTERED' AND p.portal_enabled=1").fetchone()
      if not row: raise HTTPException(503,"Test supplier account is not configured")
      token=secrets.token_urlsafe(32);now=int(time.time());c.execute("INSERT INTO sessions VALUES(?,?,?,?)",(token_hash(token),row["id"],now+SESSION_TTL,now));audit_event(c,row["id"],"TEST_SUPPLIER_QUICK_LOGIN",request);c.commit()
    response.set_cookie("supplier_session",token,max_age=SESSION_TTL,httponly=True,samesite="strict",secure=os.environ.get("COOKIE_SECURE","0")=="1",path="/")
    return {k:row[k] for k in ("id","username","supplier_code","supplier_name","display_name","role","email")}

@app.post("/logout",status_code=204)
def logout(request:Request,response:Response):
    token=request.cookies.get("supplier_session")
    if token:
      with db() as c: c.execute("DELETE FROM sessions WHERE token_hash=?",(token_hash(token),)); c.commit()
    response.delete_cookie("supplier_session",path="/")

@app.post("/change-password",status_code=204)
def change_password(body:PasswordChange,request:Request):
    user=require_user(request)
    if not hmac.compare_digest(password_hash(body.current_password,user["salt"]),user["password_hash"]): raise HTTPException(400,"Current password is incorrect")
    salt=secrets.token_hex(16)
    with db() as c:
      c.execute("UPDATE users SET password_hash=?,salt=?,updated_at=? WHERE id=?",(password_hash(body.new_password,salt),salt,int(time.time()),user["id"]))
      c.execute("DELETE FROM sessions WHERE user_id=? AND token_hash<>?",(user["id"],token_hash(request.cookies.get("supplier_session",""))))
      audit_event(c,user["id"],"PASSWORD_CHANGED",request); c.commit()

@app.patch("/me")
def update_me(body:ProfileChange,request:Request):
    user=require_user(request)
    if not hmac.compare_digest(password_hash(body.current_password,user["salt"]),user["password_hash"]): raise HTTPException(400,"Current password is incorrect")
    with db() as c:
      try:c.execute("UPDATE users SET username=?,display_name=?,updated_at=? WHERE id=?",(body.username.strip(),body.display_name.strip(),int(time.time()),user["id"]))
      except sqlite3.IntegrityError: raise HTTPException(409,"Username already exists")
      audit_event(c,user["id"],"PROFILE_CHANGED",request,json.dumps({"username":body.username,"display_name":body.display_name},ensure_ascii=False));c.commit()
    return {"username":body.username,"display_name":body.display_name}

@app.get("/users")
def list_users(request:Request):
    user=require_user(request)
    with db() as c: rows=c.execute("SELECT id,username,display_name,email,role,active,updated_at FROM users WHERE supplier_code=? ORDER BY active DESC,display_name",(user["supplier_code"],)).fetchall()
    return [dict(r) for r in rows]

@app.post("/users",status_code=201)
def create_user(body:PortalUserCreate,request:Request):
    admin=require_user(request)
    if admin.get("role") not in {"SUPPLIER_ADMIN","PORTAL_SUPER_ADMIN"}: raise HTTPException(403,"Supplier admin required")
    if body.role not in {"SUPPLIER_ADMIN","PORTAL_SUPER_ADMIN","LABEL_OPERATOR","QUALITY_CONTACT","PROFILE_EDITOR","VIEWER"}: raise HTTPException(400,"Invalid role")
    salt=secrets.token_hex(16);now=int(time.time())
    with db() as c:
      try:
        cur=c.execute("INSERT INTO users(username,password_hash,salt,supplier_code,supplier_name,display_name,active,role,email,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)",(body.username.strip(),password_hash(body.temporary_password,salt),salt,admin["supplier_code"],admin["supplier_name"],body.display_name.strip(),1,body.role,body.email,now))
      except sqlite3.IntegrityError: raise HTTPException(409,"Username already exists")
      payload={"id":cur.lastrowid,"username":body.username,"display_name":body.display_name,"email":body.email,"role":body.role,"active":True}
      audit_event(c,admin["id"],"PORTAL_USER_CREATED",request,json.dumps(payload,ensure_ascii=False));outbox(c,admin["supplier_code"],"PORTAL_USER_CREATED","PORTAL_USER",cur.lastrowid,payload);c.commit()
    return payload

@app.patch("/users/{user_id}")
def update_user(user_id:int,body:PortalUserUpdate,request:Request):
    admin=require_user(request)
    if admin.get("role") not in {"SUPPLIER_ADMIN","PORTAL_SUPER_ADMIN"}: raise HTTPException(403,"Supplier admin required")
    with db() as c:
      target=c.execute("SELECT * FROM users WHERE id=? AND supplier_code=?",(user_id,admin["supplier_code"])).fetchone()
      if not target: raise HTTPException(404,"User not found")
      role=body.role or target["role"]
      if role not in {"SUPPLIER_ADMIN","PORTAL_SUPER_ADMIN","LABEL_OPERATOR","QUALITY_CONTACT","PROFILE_EDITOR","VIEWER"}: raise HTTPException(400,"Invalid role")
      active=target["active"] if body.active is None else int(body.active)
      c.execute("UPDATE users SET display_name=?,email=?,role=?,active=?,updated_at=? WHERE id=?",(body.display_name or target["display_name"],body.email if body.email is not None else target["email"],role,active,int(time.time()),user_id))
      if not active:c.execute("DELETE FROM sessions WHERE user_id=?",(user_id,))
      payload={"id":user_id,"role":role,"active":bool(active)};audit_event(c,admin["id"],"PORTAL_USER_UPDATED",request,json.dumps(payload));outbox(c,admin["supplier_code"],"PORTAL_USER_UPDATED","PORTAL_USER",user_id,payload);c.commit()
    return payload

@app.get("/shipments")
def list_shipments(request:Request):
    user=require_user(request)
    with db() as c: rows=c.execute("SELECT payload,receiving_payload FROM shipments WHERE supplier_code=? ORDER BY created_at DESC",(user["supplier_code"],)).fetchall()
    return [{**json.loads(r["payload"]),"receiving":json.loads(r["receiving_payload"]) if r["receiving_payload"] else None} for r in rows]

@app.get("/orders")
def list_orders(request:Request):
    user=require_user(request)
    with db() as c: rows=c.execute("SELECT po_no,status,requested_delivery_date,expected_delivery_date,acknowledged_at,response_note,expected_boxes,expected_pallets,supplier_contact_name,supplier_contact_email,delivery_status,carrier_name,driver_name,driver_phone,vehicle_no,tracking_no,payload FROM purchase_orders WHERE supplier_code=? ORDER BY source_updated_at DESC",(user["supplier_code"],)).fetchall()
    return [{**dict(r),"payload":json.loads(r["payload"])} for r in rows]

@app.post("/orders/{po_no}/response")
def respond_order(po_no:str,body:PurchaseOrderResponse,request:Request):
    user=require_write_user(request);decision=body.decision.upper()
    if decision not in {"ACCEPTED","CHANGE_REQUESTED","REJECTED"}: raise HTTPException(400,"Invalid decision")
    with db() as c:
      row=c.execute("SELECT * FROM purchase_orders WHERE po_no=? AND supplier_code=?",(po_no,user["supplier_code"])).fetchone()
      if not row: raise HTTPException(404,"Purchase order not found")
      c.execute("UPDATE purchase_orders SET status=?,expected_delivery_date=?,acknowledged_at=?,response_note=?,expected_boxes=?,expected_pallets=?,supplier_contact_name=?,supplier_contact_email=?,delivery_status=?,carrier_name=?,driver_name=?,driver_phone=?,vehicle_no=?,tracking_no=?,updated_at=? WHERE po_no=?",(decision,body.expected_delivery_date,int(time.time()),body.response_note,body.expected_boxes,body.expected_pallets,body.supplier_contact_name,body.supplier_contact_email,body.delivery_status.upper(),body.carrier_name,body.driver_name,body.driver_phone,body.vehicle_no,body.tracking_no,int(time.time()),po_no))
      payload={"po_no":po_no,"decision":decision,"expected_delivery_date":body.expected_delivery_date,"response_note":body.response_note,"expected_boxes":body.expected_boxes,"expected_pallets":body.expected_pallets,"supplier_contact_name":body.supplier_contact_name,"supplier_contact_email":body.supplier_contact_email,"delivery_status":body.delivery_status.upper(),"carrier_name":body.carrier_name,"driver_name":body.driver_name,"driver_phone":body.driver_phone,"vehicle_no":body.vehicle_no,"tracking_no":body.tracking_no};audit_event(c,user["id"],"PO_RESPONDED",request,json.dumps(payload));outbox(c,user["supplier_code"],"PO_RESPONDED","PURCHASE_ORDER",po_no,payload);c.commit()
    return payload

@app.get("/orders/{po_no}/tracking")
def get_order_tracking(po_no:str,request:Request):
    user=require_user(request)
    with db() as c:
      if not c.execute("SELECT 1 FROM purchase_orders WHERE po_no=? AND supplier_code=?",(po_no,user["supplier_code"])).fetchone(): raise HTTPException(404,"Purchase order not found")
      rows=c.execute("SELECT latitude,longitude,accuracy_m,recorded_at FROM delivery_tracking WHERE po_no=? AND supplier_code=? ORDER BY recorded_at DESC LIMIT 100",(po_no,user["supplier_code"])).fetchall()
    return [dict(r) for r in rows]

@app.post("/orders/{po_no}/tracking",status_code=201)
def report_order_tracking(po_no:str,body:TrackingPoint,request:Request):
    user=require_write_user(request);recorded_at=body.recorded_at or int(time.time())
    with db() as c:
      if not c.execute("SELECT 1 FROM purchase_orders WHERE po_no=? AND supplier_code=?",(po_no,user["supplier_code"])).fetchone(): raise HTTPException(404,"Purchase order not found")
      payload={"po_no":po_no,"latitude":body.latitude,"longitude":body.longitude,"accuracy_m":body.accuracy_m,"recorded_at":recorded_at}
      c.execute("INSERT INTO delivery_tracking(po_no,supplier_code,latitude,longitude,accuracy_m,recorded_at,reported_by) VALUES(?,?,?,?,?,?,?)",(po_no,user["supplier_code"],body.latitude,body.longitude,body.accuracy_m,recorded_at,user["id"]));outbox(c,user["supplier_code"],"DELIVERY_LOCATION_UPDATED","PURCHASE_ORDER",po_no,payload);c.commit()
    return payload

@app.get("/orders/{po_no}/adjustments")
def list_order_adjustments(po_no:str,request:Request):
    user=require_user(request)
    with db() as c:
      rows=c.execute("SELECT request_no,adjustment_type,line_no,current_value,proposed_value,reason,status,created_at,updated_at FROM po_adjustment_requests WHERE po_no=? AND supplier_code=? ORDER BY created_at DESC",(po_no,user["supplier_code"])).fetchall()
    return [dict(r) for r in rows]

@app.post("/orders/{po_no}/adjustments",status_code=201)
def create_order_adjustment(po_no:str,body:PoAdjustmentCreate,request:Request):
    user=require_write_user(request);kind=body.adjustment_type.upper()
    if kind not in {"DELIVERY_DATE","QUANTITY","PRICE","MATERIAL_SPEC","SHIPPING_PLAN","OTHER"}: raise HTTPException(400,"Invalid adjustment type")
    with db() as c:
      if not c.execute("SELECT 1 FROM purchase_orders WHERE po_no=? AND supplier_code=?",(po_no,user["supplier_code"])).fetchone(): raise HTTPException(404,"Purchase order not found")
      now=int(time.time());request_no=f"POA-{time.strftime('%Y%m%d')}-{secrets.token_hex(3).upper()}";payload={"request_no":request_no,"po_no":po_no,"adjustment_type":kind,"line_no":body.line_no,"current_value":body.current_value,"proposed_value":body.proposed_value,"reason":body.reason,"status":"PENDING"}
      c.execute("INSERT INTO po_adjustment_requests(request_no,po_no,supplier_code,adjustment_type,line_no,current_value,proposed_value,reason,status,requested_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",(request_no,po_no,user["supplier_code"],kind,body.line_no,body.current_value,body.proposed_value,body.reason,"PENDING",user["id"],now,now));outbox(c,user["supplier_code"],"PO_ADJUSTMENT_REQUESTED","PURCHASE_ORDER",po_no,payload);audit_event(c,user["id"],"PO_ADJUSTMENT_REQUESTED",request,json.dumps(payload));c.commit()
    return payload

@app.post("/label-manifests")
def register_label_manifest(body:LabelManifestCreate,request:Request):
    user=require_write_user(request);now=int(time.time());payload=body.model_dump();payload.update({"supplier_code":user["supplier_code"],"status":"PRE_RECEIVING_UNCONFIRMED","registered_at":now})
    if len(body.labels)!=body.outer_box_count+body.sub_box_count: raise HTTPException(400,"Label count does not match outer/sub-box totals")
    if abs(sum(float(x.get("qty",0)) for x in body.labels if x.get("level")=="OUTER")-body.total_quantity)>0.0001: raise HTTPException(400,"Outer-box quantity does not equal total quantity")
    with db() as c:
      row=c.execute("SELECT id FROM supplier_label_manifests WHERE manifest_key=? AND supplier_code=?",(body.manifest_key,user["supplier_code"])).fetchone()
      if row:c.execute("UPDATE supplier_label_manifests SET po_no=?,material_code=?,lot_no=?,total_quantity=?,unit=?,outer_box_count=?,sub_box_count=?,payload=?,updated_at=? WHERE id=?",(body.po_no,body.material_code,body.lot_no,body.total_quantity,body.unit,body.outer_box_count,body.sub_box_count,json.dumps(payload,ensure_ascii=False),now,row["id"]));manifest_id=row["id"]
      else:manifest_id=c.execute("INSERT INTO supplier_label_manifests(manifest_key,supplier_code,po_no,material_code,lot_no,total_quantity,unit,outer_box_count,sub_box_count,status,payload,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",(body.manifest_key,user["supplier_code"],body.po_no,body.material_code,body.lot_no,body.total_quantity,body.unit,body.outer_box_count,body.sub_box_count,"PRE_RECEIVING_UNCONFIRMED",json.dumps(payload,ensure_ascii=False),user["id"],now,now)).lastrowid
      outbox(c,user["supplier_code"],"LABEL_MANIFEST_REGISTERED","LABEL_MANIFEST",manifest_id,payload);audit_event(c,user["id"],"LABEL_MANIFEST_REGISTERED",request,json.dumps({"manifest_id":manifest_id,"labels":len(body.labels)}));c.commit()
    return {"id":manifest_id,"manifest_key":body.manifest_key,"registered":True,"status":"PRE_RECEIVING_UNCONFIRMED","outer_box_count":body.outer_box_count,"sub_box_count":body.sub_box_count,"label_count":len(body.labels)}

@app.post("/shipments",status_code=201)
def create_shipment(body:ShipmentCreate,request:Request):
    user=require_write_user(request);payload=body.model_dump();now=int(time.time())
    with db() as c:
      try:c.execute("INSERT INTO shipments VALUES(?,?,?,?,?,?,?,?,?,?,?)",(body.id,user["supplier_code"],body.asn,body.po,body.eta,body.type,body.status,json.dumps(payload,ensure_ascii=False),user["id"],now,now))
      except sqlite3.IntegrityError: raise HTTPException(409,"Shipment or ASN already exists")
      audit_event(c,user["id"],"SHIPMENT_CREATED",request,body.asn);outbox(c,user["supplier_code"],"SHIPMENT_CREATED","SHIPMENT",body.id,payload);c.commit()
    return payload

@app.get("/sync/events")
def sync_events(request:Request,after:int=0,limit:int=100):
    if not secrets.compare_digest(request.headers.get("x-sync-key",""),os.environ.get("WMS_SYNC_KEY","disabled")): raise HTTPException(401,"Invalid sync key")
    with db() as c: rows=c.execute("SELECT * FROM sync_outbox WHERE id>? ORDER BY id LIMIT ?",(after,min(max(limit,1),500))).fetchall()
    return [{**dict(r),"payload":json.loads(r["payload"])} for r in rows]

@app.post("/sync/events/{event_id}/ack",status_code=204)
def sync_ack(event_id:str,request:Request):
    if not secrets.compare_digest(request.headers.get("x-sync-key",""),os.environ.get("WMS_SYNC_KEY","disabled")): raise HTTPException(401,"Invalid sync key")
    with db() as c:c.execute("UPDATE sync_outbox SET acknowledged_at=? WHERE event_id=?",(int(time.time()),event_id));c.commit()

@app.put("/sync/po-adjustments/{request_no}")
def sync_po_adjustment_decision(request_no:str,body:PoAdjustmentDecision,request:Request):
    if not secrets.compare_digest(request.headers.get("x-sync-key",""),os.environ.get("WMS_SYNC_KEY","disabled")): raise HTTPException(401,"Invalid sync key")
    status=body.status.upper()
    if status not in {"APPROVED","REJECTED"}: raise HTTPException(400,"status must be APPROVED or REJECTED")
    with db() as c:
      row=c.execute("SELECT * FROM po_adjustment_requests WHERE request_no=?",(request_no,)).fetchone()
      if not row: raise HTTPException(404,"PO adjustment request not found")
      now=int(time.time());c.execute("UPDATE po_adjustment_requests SET status=?,updated_at=? WHERE request_no=?",(status,now,request_no));audit_event(c,None,"PO_ADJUSTMENT_DECIDED",request,json.dumps({"request_no":request_no,"status":status,"review_note":body.review_note,"reviewed_by":body.reviewed_by},ensure_ascii=False));c.commit()
    return {"request_no":request_no,"status":status,"review_note":body.review_note,"reviewed_by":body.reviewed_by,"updated_at":now}

@app.put("/sync/suppliers/{supplier_code}")
def sync_supplier(supplier_code:str,body:SupplierSync,request:Request):
    if not secrets.compare_digest(request.headers.get("x-sync-key",""),os.environ.get("WMS_SYNC_KEY","disabled")): raise HTTPException(401,"Invalid sync key")
    now=int(time.time())
    with db() as c:
      c.execute("INSERT INTO portal_suppliers VALUES(?,?,?,?,?,?,?) ON CONFLICT(supplier_code) DO UPDATE SET supplier_name=excluded.supplier_name,registration_status=excluded.registration_status,portal_enabled=excluded.portal_enabled,label_enabled=excluded.label_enabled,qualification_status=excluded.qualification_status,updated_at=excluded.updated_at",(supplier_code.upper(),body.supplier_name,body.registration_status.upper(),int(body.portal_enabled),int(body.label_enabled),body.qualification_status.upper(),now))
      if body.registration_status.upper()!='REGISTERED' or not body.portal_enabled:c.execute("DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE supplier_code=?)",(supplier_code.upper(),))
      c.commit()
    return {"supplier_code":supplier_code.upper(),**body.model_dump(),"updated_at":now}

@app.put("/sync/purchase-orders/{po_no}")
def sync_purchase_order(po_no:str,body:PurchaseOrderSync,request:Request):
    if not secrets.compare_digest(request.headers.get("x-sync-key",""),os.environ.get("WMS_SYNC_KEY","disabled")): raise HTTPException(401,"Invalid sync key")
    supplier_code=request.headers.get("x-supplier-code","").upper()
    with db() as c:
      if not c.execute("SELECT 1 FROM portal_suppliers WHERE supplier_code=? AND registration_status='REGISTERED'",(supplier_code,)).fetchone(): raise HTTPException(409,"Supplier is not registered")
      now=int(time.time());payload={"po_no":po_no,**body.model_dump()};c.execute("INSERT INTO purchase_orders(po_no,supplier_code,status,requested_delivery_date,payload,source_updated_at,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(po_no) DO UPDATE SET supplier_code=excluded.supplier_code,status=excluded.status,requested_delivery_date=excluded.requested_delivery_date,payload=excluded.payload,source_updated_at=excluded.source_updated_at,updated_at=excluded.updated_at",(po_no,supplier_code,body.status.upper(),body.requested_delivery_date,json.dumps(payload,ensure_ascii=False),now,now));c.commit()
    return payload

@app.put("/sync/shipments/{shipment_id}/receiving-status")
def sync_receiving_status(shipment_id:str,body:ReceivingStatusSync,request:Request):
    if not secrets.compare_digest(request.headers.get("x-sync-key",""),os.environ.get("WMS_SYNC_KEY","disabled")): raise HTTPException(401,"Invalid sync key")
    payload=body.model_dump()
    with db() as c:
      row=c.execute("SELECT supplier_code FROM shipments WHERE id=?",(shipment_id,)).fetchone()
      if not row: raise HTTPException(404,"Shipment not found")
      c.execute("UPDATE shipments SET status=?,receiving_payload=?,updated_at=? WHERE id=?",(body.status.upper(),json.dumps(payload,ensure_ascii=False),int(time.time()),shipment_id))
      outbox(c,row["supplier_code"],"RECEIVING_STATUS_UPDATED","SHIPMENT",shipment_id,payload);c.commit()
    return {"shipment_id":shipment_id,**payload}
