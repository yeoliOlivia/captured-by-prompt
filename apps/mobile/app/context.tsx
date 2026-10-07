import { useEffect, useState } from 'react';
import { Alert, Image, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { MemoryKind, type MemoryDraft, type SavedMemory } from '@captured/core/current';
import { useLibrary } from '../src/library';
import { store } from '../src/store';
import { Button, Notice, styles } from '../src/components';
import { colors } from '../src/theme';

const blank=(kind:MemoryDraft['kind']='person',name=''):MemoryDraft=>({kind,name,qualifier:'',aliases:[],notes:'',photoIds:[],isMe:name==='me',startDate:'',endDate:''});
export default function ContextScreen(){
  const library=useLibrary(), question=library.editingQuestion;
  const [draft,setDraft]=useState<MemoryDraft|null>(()=>question?blank(question.kind,question.term):null);
  const [aliases,setAliases]=useState(''),[limit,setLimit]=useState(60),[credentials,setCredentials]=useState({url:'',token:''});
  useEffect(()=>{library.refresh().catch(e=>library.setNotice(e.message));Promise.all([store.setting('server-url'),store.token()]).then(([url,token])=>setCredentials({url:url??'',token})).catch(()=>{});},[]);
  const busy=!!library.activity;
  function edit(memory:SavedMemory){setDraft(memory);setAliases(memory.aliases.join(', '));setLimit(60);}
  function change<K extends keyof MemoryDraft>(key:K,value:MemoryDraft[K]){setDraft(d=>d?{...d,[key]:value}:null);}
  async function save(){
    if(!draft)return;
    const ok=await library.saveMemory({...draft,aliases:aliases.split(',').map(s=>s.trim()).filter(Boolean)});
    if(ok){setDraft(null);if(question)router.back();}
  }
  const localByRemote=new Map(library.photos.filter(p=>p.remoteId).map(p=>[p.remoteId,p.uri]));
  const references=library.workspace?.photos??[];
  return <ScrollView style={{backgroundColor:colors.background}} contentContainerStyle={{padding:24,gap:14}} keyboardShouldPersistTaps="handled">
    <Text style={styles.body}>People, places, trips, objects, and preferences you confirm. Saved in the same workspace as the browser.</Text>
    {!draft&&<>
      {library.memories.map(m=><Button key={m.id} label={`${m.name}${m.qualifier?' · '+m.qualifier:''}`} secondary disabled={busy} onPress={()=>edit(m)}/>)}
      <Button label="Add context" disabled={busy} onPress={()=>{setDraft(blank());setAliases('');}}/>
    </>}
    {draft&&<>
      <Text style={styles.label}>{question?`Clarify “${question.term}”`:'Edit context'}</Text>
      <View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>{MemoryKind.options.map(kind=><Button key={kind} label={kind==='event'?'Trip / event':kind} secondary={draft.kind!==kind} disabled={busy||!!question} onPress={()=>{change('kind',kind);if(kind!=='person')change('isMe',false);}}/>)}</View>
      <TextInput accessibilityLabel="Name" placeholder="Name" value={draft.name} onChangeText={v=>change('name',v)} maxLength={100} style={styles.input} editable={!busy}/>
      <TextInput accessibilityLabel="Distinguishing label" placeholder="Distinguishing label, e.g. from college" value={draft.qualifier} onChangeText={v=>change('qualifier',v)} maxLength={150} style={styles.input} editable={!busy}/>
      <TextInput accessibilityLabel="Aliases" placeholder="Other names, separated by commas" value={aliases} onChangeText={setAliases} style={styles.input} editable={!busy}/>
      <TextInput accessibilityLabel="Context notes" placeholder="What should the app know?" value={draft.notes} onChangeText={v=>change('notes',v)} multiline maxLength={2000} style={styles.input} editable={!busy}/>
      <TextInput accessibilityLabel="Start date" placeholder="Start date YYYY-MM-DD (optional)" value={draft.startDate} onChangeText={v=>change('startDate',v)} style={styles.input} editable={!busy}/>
      <TextInput accessibilityLabel="End date" placeholder="End date YYYY-MM-DD (optional)" value={draft.endDate} onChangeText={v=>change('endDate',v)} style={styles.input} editable={!busy}/>
      {draft.kind==='person'&&<View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between'}}><Text style={styles.body}>This person is me</Text><Switch accessibilityLabel="This person is me" value={draft.isMe} onValueChange={v=>change('isMe',v)} disabled={busy}/></View>}
      <Text style={styles.label}>Reference photos · {draft.photoIds.length} selected</Text>
      <Text style={styles.body}>Choose up to 24 photos. People need at least one clear reference. Analyze phone selections first to make them available here.</Text>
      <View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>{references.slice(0,limit).map(p=>{
        const selected=draft.photoIds.includes(p.id),local=localByRemote.get(p.id);
        return <Pressable key={p.id} accessibilityRole="checkbox" accessibilityState={{checked:selected}} accessibilityLabel={`Reference ${p.name}`} disabled={busy} onPress={()=>{
          if(!selected&&draft.photoIds.length>=24){library.setNotice('Choose up to 24 reference photos.');return;}
          change('photoIds',selected?draft.photoIds.filter(id=>id!==p.id):[...draft.photoIds,p.id]);
        }} style={{width:84,height:84,borderWidth:selected?4:1,borderColor:selected?colors.green:colors.line,borderRadius:10,overflow:'hidden'}}>
          <Image source={local?{uri:local}:{uri:`${credentials.url}${p.image}`,headers:{Authorization:`Bearer ${credentials.token}`}}} style={{width:'100%',height:'100%'}}/>
        </Pressable>;
      })}</View>
      {limit<references.length&&<Button label="More reference photos" secondary onPress={()=>setLimit(n=>n+60)}/>}
      <Button label={question?'Save and continue search':'Save context'} disabled={busy||!draft.name.trim()} busy={busy} onPress={()=>{void save();}}/>
      <Button label="Cancel" secondary disabled={busy} onPress={()=>{setDraft(null);if(question){library.setEditingQuestion(null);router.back();}}}/>
      {draft.id&&<Button label="Delete context" secondary disabled={busy} onPress={()=>Alert.alert('Delete this context?','Future searches will no longer use these saved facts.',[{text:'Cancel',style:'cancel'},{text:'Delete',style:'destructive',onPress:()=>{const m=library.memories.find(m=>m.id===draft.id);if(m)void library.deleteMemory(m).then(()=>setDraft(null));}}])}/>}
    </>}
    {!!library.notice&&<Notice text={library.notice}/>}
  </ScrollView>;
}
