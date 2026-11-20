package com.smt.materialloader.ui.login

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.smt.materialloader.util.LocaleManager

@Composable
fun LocalePicker(
    selected: String,
    onSelect: (String) -> Unit
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterHorizontally)
    ) {
        LocaleManager.supportedLocales.forEach { locale ->
            FilterChip(
                selected = locale == selected,
                onClick = { onSelect(locale) },
                label = { Text(LocaleManager.getDisplayName(locale)) },
                modifier = Modifier.height(40.dp)
            )
        }
    }
}
