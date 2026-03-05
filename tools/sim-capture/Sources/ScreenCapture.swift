import Foundation
import ScreenCaptureKit
import CoreMedia

/// Captures a single SCWindow at a target FPS using ScreenCaptureKit.
final class ScreenCapture: NSObject, SCStreamOutput, SCStreamDelegate {
    private let window: SCWindow
    private let fps: Int
    private let encoder: FrameEncoder
    private var stream: SCStream?
    private var running = false

    init(window: SCWindow, fps: Int, encoder: FrameEncoder) {
        self.window = window
        self.fps = fps
        self.encoder = encoder
        super.init()
    }

    func start() async throws {
        let filter = SCContentFilter(desktopIndependentWindow: window)

        let config = SCStreamConfiguration()
        config.width = Int(window.frame.width) * 2 // Retina
        config.height = Int(window.frame.height) * 2 // Retina
        config.minimumFrameInterval = CMTime(value: 1, timescale: CMTimeScale(fps))
        config.pixelFormat = kCVPixelFormatType_32BGRA
        config.showsCursor = false
        config.queueDepth = 3

        fputs("[sim-capture] Creating SCStream (window: \(window.frame.width)x\(window.frame.height), onScreen: \(window.isOnScreen))...\n", stderr)

        let stream = SCStream(filter: filter, configuration: config, delegate: self)
        try stream.addStreamOutput(self, type: .screen, sampleHandlerQueue: .global(qos: .userInteractive))

        fputs("[sim-capture] Calling startCapture()...\n", stderr)
        try await stream.startCapture()

        self.stream = stream
        self.running = true
        fputs("[sim-capture] Capture started: \(config.width)x\(config.height) @ \(fps)fps\n", stderr)
    }

    // MARK: - SCStreamDelegate

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        fputs("[sim-capture] Stream stopped with error: \(error.localizedDescription)\n", stderr)
        running = false
    }

    func stop() async {
        guard running, let stream = stream else { return }
        running = false
        do {
            try await stream.stopCapture()
        } catch {
            fputs("[sim-capture] Error stopping capture: \(error)\n", stderr)
        }
        self.stream = nil
        fputs("[sim-capture] Capture stopped\n", stderr)
    }

    // MARK: - SCStreamOutput

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard running, type == .screen else { return }
        guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        encoder.encode(pixelBuffer)
    }
}
