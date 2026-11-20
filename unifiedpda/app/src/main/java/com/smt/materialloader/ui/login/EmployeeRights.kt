package com.smt.materialloader.ui.login

/**
 * Effective rights for one employee session. MES remains the authority for
 * production users; this resolver only defines the shared PDA capability shape
 * used by the local test catalog and the UI capability checks.
 */
data class EmployeeRights(
    val roleKey: String,
    val lineCode: String?,
    val seniority: String = "STANDARD",
    val permissions: Set<String>
) {
    fun allows(permission: String): Boolean = permission in permissions
}

object EmployeeRightsCatalog {
    /**
     * Minimum capabilities every authenticated factory employee keeps, independent
     * of operational role. MES may add capabilities but never removes these.
     */
    val employeeBase: Set<String> = setOf(
        "pda.view",
        "employee.self.view",
        "employee.attendance.view",
        "employee.leave.submit"
    )

    private val rolePermissions: Map<String, Set<String>> = mapOf(
        "MATERIAL_LOADER" to setOf("smt.loading.view", "smt.loading.bind"),
        "MANUAL_LINE_LOADER" to setOf("smt.loading.view", "smt.loading.bind"),
        "AUTO_LINE_LOADER" to setOf("smt.loading.view", "smt.loading.bind"),
        "SMT_LOADER" to setOf("smt.loading.view", "smt.loading.bind"),
        "SMT_OPERATOR" to setOf("smt.loading.view", "smt.loading.bind"),
        "MATERIAL_OPERATOR" to setOf("smt.loading.view", "smt.loading.bind"),
        "GROUP_LEADER" to setOf(
            "manager.view",
            "ng.pickup.ack",
            "ng.alert.ack",
            "repair.handover.ack",
            "manager.alert.assign",
            "manager.team.message",
            "manager.handover.confirm",
            "pda.loading.monitor"
        ),
        "LINE_MANAGER" to setOf(
            "manager.view",
            "manager.team.view",
            "ng.pickup.ack",
            "ng.alert.ack",
            "repair.handover.ack",
            "approval.request.review",
            "manager.alert.assign",
            "manager.decision.review",
            "manager.team.message",
            "manager.target.recovery",
            "manager.handover.confirm",
            "manager.assignment.confirm",
            "manager.hiring.request",
            "manager.grievance.explain",
            "manager.audit.view",
            "manager.communicate.broadcast"
        ),
        "PLANT_MANAGER" to setOf(
            "manager.view",
            "manager.team.view",
            "manager.site.view",
            "approval.request.review"
        ),
        "WAREHOUSE" to setOf(
            "wms.view",
            "wms.transaction",
            "wms.receiving.execute",
            "wms.shelf.move",
            "wms.count.execute",
            "wms.document.edit"
        ),
        "MATERIAL_FETCHER" to setOf("wms.view", "wms.fetch.view", "wms.fetch.execute", "wms.shelf.out"),
        "WAREHOUSE_MANAGER" to setOf(
            "wms.view",
            "wms.execute",
            "wms.shortage.resolve",
            "wms.stock.view"
        ),
        "MATERIAL_COLLECTOR" to setOf("wms.view", "wms.collect.view", "wms.collect.execute", "wms.issue", "wms.pick.claim"),
        "MATERIAL_COLLECTOR_SMT" to setOf("wms.view", "wms.collect.view", "wms.collect.execute", "wms.issue", "wms.pick.claim"),
        "MATERIAL_COLLECTOR_AUTO" to setOf("wms.view", "wms.collect.view", "wms.collect.execute", "wms.issue", "wms.pick.claim"),
        "MATERIAL_COLLECTOR_MAN" to setOf("wms.view", "wms.collect.view", "wms.collect.execute", "wms.issue", "wms.pick.claim"),
        "MATERIAL_PICKER_SMT" to setOf("wms.view", "wms.collect.view", "wms.collect.execute", "wms.issue", "wms.pick.claim"),
        "MATERIAL_PICKER_AUTO" to setOf("wms.view", "wms.collect.view", "wms.collect.execute", "wms.issue", "wms.pick.claim"),
        "MATERIAL_PICKER_MAN" to setOf("wms.view", "wms.collect.view", "wms.collect.execute", "wms.issue", "wms.pick.claim"),
        "MATERIAL_PICKER_PACKAGING" to setOf("wms.view", "wms.collect.view", "wms.collect.execute", "wms.issue", "wms.pick.claim"),
        "MATERIAL_PICKER" to setOf("wms.view", "wms.collect.view", "wms.collect.execute", "wms.issue", "wms.pick.claim"),
        "MES" to setOf("manager.view", "approval.view", "mes.decision.review", "mes.workorder.view"),
        "PMC" to setOf(
            "manager.view",
            "approval.view",
            "pmc.workorder.view",
            "pmc.workorder.control",
            "pmc.bom.view"
        ),
        "IQC" to setOf(
            "manager.view",
            "approval.view",
            "iqc.task.view",
            "iqc.result.submit",
            "iqc.disposition"
        ),
        "ENGINEERING" to setOf("manager.view", "approval.view", "engineer.line.view", "engineer.repair.route"),
        "PRODUCTION" to setOf("manager.view", "approval.view", "production.line.view", "production.target.view"),
        "ADMIN" to setOf(
            "manager.view", "manager.team.view", "manager.site.view",
            "manager.alert.assign", "manager.decision.review", "manager.team.message",
            "manager.target.recovery", "manager.handover.confirm", "manager.assignment.confirm",
            "manager.hiring.request", "manager.grievance.explain", "manager.audit.view",
            "manager.communicate.broadcast", "plant.exception.authorize",
            "plant.loading.approve", "plant.authorization.close", "wms.view", "pmc.workorder.view"
        ),
        "MANAGEMENT" to setOf(
            "manager.view", "manager.team.view", "manager.site.view",
            "manager.alert.assign", "manager.decision.review", "manager.team.message",
            "manager.target.recovery", "manager.handover.confirm", "manager.assignment.confirm",
            "manager.hiring.request", "manager.grievance.explain", "manager.audit.view",
            "manager.communicate.broadcast", "plant.exception.authorize",
            "plant.loading.approve", "plant.authorization.close", "wms.view", "pmc.workorder.view"
        )
    )

    /** Role inheritance keeps the domain model explicit and prevents permission drift. */
    private val roleParents: Map<String, List<String>> = mapOf(
        "MATERIAL_LOADER" to listOf("EMPLOYEE"),
        "MANUAL_LINE_LOADER" to listOf("MATERIAL_LOADER"),
        "AUTO_LINE_LOADER" to listOf("MATERIAL_LOADER"),
        "SMT_LOADER" to listOf("MATERIAL_LOADER"),
        "SMT_OPERATOR" to listOf("MATERIAL_LOADER"),
        "MATERIAL_OPERATOR" to listOf("MATERIAL_LOADER"),
        "GROUP_LEADER" to listOf("EMPLOYEE"),
        "LINE_MANAGER" to listOf("GROUP_LEADER"),
        "LINE_MANAGER_SMT" to listOf("LINE_MANAGER"),
        "LINE_MANAGER_AUTO" to listOf("LINE_MANAGER"),
        "LINE_MANAGER_MANUAL" to listOf("LINE_MANAGER"),
        "PLANT_MANAGER" to listOf("LINE_MANAGER"),
        "WAREHOUSE" to listOf("EMPLOYEE"),
        "MATERIAL_FETCHER" to listOf("EMPLOYEE"),
        "WAREHOUSE_MANAGER" to listOf("EMPLOYEE"),
        "MATERIAL_COLLECTOR" to listOf("EMPLOYEE"),
        "MATERIAL_COLLECTOR_SMT" to listOf("MATERIAL_COLLECTOR"),
        "MATERIAL_COLLECTOR_AUTO" to listOf("MATERIAL_COLLECTOR"),
        "MATERIAL_COLLECTOR_MAN" to listOf("MATERIAL_COLLECTOR"),
        "MES" to listOf("EMPLOYEE"),
        "PMC" to listOf("EMPLOYEE"),
        "IQC" to listOf("EMPLOYEE"),
        "ENGINEERING" to listOf("EMPLOYEE"),
        "PRODUCTION" to listOf("EMPLOYEE"),
        "ADMIN" to listOf("EMPLOYEE"),
        "MANAGEMENT" to listOf("EMPLOYEE")
    )

    /** Seniority-conditional authority; never inferred from a display name. */
    private val seniorOnly: Map<String, Set<String>> = mapOf(
        "PLANT_MANAGER" to setOf(
            "approval.final.release",
            "plant.exception.authorize",
            "plant.loading.approve",
            "plant.authorization.close"
        )
    )

    @JvmOverloads
    fun forRole(roleKey: String, lineCode: String?, seniority: String = "SENIOR"): EmployeeRights {
        val normalizedRole = roleKey.trim().uppercase()
        val normalizedSeniority = seniority.trim().uppercase().ifBlank { "STANDARD" }
        return EmployeeRights(
            roleKey = normalizedRole,
            lineCode = lineCode?.trim()?.uppercase()?.takeIf { it.isNotBlank() },
            seniority = normalizedSeniority,
            permissions = permissionsFor(normalizedRole, normalizedSeniority)
        )
    }

    /** Merge the MES-issued capability list over the local shape catalog. */
    fun withMesIssued(rights: EmployeeRights, mesActions: Collection<String>): EmployeeRights {
        val issued = mesActions.mapNotNull { it.trim().takeIf(String::isNotEmpty) }.toSet()
        if (issued.isEmpty()) return rights
        return rights.copy(permissions = rights.permissions + employeeBase + issued)
    }

    private fun permissionsFor(roleKey: String, seniority: String = "SENIOR", visiting: Set<String> = emptySet()): Set<String> {
        if (roleKey in visiting) return emptySet()
        val parents = roleParents[roleKey].orEmpty()
        val seniorGrant = if (seniority != "JUNIOR") seniorOnly[roleKey].orEmpty() else emptySet()
        return rolePermissions[roleKey].orEmpty() + seniorGrant + parents.flatMap {
            permissionsFor(it, seniority, visiting + roleKey)
        }.toSet() + employeeBase
    }
}
