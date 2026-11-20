package com.smt.materialloader.ui.login

import com.smt.materialloader.util.PreferencesManager

/**
 * Effective rights for the signed-in session.
 *
 * The local catalog defines the capability shape used by quick-login and tests.
 * The MES-issued permission list and role-definition actions are merged over it,
 * so an MES grant is immediately usable and the PDA never has to guess a role's
 * authority from the screen being opened.
 */
object RuntimeRights {

    fun of(prefs: PreferencesManager): EmployeeRights {
        val user = prefs.getUser()
            ?: return EmployeeRights("", null, permissions = emptySet())
        val catalog = EmployeeRightsCatalog.forRole(
            user.roleKey,
            user.lineCode,
            user.seniority ?: "STANDARD"
        )
        val mesIssued = user.permissions + user.roleDefinition?.actions.orEmpty()
        return EmployeeRightsCatalog.withMesIssued(catalog, mesIssued)
    }

    fun can(prefs: PreferencesManager, permission: String): Boolean = of(prefs).allows(permission)
}
