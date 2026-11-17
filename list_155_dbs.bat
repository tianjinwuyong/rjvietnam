@echo off
D:\d\postgresql\bin\psql.exe -U postgres -d postgres -c "SELECT datname FROM pg_database ORDER BY datname"
