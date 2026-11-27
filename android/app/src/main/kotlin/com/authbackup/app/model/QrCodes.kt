package com.authbackup.app.model

import android.content.Context
import android.graphics.Bitmap
import android.graphics.ImageDecoder
import android.net.Uri
import androidx.core.graphics.createBitmap
import androidx.core.graphics.set
import com.google.zxing.BarcodeFormat
import com.google.zxing.BinaryBitmap
import com.google.zxing.DecodeHintType
import com.google.zxing.EncodeHintType
import com.google.zxing.LuminanceSource
import com.google.zxing.RGBLuminanceSource
import com.google.zxing.Result
import com.google.zxing.common.GlobalHistogramBinarizer
import com.google.zxing.common.HybridBinarizer
import com.google.zxing.qrcode.QRCodeWriter
import com.google.zxing.qrcode.decoder.ErrorCorrectionLevel
import com.google.zxing.qrcode.QRCodeReader
import com.google.zxing.multi.qrcode.QRCodeMultiReader
import kotlin.math.abs
import kotlin.math.max

/** QR codes in images (screenshots, photos, a pasted picture) and QR codes made for display. ZXing: offline, no Play services. */
object QrCodes {
    /** Big photos are read at this size at most: enough for any QR code a screen or a printout shows. */
    private const val MAX_SIDE = 2048

    private val hints = mapOf(
        DecodeHintType.POSSIBLE_FORMATS to listOf(BarcodeFormat.QR_CODE),
        DecodeHintType.TRY_HARDER to true,
    )

    /** Every QR code payload in the image, in reading order (top to bottom, left to right), without repeats. */
    fun read(bitmap: Bitmap): List<String> {
        val w = bitmap.width
        val h = bitmap.height
        val pixels = IntArray(w * h).also { bitmap.getPixels(it, 0, w, 0, 0, w, h) }
        val source = RGBLuminanceSource(w, h, pixels)
        // Light-on-dark codes (dark mode screenshots) are read from the inverted image.
        val found = decodeAll(source).ifEmpty { decodeAll(source.invert()) }
        return found
            .sortedWith { a, b ->
                val (ax, ay) = centre(a)
                val (bx, by) = centre(b)
                if (abs(ay - by) > h * 0.05f) ay.compareTo(by) else ax.compareTo(bx)
            }
            .map { it.text }
            .distinct()
    }

    private fun decodeAll(source: LuminanceSource): List<Result> {
        for (binarizer in listOf(HybridBinarizer(source), GlobalHistogramBinarizer(source))) {
            val image = BinaryBitmap(binarizer)
            val many = runCatching { QRCodeMultiReader().decodeMultiple(image, hints).toList() }.getOrDefault(emptyList())
            if (many.isNotEmpty()) return many
            runCatching { QRCodeReader().decode(image, hints) }.getOrNull()?.let { return listOf(it) }
        }
        return emptyList()
    }

    private fun centre(r: Result): Pair<Float, Float> {
        val points = r.resultPoints.orEmpty()
        if (points.isEmpty()) return 0f to 0f
        return points.map { it.x }.average().toFloat() to points.map { it.y }.average().toFloat()
    }

    /** An image file or a pasted picture, decoded in software and scaled down when it is very large. */
    fun load(context: Context, uri: Uri): Bitmap? = runCatching {
        ImageDecoder.decodeBitmap(ImageDecoder.createSource(context.contentResolver, uri)) { decoder, info, _ ->
            decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
            val side = max(info.size.width, info.size.height)
            if (side > MAX_SIDE) decoder.setTargetSampleSize((side + MAX_SIDE - 1) / MAX_SIDE)
        }
    }.getOrNull()

    /** A crisp QR code for the screen: one pixel per module, scaled up without smoothing by the caller. Medium error
     * correction, like the extension's export. */
    fun bitmap(text: String): Bitmap {
        val matrix = QRCodeWriter().encode(
            text, BarcodeFormat.QR_CODE, 0, 0,
            mapOf(EncodeHintType.ERROR_CORRECTION to ErrorCorrectionLevel.M, EncodeHintType.MARGIN to 2),
        )
        val bitmap = createBitmap(matrix.width, matrix.height)
        for (y in 0 until matrix.height) for (x in 0 until matrix.width) {
            bitmap[x, y] = if (matrix[x, y]) 0xFF000000.toInt() else 0xFFFFFFFF.toInt()
        }
        return bitmap
    }
}
