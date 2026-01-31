import Foundation

// MARK: - Message Types

enum MessageType: String, Codable {
    case metadata
    case frame
    case command
    case ping
    case pong
    case error
}

// MARK: - Outgoing Messages (App -> Server)

struct MetadataMessage: Codable {
    let type: String = "metadata"
    let width: Int
    let height: Int
    let fps: Int
}

struct FrameMessage: Codable {
    let type: String = "frame"
    let data: String  // Base64 encoded JPEG
    let pts: UInt64   // Presentation timestamp (frame number)
    let codec: String = "mjpeg"
}

struct PongMessage: Codable {
    let type: String = "pong"
    let timestamp: Double
}

// MARK: - Incoming Messages (Server -> App)

struct CommandMessage: Codable {
    let type: String
    let action: String
    let payload: CommandPayload?
}

struct CommandPayload: Codable {
    // Touch commands
    let x: Double?
    let y: Double?

    // Swipe commands
    let startX: Double?
    let startY: Double?
    let endX: Double?
    let endY: Double?
    let duration: Double?

    // Text input
    let text: String?

    // Quality control
    let quality: Double?
    let fps: Int?
}

struct PingMessage: Codable {
    let type: String = "ping"
    let timestamp: Double
}

struct ErrorMessage: Codable {
    let type: String = "error"
    let message: String
    let code: Int?
}

// MARK: - Message Encoding/Decoding

class MessageSerializer {
    private let encoder = JSONEncoder()
    private let decoder = JSONDecoder()

    func encode<T: Encodable>(_ message: T) -> Data? {
        try? encoder.encode(message)
    }

    func decode<T: Decodable>(_ type: T.Type, from data: Data) -> T? {
        try? decoder.decode(type, from: data)
    }

    func decodeMessageType(from data: Data) -> MessageType? {
        guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let typeString = json["type"] as? String else {
            return nil
        }
        return MessageType(rawValue: typeString)
    }
}

// MARK: - Command Actions

enum CommandAction: String {
    case tap
    case doubleTap
    case longPress
    case swipe
    case scroll
    case typeText
    case pressKey
    case setQuality
    case setFps
    case screenshot
}
