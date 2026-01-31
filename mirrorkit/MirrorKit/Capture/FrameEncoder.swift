import CoreImage
import UIKit
import CoreMedia

class FrameEncoder {
    private let context: CIContext
    private let colorSpace: CGColorSpace
    private var quality: CGFloat = 0.7

    init(quality: CGFloat = 0.7) {
        self.quality = quality
        // Use GPU-accelerated context for better performance
        if let metalDevice = MTLCreateSystemDefaultDevice() {
            self.context = CIContext(mtlDevice: metalDevice)
        } else {
            self.context = CIContext(options: [
                .useSoftwareRenderer: false,
                .priorityRequestLow: false
            ])
        }
        self.colorSpace = CGColorSpaceCreateDeviceRGB()
    }

    func encodeToJPEG(_ sampleBuffer: CMSampleBuffer, quality: CGFloat? = nil) -> Data? {
        guard let imageBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else {
            return nil
        }

        return encodePixelBuffer(imageBuffer, quality: quality ?? self.quality)
    }

    func encodePixelBuffer(_ pixelBuffer: CVPixelBuffer, quality: CGFloat) -> Data? {
        let ciImage = CIImage(cvPixelBuffer: pixelBuffer)

        // Get dimensions for potential scaling
        let width = CVPixelBufferGetWidth(pixelBuffer)
        let height = CVPixelBufferGetHeight(pixelBuffer)

        // Scale down if image is too large (e.g., > 1080p)
        let maxDimension: CGFloat = 1920
        var finalImage = ciImage

        if CGFloat(max(width, height)) > maxDimension {
            let scale = maxDimension / CGFloat(max(width, height))
            finalImage = ciImage.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
        }

        // Encode to JPEG using Core Image (more efficient than UIImage)
        guard let jpegData = context.jpegRepresentation(
            of: finalImage,
            colorSpace: colorSpace,
            options: [kCGImageDestinationLossyCompressionQuality as CIImageRepresentationOption: quality]
        ) else {
            // Fallback to UIImage method
            return encodeViaUIImage(pixelBuffer, quality: quality)
        }

        return jpegData
    }

    private func encodeViaUIImage(_ pixelBuffer: CVPixelBuffer, quality: CGFloat) -> Data? {
        let ciImage = CIImage(cvPixelBuffer: pixelBuffer)
        guard let cgImage = context.createCGImage(ciImage, from: ciImage.extent) else {
            return nil
        }
        let uiImage = UIImage(cgImage: cgImage)
        return uiImage.jpegData(compressionQuality: quality)
    }

    func setQuality(_ quality: CGFloat) {
        self.quality = max(0.1, min(1.0, quality))
    }
}
