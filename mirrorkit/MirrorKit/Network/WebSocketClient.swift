import Foundation
import UIKit

class WebSocketClient: NSObject {
    private var webSocket: URLSessionWebSocketTask?
    private var session: URLSession?
    private var frameCount: UInt64 = 0
    private var isConnected = false
    private var screenWidth: Int = 1170  // Default iPhone 14 Pro
    private var screenHeight: Int = 2532

    var onConnected: (() -> Void)?
    var onDisconnected: ((String) -> Void)?
    var onError: ((Error) -> Void)?

    override init() {
        super.init()
    }

    func updateScreenDimensions() {
        DispatchQueue.main.async { [weak self] in
            if let windowScene = UIApplication.shared.connectedScenes.first as? UIWindowScene {
                let screen = windowScene.screen
                self?.screenWidth = Int(screen.bounds.width * screen.scale)
                self?.screenHeight = Int(screen.bounds.height * screen.scale)
            }
        }
    }

    func connect(to url: URL) {
        // Update screen dimensions before connecting
        updateScreenDimensions()

        let configuration = URLSessionConfiguration.default
        configuration.timeoutIntervalForRequest = 30
        configuration.timeoutIntervalForResource = 300

        session = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
        webSocket = session?.webSocketTask(with: url)
        webSocket?.resume()

        listenForMessages()
    }

    func sendFrame(_ jpegData: Data) {
        guard isConnected else { return }

        frameCount += 1

        // Create frame message
        let message: [String: Any] = [
            "type": "frame",
            "data": jpegData.base64EncodedString(),
            "pts": frameCount,
            "codec": "mjpeg"
        ]

        guard let jsonData = try? JSONSerialization.data(withJSONObject: message) else {
            return
        }

        webSocket?.send(.data(jsonData)) { [weak self] error in
            if let error = error {
                print("[MirrorKit] Send error: \(error.localizedDescription)")
                self?.onError?(error)
            }
        }
    }

    func sendMetadata() {
        guard isConnected else { return }

        let metadata: [String: Any] = [
            "type": "metadata",
            "width": screenWidth,
            "height": screenHeight,
            "fps": 30
        ]

        guard let jsonData = try? JSONSerialization.data(withJSONObject: metadata) else {
            return
        }

        webSocket?.send(.data(jsonData)) { [weak self] error in
            if let error = error {
                print("[MirrorKit] Metadata send error: \(error.localizedDescription)")
                self?.onError?(error)
            }
        }
    }

    func disconnect() {
        webSocket?.cancel(with: .goingAway, reason: nil)
        isConnected = false
    }

    private func listenForMessages() {
        webSocket?.receive { [weak self] result in
            switch result {
            case .success(let message):
                self?.handleMessage(message)
                self?.listenForMessages()
            case .failure(let error):
                print("[MirrorKit] Receive error: \(error.localizedDescription)")
                self?.onDisconnected?("Receive error: \(error.localizedDescription)")
            }
        }
    }

    private func handleMessage(_ message: URLSessionWebSocketTask.Message) {
        switch message {
        case .string(let text):
            handleTextMessage(text)
        case .data(let data):
            if let text = String(data: data, encoding: .utf8) {
                handleTextMessage(text)
            }
        @unknown default:
            break
        }
    }

    private func handleTextMessage(_ text: String) {
        guard let data = text.data(using: .utf8),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = json["type"] as? String else {
            return
        }

        switch type {
        case "command":
            // Handle commands from server (future: touch input)
            print("[MirrorKit] Received command: \(json)")
        case "ping":
            // Respond to ping
            sendPong()
        default:
            break
        }
    }

    private func sendPong() {
        let pong: [String: Any] = ["type": "pong", "timestamp": Date().timeIntervalSince1970 * 1000]
        guard let jsonData = try? JSONSerialization.data(withJSONObject: pong) else { return }
        webSocket?.send(.data(jsonData)) { _ in }
    }
}

extension WebSocketClient: URLSessionWebSocketDelegate {
    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didOpenWithProtocol protocol: String?) {
        print("[MirrorKit] WebSocket connected")
        isConnected = true

        // Send metadata first
        sendMetadata()

        DispatchQueue.main.async {
            self.onConnected?()
        }
    }

    func urlSession(_ session: URLSession, webSocketTask: URLSessionWebSocketTask, didCloseWith closeCode: URLSessionWebSocketTask.CloseCode, reason: Data?) {
        print("[MirrorKit] WebSocket closed with code: \(closeCode)")
        isConnected = false

        let reasonString = reason.flatMap { String(data: $0, encoding: .utf8) } ?? "Unknown"
        DispatchQueue.main.async {
            self.onDisconnected?(reasonString)
        }
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        if let error = error {
            print("[MirrorKit] Session error: \(error.localizedDescription)")
            isConnected = false
            DispatchQueue.main.async {
                self.onDisconnected?(error.localizedDescription)
            }
        }
    }
}
