// swift-tools-version: 5.9
import PackageDescription

let package = Package(
    name: "sim-capture",
    platforms: [
        .macOS(.v13)
    ],
    targets: [
        .executableTarget(
            name: "sim-capture",
            path: "Sources",
            linkerSettings: [
                .linkedFramework("ScreenCaptureKit"),
                .linkedFramework("CoreImage"),
                .linkedFramework("CoreMedia"),
                .linkedFramework("CoreVideo"),
                .linkedFramework("Metal"),
            ]
        )
    ]
)
