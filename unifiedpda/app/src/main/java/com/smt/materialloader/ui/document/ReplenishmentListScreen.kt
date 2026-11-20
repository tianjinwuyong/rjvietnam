package com.smt.materialloader.ui.document

import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.lifecycle.viewmodel.compose.viewModel

@Composable
fun ReplenishmentListScreen(
    onBack: () -> Unit = {},
    onNavigateToDetail: (Long) -> Unit = {},
    onNavigateToCreate: () -> Unit = {},
    vm: DocListViewModel = viewModel()
) {
    val state by vm.state.collectAsState()
    DocListScreen(
        title = "补料单",
        items = state.items,
        isLoading = state.isLoading,
        error = state.error,
        filterStatus = state.filterStatus,
        onFilterChange = { vm.setFilter(it) },
        onRefresh = { vm.load(DocType.REPLENISHMENT, state.filterStatus) },
        onAction = { id, verb -> vm.doAction(DocType.REPLENISHMENT, id, verb) },
        onDelete = { id -> vm.deleteDoc(DocType.REPLENISHMENT, id) },
        onItemClick = onNavigateToDetail,
        onCreateNew = onNavigateToCreate
    )
}
