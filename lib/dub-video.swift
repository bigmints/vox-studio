import Foundation
import AVFoundation

func invalid(_ message: String) -> NSError { NSError(domain: "MyTwin", code: 1, userInfo: [NSLocalizedDescriptionKey: message]) }
func emit(_ value: [String: Any]) throws { print(String(data: try JSONSerialization.data(withJSONObject: value), encoding: .utf8)!) }
Task {
 do {
  let args=CommandLine.arguments
  let manifest=try JSONSerialization.jsonObject(with:Data(contentsOf:URL(fileURLWithPath:args[1]))) as! [String:Any]
  let source=AVURLAsset(url:URL(fileURLWithPath:manifest["video"] as! String))
  let duration=try await source.load(.duration)
  guard duration.seconds.isFinite && duration.seconds>0 && duration.seconds<=7200 else {throw invalid("Use a video shorter than two hours.")}
  guard let sourceVideo=try await source.loadTracks(withMediaType:.video).first else {throw invalid("This file has no readable video track. Try an H.264 MP4 or MOV.")}
  let audioTracks=try await source.loadTracks(withMediaType:.audio)
  let mode=manifest["mode"] as! String
  if mode == "inspect" {
   try emit(["duration":duration.seconds,"hasAudio": !audioTracks.isEmpty]);exit(0)
  }
  let output=URL(fileURLWithPath:manifest["output"] as! String)
  if mode == "extract" {
   guard let track=audioTracks.first else {throw invalid("This video has no audio. Write or paste a dubbing script instead.")}
   guard duration.seconds<=600 else {throw invalid("Automatic transcription supports videos up to 10 minutes. Paste a script for longer videos.")}
   let reader=try AVAssetReader(asset:source)
   let settings:[String:Any]=[AVFormatIDKey:kAudioFormatLinearPCM,AVSampleRateKey:16000,AVNumberOfChannelsKey:1,AVLinearPCMBitDepthKey:16,AVLinearPCMIsFloatKey:false,AVLinearPCMIsBigEndianKey:false,AVLinearPCMIsNonInterleaved:false]
   let readerOutput=AVAssetReaderTrackOutput(track:track,outputSettings:settings);reader.add(readerOutput)
   let writer=try AVAssetWriter(outputURL:output,fileType:.wav)
   let input=AVAssetWriterInput(mediaType:.audio,outputSettings:settings);writer.add(input)
   guard writer.startWriting(),reader.startReading() else {throw invalid("Could not extract this video's audio.")}
   writer.startSession(atSourceTime:.zero)
   while let sample=readerOutput.copyNextSampleBuffer() {
    while !input.isReadyForMoreMediaData {if writer.status == .failed {throw writer.error!};try await Task.sleep(nanoseconds:10_000_000)}
    guard input.append(sample) else {throw writer.error ?? invalid("Could not extract audio.")}
   }
   guard reader.status == .completed else {throw reader.error ?? invalid("Could not read audio.")}
   input.markAsFinished();await writer.finishWriting()
   guard writer.status == .completed else {throw writer.error ?? invalid("Could not save audio.")}
   try emit(["duration":duration.seconds]);exit(0)
  }
  guard mode == "render" else {throw invalid("Unknown video operation.")}
  let voice=AVURLAsset(url:URL(fileURLWithPath:manifest["audio"] as! String))
  guard let voiceTrack=try await voice.loadTracks(withMediaType:.audio).first else {throw invalid("The voice take has no readable audio.")}
  let voiceRange=try await voiceTrack.load(.timeRange)
  let start=manifest["start"] as! Double
  let available=duration.seconds-start
  guard start.isFinite && start>=0 && available>0 else {throw invalid("Start the voice before the video ends.")}
  let fit=manifest["timing"] as? String == "fit"
  guard voiceRange.duration.seconds.isFinite && voiceRange.duration.seconds>0 else {throw invalid("The voice take is empty.")}
  if !fit && voiceRange.duration.seconds>available+0.02 {throw invalid("The voice is longer than the remaining video. Choose Fit to video, shorten the script, or start earlier.")}
  let ratio=voiceRange.duration.seconds/available
  if fit && (ratio<0.5 || ratio>2) {throw invalid("Fit to video supports 0.5× to 2× voice speed. Adjust your script or voice start.")}
  let composition=AVMutableComposition()
  let video=composition.addMutableTrack(withMediaType:.video,preferredTrackID:kCMPersistentTrackID_Invalid)!
  try video.insertTimeRange(CMTimeRange(start:.zero,duration:duration),of:sourceVideo,at:.zero)
  video.preferredTransform=try await sourceVideo.load(.preferredTransform)
  let audio=composition.addMutableTrack(withMediaType:.audio,preferredTrackID:kCMPersistentTrackID_Invalid)!
  let offset=CMTime(seconds:start,preferredTimescale:600)
  try audio.insertTimeRange(voiceRange,of:voiceTrack,at:offset)
  if fit {audio.scaleTimeRange(CMTimeRange(start:offset,duration:voiceRange.duration),toDuration:duration-offset)}
  guard let exporter=AVAssetExportSession(asset:composition,presetName:AVAssetExportPresetHighestQuality) else {throw invalid("Video export is unavailable.")}
  exporter.outputURL=output;exporter.outputFileType = .mp4;exporter.shouldOptimizeForNetworkUse=true
  exporter.audioTimePitchAlgorithm = .spectral
  exporter.timeRange=CMTimeRange(start:.zero,duration:duration)
  await exporter.export()
  guard exporter.status == .completed else {throw exporter.error ?? invalid("Video export failed.")}
  try emit(["duration":duration.seconds,"voiceDuration":voiceRange.duration.seconds]);exit(0)
 } catch {fputs("\(error.localizedDescription)\n",stderr);exit(1)}
}
dispatchMain()
