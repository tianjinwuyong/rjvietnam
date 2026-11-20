package com.smt.materialloader.ui.components

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class MaterialLabelOcrParserTest {
    @Test fun parsesReceivingLabelFields() {
        val result = MaterialLabelOcrParser.parse("Material Code: C-0603-10K\nLot No: L240801A\nMFG: 2024/08/01\nEXP: 2026-08-01\nQty: 500")
        assertEquals("C-0603-10K", result.materialCode)
        assertEquals("L240801A", result.lot)
        assertEquals("2024-08-01", result.manufactureDate)
        assertEquals("2026-08-01", result.expiryDate)
        assertEquals(500.0, result.quantity!!, 0.01)
        assertEquals("L240801A", result.scanValue)
    }

    @Test fun handlesChineseLabelsAndInvalidDate() {
        val result = MaterialLabelOcrParser.parse("物料编码: RES_10K\n批次: B-01\n生产日期: 2024-02-30\n数量: 12,5")
        assertEquals("RES_10K", result.materialCode)
        assertEquals("B-01", result.lot)
        assertTrue(result.manufactureDate == null)
        assertEquals(12.5, result.quantity!!, 0.01)
    }
}
