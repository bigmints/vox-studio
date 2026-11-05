import Foundation
import AVFoundation
import CoreVideo
let output=URL(fileURLWithPath:CommandLine.arguments[1])
let writer=try AVAssetWriter(outputURL:output,fileType:.mp4)
let input=AVAssetWriterInput(mediaType:.video,outputSettings:[AVVideoCodecKey:AVVideoCodecType.h264,AVVideoWidthKey:32,AVVideoHeightKey:32])
let adaptor=AVAssetWriterInputPixelBufferAdaptor(assetWriterInput:input,sourcePixelBufferAttributes:[kCVPixelBufferPixelFormatTypeKey as String:kCVPixelFormatType_32ARGB,kCVPixelBufferWidthKey as String:32,kCVPixelBufferHeightKey as String:32])
writer.add(input);writer.startWriting();writer.startSession(atSourceTime:.zero)
for frame in 0..<60 {
 while !input.isReadyForMoreMediaData {Thread.sleep(forTimeInterval:0.01)}
 var pixel:CVPixelBuffer?;CVPixelBufferPoolCreatePixelBuffer(nil,adaptor.pixelBufferPool!,&pixel)
 CVPixelBufferLockBaseAddress(pixel!,[]);memset(CVPixelBufferGetBaseAddress(pixel!),128,CVPixelBufferGetDataSize(pixel!));CVPixelBufferUnlockBaseAddress(pixel!,[])
 adaptor.append(pixel!,withPresentationTime:CMTime(value:Int64(frame),timescale:30))
}
input.markAsFinished();let done=DispatchSemaphore(value:0);writer.finishWriting{done.signal()};done.wait();if writer.status != .completed {exit(1)}
