import { requireOptionalNativeModule } from 'expo';

export type PhotosAccess = 'full'|'limited'|'denied';
export interface NativePhotos {
  requestAccess(): Promise<PhotosAccess>;
  manageAccess(): Promise<void>;
  setFavorite(assetIds:string[],favorite:boolean): Promise<number>;
  saveAlbum(assetIds:string[],name:string): Promise<number>;
  deletePhotos(assetIds:string[]): Promise<number>;
  sharePhotos(assetIds:string[]): Promise<boolean>;
}
// Expo Go and Android can still run search. PhotoKit actions require our iOS build.
export default requireOptionalNativeModule<NativePhotos>('CapturedPhotos');
