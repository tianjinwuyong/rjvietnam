package com.smt.materialloader.ui.components

import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.time.DateTimeException
import java.util.Locale

/** Structured fields found on supplier material/receiving labels. */
data class MaterialLabelOcrResult(
    val materialCode: String? = null,
    val materialName: String? = null,
    val specification: String? = null,
    val supplier: String? = null,
    val supplierCode: String? = null,
    val supplierBarcode: String? = null,
    val purchaseOrder: String? = null,
    val lot: String? = null,
    val manufactureDate: String? = null,
    val expiryDate: String? = null,
    val quantity: Double? = null,
    val boxQuantity: Double? = null,
    val batchQuantity: Double? = null,
    val unit: String? = null,
    val ulCode: String? = null,
    val invoice: String? = null,
    val cartonCode: String? = null,
    val qualityMarks: String? = null,
    val rawText: String
) {
    /** Value suitable for the existing material scan flow. */
    val scanValue: String get() = lot ?: materialCode.orEmpty()
}

/** Parses common English/Chinese/Vietnamese receiving-label text. Kept pure for unit tests. */
object MaterialLabelOcrParser {
    private val datePatterns = listOf(
        Regex("\\b(20\\d{2})[-/.](\\d{1,2})[-/.](\\d{1,2})\\b"),
        Regex("\\b(20\\d{2})(\\d{2})(\\d{2})\\b"),
        Regex("\\b(\\d{1,2})[-/.](\\d{1,2})[-/.](20\\d{2})\\b")
    )
    private val dateFormatter = DateTimeFormatter.ISO_LOCAL_DATE

    fun parse(raw: String): MaterialLabelOcrResult {
        val text = raw.replace('\u0000', ' ').replace('|', '\n')
        val compactText = text.replace(Regex("\\s+"), "")
        fun field(patterns: List<Regex>): String? = patterns.asSequence()
            .mapNotNull { it.find(text)?.groupValues?.getOrNull(1)?.trim() }
            .firstOrNull { it.isNotBlank() }
        val material = field(listOf(
            Regex("(?im)(?:material(?:\\s*(?:code|no|number))?|part(?:\\s*no)?|物料(?:编码|料号)|料号|mã vật liệu)\\s*[:#=]?\\s*([A-Z0-9][A-Z0-9._/-]{2,})")
        ))
        val materialCodeFallback = Regex("\\d{1,3}(?:\\.\\d{2}){2,}[A-Z]?", RegexOption.IGNORE_CASE).find(text)?.value
            ?: Regex("\\d{1,3}(?:\\.\\d{2}){2,}[A-Z]?", RegexOption.IGNORE_CASE).find(compactText)?.value
        fun labeled(pattern: String) = field(listOf(Regex("(?im)$pattern\\s*[:#=]?\\s*([^\\n|;]+)")))
        val materialName = labeled("(?:material\\s*name|\\u7269\\u6599\\u540d\\u79f0|t[eê]n v[aậ]t li[eệ]u)")
            ?: Regex("(?im)\\b(DC\\s*(?:wire|line)|DC\\s*线\\s*[A-Z0-9-]*)\\b").find(text)?.groupValues?.getOrNull(1)
        val specification = labeled("(?:spec(?:ification)?|model|\\u89c4\\u683c\\u578b\\u53f7)")
        val supplier = labeled("(?:supplier|\\u4f9b\\u5e94\\u5546|nh[a] cung c[aấ]p)")
        val purchaseOrder = labeled("(?:po|purchase\\s*order|\\u91c7\\u8d2d\\u5355\\u53f7|\\u91c7\\u8d2d\\u5355)")
        val lot = field(listOf(
            Regex("(?im)(?:lot(?:\\s*(?:no|number))?|batch|批次|批号|lô)\\s*[:#=]?\\s*([A-Z0-9][A-Z0-9._/-]{2,})")
        ))
        val qtyText = field(listOf(
            Regex("(?im)(?:qty|quantity|数量|số lượng)\\s*[:#=]?\\s*([0-9]+(?:[.,][0-9]+)?)")
        ))
        val quantityFallback = Regex("(?i)\\b([0-9]+(?:[.,][0-9]+)?)\\s*(?:pcs|pc|set|box|roll|kg)\\b").find(text)?.groupValues?.getOrNull(1)
            ?: Regex("(?i)([0-9]+(?:[.,][0-9]+)?)(?:pcs|pc|set|box|roll|kg)").find(compactText)?.groupValues?.getOrNull(1)
        val standaloneQuantity = Regex("(?m)^\\s*(\\d{1,7})\\s*$").findAll(text).map { it.groupValues[1] }.lastOrNull { it.length != 4 }
        val unit = Regex("(?i)\\b(PCS|PC|SET|BOX|ROLL|KG)\\b").find(text)?.groupValues?.getOrNull(1)?.uppercase()
        val ulCode = Regex("(?i)\\bE\\d{4,}\\b").find(text)?.value
        val invoice = labeled("(?:invoice|发票号|invoice\\s*no)")
        val dates = datePatterns.flatMap { it.findAll(text).map { m -> normalizeDate(m) }.toList() }
        val manufacture = field(listOf(
            Regex("(?im)(?:mfg|mfd|manufactur(?:e|ed)|生产日期|制造日期|ngày sản xuất)\\s*[:#=]?\\s*([^\\s,;]+)")
        ))?.let(::normalizeDateToken)
        val expiry = field(listOf(
            Regex("(?im)(?:exp|expiry|expiration|有效期|失效日期|到期日|hạn sử dụng)\\s*[:#=]?\\s*([^\\s,;]+)")
        ))?.let(::normalizeDateToken)
        return MaterialLabelOcrResult(
            materialCode = material ?: materialCodeFallback,
            materialName = materialName,
            specification = specification,
            supplier = supplier,
            purchaseOrder = purchaseOrder,
            lot = lot,
            manufactureDate = manufacture ?: dates.getOrNull(0),
            expiryDate = expiry ?: dates.getOrNull(1),
            quantity = (qtyText ?: quantityFallback ?: standaloneQuantity)?.replace(',', '.')?.toDoubleOrNull(),
            unit = unit,
            ulCode = ulCode,
            invoice = invoice,
            rawText = raw
        )
    }

    private fun normalizeDateToken(token: String): String? {
        val match = datePatterns.asSequence().mapNotNull { it.find(token) }.firstOrNull() ?: return null
        return normalizeDate(match)
    }

    private fun normalizeDate(match: MatchResult): String? {
        return try {
            val g = match.groupValues
            val date = if (g[1].length == 4) LocalDate.of(g[1].toInt(), g[2].toInt(), g[3].toInt())
            else if (g[3].length == 4) LocalDate.of(g[3].toInt(), g[2].toInt(), g[1].toInt())
            else null
            date?.format(dateFormatter)
        } catch (_: DateTimeException) { null }
          catch (_: NumberFormatException) { null }
    }
}
