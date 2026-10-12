import Foundation
import Photos
import PhotosUI
import UIKit
import UniformTypeIdentifiers

struct PhotosOperationError: LocalizedError {
  let message: String
  var errorDescription: String? { message }
}

/// PhotoKit is the source of truth. Imported previews are never used to infer an asset ID.
@MainActor
final class PhotosOperations {
  private var busy = false
  private let library = PHPhotoLibrary.shared()

  func requestAccess() async -> String {
    var status = PHPhotoLibrary.authorizationStatus(for: .readWrite)
    if status == .notDetermined {
      status = await withCheckedContinuation { continuation in
        PHPhotoLibrary.requestAuthorization(for: .readWrite) { continuation.resume(returning: $0) }
      }
    }
    switch status {
    case .authorized: return "full"
    case .limited: return "limited"
    default: return "denied"
    }
  }

  func manageAccess(from presenter: UIViewController) async throws {
    guard !busy else { throw PhotosOperationError(message: "Finish the current Photos action first.") }
    busy = true
    defer { busy = false }
    let status = await requestAccess()
    if status == "limited" {
      guard presenter.presentedViewController == nil else {
        throw PhotosOperationError(message: "Close the current sheet and try again.")
      }
      await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
        library.presentLimitedLibraryPicker(from: presenter) { _ in continuation.resume() }
      }
    } else if status == "denied" {
      throw PhotosOperationError(message: "Allow Photos access in iPhone Settings, then return to Captured.")
    }
  }

  private func assets(for ids: [String]) async throws -> [PHAsset] {
    let unique = Array(Set(ids))
    guard !unique.isEmpty, unique.count <= 10000,
          unique.allSatisfy({ !$0.isEmpty && $0.utf8.count <= 512 }) else {
      throw PhotosOperationError(message: "Choose between 1 and 10,000 photos.")
    }
    guard await requestAccess() != "denied" else {
      throw PhotosOperationError(message: "Allow Photos access in iPhone Settings before changing originals.")
    }
    let fetched = PHAsset.fetchAssets(withLocalIdentifiers: unique, options: nil)
    var byID: [String: PHAsset] = [:]
    fetched.enumerateObjects { asset, _, _ in byID[asset.localIdentifier] = asset }
    // Fail the entire action if access changed or an original disappeared. Never act on a subset silently.
    guard byID.count == unique.count else {
      throw PhotosOperationError(message: "Some originals are missing or outside your allowed Photos selection. Manage Photos access or reselect those photos, then try again. Nothing was changed.")
    }
    let ordered = ids.reduce(into: [PHAsset]()) { result, id in
      if let asset = byID.removeValue(forKey: id) { result.append(asset) }
    }
    guard ordered.allSatisfy({ $0.mediaType == .image }) else {
      throw PhotosOperationError(message: "This action supports photos only.")
    }
    return ordered
  }

  private func withAssets<T>(_ ids: [String], _ action: ([PHAsset]) async throws -> T) async throws -> T {
    guard !busy else { throw PhotosOperationError(message: "Finish the current Photos action first.") }
    busy = true
    defer { busy = false }
    return try await action(assets(for: ids))
  }

  private func change(_ block: @escaping () -> Void) async throws {
    try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
      library.performChanges(block) { success, error in
        if success { continuation.resume() }
        else { continuation.resume(throwing: error ?? PhotosOperationError(message: "Photos did not apply the change. It may have been cancelled.")) }
      }
    }
  }

  func setFavorite(_ ids: [String], favorite: Bool) async throws -> Int {
    try await withAssets(ids) { assets in
      guard assets.allSatisfy({ $0.canPerform(.properties) }) else {
        throw PhotosOperationError(message: "One or more selected originals cannot be edited. Nothing was changed.")
      }
      try await self.change {
        for asset in assets { PHAssetChangeRequest(for: asset).isFavorite = favorite }
      }
      return assets.count
    }
  }

  func saveAlbum(_ ids: [String], name: String) async throws -> Int {
    let title = name.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !title.isEmpty, title.count <= 100 else {
      throw PhotosOperationError(message: "Enter an album name of up to 100 characters.")
    }
    return try await withAssets(ids) { assets in
      // Limited access can hide albums created by other apps. Do not accidentally
      // create a second album because the intended destination was invisible.
      guard PHPhotoLibrary.authorizationStatus(for: .readWrite) == .authorized else {
        throw PhotosOperationError(message: "Choosing albums by name needs Full Photos Access in iPhone Settings. Sharing, favorites, and deletion still work with your allowed photos.")
      }
      let options = PHFetchOptions()
      options.predicate = NSPredicate(format: "title == %@", title)
      let albums = PHAssetCollection.fetchAssetCollections(with: .album, subtype: .albumRegular, options: options)
      guard albums.count <= 1 else {
        throw PhotosOperationError(message: "Several albums have this name. Use a unique name to choose the destination unambiguously.")
      }
      let album = albums.firstObject
      if let album, !album.canPerform(.addContent) {
        throw PhotosOperationError(message: "This album cannot be changed. Choose a different album name.")
      }
      var requested = false
      try await self.change {
        let request: PHAssetCollectionChangeRequest
        if let album {
          guard let existing = PHAssetCollectionChangeRequest(for: album) else { return }
          request = existing
        } else {
          request = PHAssetCollectionChangeRequest.creationRequestForAssetCollection(withTitle: title)
        }
        request.addAssets(assets as NSArray)
        requested = true
      }
      guard requested else { throw PhotosOperationError(message: "Photos could not update this album. No new album was created.") }
      return assets.count
    }
  }

  func deletePhotos(_ ids: [String]) async throws -> Int {
    try await withAssets(ids) { assets in
      guard assets.allSatisfy({ $0.canPerform(.delete) }) else {
        throw PhotosOperationError(message: "One or more selected originals cannot be deleted. Nothing was changed.")
      }
      // PhotoKit presents the system confirmation. Cancellation rejects; JS must not remove its copies first.
      try await self.change { PHAssetChangeRequest.deleteAssets(assets as NSArray) }
      return assets.count
    }
  }

  private func imageData(for asset: PHAsset) async throws -> (Data, String) {
    try await withCheckedThrowingContinuation { continuation in
      let options = PHImageRequestOptions()
      options.isNetworkAccessAllowed = true
      options.deliveryMode = .highQualityFormat
      options.version = .current
      PHImageManager.default().requestImageDataAndOrientation(for: asset, options: options) { data, uti, _, info in
        if let error = info?[PHImageErrorKey] as? Error { continuation.resume(throwing: error); return }
        if (info?[PHImageCancelledKey] as? Bool) == true {
          continuation.resume(throwing: PhotosOperationError(message: "Preparing the photo was cancelled.")); return
        }
        guard let data, let uti else {
          continuation.resume(throwing: PhotosOperationError(message: "Could not download an original from Photos. Check your iCloud connection and try again.")); return
        }
        continuation.resume(returning: (data, UTType(uti)?.preferredFilenameExtension ?? "jpg"))
      }
    }
  }

  func sharePhotos(_ ids: [String], from presenter: UIViewController) async throws -> Bool {
    guard Set(ids).count <= 100 else {
      throw PhotosOperationError(message: "Share up to 100 photos at a time. Narrow the selection and try again.")
    }
    return try await withAssets(ids) { assets in
      let folder = FileManager.default.temporaryDirectory.appendingPathComponent("captured-share-\(UUID().uuidString)", isDirectory: true)
      try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
      defer { try? FileManager.default.removeItem(at: folder) }
      var files: [URL] = []
      // Export one image at a time rather than retaining every full-resolution image in memory.
      // Live Photos are exported as current, full-resolution still images.
      for (index, asset) in assets.enumerated() {
        let (data, ext) = try await self.imageData(for: asset)
        let file = folder.appendingPathComponent("photo-\(index + 1).\(ext)")
        try data.write(to: file, options: [.atomic, .completeFileProtection])
        files.append(file)
      }
      guard presenter.viewIfLoaded?.window != nil, presenter.presentedViewController == nil else {
        throw PhotosOperationError(message: "Return to the app and close any open sheet before sharing.")
      }
      return try await withCheckedThrowingContinuation { continuation in
        let sheet = UIActivityViewController(activityItems: files, applicationActivities: nil)
        sheet.completionWithItemsHandler = { _, completed, _, error in
          if let error { continuation.resume(throwing: error) }
          else { continuation.resume(returning: completed) }
        }
        if let popover = sheet.popoverPresentationController {
          popover.sourceView = presenter.view
          popover.sourceRect = CGRect(x: presenter.view.bounds.midX, y: presenter.view.bounds.midY, width: 1, height: 1)
          popover.permittedArrowDirections = []
        }
        presenter.present(sheet, animated: true)
      }
    }
  }
}
