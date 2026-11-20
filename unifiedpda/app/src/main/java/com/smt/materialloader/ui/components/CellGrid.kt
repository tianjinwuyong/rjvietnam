package com.smt.materialloader.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.smt.materialloader.data.api.dto.CellStatus
import com.smt.materialloader.data.api.dto.ShelfCell

@Composable
fun CellGrid(
    cells: List<ShelfCell>,
    shelfCode: String,
    onCellPress: (ShelfCell) -> Unit,
    modifier: Modifier = Modifier
) {
    LazyVerticalGrid(
        columns = GridCells.Fixed(4),
        modifier = modifier.fillMaxWidth(),
        contentPadding = PaddingValues(4.dp),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalArrangement = Arrangement.spacedBy(6.dp)
    ) {
        items(cells) { cell ->
            CellItem(cell = cell, onClick = { onCellPress(cell) })
        }
    }
}

@Composable
private fun CellItem(
    cell: ShelfCell,
    onClick: () -> Unit
) {
    val bgColor = when (cell.cellStatus) {
        CellStatus.OCCUPIED -> Color(0xFF064e3b)
        CellStatus.EMPTY -> Color(0xFF1e293b)
        CellStatus.RESERVED -> Color(0xFF78350f)
        CellStatus.FAULT -> Color(0xFF450a0a)
    }

    val borderColor = when (cell.cellStatus) {
        CellStatus.OCCUPIED -> Color(0xFF22c55e)
        CellStatus.EMPTY -> Color(0xFF334155)
        CellStatus.RESERVED -> Color(0xFFfbbf24)
        CellStatus.FAULT -> Color(0xFFef4444)
    }

    Column(
        modifier = Modifier
            .aspectRatio(1f)
            .clip(RoundedCornerShape(8.dp))
            .background(bgColor)
            .clickable(onClick = onClick)
            .padding(4.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Text(
            text = cell.cellNumber,
            color = Color(0xFFf1f5f9),
            fontSize = 16.sp,
            fontWeight = FontWeight.Bold,
            textAlign = TextAlign.Center
        )
        if (cell.cellStatus == CellStatus.OCCUPIED && cell.materialCode != null) {
            Text(
                text = cell.materialCode.take(6),
                color = Color(0xFF94a3b8),
                fontSize = 9.sp,
                textAlign = TextAlign.Center,
                maxLines = 1
            )
        }
    }
}