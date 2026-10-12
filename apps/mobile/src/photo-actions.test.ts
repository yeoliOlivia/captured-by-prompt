import { describe,it,expect,vi } from 'vitest';
import { originalIds,selectionSnapshot,runPhotoAction } from './photo-actions';
const photo=(id:string,assetId:string|null=id)=>({id,assetId});
function native(){return {requestAccess:vi.fn(),manageAccess:vi.fn(),setFavorite:vi.fn(async(ids:string[])=>ids.length),saveAlbum:vi.fn(async(ids:string[])=>ids.length),deletePhotos:vi.fn(async(ids:string[])=>ids.length),sharePhotos:vi.fn(async()=>true)};}

describe('original Photos action boundary',()=>{
  it('freezes the selected IDs even if ranked results, filters, or source objects change',()=>{
    const results=[photo('a','original-a'),photo('b','original-b')];
    const selected=selectionSnapshot(results);
    results[0]!.assetId='wrong';results.splice(1,1);results.push(photo('c'));
    expect(originalIds(selected)).toEqual(['original-a','original-b']);
    expect(Object.isFrozen(selected[0])).toBe(true);
  });
  it('does not guess missing originals or silently run an action on the remaining subset',async()=>{
    const bridge=native();
    await expect(runPhotoAction(bridge,'delete',[photo('a'),photo('b',null)])).rejects.toThrow('No originals were changed');
    expect(bridge.deletePhotos).not.toHaveBeenCalled();
    expect(()=>originalIds([])).toThrow('Select');
  });
  it('deduplicates original assets while preserving distinct local selections',async()=>{
    const selected=selectionSnapshot([photo('a','same'),photo('b','same'),photo('a','same')]);
    expect(selected).toHaveLength(2);
    const bridge=native();await runPhotoAction(bridge,'favorite',selected);
    expect(bridge.setFavorite).toHaveBeenCalledExactlyOnceWith(['same'],true);
  });
  it('dispatches unfavorite and albums to original identifiers, without creating image copies',async()=>{
    const bridge=native(),selected=[photo('local','original')];
    await runPhotoAction(bridge,'unfavorite',selected);
    expect(bridge.setFavorite).toHaveBeenCalledWith(['original'],false);
    await runPhotoAction(bridge,'album',selected,'  Japan  ');
    expect(bridge.saveAlbum).toHaveBeenCalledWith(['original'],'Japan');
    await expect(runPhotoAction(bridge,'album',selected,' ')).rejects.toThrow('album name');
    expect(bridge.saveAlbum).toHaveBeenCalledTimes(1);
  });
  it('does not report cancellation or permission failure as successful deletion',async()=>{
    const bridge=native();bridge.deletePhotos.mockRejectedValueOnce(new Error('User cancelled'));
    await expect(runPhotoAction(bridge,'delete',[photo('a')])).rejects.toThrow('User cancelled');
    bridge.deletePhotos.mockResolvedValueOnce(0);
    await expect(runPhotoAction(bridge,'delete',[photo('a')])).rejects.toThrow('local copies have been kept');
    expect(await runPhotoAction(bridge,'delete',[photo('a')])).toEqual({assetIds:['a'],completed:true});
  });
  it('distinguishes share cancellation and bounds full-resolution exports',async()=>{
    const bridge=native();bridge.sharePhotos.mockResolvedValue(false);
    expect(await runPhotoAction(bridge,'share',[photo('a')])).toEqual({assetIds:['a'],completed:false});
    await expect(runPhotoAction(bridge,'share',Array.from({length:101},(_,i)=>photo(String(i))))).rejects.toThrow('100');
    expect(bridge.sharePhotos).toHaveBeenCalledTimes(1);
  });
  it('explains missing native builds instead of simulating Photos changes',async()=>{
    await expect(runPhotoAction(null,'delete',[photo('a')])).rejects.toThrow('iOS development build');
  });
});
