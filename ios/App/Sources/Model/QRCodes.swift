import CoreImage
import CoreImage.CIFilterBuiltins
import UIKit
import Vision

/// QR codes in images (screenshots, photos, a pasted picture) and QR codes made for display.
enum QRCodes {
    /// Every QR code payload in the image, in reading order (top to bottom, left to right).
    static func read(from image: UIImage) async -> [String] {
        // Images from the photo library may be backed by CIImage only: draw them once into a bitmap.
        let bitmap = image.cgImage ?? UIGraphicsImageRenderer(size: image.size).image { _ in image.draw(at: .zero) }.cgImage
        guard let cgImage = bitmap else { return [] }
        return await Task.detached(priority: .userInitiated) {
            let request = VNDetectBarcodesRequest()
            request.symbologies = [.qr]
            try? VNImageRequestHandler(cgImage: cgImage, options: [:]).perform([request])
            let found = (request.results ?? []).sorted {
                abs($0.boundingBox.midY - $1.boundingBox.midY) > 0.05 ? $0.boundingBox.midY > $1.boundingBox.midY : $0.boundingBox.minX < $1.boundingBox.minX
            }
            var seen = Set<String>()
            return found.compactMap(\.payloadStringValue).filter { seen.insert($0).inserted }
        }.value
    }

    /// A crisp QR code for the screen (medium error correction, like the extension's export).
    static func image(for text: String, scale: CGFloat = 10) -> UIImage? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(text.utf8)
        filter.correctionLevel = "M"
        guard let output = filter.outputImage?.transformed(by: CGAffineTransform(scaleX: scale, y: scale)),
              let cg = CIContext().createCGImage(output, from: output.extent) else { return nil }
        return UIImage(cgImage: cg)
    }
}
