package com.smt.materialloader.ui.login

/** Test-only employee identities for MuMu/local smoke tests. */
data class VirtualEmployee(
    val username: String,
    val label: String,
    val role: String,
    val roleKey: String = "LINE_MANAGER",
    val lineCode: String? = "L001",
    val password: String = "Factory@123",
    val seniority: String = "STANDARD"
)

/** Compatibility name retained for the existing quick-login UI. */
typealias DemoAccount = VirtualEmployee

object VirtualEmployeeCatalog {
    val standard = listOf(
        VirtualEmployee("EMPLOYEE_VN001", "Virtual employee · Self service", "Employee", "EMPLOYEE"),
        VirtualEmployee("VN_OP_001", "SMT PDA operator · Remote MES", "SMT Loader", "SMT_LOADER", "L001"),
        VirtualEmployee("VN_MATERIAL_RECEIVER", "Material receiver · Remote WMS", "Material Loader", "MATERIAL_LOADER", "L004"),
        VirtualEmployee("VN_WH_001", "Warehouse 01 · Remote WMS", "Warehouse Material", "WAREHOUSE"),
        VirtualEmployee("VN_WC_001", "集料员 · Remote WMS", "集料员", "MATERIAL_COLLECTOR"),
        VirtualEmployee("VN_WC_002", "集料员 02 · Remote WMS", "集料员", "MATERIAL_COLLECTOR"),
        VirtualEmployee("VN_WC_003", "集料员 03 · Remote WMS", "集料员", "MATERIAL_COLLECTOR"),
        VirtualEmployee("VN_WC_004", "集料员 04 · Remote WMS", "集料员", "MATERIAL_COLLECTOR"),
        VirtualEmployee("VN_PK_SMT", "SMT领料员 · Remote WMS", "SMT领料员", "MATERIAL_PICKER_SMT"),
        VirtualEmployee("VN_PK_AUTO", "自动线领料员 · Remote WMS", "自动线领料员", "MATERIAL_PICKER_AUTO"),
        VirtualEmployee("VN_PK_MAN", "手动线领料员 · Remote WMS", "手动线领料员", "MATERIAL_PICKER_MAN"),
        VirtualEmployee("VN_PK_PKG", "包装领料员 · Remote WMS", "包装领料员", "MATERIAL_PICKER_PACKAGING"),
        VirtualEmployee("VN_PK_ALL", "全段领料员 · Remote WMS", "全段领料员", "MATERIAL_PICKER"),
        VirtualEmployee("VN_WM_001", "仓库主管 · Remote WMS", "仓库主管", "WAREHOUSE_MANAGER"),
        VirtualEmployee("VN_WC_SMT", "SMT领料员 · Remote WMS", "SMT领料员", "MATERIAL_COLLECTOR_SMT", "L001"),
        VirtualEmployee("VN_WC_AUTO", "自动线领料员 · Remote WMS", "自动线领料员", "MATERIAL_COLLECTOR_AUTO", "L002"),
        VirtualEmployee("VN_WC_MAN", "手动线领料员 · Remote WMS", "手动线领料员", "MATERIAL_COLLECTOR_MAN", "L004"),
        VirtualEmployee("PMC_CN_01", "PMC · Remote", "PMC", "PMC"),
        VirtualEmployee("QC_VN_01", "IQC · Remote", "IQC", "IQC"),
        VirtualEmployee("ENGINEERING_TEST", "Virtual employee · Engineering", "Engineering", "ENGINEERING"),
        VirtualEmployee("VN_LM_SMT", "SMT线长", "SMT Line Manager", "LINE_MANAGER_SMT", "L001", seniority = "SENIOR"),
        VirtualEmployee("VN_LM_AUTO", "自动线线长", "Auto Line Manager", "LINE_MANAGER_AUTO", "L002", seniority = "SENIOR"),
        VirtualEmployee("VN_LM_MAN", "手动线线长", "Manual Line Manager", "LINE_MANAGER_MANUAL", "L004", seniority = "SENIOR")
    )

    val seniorManagers = listOf(
        VirtualEmployee("MO_LI_BIN", "莫立斌 · 高级厂长", "Mo Libin · Senior Factory Manager", "PLANT_MANAGER", seniority = "SENIOR"),
        VirtualEmployee("MENG_YING", "蒙营 · 厂长", "Meng Ying · Plant Manager", "PLANT_MANAGER", seniority = "JUNIOR")
    )

    val plantManager: List<VirtualEmployee> = listOf(
        // Real senior managers are listed in seniorManagers (MO_LI_BIN / MENG_YING).
    )
}
