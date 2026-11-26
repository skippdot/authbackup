@preconcurrency import AVFoundation
import AuthBackupCore
import SwiftUI

/// The camera, reading QR codes until it has what it needs: one link, or every QR code of a Google Authenticator export.
struct ScannerScreen: View {
    @Binding var batch: ImportBatch
    let onComplete: () -> Void

    @State private var status = AVCaptureDevice.authorizationStatus(for: .video)
    @State private var hint: String?
    @State private var seen = Set<String>()

    var body: some View {
        ZStack(alignment: .bottom) {
            camera
            VStack(spacing: 8) {
                if let pending = batch.pendingMigration {
                    Text("Scanned \(pending.seen) of \(pending.size). Show the next QR code.")
                } else if let hint {
                    Text(hint)
                } else {
                    Text("Point the camera at a QR code")
                }
            }
            .font(.subheadline.weight(.medium))
            .multilineTextAlignment(.center)
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 12))
            .padding(24)
        }
        .navigationTitle("Scan")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if !batch.isEmpty {
                ToolbarItem(placement: .confirmationAction) { Button("Done", action: onComplete) }
            }
        }
        .task {
            if status == .notDetermined {
                _ = await AVCaptureDevice.requestAccess(for: .video)
                status = AVCaptureDevice.authorizationStatus(for: .video)
            }
        }
    }

    @ViewBuilder private var camera: some View {
        switch status {
        case .authorized where AVCaptureDevice.default(for: .video) != nil:
            CameraView { found($0) }.ignoresSafeArea(edges: .bottom)
        case .authorized, .notDetermined:
            ContentUnavailableView("No camera", systemImage: "camera",
                                   description: Text("Choose a screenshot instead, or paste the link."))
        default:
            ContentUnavailableView {
                Label("No access to the camera", systemImage: "camera.fill")
            } description: {
                Text("Allow AuthBackup to use the camera in Settings, or choose a screenshot instead.")
            } actions: {
                Button("Open Settings") {
                    if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
                }
            }
        }
    }

    private func found(_ text: String) {
        guard seen.insert(text).inserted else { return }
        guard batch.add(text: text) else {
            hint = String(localized: "This QR code holds no two-factor key.")
            return
        }
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        if batch.pendingMigration == nil { onComplete() }
    }
}

/// AVFoundation's QR reader: works on every iPhone and iPad with a camera.
private struct CameraView: UIViewRepresentable {
    let onCode: @MainActor (String) -> Void

    func makeUIView(context: Context) -> PreviewView {
        let view = PreviewView()
        view.start(onCode: onCode)
        return view
    }

    func updateUIView(_ uiView: PreviewView, context: Context) {}

    static func dismantleUIView(_ uiView: PreviewView, coordinator: ()) { uiView.stop() }

    final class PreviewView: UIView, AVCaptureMetadataOutputObjectsDelegate {
        override class var layerClass: AnyClass { AVCaptureVideoPreviewLayer.self }
        private let session = AVCaptureSession()
        private var onCode: (@MainActor (String) -> Void)?

        func start(onCode: @escaping @MainActor (String) -> Void) {
            self.onCode = onCode
            guard let device = AVCaptureDevice.default(for: .video), let input = try? AVCaptureDeviceInput(device: device),
                  session.canAddInput(input) else { return }
            session.addInput(input)
            let output = AVCaptureMetadataOutput()
            guard session.canAddOutput(output) else { return }
            session.addOutput(output)
            output.setMetadataObjectsDelegate(self, queue: .main)
            output.metadataObjectTypes = [.qr]
            let layer = self.layer as! AVCaptureVideoPreviewLayer
            layer.session = session
            layer.videoGravity = .resizeAspectFill
            let session = self.session
            DispatchQueue.global(qos: .userInitiated).async { session.startRunning() }
        }

        func stop() {
            let session = self.session
            DispatchQueue.global(qos: .userInitiated).async { session.stopRunning() }
        }

        nonisolated func metadataOutput(_ output: AVCaptureMetadataOutput, didOutput objects: [AVMetadataObject], from connection: AVCaptureConnection) {
            let texts = objects.compactMap { ($0 as? AVMetadataMachineReadableCodeObject)?.stringValue }
            MainActor.assumeIsolated {
                texts.forEach { onCode?($0) }
            }
        }
    }
}
