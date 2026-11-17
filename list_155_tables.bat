@echo off
set PGPASSWORD=postgres
D:\d\postgresql\bin\psql.exe -U postgres -d smt_factory -c "SELECT schemaname, tablename FROM pg_tables WHERE schemaname NOT IN ('pg_catalog', 'information_schema') ORDER BY schemaname, tablename"
