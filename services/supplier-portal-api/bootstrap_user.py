import getpass, os, secrets, sqlite3, sys
from main import DB, db, password_hash
username=os.environ.get("PORTAL_USERNAME") or input("Username: ").strip()
password=os.environ.get("PORTAL_PASSWORD") or getpass.getpass("Password: ")
code=os.environ.get("SUPPLIER_CODE") or input("Supplier code: ").strip()
name=os.environ.get("SUPPLIER_NAME") or input("Supplier name: ").strip()
display=os.environ.get("DISPLAY_NAME") or username
role=os.environ.get("PORTAL_ROLE") or "SUPPLIER_ADMIN"
active=0 if os.environ.get("PORTAL_ACTIVE","1")=="0" else 1
salt=secrets.token_hex(16)
with db() as c:
 c.execute("INSERT INTO portal_suppliers(supplier_code,supplier_name,registration_status,portal_enabled,label_enabled,qualification_status,updated_at) VALUES(?,?,'REGISTERED',1,1,'QUALIFIED',strftime('%s','now')) ON CONFLICT(supplier_code) DO UPDATE SET supplier_name=excluded.supplier_name,registration_status='REGISTERED',portal_enabled=1,label_enabled=1,qualification_status='QUALIFIED',updated_at=excluded.updated_at",(code,name))
 c.execute("INSERT INTO users(username,password_hash,salt,supplier_code,supplier_name,display_name,role,active) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(username) DO UPDATE SET password_hash=excluded.password_hash,salt=excluded.salt,supplier_code=excluded.supplier_code,supplier_name=excluded.supplier_name,display_name=excluded.display_name,role=excluded.role,active=excluded.active",(username,password_hash(password,salt),salt,code,name,display,role,active));c.commit()
print("user ready",username,code,DB)
