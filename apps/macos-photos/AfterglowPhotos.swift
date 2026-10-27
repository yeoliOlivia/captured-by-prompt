import AppKit
import Foundation
import ImageIO
import Photos
import SwiftUI
import UniformTypeIdentifiers

private let studioURL = URL(string: "http://127.0.0.1:8790/studio")!
private let ink = Color(red: 0.17, green: 0.22, blue: 0.18)
private let cream = Color(red: 0.975, green: 0.965, blue: 0.94)
private let accent = Color(red: 0.30, green: 0.40, blue: 0.28)

private struct ImportFailure: LocalizedError {
    let message: String
    var errorDescription: String? { message }
}

private struct Album: Identifiable {
    let collection: PHAssetCollection
    let photoCount: Int
    var id: String { collection.localIdentifier }
    var title: String { collection.localizedTitle ?? "Untitled album" }
    var isShared: Bool { collection.assetCollectionSubtype == .albumCloudShared }
}

private struct Workspace: Decodable { let datasetId: String }
private struct AssetReceipt: Decodable {
    let assetId: String
    let modifiedAt: String?
    let photoId: String
}
private struct AlbumConnection: Decodable {
    let connectionId: String
    let tripId: String
    let assets: [AssetReceipt]
    let reused: Bool
}
private struct UploadReceipt: Decodable {
    let photoId: String
    let tripId: String
    let cached: Bool
    let updated: Bool
    let added: Int
}
private struct ConnectPayload: Encodable {
    let clientId: String
    let albumId: String
    let albumTitle: String
}
private struct Coordinates: Encodable { let lat: Double; let lon: Double }
private struct AssetPayload: Encodable {
    let connectionId: String
    let assetId: String
    let modifiedAt: String?
    let name: String
    let jpegBase64: String
    let capturedAt: String?
    let place: Coordinates?

    private enum CodingKeys: String, CodingKey { case connectionId, assetId, modifiedAt, name, jpegBase64, capturedAt, place }
    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(connectionId, forKey: .connectionId)
        try container.encode(assetId, forKey: .assetId)
        try container.encode(modifiedAt, forKey: .modifiedAt)
        try container.encode(name, forKey: .name)
        try container.encode(jpegBase64, forKey: .jpegBase64)
        try container.encode(capturedAt, forKey: .capturedAt)
        try container.encode(place, forKey: .place)
    }
}

// No cookies, remote addresses, redirects, or API keys. The local server owns
// the import ledger; reopening the companion never requires a second mapping.
private final class NoRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }
}

@MainActor
private final class Backend {
    private let delegate = NoRedirects()
    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.httpShouldSetCookies = false
        config.httpCookieAcceptPolicy = .never
        config.timeoutIntervalForRequest = 45
        config.timeoutIntervalForResource = 180
        return URLSession(configuration: config, delegate: delegate, delegateQueue: nil)
    }()
    private var token = ""

    func connect() async throws -> Workspace {
        let html = try await request(path: "/studio")
        let text = String(decoding: html, as: UTF8.self)
        let regex = try NSRegularExpression(pattern: #"name="playground-session" content="([a-f0-9]{32,128})""#)
        guard let match = regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)),
              let range = Range(match.range(at: 1), in: text) else {
            throw ImportFailure(message: "The local workspace did not provide a session. Start the current Afterglow server and try again.")
        }
        token = String(text[range])
        return try await status()
    }

    func status() async throws -> Workspace {
        try JSONDecoder().decode(Workspace.self, from: await request(path: "/api/studio/status"))
    }

    func link(clientId: String, album: Album) async throws -> AlbumConnection {
        let payload = ConnectPayload(clientId: clientId, albumId: album.id, albumTitle: album.title)
        return try JSONDecoder().decode(AlbumConnection.self, from: await request(path: "/api/studio/mac/imports/connect", body: JSONEncoder().encode(payload)))
    }

    func upload(_ payload: AssetPayload) async throws -> UploadReceipt {
        try JSONDecoder().decode(UploadReceipt.self, from: await request(path: "/api/studio/mac/imports/asset", body: JSONEncoder().encode(payload)))
    }

    private func request(path: String, body: Data? = nil) async throws -> Data {
        guard path.hasPrefix("/"), let url = URL(string: "http://127.0.0.1:8790" + path),
              url.scheme == "http", url.host == "127.0.0.1", url.port == 8790 else {
            throw ImportFailure(message: "Imports can connect only to this Mac’s local workspace.")
        }
        var request = URLRequest(url: url)
        request.cachePolicy = .reloadIgnoringLocalCacheData
        if let body {
            request.httpMethod = "POST"
            request.httpBody = body
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.setValue(token, forHTTPHeaderField: "x-playground-session")
        }
        do {
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse else {
                throw ImportFailure(message: "The local workspace returned an unexpected response.")
            }
            guard (200..<300).contains(http.statusCode) else {
                if http.statusCode == 403 { throw ImportFailure(message: "The workspace restarted or its session expired. Import / Refresh will reconnect and resume saved work.") }
                if http.statusCode == 409 { throw ImportFailure(message: "The workspace is busy. Let its current operation finish, then import again.") }
                if http.statusCode == 404 { throw ImportFailure(message: "This workspace does not have the album importer, or it changed during import. Start the latest server and try again.") }
                let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
                throw ImportFailure(message: object?["message"] as? String ?? "The workspace could not save this photo (HTTP \(http.statusCode)). Try again after checking the local server.")
            }
            return data
        } catch let error as URLError {
            if error.code == .cancelled { throw CancellationError() }
            throw ImportFailure(message: "Couldn’t reach Afterglow on this Mac. Start the web workspace at 127.0.0.1:8790, then try again. Completed imports are saved.")
        }
    }
}

// PhotoKit can call a result handler more than once and cancellation can race
// the final image. This latch resumes exactly once and cancels the request ID.
private final class PhotoRequest: @unchecked Sendable {
    private let lock = NSLock()
    private let manager = PHImageManager.default()
    private var continuation: CheckedContinuation<NSImage, Error>?
    private var requestId: PHImageRequestID?
    private var completed = false

    func install(_ value: CheckedContinuation<NSImage, Error>) -> Bool {
        lock.lock()
        if completed { lock.unlock(); value.resume(throwing: CancellationError()); return false }
        continuation = value
        lock.unlock()
        return true
    }

    func track(_ id: PHImageRequestID) {
        lock.lock(); requestId = id; let shouldCancel = completed; lock.unlock()
        if shouldCancel { manager.cancelImageRequest(id) }
    }

    func finish(_ result: Result<NSImage, Error>) {
        lock.lock()
        guard !completed else { lock.unlock(); return }
        completed = true
        let value = continuation; continuation = nil
        lock.unlock()
        value?.resume(with: result)
    }

    func cancel() {
        finish(.failure(CancellationError()))
        lock.lock(); let id = requestId; lock.unlock()
        if let id { manager.cancelImageRequest(id) }
    }

    @MainActor static func image(for asset: PHAsset, progress: @escaping @Sendable (Double) -> Void) async throws -> NSImage {
        let request = PhotoRequest()
        return try await withTaskCancellationHandler {
            try Task.checkCancellation()
            return try await withCheckedThrowingContinuation { continuation in
                guard request.install(continuation) else { return }
                let options = PHImageRequestOptions()
                options.deliveryMode = .highQualityFormat
                options.resizeMode = .exact
                options.version = .current
                options.isNetworkAccessAllowed = true
                options.progressHandler = { value, _, _, _ in progress(value) }
                let id = request.manager.requestImage(for: asset, targetSize: CGSize(width: 1024, height: 1024), contentMode: .aspectFit, options: options) { image, info in
                    if info?[PHImageCancelledKey] as? Bool == true { request.finish(.failure(CancellationError())); return }
                    if info?[PHImageErrorKey] is Error {
                        request.finish(.failure(ImportFailure(message: "Photos couldn’t download or read this image."))); return
                    }
                    if info?[PHImageResultIsDegradedKey] as? Bool == true { return }
                    guard let image else { request.finish(.failure(ImportFailure(message: "A photo preview is not available yet. Let Photos finish syncing, then retry."))); return }
                    request.finish(.success(image))
                }
                request.track(id)
            }
        } onCancel: { request.cancel() }
    }
}

@MainActor
private final class ImportModel: ObservableObject {
    @Published var albums: [Album] = []
    @Published var selection: String?
    @Published var busy = false
    @Published var importing = false
    @Published var connected = false
    @Published var limited = false
    @Published var completed = 0
    @Published var total = 0
    @Published var saved = 0
    @Published var unchanged = 0
    @Published var unavailable = 0
    @Published var status = "Choose an album. Keep the originals exactly where they are."
    @Published var detail = ""
    @Published var error: String?
    private let backend = Backend()
    private var operation: Task<Void, Never>?
    private var runID = UUID()
    private let clientId: String

    init() {
        let defaults = UserDefaults.standard
        if let existing = defaults.string(forKey: "afterglow.installation-id"), UUID(uuidString: existing) != nil {
            clientId = existing
        } else {
            clientId = UUID().uuidString.lowercased()
            defaults.set(clientId, forKey: "afterglow.installation-id")
        }
    }

    var selectedAlbum: Album? { albums.first { $0.id == selection } }

    func loadAlbums() {
        guard !busy else { return }
        busy = true; error = nil; status = "Connecting to your local workspace…"; detail = ""
        operation = Task {
            defer { busy = false; operation = nil }
            do {
                _ = try await backend.connect(); connected = true
                try Task.checkCancellation()
                let previous = PHPhotoLibrary.authorizationStatus(for: .readWrite)
                let permission: PHAuthorizationStatus
                if previous == .notDetermined {
                    status = "Allow access to choose a Photos album."
                    permission = await withCheckedContinuation { continuation in
                        PHPhotoLibrary.requestAuthorization(for: .readWrite) { continuation.resume(returning: $0) }
                    }
                } else { permission = previous }
                try Task.checkCancellation()
                guard permission == .authorized || permission == .limited else {
                    throw ImportFailure(message: "Photos access is off. Allow Afterglow Photos in System Settings → Privacy & Security → Photos, then load your albums again.")
                }
                limited = permission == .limited
                var available: [Album] = []
                let collections = PHAssetCollection.fetchAssetCollections(with: .album, subtype: .any, options: nil)
                collections.enumerateObjects { collection, _, _ in
                    let options = PHFetchOptions(); options.predicate = NSPredicate(format: "mediaType == %d", PHAssetMediaType.image.rawValue)
                    let count = PHAsset.fetchAssets(in: collection, options: options).count
                    available.append(Album(collection: collection, photoCount: count))
                }
                albums = available.sorted { $0.title.localizedStandardCompare($1.title) == .orderedAscending }
                if !albums.contains(where: { $0.id == selection }) { selection = nil }
                status = albums.isEmpty ? "No accessible albums found." : "Your albums are ready. Choose one to bring into Afterglow."
                detail = albums.isEmpty ? "Create an album in Photos, or wait for iCloud Photos to sync on this Mac, then reload. Smart albums and the entire library are not imported automatically." : "Only the album you select will be copied. Shared albums appear when Photos makes them available."
            } catch is CancellationError { status = "Stopped. Nothing in Photos was changed." }
            catch { self.error = error.localizedDescription; status = "A quick check before we continue." }
        }
    }

    func startImport() {
        guard !busy, let album = selectedAlbum else { return }
        busy = true; importing = true; completed = 0; total = 0; saved = 0; unchanged = 0; unavailable = 0
        error = nil; detail = ""; status = "Checking saved progress…"; runID = UUID()
        let currentRun = runID
        operation = Task {
            defer { busy = false; importing = false; operation = nil }
            do {
                let permission = PHPhotoLibrary.authorizationStatus(for: .readWrite)
                guard permission == .authorized || permission == .limited else {
                    throw ImportFailure(message: "Photos permission changed. Load your albums again before importing.")
                }
                limited = permission == .limited
                let workspace = try await backend.connect(); connected = true
                let options = PHFetchOptions()
                options.predicate = NSPredicate(format: "mediaType == %d", PHAssetMediaType.image.rawValue)
                options.sortDescriptors = [NSSortDescriptor(key: "creationDate", ascending: true)]
                let assets = PHAsset.fetchAssets(in: album.collection, options: options)
                total = assets.count
                guard total <= 10_000 else { throw ImportFailure(message: "This album has more than 10,000 photos. Choose or create a smaller trip album in Photos.") }
                guard total > 0 else { throw ImportFailure(message: "This album has no accessible still photos. Videos are not imported.") }
                try Task.checkCancellation()
                let connection = try await backend.link(clientId: clientId, album: album)
                let receipts = Dictionary(connection.assets.map { ($0.assetId, $0) }, uniquingKeysWith: { _, last in last })
                let dates = ISO8601DateFormatter(); dates.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
                var failedNames: [String] = []
                for index in 0..<assets.count {
                    try Task.checkCancellation()
                    let asset = assets.object(at: index)
                    let modified = asset.modificationDate.map { dates.string(from: $0) }
                    if let modified, receipts[asset.localIdentifier]?.modifiedAt == modified {
                        unchanged += 1; completed += 1; continue
                    }
                    let name = PHAssetResource.assetResources(for: asset).first?.originalFilename ?? "Photo-\(index + 1).jpg"
                    status = "Bringing in \(album.title)"
                    detail = "Photo \(index + 1) of \(total) · \(name)"
                    let data: Data
                    do {
                        let image = try await PhotoRequest.image(for: asset) { [weak self] value in
                            Task { @MainActor in
                                guard let self, self.runID == currentRun, self.importing else { return }
                                self.detail = "Photo \(index + 1) of \(self.total) · Downloading from iCloud \(Int(value * 100))%"
                            }
                        }
                        try Task.checkCancellation()
                        guard let pixels = image.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
                            throw ImportFailure(message: "This photo could not be converted to a preview.")
                        }
                        data = try jpegPreview(pixels)
                    } catch is CancellationError { throw CancellationError() }
                    catch {
                        unavailable += 1; completed += 1
                        if failedNames.count < 3 { failedNames.append(name) }
                        continue
                    }
                    let location = asset.location.map { Coordinates(lat: $0.coordinate.latitude, lon: $0.coordinate.longitude) }
                    let payload = AssetPayload(connectionId: connection.connectionId, assetId: asset.localIdentifier, modifiedAt: modified,
                                               name: name, jpegBase64: data.base64EncodedString(), capturedAt: asset.creationDate.map { dates.string(from: $0) }, place: location)
                    let receipt = try await backend.upload(payload)
                    if receipt.cached { unchanged += 1 } else { saved += 1 }
                    completed += 1
                }
                let latest = try await backend.status()
                guard latest.datasetId == workspace.datasetId else { throw ImportFailure(message: "The workspace changed during import. Reconnect and refresh the album; completed photos remain in their original workspace.") }
                status = unavailable == 0 ? "Your album is in Afterglow." : "Album imported, with a few photos to retry."
                detail = unavailable == 0 ? "Open the studio to find “\(album.title)”. Refresh adds new or edited previews; removing a photo from Photos does not remove its imported copy." : "\(unavailable) photos were unavailable. Let Photos finish syncing, then Import / Refresh to retry. \(failedNames.joined(separator: ", "))"
            } catch is CancellationError {
                status = "Import stopped. Your progress is saved."
                detail = "Import / Refresh checks the workspace ledger and resumes. A photo finishing when you stopped may already be saved."
            } catch {
                self.error = error.localizedDescription
                status = "Import paused. Completed photos are saved."
                detail = "Import / Refresh will check saved progress before uploading again."
            }
        }
    }

    func cancel() { status = "Stopping…"; operation?.cancel() }

}

// Core Graphics keeps encoding independent of the Photos and window lifecycles.
private func jpegPreview(_ source: CGImage) throws -> Data {
        let scale = min(1, 1024 / Double(max(source.width, source.height)))
        let width = max(1, Int(Double(source.width) * scale)), height = max(1, Int(Double(source.height) * scale))
        guard let context = CGContext(data: nil, width: width, height: height, bitsPerComponent: 8, bytesPerRow: 0,
                                      space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else { throw ImportFailure(message: "Could not prepare a photo preview.") }
        context.setFillColor(CGColor(red: 1, green: 1, blue: 1, alpha: 1)); context.fill(CGRect(x: 0, y: 0, width: width, height: height))
        context.interpolationQuality = .high
        context.draw(source, in: CGRect(x: 0, y: 0, width: width, height: height))
        guard let rendered = context.makeImage() else { throw ImportFailure(message: "Could not render a photo preview.") }
        let output = NSMutableData()
        guard let destination = CGImageDestinationCreateWithData(output, UTType.jpeg.identifier as CFString, 1, nil) else { throw ImportFailure(message: "Could not encode a photo preview.") }
        CGImageDestinationAddImage(destination, rendered, [kCGImageDestinationLossyCompressionQuality: 0.88] as CFDictionary)
        guard CGImageDestinationFinalize(destination) else { throw ImportFailure(message: "Could not save a photo preview.") }
        return output as Data
}

private struct ContentView: View {
    @StateObject private var model = ImportModel()
    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 10) {
                    Label("AFTERGLOW / PHOTOS", systemImage: "sun.max").font(.system(size: 11, weight: .semibold, design: .monospaced)).tracking(2)
                    Text("Bring the trip together.").font(.system(size: 35, weight: .medium, design: .serif))
                    Text("One album from Photos. A little more out of every moment.").font(.system(size: 14)).foregroundStyle(.secondary)
                }
                Spacer()
                Text(model.connected ? "LOCAL WORKSPACE" : "ON THIS MAC").font(.system(size: 10, weight: .medium, design: .monospaced)).padding(.horizontal, 12).padding(.vertical, 8).background(accent.opacity(0.10), in: Capsule())
            }
            VStack(alignment: .leading, spacing: 14) {
                HStack {
                    Text("Choose your album").font(.system(size: 17, weight: .medium))
                    Spacer()
                    Button(model.albums.isEmpty ? "Connect to Photos" : "Reload albums", action: model.loadAlbums).disabled(model.busy)
                }
                if model.albums.isEmpty {
                    VStack(spacing: 12) {
                        Image(systemName: "photo.stack").font(.system(size: 30, weight: .light))
                        Text("Your originals stay in Photos.").font(.system(size: 17, weight: .medium, design: .serif))
                        Text("Connect to choose a single album. We’ll copy small previews into the local studio, along with capture dates and approximate places.")
                            .font(.system(size: 13)).foregroundStyle(.secondary).multilineTextAlignment(.center).frame(maxWidth: 420)
                    }.frame(maxWidth: .infinity, minHeight: 200)
                } else {
                    List(model.albums, selection: $model.selection) { album in
                        HStack(spacing: 12) {
                            Image(systemName: album.isShared ? "person.2.crop.square.stack" : "rectangle.stack").frame(width: 25).foregroundStyle(accent)
                            VStack(alignment: .leading, spacing: 3) {
                                Text(album.title).font(.system(size: 14, weight: .medium))
                                Text("\(album.photoCount) accessible photos\(album.isShared ? " · Shared album" : "")").font(.system(size: 11)).foregroundStyle(.secondary)
                            }
                            Spacer()
                        }.padding(.vertical, 5).tag(album.id)
                    }.listStyle(.inset).scrollContentBackground(.hidden).frame(minHeight: 150, maxHeight: 220).disabled(model.busy)
                }
                if model.limited {
                    Label("Limited Photos access: album counts and imports include only the photos macOS lets this app see.", systemImage: "eye").font(.system(size: 12)).foregroundStyle(.secondary)
                }
            }.padding(20).background(.white.opacity(0.7), in: RoundedRectangle(cornerRadius: 20))
            VStack(alignment: .leading, spacing: 9) {
                Text(model.status).font(.system(size: 15, weight: .medium))
                if !model.detail.isEmpty { Text(model.detail).font(.system(size: 12)).foregroundStyle(.secondary).lineLimit(3).textSelection(.enabled) }
                if model.importing || model.completed > 0 {
                    ProgressView(value: Double(model.completed), total: Double(max(1, model.total))).tint(accent)
                    Text("\(model.saved) saved · \(model.unchanged) unchanged · \(model.unavailable) unavailable").font(.system(size: 11, design: .monospaced)).foregroundStyle(.secondary)
                }
                if let error = model.error { Text(error).font(.system(size: 12)).foregroundStyle(Color(red: 0.55, green: 0.22, blue: 0.16)).textSelection(.enabled) }
            }.frame(minHeight: 64, alignment: .top)
            Spacer(minLength: 0)
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text("No AI calls during import.").font(.system(size: 12, weight: .medium))
                    Text("No library edits, deletion, or automatic sharing. Still photos only.").font(.system(size: 11)).foregroundStyle(.secondary)
                }
                Spacer()
                if model.busy { Button("Stop", action: model.cancel) }
                Button("Open studio") { NSWorkspace.shared.open(studioURL) }.buttonStyle(.bordered)
                Button("Import / Refresh", action: model.startImport).buttonStyle(.borderedProminent).tint(accent).disabled(model.busy || model.selectedAlbum == nil)
            }
        }
        .padding(30).frame(minWidth: 760, minHeight: 650).background(cream).foregroundStyle(ink)
    }
}

private final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}

// Local contract checks only: no HTTP requests, windows, Photos queries, or
// authorization prompts. Run the signed executable with --self-test.
@MainActor
private func runSelfTests() throws {
    func check(_ condition: @autoclosure () -> Bool, _ message: String) throws {
        if !condition() { throw ImportFailure(message: "Self-test failed: \(message)") }
    }
    let connectionJSON = #"{"connectionId":"00000000-0000-4000-8000-000000000001","tripId":"00000000-0000-4000-8000-000000000002","reused":true,"assets":[{"assetId":"test-asset","modifiedAt":null,"photoId":"test-photo"}]}"#
    let connection = try JSONDecoder().decode(AlbumConnection.self, from: Data(connectionJSON.utf8))
    try check(connection.reused && connection.assets.count == 1 && connection.assets[0].modifiedAt == nil, "album ledger response")
    for added in [0, 1] {
        let receiptJSON = "{\"photoId\":\"test-photo\",\"tripId\":\"test-trip\",\"cached\":false,\"updated\":true,\"added\":\(added)}"
        let receipt = try JSONDecoder().decode(UploadReceipt.self, from: Data(receiptJSON.utf8))
        try check(receipt.added == added && receipt.updated, "upload addition count must decode as a number")
    }
    let payload = AssetPayload(connectionId: connection.connectionId, assetId: "test-asset", modifiedAt: nil, name: "test.jpg", jpegBase64: "dGVzdA==", capturedAt: nil, place: nil)
    let object = try JSONSerialization.jsonObject(with: JSONEncoder().encode(payload)) as! [String: Any]
    try check(object["modifiedAt"] is NSNull && object["capturedAt"] is NSNull && object["place"] is NSNull, "missing metadata must encode explicit nulls")
    let connectPayload = ConnectPayload(clientId: "test-installation", albumId: "test-album", albumTitle: "Test trip")
    let connectObject = try JSONSerialization.jsonObject(with: JSONEncoder().encode(connectPayload)) as! [String: Any]
    try check(Set(connectObject.keys) == ["clientId", "albumId", "albumTitle"], "album connection fields")
    guard let pixels = CGContext(data: nil, width: 1800, height: 900, bitsPerComponent: 8, bytesPerRow: 0,
                                 space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue) else {
        throw ImportFailure(message: "Self-test failed: image fixture allocation")
    }
    pixels.setFillColor(CGColor(red: 0.2, green: 0.4, blue: 0.3, alpha: 1))
    pixels.fill(CGRect(x: 0, y: 0, width: 1800, height: 900))
    guard let fixture = pixels.makeImage() else { throw ImportFailure(message: "Self-test failed: image fixture") }
    let jpeg = try jpegPreview(fixture)
    guard let source = CGImageSourceCreateWithData(jpeg as CFData, nil),
          let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any] else {
        throw ImportFailure(message: "Self-test failed: encoded JPEG could not be reopened")
    }
    try check(properties[kCGImagePropertyPixelWidth] as? Int == 1024 && properties[kCGImagePropertyPixelHeight] as? Int == 512, "JPEG preview dimensions and aspect ratio")
    try check(jpeg.count < 2 * 1024 * 1024, "JPEG must fit backend upload limit")
    print("Passed: album and upload decoding, explicit-null metadata, connection fields, JPEG dimensions, aspect ratio, and upload size. No Photos access or network requests.")
}

@main
struct AfterglowPhotosLauncher {
    @MainActor static func main() {
        if CommandLine.arguments.contains("--self-test") {
            do { try runSelfTests(); exit(EXIT_SUCCESS) }
            catch { fputs("\(error.localizedDescription)\n", stderr); exit(EXIT_FAILURE) }
        }
        AfterglowPhotosApp.main()
    }
}

struct AfterglowPhotosApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    var body: some Scene {
        WindowGroup { ContentView() }.windowStyle(.hiddenTitleBar).defaultSize(width: 800, height: 720)
            .commands { CommandGroup(replacing: .newItem) {} }
    }
}
