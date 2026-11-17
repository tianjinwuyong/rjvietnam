#!/usr/bin/env python3
"""Generate employee QR codes and store as PNG in DB (qr_image column)."""
import os, sys, json, base64, io

PYTHON = r"C:\Users\tianj\AppData\Local\Programs\Python\Python314\python.exe"

try:
    import qrcode as _qr
    print(f"qrcode available")
    qrcode = _qr
except ImportError:
    print("qrcode not installed in system Python")
    qrcode = None

import psycopg2
import urllib.request

API = "http://127.0.0.1:8080"

def login():
    req = urllib.request.urlopen(
        urllib.request.Request(f'{API}/api/auth/login',
            data=json.dumps({"username":"admin","password":"Factory@123"}).encode(),
            headers={"Content-Type":"application/json"})
    )
    return json.loads(req.read())['data']['item']['token']

def get_employees(token):
    req = urllib.request.urlopen(
        urllib.request.Request(f'{API}/api/hr/employees',
            headers={"Authorization": f"Bearer {token}"})
    )
    resp = json.loads(req.read())
    if isinstance(resp, list):
        return resp
    return resp.get('data', {}).get('items', [])

def generate_qr_png(data: str) -> bytes:
    """Generate QR code PNG bytes."""
    if qrcode:
        img = qrcode.make(data)
        buf = io.BytesIO()
        img.save(buf, format='PNG')
        return buf.getvalue()
    else:
        import subprocess
        result = subprocess.run(
            ['node', '-e', f'''
const QRCode = require('qrcode');
QRCode.toDataURL({json.dumps(data)}, {{ format: 'png' }}, (err, url) => {{
  if (err) {{ console.error('ERROR:', err.message); process.exit(1); }}
  console.log(url);
}});
'''],
            capture_output=True, text=True,
            cwd=r"C:\Users\tianj\Desktop\越南工厂瑞晶\越南工厂瑞晶\smt-factory-system"
        )
        if result.returncode != 0:
            raise RuntimeError(f"Node QR failed: {result.stderr}")
        b64 = result.stdout.strip().split(',')[1]
        return base64.b64decode(b64)

def main():
    token = login()
    employees = get_employees(token)
    print(f"Got {len(employees)} employees")

    conn = psycopg2.connect(
        host='127.0.0.1', port=5432, dbname='smt_factory',
        user='postgres', password='postgres'
    )
    conn.autocommit = True
    cur = conn.cursor()

    # Ensure qr_image column exists
    cur.execute("""
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name='hr_employees' AND column_name='qr_image'
            ) THEN
                ALTER TABLE hr_employees ADD COLUMN qr_image bytea;
            END IF;
        END $$;
    """)
    print("Column qr_image ready")

    updated = 0
    for emp in employees:
        emp_id = emp['id']
        emp_no = emp['employee_no']

        # 姓名
        name_zh = emp.get('name_zh', '')
        # 性别: M/F → 男/女
        gender_map = {'M': '男', 'F': '女', 'male': '男', 'female': '女'}
        gender_raw = emp.get('gender', '')
        gender = gender_map.get(gender_raw, gender_raw)

        # 年龄: 从 birth_date 计算
        age = None
        birth_date = emp.get('birth_date')
        if birth_date:
            try:
                from datetime import datetime, date
                if isinstance(birth_date, str):
                    bd = datetime.fromisoformat(birth_date.replace('Z', '+00:00'))
                    today = date.today()
                    age = today.year - bd.year - ((today.month, today.day) < (bd.month, bd.day))
            except Exception:
                age = None

        # 入职时间
        join_date = emp.get('join_date', '')
        if join_date:
            try:
                jd = datetime.fromisoformat(join_date.replace('Z', '+00:00'))
                join_date = jd.strftime('%Y-%m-%d')
            except Exception:
                pass

        # 职位
        position = emp.get('position_title', '')

        # 联系电话
        phone = emp.get('phone', '')

        qr_data = json.dumps({
            "工号": emp_no,
            "姓名": name_zh,
            "性别": gender,
            "年龄": age,
            "入职时间": join_date,
            "职位": position,
            "联系电话": phone,
        }, ensure_ascii=False, indent=None)

        print(f"  Generating QR for {emp_no} {name_zh}...", end='', flush=True)
        try:
            png = generate_qr_png(qr_data)
            cur.execute(
                "UPDATE hr_employees SET qr_image = %s WHERE id = %s",
                (psycopg2.Binary(png), emp_id)
            )
            print(f" OK ({len(png)} bytes)")
            updated += 1
        except Exception as ex:
            print(f" FAIL: {ex}")

    cur.close()
    conn.close()
    print(f"\nDone: {updated}/{len(employees)} QR codes generated")

if __name__ == '__main__':
    main()