cmd /c "C:\PostgreSQL\pgsql\bin\psql.exe -U smt_factory -d postgres -c \"SELECT pg_is_in_recovery;\" -c \"SELECT now();\" -c \"SELECT * FROM pg_stat_wal_receiver;\""
