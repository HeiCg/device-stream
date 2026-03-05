import Foundation
import ScreenCaptureKit

struct WindowInfo {
    let window: SCWindow
    let pid: UInt32
    let width: UInt32
    let height: UInt32
}

enum WindowFinderError: Error, CustomStringConvertible {
    case noSimulatorWindows
    case udidNotFound(String)
    case noContent

    var description: String {
        switch self {
        case .noSimulatorWindows:
            return "No Simulator.app windows found. Is a simulator booted?"
        case .udidNotFound(let udid):
            return "Could not find simulator window for UDID: \(udid)"
        case .noContent:
            return "Failed to get shareable content from ScreenCaptureKit"
        }
    }
}

struct WindowFinder {

    /// Find the simulator window for a given UDID.
    /// Strategy 1: Match by window title containing the UDID or device name.
    /// Strategy 2: Match by PID from `xcrun simctl list devices -j`.
    static func find(udid: String) async throws -> WindowInfo {
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)

        // Filter to Simulator.app windows with meaningful size (skip menubars, toolbars)
        let simWindows = content.windows.filter { window in
            window.owningApplication?.bundleIdentifier == "com.apple.iphonesimulator"
                && window.frame.width > 100 && window.frame.height > 100
        }

        if simWindows.isEmpty {
            throw WindowFinderError.noSimulatorWindows
        }

        // Strategy 1: Match by window title
        // Window titles follow format: "iPhone 15 Pro - farm-ios-1 (Booted)" or similar
        for window in simWindows {
            let title = window.title ?? ""
            if title.contains(udid) {
                return makeWindowInfo(window)
            }
        }

        // Strategy 2: Look up the device name and match by title
        if let deviceName = try? await getDeviceName(udid: udid) {
            for window in simWindows {
                let title = window.title ?? ""
                if title.contains(deviceName) {
                    return makeWindowInfo(window)
                }
            }
        }

        // Strategy 3: Get PID from simctl and match by process ID
        if let pid = try? await getSimulatorPID(udid: udid) {
            for window in simWindows {
                if window.owningApplication?.processID == pid {
                    return makeWindowInfo(window)
                }
            }
        }

        // Strategy 4: If there's only one simulator window, use it
        if simWindows.count == 1 {
            fputs("[sim-capture] Warning: Could not match UDID, using only available simulator window\n", stderr)
            return makeWindowInfo(simWindows[0])
        }

        throw WindowFinderError.udidNotFound(udid)
    }

    private static func makeWindowInfo(_ window: SCWindow) -> WindowInfo {
        let pid = UInt32(window.owningApplication?.processID ?? 0)
        let width = UInt32(window.frame.width)
        let height = UInt32(window.frame.height)
        return WindowInfo(window: window, pid: pid, width: width, height: height)
    }

    /// Get the device name for a UDID from simctl
    private static func getDeviceName(udid: String) async throws -> String? {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/xcrun")
        process.arguments = ["simctl", "list", "devices", "-j"]
        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = FileHandle.nullDevice
        try process.run()
        process.waitUntilExit()

        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let devices = json["devices"] as? [String: [[String: Any]]] else {
            return nil
        }

        for (_, deviceList) in devices {
            for device in deviceList {
                if let deviceUdid = device["udid"] as? String, deviceUdid == udid,
                   let name = device["name"] as? String {
                    return name
                }
            }
        }
        return nil
    }

    /// Get the Simulator.app PID that hosts a given UDID
    private static func getSimulatorPID(udid: String) async throws -> pid_t? {
        // simctl doesn't directly tell us the PID of the hosting Simulator.app process
        // But we can use the device info to find it
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/pgrep")
        process.arguments = ["-f", "Simulator.app.*\(udid)"]
        let pipe = Pipe()
        process.standardOutput = pipe
        process.standardError = FileHandle.nullDevice
        try process.run()
        process.waitUntilExit()

        let output = String(data: pipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines)
        if let pidStr = output?.components(separatedBy: "\n").first, let pid = Int32(pidStr) {
            return pid
        }
        return nil
    }
}
