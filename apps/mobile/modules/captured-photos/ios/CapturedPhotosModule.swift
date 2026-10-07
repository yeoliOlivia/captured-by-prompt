import ExpoModulesCore
import UIKit

public final class CapturedPhotosModule: Module {
  @MainActor private lazy var operations = PhotosOperations()

  public func definition() -> ModuleDefinition {
    Name("CapturedPhotos")

    AsyncFunction("requestAccess") { (promise: Promise) in
      self.complete(promise) { await self.operations.requestAccess() }
    }
    AsyncFunction("manageAccess") { (promise: Promise) in
      self.complete(promise) {
        try await self.operations.manageAccess(from: self.presenter())
        return true
      }
    }
    AsyncFunction("setFavorite") { (ids: [String], favorite: Bool, promise: Promise) in
      self.complete(promise) { try await self.operations.setFavorite(ids, favorite: favorite) }
    }
    AsyncFunction("saveAlbum") { (ids: [String], name: String, promise: Promise) in
      self.complete(promise) { try await self.operations.saveAlbum(ids, name: name) }
    }
    AsyncFunction("deletePhotos") { (ids: [String], promise: Promise) in
      self.complete(promise) { try await self.operations.deletePhotos(ids) }
    }
    AsyncFunction("sharePhotos") { (ids: [String], promise: Promise) in
      self.complete(promise) { try await self.operations.sharePhotos(ids, from: self.presenter()) }
    }
  }

  @MainActor private func presenter() throws -> UIViewController {
    guard let presenter = appContext?.utilities?.currentViewController() else {
      throw PhotosOperationError(message: "Open Captured before using Photos actions.")
    }
    return presenter
  }

  private func complete<T>(_ promise: Promise, action: @escaping @MainActor () async throws -> T) {
    Task { @MainActor in
      do { promise.resolve(try await action() as Any) }
      catch { promise.reject("ERR_PHOTOS_ACTION", error.localizedDescription) }
    }
  }
}
