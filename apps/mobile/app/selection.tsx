import { useState } from 'react';
import { Alert, FlatList, Image, Pressable, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useLibrary } from '../src/library';
import { originalIds, selectionSnapshot, type PhotoAction } from '../src/photo-actions';
import { Button, Notice, styles } from '../src/components';
import { colors } from '../src/theme';

export default function SelectionScreen(){
  const library=useLibrary(),[albumName,setAlbumName]=useState('');
  const selected=library.selection, busy=!!library.activity;
  const byId=new Map(library.photos.map(p=>[p.id,p]));
  const missing=selected.filter(p=>!p.assetId).length;
  const disabled=busy||!selected.length||!!missing||!library.photosActionsAvailable;
  const execute=(action:PhotoAction)=>{
    const snapshot=selectionSnapshot(selected);
    if(action!=='delete'){void library.photosAction(action,snapshot,albumName);return;}
    // Capture the exact set BEFORE opening the confirmation, never read changing search results later.
    let count:number;
    try{count=originalIds(snapshot).length;}catch(e){library.setNotice((e as Error).message);return;}
    Alert.alert(`Delete ${count} original photo${count===1?'':'s'}?`,
      'This deletes originals from Apple Photos, including devices synced through iCloud Photos. Phone app copies will also be removed. Mac workspace copies remain. Apple will ask you to confirm.',[
        {text:'Cancel',style:'cancel'},
        {text:'Delete from Photos',style:'destructive',onPress:()=>{void library.photosAction('delete',snapshot);}},
      ]);
  };
  return <FlatList style={{backgroundColor:colors.background}} contentContainerStyle={{padding:24,gap:12}} data={selected} keyExtractor={p=>p.id} numColumns={3} columnWrapperStyle={{gap:8}}
    ListHeaderComponent={<View style={{gap:14,marginBottom:18}}>
      <Text style={{fontSize:24,color:colors.ink,fontWeight:'600'}}>{selected.length} selected</Text>
      <Text style={styles.body}>Review this fixed selection. Adjusting the search filter will not change it. Tap a photo below to remove it.</Text>
      {!library.photosActionsAvailable&&<Notice text="Photos actions need the Captured iOS development build. Search still works in Expo Go, but this native module is not included there."/>}
      {!!missing&&<Notice text={`${missing} photo${missing===1?' has':'s have'} no link to an original. Enable Photos access in Settings, then remove and reselect those photos. No original will be guessed from a filename or preview.`}/>}
      {!!missing&&<Button label="Photos access settings" secondary disabled={busy} onPress={()=>router.push('/settings')}/>}
      <Button label="Share / save to Files" disabled={disabled} onPress={()=>execute('share')} busy={busy}/>
      <Text style={styles.body}>Shares up to 100 full-resolution still photos through the iOS share sheet. iCloud originals may need downloading. Live Photo motion is not included.</Text>
      <View style={{flexDirection:'row',gap:8}}><View style={{flex:1}}><Button label="Favorite" secondary disabled={disabled} onPress={()=>execute('favorite')}/></View><View style={{flex:1}}><Button label="Unfavorite" secondary disabled={disabled} onPress={()=>execute('unfavorite')}/></View></View>
      <TextInput accessibilityLabel="Album name" value={albumName} onChangeText={setAlbumName} placeholder="Album name" maxLength={100} style={styles.input} editable={!busy}/>
      <Button label="Save to album" secondary disabled={disabled||!albumName.trim()} onPress={()=>execute('album')}/>
      <Text style={styles.body}>Adds the originals to an existing album with this name, or creates a new album. Photos are not duplicated. Choosing albums by name requires Full Photos Access.</Text>
      <Button label="Delete originals from Photos" secondary disabled={disabled} onPress={()=>execute('delete')}/>
      <Button label="Clear selection" secondary disabled={busy||!selected.length} onPress={library.clearSelection}/>
      <Button label="Back to search" secondary disabled={busy} onPress={()=>router.back()}/>
      {!!library.notice&&<Notice text={library.notice}/>}
    </View>}
    renderItem={({item,index})=>{
      const photo=byId.get(item.id);
      return <Pressable accessibilityRole="button" accessibilityLabel={`Remove photo ${index+1} from selection`} disabled={busy} onPress={()=>library.toggleSelection(item)} style={{flex:1,maxWidth:'33%',height:110,borderRadius:10,overflow:'hidden',backgroundColor:colors.light}}>
        {photo&&<Image source={{uri:photo.uri}} style={{width:'100%',height:'100%'}}/>}
        <Text style={{position:'absolute',right:6,top:6,backgroundColor:'white',color:colors.ink,paddingHorizontal:5,borderRadius:5}}>×</Text>
      </Pressable>;
    }}/>
}
