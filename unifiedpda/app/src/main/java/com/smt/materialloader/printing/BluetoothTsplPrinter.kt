package com.smt.materialloader.printing

import android.annotation.SuppressLint
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothManager
import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.util.UUID

data class PairedPrinter(val name: String, val address: String)

object BluetoothTsplPrinter {
    private val sppUuid: UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB")

    @SuppressLint("MissingPermission")
    fun paired(context: Context): List<PairedPrinter> {
        val adapter = (context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager).adapter
            ?: return emptyList()
        return adapter.bondedDevices.orEmpty()
            .map { PairedPrinter(it.name ?: "Bluetooth printer", it.address) }
            .sortedBy { it.name }
    }

    @SuppressLint("MissingPermission")
    suspend fun printBoxLabels(context: Context, address: String, qrValues: List<String>): Result<Int> = withContext(Dispatchers.IO) {
        runCatching {
            require(qrValues.isNotEmpty()) { "No box QR data" }
            val adapter: BluetoothAdapter = (context.getSystemService(Context.BLUETOOTH_SERVICE) as BluetoothManager).adapter
                ?: error("Bluetooth is unavailable")
            require(adapter.isEnabled) { "Bluetooth is turned off" }
            val socket = adapter.getRemoteDevice(address).createRfcommSocketToServiceRecord(sppUuid)
            try {
                adapter.cancelDiscovery()
                socket.connect()
                socket.outputStream.buffered().use { output ->
                    qrValues.forEachIndexed { index, qr ->
                        val safe = qr.replace("\"", "")
                        val command = buildString {
                            append("SIZE 60 mm,40 mm\r\nGAP 2 mm,0 mm\r\nDIRECTION 1\r\nCLS\r\n")
                            append("TEXT 24,20,\"3\",0,1,1,\"WMS BOX ${index + 1}/${qrValues.size}\"\r\n")
                            append("QRCODE 24,58,L,6,A,0,M2,S7,\"$safe\"\r\n")
                            append("TEXT 210,75,\"2\",0,1,1,\"${safe.take(24)}\"\r\n")
                            append("PRINT 1,1\r\n")
                        }
                        output.write(command.toByteArray(Charsets.UTF_8))
                    }
                    output.flush()
                }
                qrValues.size
            } finally {
                runCatching { socket.close() }
            }
        }
    }
}
