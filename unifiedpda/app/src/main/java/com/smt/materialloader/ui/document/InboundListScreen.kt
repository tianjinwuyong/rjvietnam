package com.smt.materialloader.ui.document

import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.lifecycle.viewmodel.compose.viewModel

@Composable
fun InboundListScreen(
    onBack: () -> Unit = {},
    onNavigateToDetail: (Long) -> Unit = {},
    onNavigateToCreate: () -> Unit = {},
    vm: DocListViewModel = viewModel()
) {
    val state by vm.state.collectAsState()
    DocListScreen(
        title = "入库单",
        items = state.items,
        isLoading = state.isLoading,
        error = state.error,
        filterStatus = state.filterStatus,
        onFilterChange = { vm.setFilter(it) },
        onRefresh = { vm.load(DocType.INBOUND, state.filterStatus) },
        onAction = { id, verb -> vm.doAction(DocType.INBOUND, id, verb) },
        onDelete = { id -> vm.deleteDoc(DocType.INBOUND, id) },
        onItemClick = onNavigateToDetail,
        onCreateNew = onNavigateToCreate
    )
}
