import Foundation
import ScreenCaptureKit

// MARK: - Argument parsing

struct Arguments {
    var udid: String = ""
    var fps: Int = 30
    var quality: Float = 0.8
    var scale: Int = 1
}

func parseArgs() -> Arguments {
    var args = Arguments()
    let argv = CommandLine.arguments
    var i = 1
    while i < argv.count {
        switch argv[i] {
        case "--udid":
            i += 1; args.udid = argv[i]
        case "--fps":
            i += 1; args.fps = Int(argv[i]) ?? 30
        case "--quality":
            i += 1
            let q = Int(argv[i]) ?? 80
            args.quality = Float(q) / 100.0
        case "--scale":
            i += 1; args.scale = Int(argv[i]) ?? 1
        case "--help", "-h":
            fputs("""
            Usage: sim-capture --udid <UDID> [--fps N] [--quality 0-100] [--scale 1|2|4]

            Options:
              --udid      Simulator UDID (required)
              --fps       Target frames per second (default: 30)
              --quality   JPEG quality 0-100 (default: 80)
              --scale     Downscale factor: 1=full, 2=half, 4=quarter (default: 1)

            Output: Binary protocol on stdout (header + JPEG frames)
            Logs: stderr

            """, stderr)
            exit(0)
        default:
            fputs("[sim-capture] Unknown argument: \(argv[i])\n", stderr)
            exit(1)
        }
        i += 1
    }

    if args.udid.isEmpty {
        fputs("[sim-capture] Error: --udid is required\n", stderr)
        exit(1)
    }

    return args
}

// MARK: - Main

let args = parseArgs()

fputs("[sim-capture] Starting capture for UDID: \(args.udid) (fps=\(args.fps), quality=\(Int(args.quality * 100)), scale=\(args.scale))\n", stderr)

// Disable stdout buffering for real-time frame delivery
setbuf(stdout, nil)

// Capture reference for signal cleanup
var capture: ScreenCapture?

// Handle SIGTERM / SIGINT for graceful shutdown
let signalCallback: @convention(c) (Int32) -> Void = { sig in
    fputs("\n[sim-capture] Received signal \(sig), shutting down...\n", stderr)
    // We can't call async from signal handler, so just exit
    // The OS will clean up ScreenCaptureKit resources
    exit(0)
}
signal(SIGTERM, signalCallback)
signal(SIGINT, signalCallback)

// Run async main
let semaphore = DispatchSemaphore(value: 0)

Task {
    do {
        // Step 1: Find the simulator window
        fputs("[sim-capture] Looking for simulator window...\n", stderr)
        let windowInfo = try await WindowFinder.find(udid: args.udid)
        fputs("[sim-capture] Found window: \(windowInfo.width)x\(windowInfo.height) (PID: \(windowInfo.pid))\n", stderr)

        // Step 2: Create encoder and write header
        let encoder = FrameEncoder(quality: args.quality, scale: args.scale)
        let retinaWidth = windowInfo.width * 2
        let retinaHeight = windowInfo.height * 2
        encoder.writeHeader(pid: windowInfo.pid, width: retinaWidth, height: retinaHeight)
        fputs("[sim-capture] Header sent: \(retinaWidth)x\(retinaHeight)\n", stderr)

        // Step 3: Start capture
        let cap = ScreenCapture(window: windowInfo.window, fps: args.fps, encoder: encoder)
        capture = cap
        try await cap.start()

        // Keep running until signal
        fputs("[sim-capture] Streaming... (press Ctrl+C to stop)\n", stderr)

    } catch {
        fputs("[sim-capture] Error: \(error)\n", stderr)
        exit(1)
    }
}

// Block main thread indefinitely (capture runs on ScreenCaptureKit's internal queue)
dispatchMain()
