import Foundation
import AVFoundation
let args=CommandLine.arguments
Task {
 do {
  let manifest=try JSONSerialization.jsonObject(with:Data(contentsOf:URL(fileURLWithPath:args[1]))) as! [String:Any]
  let duration=manifest["duration"] as! Double
  let work=FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
  try FileManager.default.createDirectory(at:work,withIntermediateDirectories:true)
  defer {try? FileManager.default.removeItem(at:work)}
  var part=0
  let composition=AVMutableComposition()
  let video=composition.addMutableTrack(withMediaType:.video,preferredTrackID:kCMPersistentTrackID_Invalid)!
  var cursor=CMTime.zero
  for path in manifest["files"] as! [String] {
   let local=work.appendingPathComponent("part-\(part).mp4");part+=1
   try FileManager.default.copyItem(at:URL(fileURLWithPath:path),to:local)
   let asset=AVURLAsset(url:local);let tracks=try await asset.loadTracks(withMediaType:.video)
   guard let track=tracks.first else {throw NSError(domain:"Missing video track",code:1)}
   let length=CMTimeMinimum(try await asset.load(.duration),CMTime(seconds:duration,preferredTimescale:600)-cursor)
   if length<=CMTime.zero {break}
   try video.insertTimeRange(CMTimeRange(start:.zero,duration:length),of:track,at:cursor)
   if cursor==CMTime.zero {video.preferredTransform=try await track.load(.preferredTransform)}
   cursor=cursor+length
  }
  guard cursor.seconds>=duration-0.05 else {throw NSError(domain:"Generated shots do not cover voice clip",code:2)}
  let originalAudio=URL(fileURLWithPath:manifest["audio"] as! String)
  let header=try Data(contentsOf:originalAudio).prefix(12)
  let ext=header.starts(with:Data("RIFF".utf8)) ? "wav" : (header.dropFirst(4).starts(with:Data("ftyp".utf8)) ? "m4a" : "mp3")
  let localAudio=work.appendingPathComponent("voice."+ext);try FileManager.default.copyItem(at:originalAudio,to:localAudio)
  let voice=AVURLAsset(url:localAudio)
  guard let voiceTrack=try await voice.loadTracks(withMediaType:.audio).first else {throw NSError(domain:"Voice track missing",code:3)}
  let audio=composition.addMutableTrack(withMediaType:.audio,preferredTrackID:kCMPersistentTrackID_Invalid)!
  try audio.insertTimeRange(CMTimeRange(start:CMTime(seconds:manifest["audioStart"] as! Double,preferredTimescale:600),duration:CMTime(seconds:duration,preferredTimescale:600)),of:voiceTrack,at:.zero)
  guard let exporter=AVAssetExportSession(asset:composition,presetName:AVAssetExportPresetHighestQuality) else {throw NSError(domain:"Export unavailable",code:4)}
  exporter.outputURL=URL(fileURLWithPath:args[2]);exporter.outputFileType = .mp4;exporter.shouldOptimizeForNetworkUse=true
  await exporter.export()
  guard exporter.status == .completed else {throw exporter.error ?? NSError(domain:"Export failed",code:5)}
  exit(0)
 } catch {fputs("Could not assemble full voice video: \(error)\n",stderr);exit(1)}
}
dispatchMain()
