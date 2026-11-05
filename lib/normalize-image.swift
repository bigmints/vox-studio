import Foundation
import ImageIO
import UniformTypeIdentifiers
let sourceURL = URL(fileURLWithPath: CommandLine.arguments[1])
let outputURL = URL(fileURLWithPath: CommandLine.arguments[2])
guard let source = CGImageSourceCreateWithURL(sourceURL as CFURL, nil) else { exit(1) }
// Keep the base64 payload below the provider's 5 MB inline-image cap.
for maximum in [1280, 1024, 768] {
 guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [
  kCGImageSourceCreateThumbnailFromImageAlways: true,
  kCGImageSourceCreateThumbnailWithTransform: true,
  kCGImageSourceThumbnailMaxPixelSize: maximum
 ] as CFDictionary), let destination = CGImageDestinationCreateWithURL(outputURL as CFURL, UTType.png.identifier as CFString, 1, nil) else {exit(1)}
 CGImageDestinationAddImage(destination, image, [kCGImagePropertyOrientation: 1] as CFDictionary)
 guard CGImageDestinationFinalize(destination) else {exit(1)}
 if let size = try? FileManager.default.attributesOfItem(atPath: outputURL.path)[.size] as? NSNumber, size.intValue <= 3500000 {exit(0)}
}
exit(1)
