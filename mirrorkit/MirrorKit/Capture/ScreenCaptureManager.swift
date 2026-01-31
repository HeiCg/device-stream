import ReplayKit
import AVFoundation

class ScreenCaptureManager: NSObject {
    private let recorder = RPScreenRecorder.shared()
    var onFrame: ((CMSampleBuffer) -> Void)?

    private var isCapturing = false
    private var lastFrameTime: CFTimeInterval = 0
    private let targetFrameInterval: CFTimeInterval = 1.0 / 30.0 // 30 fps

    func startCapture() async throws {
        guard recorder.isAvailable else {
            throw CaptureError.recorderNotAvailable
        }

        guard !isCapturing else {
            throw CaptureError.alreadyCapturing
        }

        isCapturing = true
        lastFrameTime = CACurrentMediaTime()

        try await recorder.startCapture { [weak self] sampleBuffer, bufferType, error in
            guard let self = self else { return }

            // Only process video frames
            guard bufferType == .video else { return }

            if let error = error {
                print("[MirrorKit] Capture error: \(error.localizedDescription)")
                return
            }

            // Frame rate limiting
            let currentTime = CACurrentMediaTime()
            guard currentTime - self.lastFrameTime >= self.targetFrameInterval else { return }
            self.lastFrameTime = currentTime

            self.onFrame?(sampleBuffer)
        }
    }

    func stopCapture() async {
        guard isCapturing else { return }

        isCapturing = false
        await recorder.stopCapture()
    }

    var isRecorderAvailable: Bool {
        recorder.isAvailable
    }
}

enum CaptureError: Error, LocalizedError {
    case recorderNotAvailable
    case alreadyCapturing
    case captureStartFailed(Error)

    var errorDescription: String? {
        switch self {
        case .recorderNotAvailable:
            return "Screen recorder is not available on this device"
        case .alreadyCapturing:
            return "Screen capture is already in progress"
        case .captureStartFailed(let error):
            return "Failed to start capture: \(error.localizedDescription)"
        }
    }
}
