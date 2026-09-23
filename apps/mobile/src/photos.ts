import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { Directory, File, Paths } from 'expo-file-system';
import * as Crypto from 'expo-crypto';
import { PHOTO_LIMIT, assertCapacity, exifDate, type Photo } from '@captured/core';
import { store } from './store';

function directory() {
  const dir = new Directory(Paths.document, 'selected-photos');
  dir.create({ intermediates: true, idempotent: true });
  return dir;
}

export async function selectPhotos(): Promise<number> {
  const existing = await store.list();
  const remaining = PHOTO_LIMIT - existing.length;
  if (remaining <= 0) throw new Error('Your 30-photo collection is full. Remove a photo to add another.');
  // PHPicker grants access only to explicitly selected images; no broad library permission is requested.
  const picked = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: remaining,
    orderedSelection: true, quality: 1, exif: true,
  });
  if (picked.canceled) return 0;
  const known = new Set(existing.flatMap(p => p.assetId ? [p.assetId] : []));
  const assets = picked.assets.filter(a => {
    if (!a.assetId) return true;
    if (known.has(a.assetId)) return false;
    known.add(a.assetId);
    return true;
  });
  assertCapacity(existing.length, assets.length);
  const imported: Photo[] = [];
  try {
    for (const asset of assets) {
      const id = Crypto.randomUUID();
      const extension = asset.uri.split('.').pop()?.split('?')[0]?.replace(/[^a-zA-Z0-9]/g, '') || 'jpg';
      const file = new File(directory(), `${id}.${extension}`);
      new File(asset.uri).copy(file);
      imported.push({ id, assetId: asset.assetId ?? null, uri: file.uri, width: asset.width, height: asset.height, capturedAt: exifDate(asset.exif), status: 'pending', analysis: null, error: null, addedAt: new Date().toISOString() });
    }
    await store.add(imported);
    return imported.length;
  } catch (error) {
    for (const photo of imported) deleteLocalPhoto(photo);
    throw error;
  }
}

export async function previewBase64(photo: Photo): Promise<string> {
  const context = ImageManipulator.manipulate(photo.uri);
  if (Math.max(photo.width, photo.height) > 1024) context.resize(photo.width >= photo.height ? { width: 1024 } : { height: 1024 });
  const rendered = await context.renderAsync();
  const result = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.85, base64: true });
  try {
    if (!result.base64) throw new Error('Could not prepare this photo. Remove it and select it again.');
    return result.base64;
  } finally {
    const preview = new File(result.uri);
    if (preview.exists) preview.delete();
    rendered.release();
    context.release();
  }
}

export function deleteLocalPhoto(photo: Photo) {
  const file = new File(photo.uri);
  if (file.exists) file.delete();
}

export function deleteAllLocalPhotos() {
  const dir = new Directory(Paths.document, 'selected-photos');
  if (dir.exists) dir.delete();
}
