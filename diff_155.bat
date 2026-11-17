@echo off
set PGPASSWORD=postgres
D:\d\postgresql\bin\psql.exe -U postgres -d smt_factory -c "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename" > C:\Users\tianj\Desktop\越南工厂瑞晶\smt-factory-system\155_tables.txt
