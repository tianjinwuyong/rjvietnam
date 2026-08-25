# 工位数据源配置 (Station Data Sources)

## L004 手动线 (Manual Line) — 13 Stations

| # | 工位名称 | Code | 数据源类型 | 连接信息 |
|---|---------|------|-----------|---------|
| 1 | PDA扫码上料 | pda_load | TBD | |
| 2 | 波峰焊 | wave_solder | TBD | |
| 3 | AOI | manu_aio | **MySQL** | root/root1234, 192.168.6.50:3306, aoi_data |
| 4 | ICT | manu_ict | **File** | D:\SRC |
| 5 | FCT | manu_fct | **File** | D:\ATS\测试报表 |
| 6 | 分板机 | manu_depanel | TBD | |
| 7 | 绑码 | manu_shellbinding | TBD | |
| 8 | 组装ATE | manu_assem_ate | **File** | D:\ATS\测试报表 |
| 9 | 超声波 | manu_supersonic | **SQL Server** | sa/888888 |
| 10 | 成品老化 | manu_agingcab | **MySQL** | root/871223 |
| 11 | 高压测试 | manu_hivolt_ate | **File** | D:\ATS\测试报表 |
| 12 | 包装ATE | manu_package_ate | **File** | D:\ATS\测试报表 |
| 13 | 包装 | manu_case_binding | TBD | |
