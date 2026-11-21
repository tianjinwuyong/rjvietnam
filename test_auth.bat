@echo off
echo Testing replicator with PGPASSWORD...
set PGPASSWORD=Replicator@123
C:\PostgreSQL\pgsql\bin\psql.exe -h 100.116.166.118 -p 5432 -U replicator -d postgres -c "SELECT 'authenticated' AS status;"
echo Exit code: %ERRORLEVEL%
