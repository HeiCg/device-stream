import Foundation

/// Binary protocol for streaming JPEG frames over stdout.
///
/// Header (24 bytes, sent once):
///   [1 byte]  version = 1
///   [1 byte]  header_size = 24
///   [4 bytes] pid (LE)
///   [4 bytes] real width (LE)
///   [4 bytes] real height (LE)
///   [4 bytes] virtual width (LE)
///   [4 bytes] virtual height (LE)
///   [1 byte]  orientation
///   [1 byte]  flags (reserved)
///
/// Frame (repeated):
///   [4 bytes] frame_size (LE)
///   [N bytes] JPEG data
struct BinaryProtocol {
    private let output = FileHandle.standardOutput

    func writeHeader(pid: UInt32, width: UInt32, height: UInt32, virtualWidth: UInt32, virtualHeight: UInt32, orientation: UInt8 = 0) {
        var data = Data(capacity: 24)
        data.append(1) // version
        data.append(24) // header_size
        data.append(contentsOf: withUnsafeBytes(of: pid.littleEndian) { Array($0) })
        data.append(contentsOf: withUnsafeBytes(of: width.littleEndian) { Array($0) })
        data.append(contentsOf: withUnsafeBytes(of: height.littleEndian) { Array($0) })
        data.append(contentsOf: withUnsafeBytes(of: virtualWidth.littleEndian) { Array($0) })
        data.append(contentsOf: withUnsafeBytes(of: virtualHeight.littleEndian) { Array($0) })
        data.append(orientation) // orientation
        data.append(0) // flags (reserved)
        output.write(data)
    }

    func writeFrame(jpegData: Data) {
        let size = UInt32(jpegData.count)
        var header = Data(capacity: 4)
        header.append(contentsOf: withUnsafeBytes(of: size.littleEndian) { Array($0) })
        output.write(header)
        output.write(jpegData)
    }
}
