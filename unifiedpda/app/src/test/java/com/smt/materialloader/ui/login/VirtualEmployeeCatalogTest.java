package com.smt.materialloader.ui.login;

import org.junit.Test;

import java.util.HashSet;
import java.util.List;
import java.util.Set;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

public class VirtualEmployeeCatalogTest {
    @Test
    public void standardCatalogHasDistinctTestIdentitiesAndLineRoles() {
        List<VirtualEmployee> accounts = VirtualEmployeeCatalog.INSTANCE.getStandard();
        Set<String> usernames = new HashSet<>();
        for (VirtualEmployee account : accounts) {
            usernames.add(account.getUsername());
            assertTrue(account.getUsername(), !account.getLabel().isBlank());
        }
        assertEquals(accounts.size(), usernames.size());
        assertTrue(accounts.stream().anyMatch(a -> "SMT_LOADER".equals(a.getRoleKey()) && "L001".equals(a.getLineCode())));
        assertTrue(accounts.stream().anyMatch(a -> "MATERIAL_LOADER".equals(a.getRoleKey())));
        assertTrue(accounts.stream().anyMatch(a -> "LINE_MANAGER_MANUAL".equals(a.getRoleKey()) && "L004".equals(a.getLineCode())));
        assertTrue(accounts.stream().anyMatch(a -> "LINE_MANAGER_AUTO".equals(a.getRoleKey()) && "L002".equals(a.getLineCode())));
        assertTrue(accounts.stream().anyMatch(a -> "LINE_MANAGER_SMT".equals(a.getRoleKey()) && "L001".equals(a.getLineCode())));
    }

    @Test
    public void plantManagerCatalogIsSeparateFromOperationalLoaders() {
        // The plant-manager quick-login surface is seniorManagers; the operational
        // plantManager slot stays empty so loader builds never list managers.
        assertTrue(VirtualEmployeeCatalog.INSTANCE.getPlantManager().isEmpty());
        List<VirtualEmployee> managers = VirtualEmployeeCatalog.INSTANCE.getSeniorManagers();
        assertEquals(2, managers.size());
        assertTrue(managers.stream().anyMatch(a -> "MO_LI_BIN".equals(a.getUsername())
                && "PLANT_MANAGER".equals(a.getRoleKey())
                && "SENIOR".equals(a.getSeniority())));
        assertTrue(managers.stream().anyMatch(a -> "MENG_YING".equals(a.getUsername())
                && "PLANT_MANAGER".equals(a.getRoleKey())
                && "JUNIOR".equals(a.getSeniority())));
        assertTrue(managers.stream().noneMatch(a -> a.getRoleKey().contains("LOADER")));
        Set<String> standardUsernames = new HashSet<>();
        for (VirtualEmployee account : VirtualEmployeeCatalog.INSTANCE.getStandard()) {
            standardUsernames.add(account.getUsername());
        }
        assertTrue(managers.stream().noneMatch(a -> standardUsernames.contains(a.getUsername())));
    }
}
