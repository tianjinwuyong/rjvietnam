@echo off
set PGPASSWORD=Replicator@123
C:\PostgreSQL\pgsql\bin\pg_basebackup.exe -h 100.116.166.118 -p 5432 -U replicator -D C:\PostgreSQL\data -R -Xs -P -Fp
echo Exit code: %ERRORLEVEL%
