Start-Process -FilePath "C:\PostgreSQL\pgsql\bin\pg_ctl.exe" -ArgumentList "start -D C:\PostgreSQL\data -l C:\PostgreSQL\pg.log" -WindowStyle Hidden
Start-Sleep -Seconds 5
