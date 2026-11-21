@echo off
set "FACTORY_DOMAIN=manual"
set "LINE_DOMAIN=manual"
set "MES_API_URL=http://127.0.0.1:8080/api/pda/events"
set "MES_API=http://127.0.0.1:8080/api"
set "ICT_WATCH_DIR=D:\RUIJING_TEST\MANUAL\ICT"
set "ICT_SCANNER_TCP_PORT=13003"
cd /d "C:\Users\tianj\Desktop\越南工厂瑞晶\瑞晶越南工位-正式命名\004-手动线\(03)ICT"
start "" /b "C:\Users\tianj\AppData\Local\Programs\Python\Python38\pythonw.exe" ict_agent.py
