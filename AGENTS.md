# Repository Guidelines(仓库指南)

## Project Overview(项目概述)

面向工厂现场人员的 Android PDA 应用(Kotlin + Jetpack Compose):员工、上料员、组长、
线长、厂长、仓库/IQC/MES 人员。它是纯粹的 MES/WMS **客户端** —— MES 掌握计划、工单、
角色、线体范围、审批与审计。PDA 绝不本地授予权限,绝不写入模拟生产数据。
领域词汇与强制约定:`CONTEXT.md`;角色/任务契约与验收门槛:`ROLE_TASK_GRAPH.md`;
页面层级与 MES 接口契约:`SITE-MAP-AND-MES-API.md`;管理者运营模型:`SKILL.md`。

## Architecture & Data Flow(架构与数据流)

单 Activity Compose 应用,手动依赖注入,MVVM:

```
MainActivity(dispatchKeyEvent 扫码枪按键捕获、15 秒心跳、语言环境)
  → MaterialLoaderTheme { AppNavHost() }        ui/navigation/AppNavigation.kt
  → ui/<feature>/XxxScreen → XxxViewModel       (StateFlow<XxxUiState>)
  → data/repository/* 或直接调 ApiService        suspend → Result<T> / Response<JsonObject>
  → RetrofitClient → OkHttp:EndpointFailoverInterceptor → AuthInterceptor → 日志
  → MES 192.168.6.155 → .122 → .234(:8080,明文 HTTP)
```

- **路由/角色管控**(`ui/navigation/AppNavigation.kt`,约 860 行):路由为
  `object Routes` 中的扁平 snake_case 常量;带参路由用字符串模板
  (`"${Routes.RACK_DETAIL}/{shelfCode}"`)。管控函数是 `canAccessRoute(prefs, route)` ——
  将 MES 下发的 `user.roleDefinition.pages` 与 `mesPageKey(route)` 比对,否则回退到
  硬编码的角色允许集合。执行方式是 `AppNavHost` 中 `LaunchedEffect` 的重定向,
  不是逐个 Composable 检查。启动页由 `unifiedStartRoute(prefs)` 决定;
  管理模块可见性由 `visibleManagerModules(prefs)` 决定。
- **端点故障转移**:链路 155 → 122 → 234(`defaultConfig` 中的
  `PRIMARY/SECONDARY/TERTIARY_API_BASE_URL`,所有变体一致)。仅 GET/HEAD 失败时级联
  重试;POST/PUT/DELETE **绝不重放**(歧义写入由 MES 对账;非 GET 携带 `X-Request-ID`)。
  健康探测 `GET {base}health`,端点选择最多每 15 秒重探一次。
- **鉴权**:`AuthInterceptor` 添加 `Authorization: Bearer <jwt>`(跳过 `/auth/login`),
  `TEST_ACTION_BYPASS_ENABLED` 为真时添加 `X-PDA-Test-Mode: 1`。
- **API 层**:单个巨大的 `data/api/ApiService.kt`(约 100 个 suspend 方法),大多返回
  `Response<JsonObject>`、请求体为临时 `Map<String, Any?>`;JSON 为 snake_case(Gson)。
  新旧端点双路径并存(`/wms/...` 与 `/api/wms/...`)。
- **离线**:`data/offline/OfflineLoadingStore.kt`(SQLite)只服务 `ui/pdaloading`:
  库位/批次/槽位快照 → 本地质量闸门 → SHA-256 哈希链离线队列,经
  `/api/smt/loading/offline-events` 同步回传。
- **子系统**:`alarm/` 前台服务每 10 秒轮询 `managerAlerts` → 全屏
  `AlarmPopupActivity`;测试旁路开启时跳过轮询。
  `printing/BluetoothTsplPrinter.kt` 经蓝牙 SPP 发送原始 TSPL 指令。
  `ui/components/` 提供共享的 CameraX+ML Kit 条码扫描与中文 OCR 标签扫描组件。

## Key Directories(关键目录)

|路径|用途|
|---|---|
|`unifiedpda/`|Gradle 根目录(`rootProject.name = "UnifiedPDA"`),单 `:app` 模块|
|`unifiedpda/app/src/main/java/com/smt/materialloader/`|全部应用源码|
|`…/ui/<feature>/`|每个模块 Screen+ViewModel:`login`、`receiving`(最大,WMS 收货)、`pdaloading`(SMT 线上料)、`manager`(驾驶舱/审批/HR/班组)、`document`(5 种 WMS 单据)、`collect`、`count`、`issue`、`returnmaterial`、`shortage`、`pick`、`shelfin`、`shelfout`、`rack`、`query`、`wolist`、`wobind`、`iqc`、`signification`(OA)、`fetching`、`employee`、`history`、`location`|
|`…/data/api/`、`…/data/repository/`、`…/data/offline/`|网络层、仓储层、离线队列|
|`…/alarm/`、`…/printing/`、`…/util/`|告警服务、蓝牙打印、偏好/语言管理器|
|`unifiedpda/app/src/main/res/values{,-zh,-vi}/`|英文默认 + 中文 + 越南文文案|
|`godot-warehouse-map/`、`unity-warehouse-map/`|实验性独立 3D 仓库地图客户端 —— 除非任务明确关于它,否则不要动|

## Development Commands(开发命令)

在 `unifiedpda/` 下、Windows(PowerShell/CMD;只有 `gradlew.bat`,无 POSIX 脚本):

```bat
.\gradlew.bat :app:assembleDebug              :: debug 变体(MES 192.168.6.155)
.\gradlew.bat :app:assembleUnifiedManagement  :: 验收构建门槛(见「Testing & QA」)
.\gradlew.bat :app:testDebugUnitTest          :: JVM 单元测试(仅有的测试)
```

**非 ASCII 项目路径会破坏 `:app:testDebugUnitTest`**(本路径含中文):Gradle 以 UTF-8
写测试 worker 的 classpath `@argfile`,但 forked JVM 按平台字符集(GBK)解析,项目目录
条目被乱码化 → 所有测试类 `ClassNotFoundException`。须经 ASCII junction 运行(一次创建):

```bat
mklink /J C:\rjpda "C:\Users\tianj\Desktop\越南工厂瑞晶\统一PDA管理\unifiedpda"
cd C:\rjpda && .\gradlew.bat :app:testDebugUnitTest
```

若增量 Kotlin 状态损坏导致编译失败(`Cannot access output property
… caches-jvm\inputs\source-to-output.tab.values.at`):先 `.\gradlew.bat --stop`,
删除 `app/build/kotlin` 再重试。

安装 + 冒烟验证:

```bat
adb install -r unifiedpda\app\build\outputs\apk\debug\app-debug.apk
adb shell am start -n com.ruijing.linemanager/com.smt.materialloader.MainActivity
adb exec-out screencap -p > shot.png          :: 目检 UI 变更
```

**MuMu 规程**(本机约定):智能体不得自行启动 MuMu;仅当操作者已打开模拟器实例后,
方可经 `adb`(连接 `127.0.0.1:7555` 或 `adb connect 127.0.0.1:<端口>`)安装与测试。
注意 MuMu 多屏:每个 app 实例可能在不同逻辑屏(`input -d <display>` 需先查
`dumpsys display`);设备冒烟门槛(三语等)可由智能体在已开实例上执行。

`hotelDebug` 为厂外调试构建,端点见下文「厂外连真实 MES」;每变体遗留的
`API_BASE_URL` 字段仍是死代码(运行时只读 `PRIMARY/SECONDARY/TERTIARY_API_BASE_URL`),
除 hotelDebug 外各变体均指向厂区 LAN。

**厂外连真实 MES(hotelDebug 已改好):** 出厂 LAN `192.168.6.0/24` 在本机不可路由,
Tailscale 也不带子网路由(所有节点 `sub=` 空);但 `ruijing-management-122` =
`100.116.166.118:8080` 可直连,且提供真实 MES `/api/auth/*`。hotelDebug 的三段端点现指向
`http://127.0.0.1:8080/`,完整链路:

```bat
:: 1. 主机起兼容代理(legacy /auth/login|session → /api/auth/*,其余透传,保 query)
python tools\mes-compat-proxy.py --listen 18080
:: 2. 设备环回转发
adb -s 127.0.0.1:16448 reverse tcp:8080 tcp:18080
:: 3. 装 hotelDebug 即连真 MES 122(155/234 厂外不可用;X-PDA-Route 按 host 判定,环回标 FACTORY_UNKNOWN)
```

MES 122 能力矩阵(2026-11-21 实测):`/api/pda/{heartbeats,events}`、
`/api/smt/loading/{work-orders,offline-violations,operators}`、`/mes/lines/{code}`、
`/hr/employees`、`/api/wms/receiving/live-state`、`/api/oa/documents`、`/api/manager/team`
在线;`/api/manager/{alerts,decisions,messages,targets,handover,audit}`、
`/api/smt/loading/offline-lease`、`/api/dispatch/claim` 仍 404(Required,服务器侧);
SMT WebView 面板(`TempSmtLoadingActivity` 硬编码 `155:5178/5180`)厂外不可达。
`EMPLOYEE_VN001` 在 122 上未开通;`VN_WH_001 / VN_OP_001 / VN_LM_* / QC_VN_01 /
PMC_CN_01 / MO_LI_BIN`(密码 `Factory@123`)可登录。

|构建类型|applicationId 后缀|标志|
|---|---|---|
|`debug`|—|`TEST_ACTION_BYPASS_ENABLED=true`|
|`hotelDebug`|—|继承 debug + 本地意图|
|`receivingOnly`|`.receiving`|仅 WMS 收货;运行时由 `APPLICATION_ID.endsWith(".receiving")` 判定,**不是** `RECEIVING_ONLY` 标志(该标志从未被读取)|
|`plantManager` / `plantManagerRelease`|`.plantmanager`|`PLANT_MANAGER_APP=true`|
|`unifiedManagement` / `unifiedManagementRelease`|`.management`|`UNIFIED_MANAGEMENT_APP=true`(线长 · 组长 · 物料员)|
|`release`|—|开启混淆|

`TEST_ACTION_BYPASS_ENABLED` 在所有 debug 衍生变体为 true,在**全部三个 release 变体为
false —— 严禁在 release 启用。**

## Code Conventions & Common Patterns(代码约定与常用模式)

- **无 DI 框架。** 手动服务定位器:`MaterialLoaderApp.instance` 暴露各 Repository /
  `apiService`;`RetrofitClient` 为单例 object。Feature 代码用 Compose 默认参数
  `viewModel: XxxViewModel = viewModel()` 获取 ViewModel。
- **状态**:每个 ViewModel 一个 `data class XxxUiState`;`MutableStateFlow` +
  `asStateFlow()`;页面统一用普通 `collectAsState()`(全仓库从未使用
  `collectAsStateWithLifecycle` —— 不要零散引入)。
- **数据访问新旧并存(技术债,按局部惯例走):** 老功能经 `data/repository/*`
  (`suspend fun …(): Result<T>`,统一 `parseError`);较新的
  manager/receiving/pdaloading 代码直接用 `ApiService` + 原始 `JsonObject` +
  就地 `response.isSuccessful` 判断。
- **API 载荷**:snake_case JSON;请求体多为临时 `Map<String, Any?>`;
  仅 `data/api/dto/` 内有类型化 DTO(靠 ProGuard `-keep` 保留)。
- **扫码枪输入**:硬件扫码枪以按键形式进入
  `MainActivity.dispatchKeyEvent` → `MainActivity.scannerResultCallback`
  (由收货页挂接)。相机扫码优先复用
  `NativeQrScannerActivity` / `ui/components/BarcodeScanner`。
- **PDA 人体工学**:可点操作 ≥48dp、仅竖屏、处理中/错误状态可见、
  空数据/离线/无权限状态必须显式呈现。
- **文案**:管理端页面走 `res/values{,-zh,-vi}/strings.xml` + `manager_strings.xml`
  三语同步添加;操作端页面内联中文字面量 —— 与所在文件保持一致,不要批量抽取。
- **权限来源**:绝不以"页面能打开"推断能力;特权操作必须由 MES 下发的权限集允许。
  `EmployeeRightsCatalog` 只是本地形态/测试目录,不是生产权限来源。

## Important Files(重要文件)

- `unifiedpda/app/build.gradle.kts` —— 全部 8 个构建类型、端点、标志、依赖
- `unifiedpda/settings.gradle.kts`、`gradle.properties` —— 注意
  `android.overridePathCheck=true`(容忍非 ASCII 项目路径),不要删除
- `unifiedpda/app/src/main/AndroidManifest.xml` —— 权限、`.MainActivity`、
  `.alarm.ManagerAlarmService`(dataSync 前台服务)、`.alarm.BootReceiver`、扫码/相机 Activity
- `unifiedpda/app/src/main/java/com/smt/materialloader/MainActivity.kt` —— 扫码按键捕获、
  心跳、通知权限
- `…/ui/navigation/AppNavigation.kt` —— `Routes`、`canAccessRoute`、`unifiedStartRoute`、
  `visibleManagerModules`、`AppNavHost`(约 50 条 composable 路由)
- `…/data/api/{RetrofitClient,AuthInterceptor,EndpointFailoverInterceptor,ApiService}.kt`
- `…/ui/login/{EmployeeRights.kt,VirtualEmployee.kt}` —— 角色权限形态 + 测试身份
- `…/ui/login/RuntimeRights.kt` —— 当前会话有效权限 = 本地角色形态 + MES 下发 permissions/actions
- `…/ui/iqc/{IqcInspectionScreen,IqcViewModel}.kt` —— WMS 来料检验闭环(来料→检验单→缺陷→AQL 判定→刷新)
- `…/data/repository/AuthRepository.kt` —— 登录保存 expiresAt/roleDefinition;`restoreSession()` 启动时回读
- `…/app/proguard-rules.pro`、`unifiedpda/app/release-signing.properties`(本地文件,已 gitignore)

## Runtime/Tooling Preferences(运行时与工具链要求)

- JDK 17(`JAVA_HOME=C:\jdk17\jdk-17.0.19+10`)、Android SDK `C:\android-sdk`
  (经 `unifiedpda/local.properties` 配置,严禁提交)。
- Gradle wrapper 8.14.3、AGP 8.4.0、Kotlin 1.9.24、Compose BOM 2024.06.00、
  compileSdk/targetSdk 34、minSdk 26、Java/`jvmTarget` 17。
- 可选离线缓存:`-g .gradle-home` 复用 `unifiedpda/.gradle-home/` —— 已被
  `unifiedpda/.gitignore` 忽略,严禁提交。
- 无其他运行时:仓库内没有 Node/Python 工具链;构建、安装、冒烟验证一律走
  PowerShell + Gradle wrapper + adb。

## Testing & QA(测试与质量)

仅 JVM 单元测试 —— 没有 `androidTest/`、没有 mock(无 mockk/Mockito/Robolectric);
测试依赖只有 `junit:junit:4.13.2`。现有三个类只测试刻意**纯 JVM** 的生产代码
(不 import Android —— 保持该约定才可测):

- `…/ui/login/EmployeeRightsTest.java` —— 角色→权限目录,含未知角色回退
- `…/ui/login/VirtualEmployeeCatalogTest.java` —— 测试身份目录、管理/上料身份隔离
- `…/ui/components/MaterialLabelOcrParserTest.kt` —— 标签字段解析(中英、日期/数量边界)

测试命令 `.\gradlew.bat :app:testDebugUnitTest`;新增测试须同步更新此清单。
编译面变更必须在真机或 MuMu 模拟器上完成构建 + 安装/冒烟验证。

按 `ROLE_TASK_GRAPH.md`("Ralph loop stop rule"),变更完成须过全部门槛:
(1) 角色边界不被突破,(2) HR/MES API 同步 —— 只呈现权限、绝不覆盖,
(3) 48dp 操作,(4) 处理中/错误反馈可见,含失败/空/离线/无权限状态,
(5) 单元测试全绿 + `.\gradlew.bat :app:assembleUnifiedManagement` 构建成功。

### Repository hygiene(仓库卫生)

- 严禁提交 APK、JKS/密钥库、`release-signing.properties`、`local.properties`、
  构建产物、日志、截图、`.gradle-home/`。忽略层:根 `.gitignore` +
  `unifiedpda/.gitignore`(没有 app 级 `.gitignore`)。
- 根目录约 40 个 `*.apk` 与各 `*.png` 是历史构建证据,不是源码。
- `unifiedpda/app/release/ruijing-plant-manager-release.jks` 存在于本地 —— 保持不被
  跟踪,任何内容不得引用。
- git 仓库在 `master` 分支;首次提交 `c5a4665`(2026-11-21)已包含全部源码与文档;
  远端 `origin`(github.com/tianjinwuyong/rjvietnam)**尚未推送**。
- 除非任务明确关于 3D 仓库地图,保持 `godot-warehouse-map/` 与
  `unity-warehouse-map/` 原样不动。
