import SwiftUI

struct ContentView: View {
    @EnvironmentObject var streamManager: StreamManager

    var body: some View {
        VStack(spacing: 20) {
            Image(systemName: "tv.and.mediabox")
                .font(.system(size: 60))
                .foregroundColor(streamManager.isStreaming ? .green : .gray)

            Text("MirrorKit")
                .font(.largeTitle)
                .fontWeight(.bold)

            Text(streamManager.status)
                .font(.headline)
                .foregroundColor(.secondary)

            if !streamManager.serverUrl.isEmpty {
                Text(streamManager.serverUrl)
                    .font(.caption)
                    .foregroundColor(.secondary)
                    .lineLimit(2)
                    .padding(.horizontal)
            }

            if streamManager.isStreaming {
                VStack(spacing: 8) {
                    HStack {
                        Circle()
                            .fill(.red)
                            .frame(width: 12, height: 12)
                        Text("Streaming")
                            .font(.headline)
                    }

                    Text("Frames: \(streamManager.frameCount)")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
                .padding()
                .background(Color.black.opacity(0.1))
                .cornerRadius(10)
            }

            Spacer()

            HStack(spacing: 20) {
                Button(action: {
                    if streamManager.isStreaming {
                        streamManager.stopStreaming()
                    } else {
                        streamManager.startFromCommandLine()
                    }
                }) {
                    Text(streamManager.isStreaming ? "Stop" : "Start")
                        .font(.headline)
                        .foregroundColor(.white)
                        .frame(width: 120, height: 44)
                        .background(streamManager.isStreaming ? Color.red : Color.blue)
                        .cornerRadius(10)
                }
            }
            .padding(.bottom, 40)
        }
        .padding()
    }
}

#Preview {
    ContentView()
        .environmentObject(StreamManager())
}
