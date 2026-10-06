@preconcurrency import UniformTypeIdentifiers
import UIKit

@MainActor
final class ShareViewController: UIViewController {
    private let statusLabel = UILabel()
    private let detailLabel = UILabel()
    private let activityIndicator = UIActivityIndicatorView(style: .medium)
    private let doneButton = UIButton(type: .system)
    private var hasStarted = false
    private var didFinish = false

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .systemBackground

        statusLabel.text = "Preparing screenshot for Rallyroo…"
        statusLabel.numberOfLines = 0
        statusLabel.adjustsFontForContentSizeCategory = true
        statusLabel.font = .preferredFont(forTextStyle: .headline)
        statusLabel.textAlignment = .center
        detailLabel.text = "Images stay on this device. You will review drafts in Rallyroo before adding them."
        detailLabel.adjustsFontForContentSizeCategory = true
        detailLabel.font = .preferredFont(forTextStyle: .subheadline)
        detailLabel.textColor = .secondaryLabel
        detailLabel.textAlignment = .center
        detailLabel.numberOfLines = 0
        activityIndicator.startAnimating()
        doneButton.setTitle("Cancel", for: .normal)
        doneButton.addTarget(self, action: #selector(finish), for: .touchUpInside)

        let stack = UIStackView(arrangedSubviews: [activityIndicator, statusLabel, detailLabel, doneButton])
        stack.axis = .vertical
        stack.spacing = 16
        stack.alignment = .fill
        stack.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(stack)
        NSLayoutConstraint.activate([
            stack.leadingAnchor.constraint(equalTo: view.layoutMarginsGuide.leadingAnchor),
            stack.trailingAnchor.constraint(equalTo: view.layoutMarginsGuide.trailingAnchor),
            stack.centerYAnchor.constraint(equalTo: view.centerYAnchor),
        ])
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        guard !hasStarted else { return }
        hasStarted = true
        Task { await receiveImage() }
    }

    private func receiveImage() async {
        do {
            let data = try await sharedImageData()
            guard !didFinish else { return }
            let queue = try SharedScheduleCaptureQueue.appGroup()
            try queue.enqueue(data)
            activityIndicator.stopAnimating()
            statusLabel.text = "Ready to review in Rallyroo"
            detailLabel.text = "Tap Done, then open Rallyroo to review this screenshot. Images stay on-device; only recognized text is used to create drafts."
            doneButton.setTitle("Done", for: .normal)
            UIAccessibility.post(notification: .announcement, argument: statusLabel.text)
        } catch {
            guard !didFinish else { return }
            activityIndicator.stopAnimating()
            statusLabel.text = "Image not shared"
            detailLabel.text = "Rallyroo could not read this image. Try sharing a screenshot or photo again."
            doneButton.setTitle("Close", for: .normal)
        }
    }

    private func sharedImageData() async throws -> Data {
        let providers = extensionContext?.inputItems
            .compactMap { $0 as? NSExtensionItem }
            .flatMap { $0.attachments ?? [] } ?? []
        guard let provider = providers.first(where: {
            $0.hasItemConformingToTypeIdentifier(UTType.image.identifier)
        }) else {
            throw SharedScheduleCaptureQueueError.invalidImage
        }
        return try await withCheckedThrowingContinuation { continuation in
            provider.loadDataRepresentation(forTypeIdentifier: UTType.image.identifier) { data, error in
                if let data {
                    continuation.resume(returning: data)
                } else {
                    continuation.resume(throwing: error ?? SharedScheduleCaptureQueueError.invalidImage)
                }
            }
        }
    }

    @objc private func finish() {
        didFinish = true
        extensionContext?.completeRequest(returningItems: nil)
    }
}
