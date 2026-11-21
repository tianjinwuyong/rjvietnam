@echo off
echo Testing replicator connection to 122...
C:\PostgreSQL\pgsql\bin\psql.exe -h 100.116.166.118 -p 5432 -U replicator -d postgres -c "SELECT 1 AS test;"
echo Exit code: %ERRORLEVEL%
