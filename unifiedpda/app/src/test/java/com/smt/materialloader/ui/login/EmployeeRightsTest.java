package com.smt.materialloader.ui.login;

import org.junit.Test;

import java.util.Set;
import java.util.Arrays;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

public class EmployeeRightsTest {
    @Test
    public void everyRoleKeepsEmployeeBaseRights() {
        EmployeeRights rights = EmployeeRightsCatalog.INSTANCE.forRole("MATERIAL_LOADER", "L004");
        assertTrue(rights.allows("pda.view"));
        assertTrue(rights.allows("employee.self.view"));
        assertEquals("L004", rights.getLineCode());
    }

    @Test
    public void materialLoaderAddsOnlyMaterialExecutionRights() {
        EmployeeRights rights = EmployeeRightsCatalog.INSTANCE.forRole("MATERIAL_LOADER", "L004");
        assertTrue(rights.allows("smt.loading.view"));
        assertTrue(rights.allows("smt.loading.bind"));
        assertTrue(!rights.allows("approval.final.release"));
    }

    @Test
    public void groupLeaderAddsAcknowledgementRightsWithoutFinalRelease() {
        EmployeeRights rights = EmployeeRightsCatalog.INSTANCE.forRole("GROUP_LEADER", "L004");
        assertTrue(rights.allows("ng.pickup.ack"));
        assertTrue(rights.allows("manager.view"));
        assertTrue(!rights.allows("approval.final.release"));
    }

    @Test
    public void lineManagerInheritsGroupLeaderAndEmployeeRights() {
        EmployeeRights rights = EmployeeRightsCatalog.INSTANCE.forRole("LINE_MANAGER", "L004");
        assertTrue(rights.allows("employee.self.view"));
        assertTrue(rights.allows("ng.pickup.ack"));
        assertTrue(rights.allows("approval.request.review"));
        assertTrue(!rights.allows("approval.final.release"));
    }

    @Test
    public void plantManagerInheritsTheEntireEmployeeLeaderChain() {
        EmployeeRights rights = EmployeeRightsCatalog.INSTANCE.forRole("PLANT_MANAGER", null);
        assertTrue(rights.allows("employee.self.view"));
        assertTrue(rights.allows("ng.pickup.ack"));
        assertTrue(rights.allows("approval.request.review"));
        assertTrue(rights.allows("approval.final.release"));
    }

    @Test
    public void juniorPlantManagerCannotFinalRelease() {
        EmployeeRights rights = EmployeeRightsCatalog.INSTANCE.forRole("PLANT_MANAGER", null, "JUNIOR");
        assertTrue(rights.allows("manager.site.view"));
        assertTrue(rights.allows("approval.request.review"));
        assertTrue(!rights.allows("approval.final.release"));
    }

    @Test
    public void everyFactoryRoleInheritsEmployeeBaseRights() {
        for (String role : Arrays.asList(
                "MATERIAL_LOADER", "GROUP_LEADER", "LINE_MANAGER", "PLANT_MANAGER",
                "WAREHOUSE", "MATERIAL_FETCHER", "MES", "PMC", "IQC", "ENGINEERING", "PRODUCTION")) {
            EmployeeRights rights = EmployeeRightsCatalog.INSTANCE.forRole(role, "L004");
            assertTrue(role, rights.allows("pda.view"));
            assertTrue(role, rights.allows("employee.self.view"));
        }
    }

    @Test
    public void materialFetcherCanFetchWithoutWarehouseAdministrationRights() {
        EmployeeRights rights = EmployeeRightsCatalog.INSTANCE.forRole("MATERIAL_FETCHER", null);
        assertTrue(rights.allows("wms.fetch.view"));
        assertTrue(rights.allows("wms.fetch.execute"));
        assertTrue(!rights.allows("approval.final.release"));
    }

    @Test
    public void unknownRoleFallsBackToEmployeeBaseOnly() {
        Set<String> permissions = EmployeeRightsCatalog.INSTANCE.forRole("UNKNOWN", null).getPermissions();
        assertEquals(4, permissions.size());
        assertTrue(permissions.contains("pda.view"));
        assertTrue(permissions.contains("employee.self.view"));
        assertTrue(permissions.contains("employee.attendance.view"));
        assertTrue(permissions.contains("employee.leave.submit"));
    }

    @Test
    public void groupLeaderCanAcknowledgeAssignAndMessageButNotDecide() {
        EmployeeRights rights = EmployeeRightsCatalog.INSTANCE.forRole("GROUP_LEADER", "L004");
        assertTrue(rights.allows("ng.alert.ack"));
        assertTrue(rights.allows("manager.alert.assign"));
        assertTrue(rights.allows("manager.team.message"));
        assertTrue(rights.allows("manager.handover.confirm"));
        assertTrue(!rights.allows("manager.decision.review"));
        assertTrue(!rights.allows("approval.final.release"));
    }

    @Test
    public void lineManagerOwnsRecoveryAuditAssignmentAndHiring() {
        EmployeeRights rights = EmployeeRightsCatalog.INSTANCE.forRole("LINE_MANAGER_SMT", "L004");
        assertTrue(rights.allows("manager.target.recovery"));
        assertTrue(rights.allows("manager.audit.view"));
        assertTrue(rights.allows("manager.assignment.confirm"));
        assertTrue(rights.allows("manager.hiring.request"));
        assertTrue(rights.allows("manager.grievance.explain"));
        assertTrue(!rights.allows("plant.exception.authorize"));
    }

    @Test
    public void juniorPlantManagerCannotAuthorizeExceptionsOrApproveLoading() {
        EmployeeRights rights = EmployeeRightsCatalog.INSTANCE.forRole("PLANT_MANAGER", null, "JUNIOR");
        assertTrue(rights.allows("manager.team.view"));
        assertTrue(!rights.allows("plant.exception.authorize"));
        assertTrue(!rights.allows("plant.loading.approve"));
        assertTrue(!rights.allows("plant.authorization.close"));
    }

    @Test
    public void iqcPmcAndWarehouseRolesGetTheirExecutionRights() {
        EmployeeRights iqc = EmployeeRightsCatalog.INSTANCE.forRole("IQC", "L004");
        assertTrue(iqc.allows("iqc.result.submit"));
        assertTrue(iqc.allows("iqc.task.view"));
        assertTrue(!iqc.allows("plant.exception.authorize"));

        EmployeeRights pmc = EmployeeRightsCatalog.INSTANCE.forRole("PMC", null);
        assertTrue(pmc.allows("pmc.workorder.control"));
        assertTrue(pmc.allows("pmc.bom.view"));
        assertTrue(!pmc.allows("approval.final.release"));

        EmployeeRights warehouseManager = EmployeeRightsCatalog.INSTANCE.forRole("WAREHOUSE_MANAGER", null);
        assertTrue(warehouseManager.allows("wms.shortage.resolve"));
        assertTrue(!warehouseManager.allows("manager.decision.review"));
    }

    @Test
    public void adminAndManagementShareThePlantAuthorityShape() {
        for (String role : Arrays.asList("ADMIN", "MANAGEMENT")) {
            EmployeeRights rights = EmployeeRightsCatalog.INSTANCE.forRole(role, null);
            assertTrue(role, rights.allows("manager.audit.view"));
            assertTrue(role, rights.allows("plant.exception.authorize"));
            assertTrue(role, rights.allows("employee.self.view"));
        }
    }
}
