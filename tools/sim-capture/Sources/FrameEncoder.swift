import Foundation
import CoreImage
import CoreVideo
import Metal

/// Encodes CVPixelBuffer frames to JPEG using Metal-accelerated CoreImage.
final class FrameEncoder {
    private let ciContext: CIContext
    private let colorSpace: CGColorSpace
    private let quality: Float
    private let scaleFactor: Int
    private let protocol_: BinaryProtocol

    /// - Parameters:
    ///   - quality: JPEG quality 0.0 - 1.0
    ///   - scale: Downscale factor (1 = full, 2 = half, 4 = quarter)
    init(quality: Float = 0.8, scale: Int = 1) {
        // Use Metal GPU for JPEG encoding
        if let device = MTLCreateSystemDefaultDevice() {
            self.ciContext = CIContext(mtlDevice: device, options: [
                .cacheIntermediates: false,
                .priorityRequestLow: false,
            ])
        } else {
            // Fallback to CPU
            self.ciContext = CIContext(options: [.useSoftwareRenderer: true])
        }
        self.colorSpace = CGColorSpace(name: CGColorSpace.sRGB) ?? CGColorSpaceCreateDeviceRGB()
        self.quality = quality
        self.scaleFactor = scale
        self.protocol_ = BinaryProtocol()
    }

    func writeHeader(pid: UInt32, width: UInt32, height: UInt32) {
        let vw = width / UInt32(scaleFactor)
        let vh = height / UInt32(scaleFactor)
        protocol_.writeHeader(pid: pid, width: width, height: height, virtualWidth: vw, virtualHeight: vh)
    }

    /// Encode a CVPixelBuffer to JPEG and write to stdout.
    func encode(_ pixelBuffer: CVPixelBuffer) {
        var image = CIImage(cvPixelBuffer: pixelBuffer)

        // Scale down if requested
        if scaleFactor > 1 {
            let s = 1.0 / Double(scaleFactor)
            image = image.transformed(by: CGAffineTransform(scaleX: s, y: s))
        }

        guard let jpegData = ciContext.jpegRepresentation(
            of: image,
            colorSpace: colorSpace,
            options: [kCGImageDestinationLossyCompressionQuality as CIImageRepresentationOption: quality]
        ) else {
            fputs("[sim-capture] Failed to encode JPEG frame\n", stderr)
            return
        }

        protocol_.writeFrame(jpegData: jpegData)
    }
}
