import type { NativePhotos } from '../modules/captured-photos';

export type ActionPhoto = Readonly<{id:string;assetId:string|null}>;
export type PhotoAction = 'favorite'|'unfavorite'|'album'|'share'|'delete';
export type ActionResult = {assetIds:string[];completed:boolean};

/** Capture IDs at the moment of selection/confirmation, independently of ranked results. */
export function selectionSnapshot(photos:readonly ActionPhoto[]):ActionPhoto[] {
  return [...new Map(photos.map(p=>[p.id,Object.freeze({id:p.id,assetId:p.assetId})])).values()];
}
export function originalIds(photos:readonly ActionPhoto[]):string[] {
  if(!photos.length) throw new Error('Select some photos first.');
  if(photos.some(p=>!p.assetId)) throw new Error('Some selections have no original Photos link. Enable Photos access in Settings, then remove and reselect those photos. No originals were changed.');
  const ids=[...new Set(photos.map(p=>p.assetId!))];
  if(ids.length>10000) throw new Error('Select at most 10,000 photos for one action.');
  return ids;
}

export async function runPhotoAction(native:NativePhotos|null, action:PhotoAction, selection:readonly ActionPhoto[], albumName=''):Promise<ActionResult> {
  if(!native) throw new Error('Photos actions require the Captured iOS development build. They are not available in Expo Go or the browser.');
  const ids=originalIds(selection);
  if(action==='share') {
    if(ids.length>100) throw new Error('Share up to 100 photos at a time.');
    return {assetIds:ids,completed:await native.sharePhotos(ids)};
  }
  let count:number;
  if(action==='album') {
    const name=albumName.trim();
    if(!name || name.length>100) throw new Error('Enter an album name of up to 100 characters.');
    count=await native.saveAlbum(ids,name);
  } else if(action==='delete') count=await native.deletePhotos(ids);
  else count=await native.setFavorite(ids,action==='favorite');
  // Local copies must only be removed after confirmed completion for the entire original set.
  if(count!==ids.length) throw new Error('Photos returned an unexpected result. Check Apple Photos before trying again; local copies have been kept.');
  return {assetIds:ids,completed:true};
}
