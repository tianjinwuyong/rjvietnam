import json, time, urllib.request

stations = ('manu_pda','manu_aio','wave_solder','manu_ict','manu_fct','manu_depanel','manu_shellbinding',
            'manu_assem_ate','manu_supersonic','manu_agingcab','manu_hivolt_ate','manu_package_ate',
            'manu_outer_box_binding','manu_pallet_binding','manu_rework')
while True:
    for station in stations:
        body = json.dumps({'agent':'LOCAL_PREFLIGHT_HEARTBEAT','lineCode':'L004','status':'running',
                           'timestamp':int(time.time()*1000)}).encode()
        request = urllib.request.Request(f'http://127.0.0.1:8080/api/mes/heartbeat/{station}', body,
                                         {'Content-Type':'application/json'}, method='POST')
        try: urllib.request.urlopen(request, timeout=3).read()
        except Exception: pass
    time.sleep(10)
