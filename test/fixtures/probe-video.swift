import Foundation
import AVFoundation
Task {
 do {let asset=AVURLAsset(url:URL(fileURLWithPath:CommandLine.arguments[1]));let duration=try await asset.load(.duration);let tracks=try await asset.loadTracks(withMediaType:.audio);print("\(duration.seconds),\(tracks.count)");exit(0)}catch{exit(1)}
}
dispatchMain()
