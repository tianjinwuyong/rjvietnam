package com.smt.materialloader.ui.pdaloading

internal object PdaLoadingStrings {
    private val text = mapOf(
        "materialList" to listOf("BOM物料清单", "BOM materials", "Danh sách vật liệu BOM"),
        "bound" to listOf("已完成", "Completed", "Đã hoàn thành"),
        "waiting" to listOf("待上料", "Pending", "Chờ nạp"),
        "qtyPer" to listOf("单台用量", "Qty/unit", "SL/đơn vị"),
        "requiredQty" to listOf("工单需求量", "WO required", "SL lệnh SX"),
        "availableQty" to listOf("仓库可用余量", "Available stock", "Tồn kho khả dụng"),
        "projectedQty" to listOf("上料后预计余量", "Projected balance", "Tồn dự kiến sau nạp"),
        "safetyStock" to listOf("安全库存", "Safety stock", "Tồn kho an toàn"),
        "supplySafe" to listOf("供料安全", "Supply safe", "Cấp liệu an toàn"),
        "supplyShortage" to listOf("供料不足", "Supply shortage", "Thiếu vật liệu"),
        "title" to listOf("统一应用", "Unified Application", "Ứng dụng hợp nhất"),
        "workOrders" to listOf("MES工单", "MES work orders", "Lệnh sản xuất MES"),
        "refresh" to listOf("刷新", "Refresh", "Làm mới"),
        "waitingWo" to listOf("等待 MES 下发工单…", "Waiting for MES work order…", "Đang chờ MES phát lệnh sản xuất…"),
        "pcbSn" to listOf("扫描 PCB SN（来自 SPI）", "Scan PCB SN from SPI", "Quét PCB SN từ SPI"),
        "pcbSnHelp" to listOf(
            "可选扫描；SPI 结果仅在 MES 后台标记，不影响 PDA 上料",
            "Optional scan; SPI status is marked in MES without affecting PDA loading",
            "Quét tùy chọn; trạng thái SPI chỉ được đánh dấu trong MES, không ảnh hưởng nạp PDA"
        ),
        "testBypass" to listOf("⚠ 测试专用：旁路全部质量门和线长放行", "⚠ TEST ONLY: bypass all quality gates and leader release", "⚠ CHỈ THỬ NGHIỆM: bỏ qua mọi cổng chất lượng và phê duyệt"),
        "bypassAction" to listOf("测试：旁路当前动作", "TEST: bypass current action", "THỬ NGHIỆM: bỏ qua bước hiện tại"),
        "bypassActionHelp" to listOf("测试直通：不审批、不审计，仅保留绑定记录", "Test pass-through: no approval or audit; keep binding records only", "Chế độ thử nghiệm: không phê duyệt, không nhật ký; chỉ lưu liên kết"),
        "bypassMachine" to listOf("旁路机器", "Bypass machine", "Bỏ qua máy"),
        "bypassSlot" to listOf("旁路槽位", "Bypass slot", "Bỏ qua vị trí"),
        "bypassFeeder" to listOf("旁路 Feeder", "Bypass feeder", "Bỏ qua feeder"),
        "bypassReel" to listOf("旁路料盘", "Bypass reel", "Bỏ qua cuộn liệu"),
        "bypassConfirm" to listOf("旁路确认绑定", "Bypass binding confirmation", "Bỏ qua xác nhận liên kết"),
        "bypassRelease" to listOf("旁路线长放行", "Bypass leader release", "Bỏ qua phê duyệt tổ trưởng"),
        "materialBypass" to listOf("测试旁路物料SN及全部审批", "TEST: bypass material SN and all approvals", "THỬ NGHIỆM: bỏ qua SN vật liệu và mọi phê duyệt"),
        "materialBypassOn" to listOf("✓ 已旁路：立即绑定，MES仅备案", "✓ Bypassed: bind immediately, MES records only", "✓ Đã bỏ qua: liên kết ngay, MES chỉ lưu hồ sơ"),
        "pcbBypass" to listOf("临时绕过 PCB SN 绑定", "Temporarily bypass PCB SN binding", "Tạm bỏ qua liên kết PCB SN"),
        "start" to listOf("开始上料", "Start loading", "Bắt đầu nạp liệu"),
        "qualityGates" to listOf("MES/PDA 六项自动审计", "MES/PDA six automatic audits", "Sáu kiểm tra tự động MES/PDA"),
        "scanner" to listOf("扫码枪输入", "Scanner input", "Dữ liệu máy quét"),
        "submitScan" to listOf("提交扫码", "Submit scan", "Gửi mã quét"),
        "back" to listOf("← 返回上一步", "← Back to previous step", "← Quay lại bước trước"),
        "loadingHome" to listOf("返回上料首页", "Loading Home", "Về trang nạp liệu"),
        "simulateCurrentScan" to listOf("模拟当前扫码", "Simulate current scan", "Mô phỏng quét hiện tại"),
        "confirmBinding" to listOf("确认绑定", "Confirm binding", "Xác nhận liên kết"),
        "boundSlots" to listOf("已绑定槽位", "Bound slots", "Vị trí đã liên kết"),
        "leaderBadge" to listOf("扫描线长工号", "Scan line-leader badge", "Quét mã tổ trưởng"),
        "release" to listOf("线长确认放行", "Line-leader release", "Tổ trưởng xác nhận cho phép"),
        "pcbBypassTitle" to listOf("PCB SN 绕过授权", "PCB SN bypass authorization", "Ủy quyền bỏ qua PCB SN"),
        "pcbBypassHelp" to listOf("仅限 SPI 扫码异常，操作将记录到 MES 审计。", "Only for SPI scan exceptions. MES will audit this action.", "Chỉ dùng khi quét SPI lỗi. MES sẽ ghi nhật ký thao tác."),
        "reason" to listOf("原因", "Reason", "Lý do"),
        "confirmBypass" to listOf("确认绕过", "Confirm bypass", "Xác nhận bỏ qua"),
        "cancel" to listOf("取消", "Cancel", "Hủy"),
        "testTitle" to listOf("⚠ 测试旁路模式", "⚠ Test bypass mode", "⚠ Chế độ bỏ qua thử nghiệm"),
        "testHelp" to listOf(
            "仅允许测试工单 26071019999。将旁路 BOM、槽位、Feeder、IQC、批次、数量、过期、MSD及放行检查，并写入 MES 审计。",
            "Allowed only for test WO 26071019999. Bypasses BOM, slot, feeder, IQC, lot, quantity, expiry, MSD and release checks; MES audit is mandatory.",
            "Chỉ áp dụng cho LSX thử nghiệm 26071019999. Bỏ qua kiểm tra BOM, vị trí, feeder, IQC, lô, số lượng, hạn dùng, MSD và phê duyệt; MES bắt buộc ghi nhật ký."
        ),
        "testReason" to listOf("测试原因", "Test reason", "Lý do thử nghiệm"),
        "authorizer" to listOf("线长/经理工号", "Leader/manager badge", "Mã tổ trưởng/quản lý"),
        "confirmTest" to listOf("确认进入测试旁路", "Enable test bypass", "Bật bỏ qua thử nghiệm"),
        "alarm" to listOf("报警", "Alarm", "Cảnh báo"),
        "clearAlarm" to listOf("解除报警", "Clear alarm", "Xóa cảnh báo"),
        "workOrder" to listOf("工单", "Work order", "Lệnh sản xuất"),
        "machine" to listOf("机位", "Machine", "Máy"),
        "pendingScan" to listOf("待扫码", "Pending scan", "Chờ quét"),
        "offlinePending" to listOf("离线待补传", "Offline pending upload", "Chờ tải lên ngoại tuyến"),
        "records30" to listOf("条 · 最长允许30分钟", "records · maximum 30 minutes", "bản ghi · tối đa 30 phút"),
        "offlineUntil" to listOf("离线授权截止", "Offline authorization until", "Ủy quyền ngoại tuyến đến"),
        "slot" to listOf("槽位", "Slot", "Vị trí"),
        "feeder" to listOf("飞达", "Feeder", "Feeder"),
        "materialSn" to listOf("物料SN", "Material SN", "SN vật liệu"),
        "material" to listOf("物料", "Material", "Vật liệu"),
        "lot" to listOf("批次", "Lot", "Lô"),
    )

    private val workflowText = mapOf(
        "bindingSuccessTitle" to listOf("绑定成功", "Binding successful", "Liên kết thành công"),
        "bindingSuccessNext" to listOf("物料已绑定，请继续扫描下一种物料。", "Material bound. Continue scanning the next material.", "Đã liên kết vật liệu. Tiếp tục quét vật liệu tiếp theo."),
        "bindingSuccessAll" to listOf("所有物料已绑定，请扫描线长工号完成工单。", "All materials are bound. Scan the line-leader badge to finish the work order.", "Đã liên kết tất cả vật liệu. Quét mã tổ trưởng để hoàn thành lệnh."),
        "bindingProgress" to listOf("绑定进度", "Binding progress", "Tiến độ liên kết"),
        "nextMaterial" to listOf("下一种物料", "Next material", "Vật liệu tiếp theo"),
        "continueToRelease" to listOf("进入工单完成", "Continue to completion", "Tiếp tục hoàn thành lệnh"),
        "woCompletedTitle" to listOf("工单已完成", "Work order completed", "Lệnh sản xuất đã hoàn thành"),
        "woCompletedMessage" to listOf("工单已完成并解除锁定，可以开始下一张工单。", "The work order is completed and unlocked. You can start the next work order.", "Lệnh đã hoàn thành và mở khóa. Có thể bắt đầu lệnh tiếp theo."),
        "startNextWo" to listOf("开始下一张工单", "Start next work order", "Bắt đầu lệnh tiếp theo")
    )

    fun get(language: String, key: String): String {
        val index = when (language) { "en" -> 1; "vi" -> 2; else -> 0 }
        return (text[key] ?: workflowText[key])?.get(index) ?: key
    }

    fun message(language: String, value: String): String {
        val translations = mapOf(
            "请扫机位码" to listOf("请扫机位码", "Scan the machine code", "Quét mã máy"),
            "请扫物料卷码" to listOf("请扫物料卷码", "Scan the material roll", "Quét mã cuộn vật liệu"),
            "请扫槽号" to listOf("请扫槽号", "Scan the slot", "Quét vị trí"),
            "请扫飞达号" to listOf("请扫飞达号", "Scan the feeder", "Quét feeder"),
            "请扫物料盘码" to listOf("请扫物料盘码", "Scan the material reel", "Quét cuộn vật liệu"),
            "物料SN已读取，请核对并确认绑定 / Material SN accepted" to listOf(
                "物料SN已读取，请核对并确认绑定",
                "Material SN accepted. Review and confirm binding",
                "Đã nhận SN vật liệu. Kiểm tra và xác nhận liên kết"
            ),
            "MES六项质量门通过；请扫下一个槽号" to listOf(
                "MES六项质量门通过；请扫下一个槽号",
                "MES quality gates passed; scan the next slot",
                "Đã đạt các cổng chất lượng MES; quét vị trí tiếp theo"
            ),
            "工单已放行" to listOf("工单已放行", "Work order released", "Lệnh sản xuất đã được cho phép"),
            "等待MES下发工单" to listOf("等待MES下发工单", "Waiting for MES work order", "Đang chờ lệnh sản xuất MES"),
            "请选择MES工单" to listOf("请选择MES工单", "Select a MES work order", "Chọn lệnh sản xuất MES"),
            "⚠ 测试旁路模式：所有操作将写入MES审计" to listOf(
                "⚠ 测试旁路模式：所有操作将写入MES审计",
                "⚠ Test bypass mode: every action is written to the MES audit",
                "⚠ Chế độ bỏ qua thử nghiệm: mọi thao tác được ghi vào nhật ký MES"
            ),
            "MES离线，无法接收工单" to listOf(
                "MES离线，无法接收工单",
                "MES is offline; work orders cannot be received",
                "MES ngoại tuyến; không thể nhận lệnh sản xuất"
            ),
            "当前步骤不接受扫码 / Scan is not accepted at this step" to listOf(
                "当前步骤不接受扫码",
                "Scan is not accepted at this step",
                "Bước hiện tại không chấp nhận quét mã"
            ),
            "工单不能为空 / Work order is required" to listOf(
                "工单不能为空",
                "Work order is required",
                "Bắt buộc chọn lệnh sản xuất"
            )
        )
        val index = when (language) { "en" -> 1; "vi" -> 2; else -> 0 }
        return translations[value]?.get(index) ?: value
    }

    fun step(language: String, step: LoadingStep): String {
        val values = when (step) {
            LoadingStep.MATERIAL -> listOf("① 扫描物料卷", "① Scan material roll", "① Quét cuộn vật liệu")
            LoadingStep.MACHINE -> listOf("② 扫描机位", "② Scan machine", "② Quét máy")
            LoadingStep.SLOT -> listOf("③ 扫描槽位", "③ Scan slot", "③ Quét vị trí")
            LoadingStep.FEEDER -> listOf("④ 扫描飞达", "④ Scan feeder", "④ Quét feeder")
            LoadingStep.REEL -> listOf("⑤ 扫描料盘", "⑤ Scan reel", "⑤ Quét cuộn vật liệu")
            LoadingStep.CONFIRM -> listOf("⑥ 确认上料", "⑥ Confirm loading", "⑥ Xác nhận nạp liệu")
            LoadingStep.RELEASED -> listOf("✓ 已放行", "✓ Released", "✓ Đã cho phép")
            else -> listOf("准备", "Ready", "Sẵn sàng")
        }
        return values[when (language) { "en" -> 1; "vi" -> 2; else -> 0 }]
    }
}
