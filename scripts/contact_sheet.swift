// Make a 4-frame contact sheet of a video so it can be labelled at a glance.
// Usage: swift scripts/contact_sheet.swift <video> <out.jpg>
import AVFoundation
import AppKit

let args = CommandLine.arguments
guard args.count == 3 else { print("usage: contact_sheet <video> <out.jpg>"); exit(1) }
let asset = AVURLAsset(url: URL(fileURLWithPath: args[1]))
let gen = AVAssetImageGenerator(asset: asset)
gen.appliesPreferredTrackTransform = true
gen.maximumSize = CGSize(width: 360, height: 640)
gen.requestedTimeToleranceBefore = .zero
gen.requestedTimeToleranceAfter = CMTime(seconds: 0.5, preferredTimescale: 600)

let duration = CMTimeGetSeconds(asset.duration)
let frames: [CGImage] = [0.08, 0.35, 0.62, 0.9].compactMap {
    try? gen.copyCGImage(at: CMTime(seconds: duration * $0, preferredTimescale: 600), actualTime: nil)
}
guard let first = frames.first else { print("no frames"); exit(1) }
let w = first.width, h = first.height, gap = 8
let sheet = NSImage(size: NSSize(width: w * frames.count + gap * (frames.count - 1), height: h))
sheet.lockFocus()
NSColor.black.setFill()
NSRect(origin: .zero, size: sheet.size).fill()
for (i, f) in frames.enumerated() {
    NSImage(cgImage: f, size: NSSize(width: w, height: h))
        .draw(in: NSRect(x: i * (w + gap), y: 0, width: w, height: h))
}
sheet.unlockFocus()
let rep = NSBitmapImageRep(data: sheet.tiffRepresentation!)!
try! rep.representation(using: .jpeg, properties: [.compressionFactor: 0.7])!
    .write(to: URL(fileURLWithPath: args[2]))
