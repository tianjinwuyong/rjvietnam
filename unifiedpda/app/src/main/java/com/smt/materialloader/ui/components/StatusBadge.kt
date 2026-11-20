package com.smt.materialloader.ui.components

import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

enum class BadgeTone { OK, INFO, WARNING, DANGER }

@Composable
fun StatusBadge(
    label: String,
    tone: BadgeTone,
    compact: Boolean = false,
    modifier: Modifier = Modifier
) {
    val bgColor = when (tone) {
        BadgeTone.OK -> Color(0xFF064e3b)
        BadgeTone.INFO -> Color(0xFF1e3a5f)
        BadgeTone.WARNING -> Color(0xFF78350f)
        BadgeTone.DANGER -> Color(0xFF450a0a)
    }
    val textColor = when (tone) {
        BadgeTone.OK -> Color(0xFF34d399)
        BadgeTone.INFO -> Color(0xFF60a5fa)
        BadgeTone.WARNING -> Color(0xFFfbbf24)
        BadgeTone.DANGER -> Color(0xFFfca5a5)
    }
    Surface(
        color = bgColor,
        shape = MaterialTheme.shapes.small,
        modifier = modifier
    ) {
        Text(
            text = label,
            color = textColor,
            fontSize = if (compact) 11.sp else 13.sp,
            fontWeight = FontWeight.SemiBold,
            modifier = Modifier.padding(horizontal = if (compact) 6.dp else 8.dp, vertical = if (compact) 2.dp else 4.dp)
        )
    }
}

fun connectionStatusToTone(status: com.smt.materialloader.data.api.dto.ShelfConnectionStatus): BadgeTone {
    return when (status) {
        com.smt.materialloader.data.api.dto.ShelfConnectionStatus.ONLINE -> BadgeTone.OK
        com.smt.materialloader.data.api.dto.ShelfConnectionStatus.OFFLINE -> BadgeTone.WARNING
        com.smt.materialloader.data.api.dto.ShelfConnectionStatus.FAULT -> BadgeTone.DANGER
    }
}

fun cellStatusToTone(status: com.smt.materialloader.data.api.dto.CellStatus): BadgeTone {
    return when (status) {
        com.smt.materialloader.data.api.dto.CellStatus.OCCUPIED -> BadgeTone.OK
        com.smt.materialloader.data.api.dto.CellStatus.EMPTY -> BadgeTone.INFO
        com.smt.materialloader.data.api.dto.CellStatus.RESERVED -> BadgeTone.WARNING
        com.smt.materialloader.data.api.dto.CellStatus.FAULT -> BadgeTone.DANGER
    }
}