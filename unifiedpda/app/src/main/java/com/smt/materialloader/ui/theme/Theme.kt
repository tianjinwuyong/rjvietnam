package com.smt.materialloader.ui.theme

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.TextUnitType
import androidx.compose.ui.unit.dp

object AppColors {
    val Background      = Color(0xFF08131D)
    val Surface         = Color(0xFF101D27)
    val SurfaceAlt       = Color(0xFF192833)
    val SurfaceHover     = Color(0xFF203542)
    val Border           = Color(0xFF2C414F)
    val BorderFocus      = Color(0xFF18C6D9)
    val TextPrimary      = Color(0xFFF2F6F8)
    val TextSecondary    = Color(0xFF9EB0BC)
    val TextTertiary     = Color(0xFF536572)
    val Primary          = Color(0xFF18C6D9)
    val PrimaryDark      = Color(0xFF0E9FB1)
    val Secondary       = Color(0xFFF2B84B)
    val Tertiary         = Color(0xFF22D887)
    val StatusOk         = Color(0xFF22D887)
    val StatusWarning    = Color(0xFFF2B84B)
    val StatusDanger     = Color(0xFFF05252)
    val StatusInfo       = Color(0xFF4C8DFF)
    val StatusNeutral    = Color(0xFF536572)
    val StatusOkBg       = Color(0xFF063827)
    val StatusWarningBg  = Color(0xFF402E0C)
    val StatusDangerBg   = Color(0xFF401719)
    val StatusInfoBg     = Color(0xFF172F50)
    val StatusNeutralBg  = Color(0xFF1B2932)
}

private val DarkColorScheme = darkColorScheme(
    primary = AppColors.Primary,
    onPrimary = Color.White,
    primaryContainer = AppColors.StatusInfoBg,
    onPrimaryContainer = Color(0xFFBFDBFE),
    secondary = AppColors.Secondary,
    onSecondary = Color.Black,
    secondaryContainer = AppColors.StatusWarningBg,
    onSecondaryContainer = Color(0xFFFDE68A),
    tertiary = AppColors.Tertiary,
    onTertiary = Color.White,
    tertiaryContainer = AppColors.StatusOkBg,
    onTertiaryContainer = Color(0xFFBBF7D0),
    error = AppColors.StatusDanger,
    onError = Color.White,
    errorContainer = AppColors.StatusDangerBg,
    onErrorContainer = Color(0xFFFCA5A5),
    background = AppColors.Background,
    onBackground = AppColors.TextPrimary,
    surface = AppColors.Surface,
    onSurface = AppColors.TextPrimary,
    surfaceVariant = AppColors.SurfaceAlt,
    onSurfaceVariant = AppColors.TextSecondary,
    outline = AppColors.Border,
    outlineVariant = AppColors.Border,
    inverseSurface = Color(0xFFE8EDF5),
    inverseOnSurface = AppColors.Background,
    inversePrimary = AppColors.PrimaryDark,
    surfaceTint = AppColors.Primary,
)

private val AppTypography = Typography(
    headlineLarge  = TextStyle(fontWeight = FontWeight.Bold,   fontSize = TextUnit(28f, TextUnitType.Sp)),
    headlineMedium  = TextStyle(fontWeight = FontWeight.Bold,   fontSize = TextUnit(24f, TextUnitType.Sp)),
    headlineSmall   = TextStyle(fontWeight = FontWeight.SemiBold, fontSize = TextUnit(20f, TextUnitType.Sp)),
    titleLarge     = TextStyle(fontWeight = FontWeight.SemiBold, fontSize = TextUnit(18f, TextUnitType.Sp)),
    titleMedium    = TextStyle(fontWeight = FontWeight.SemiBold, fontSize = TextUnit(16f, TextUnitType.Sp)),
    titleSmall     = TextStyle(fontWeight = FontWeight.Medium,  fontSize = TextUnit(14f, TextUnitType.Sp)),
    bodyLarge      = TextStyle(fontWeight = FontWeight.Normal,  fontSize = TextUnit(16f, TextUnitType.Sp)),
    bodyMedium     = TextStyle(fontWeight = FontWeight.Normal,  fontSize = TextUnit(14f, TextUnitType.Sp)),
    bodySmall      = TextStyle(fontWeight = FontWeight.Normal,  fontSize = TextUnit(12f, TextUnitType.Sp)),
    labelLarge     = TextStyle(fontWeight = FontWeight.SemiBold, fontSize = TextUnit(14f, TextUnitType.Sp)),
    labelMedium    = TextStyle(fontWeight = FontWeight.Medium,  fontSize = TextUnit(12f, TextUnitType.Sp)),
    labelSmall     = TextStyle(fontWeight = FontWeight.Medium,  fontSize = TextUnit(10f, TextUnitType.Sp)),
)

private val AppShapes = Shapes(
    extraSmall = RoundedCornerShape(4.dp),
    small      = RoundedCornerShape(8.dp),
    medium     = RoundedCornerShape(12.dp),
    large      = RoundedCornerShape(16.dp),
    extraLarge = RoundedCornerShape(24.dp),
)

@Composable
fun MaterialLoaderTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = DarkColorScheme,
        typography = AppTypography,
        shapes = AppShapes,
        content = content
    )
}
