import SwiftUI

@main
struct MirrorKitApp: App {
    @StateObject private var streamManager = StreamManager()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(streamManager)
                .onAppear {
                    streamManager.startFromCommandLine()
                }
        }
    }
}

class StreamManager: ObservableObject {
    @Published var isStreaming = false
    @Published var status = "Idle"
    @Published var frameCount: UInt64 = 0
    @Published var serverUrl: String = ""

    private var captureManager: ScreenCaptureManager?
    private var frameEncoder: FrameEncoder?
    private var webSocketClient: WebSocketClient?

    func startFromCommandLine() {
        // Parse command line arguments for --server URL
        let args = CommandLine.arguments
        if let serverIndex = args.firstIndex(of: "--server"),
           serverIndex + 1 < args.count {
            let urlString = args[serverIndex + 1]
            serverUrl = urlString
            startStreaming(to: urlString)
        } else {
            // Default URL for development
            let defaultUrl = "ws://localhost:5001/ws/mirror/device?deviceId=booted"
            serverUrl = defaultUrl
            status = "No --server argument. Using default."
        }
    }

    func startStreaming(to urlString: String) {
        guard let url = URL(string: urlString) else {
            status = "Invalid URL"
            return
        }

        status = "Connecting..."

        frameEncoder = FrameEncoder()
        webSocketClient = WebSocketClient()
        captureManager = ScreenCaptureManager()

        webSocketClient?.onConnected = { [weak self] in
            DispatchQueue.main.async {
                self?.status = "Connected, starting capture..."
                self?.startCapture()
            }
        }

        webSocketClient?.onDisconnected = { [weak self] reason in
            DispatchQueue.main.async {
                self?.status = "Disconnected: \(reason)"
                self?.isStreaming = false
            }
        }

        webSocketClient?.connect(to: url)
    }

    private func startCapture() {
        guard let captureManager = captureManager,
              let frameEncoder = frameEncoder,
              let webSocketClient = webSocketClient else { return }

        captureManager.onFrame = { [weak self] sampleBuffer in
            guard let self = self,
                  let jpegData = frameEncoder.encodeToJPEG(sampleBuffer) else { return }

            webSocketClient.sendFrame(jpegData)

            DispatchQueue.main.async {
                self.frameCount += 1
            }
        }

        Task {
            do {
                try await captureManager.startCapture()
                await MainActor.run {
                    self.isStreaming = true
                    self.status = "Streaming"
                }
            } catch {
                await MainActor.run {
                    self.status = "Capture error: \(error.localizedDescription)"
                }
            }
        }
    }

    func stopStreaming() {
        Task {
            await captureManager?.stopCapture()
            webSocketClient?.disconnect()
            await MainActor.run {
                isStreaming = false
                status = "Stopped"
            }
        }
    }
}
