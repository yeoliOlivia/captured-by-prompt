import { useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Image, Keyboard, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Switch, Text, TextInput, View, useWindowDimensions } from 'react-native';
import Slider from '@react-native-community/slider';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { COLLECTION_LIMIT } from '@captured/core/current';
import { useLibrary } from '../src/library';
import { Button, Notice, styles as common } from '../src/components';
import { colors } from '../src/theme';

export default function Home() {
  const library=useLibrary(), {width}=useWindowDimensions();
  const [prompt,setPrompt]=useState('');
  const busy=!!library.activity, indexed=library.photos.filter(p=>p.indexed).length;
  const photos=library.searchingView ? library.matches : library.photos;
  const size=(width-64)/3;
  const accept=()=>Alert.alert('Analyze selected photos?', 'Resized previews are uploaded to your Mac workspace and sent to its selected Gemini or Qwen provider. Personal searches also send relevant saved context and reference photos. Provider billing and data-use terms apply. Your entire Photos library is not scanned.',[
    {text:'Not now',style:'cancel'}, {text:'Allow analysis',onPress:()=>{void library.acceptConsent().catch(e=>library.setNotice(e.message));}},
  ]);
  if(!library.ready) return <SafeAreaView style={s.screen}><ActivityIndicator /></SafeAreaView>;
  return <SafeAreaView style={s.screen} edges={['top']}><KeyboardAvoidingView style={{flex:1}} behavior={Platform.OS==='ios'?'padding':undefined}>
    <FlatList data={photos} keyExtractor={p=>p.id} numColumns={3} contentContainerStyle={s.content} columnWrapperStyle={{gap:8}} keyboardShouldPersistTaps="handled"
      ListHeaderComponent={<View style={{gap:18,marginBottom:18}}>
        <View style={s.brandRow}><Text style={s.wordmark}>captured / by prompt</Text><Button label="Settings" secondary onPress={()=>router.push('/settings')} /></View>
        <Text style={s.title}>You remember it.{'\n'}Let’s find it.</Text>
        <Text style={s.subtitle}>Choose photos from your phone. Search with the same workspace you use on your Mac.</Text>
        {!library.workspace && <Button label="Connect workspace" onPress={()=>router.push('/settings')} />}
        {!library.consent && <Button label="Review cloud analysis" onPress={accept} disabled={busy} />}
        <View style={s.searchBox}>
          <TextInput accessibilityLabel="Search photos" placeholder="Tennis on grass, me with Mark…" value={prompt} onChangeText={setPrompt} maxLength={1000} style={s.searchInput} editable={!busy} />
          <Button label="Search" onPress={()=>{Keyboard.dismiss();void library.search(prompt);}} disabled={busy||!library.consent||!indexed||!prompt.trim()||!!library.workspace?.indexing} busy={library.activity==='searching'} />
        </View>
        <View style={s.sectionRow}><Text style={common.body}>Use my context</Text><Switch accessibilityLabel="Use my context" value={library.useContext} disabled={busy} onValueChange={library.setUseContext}/></View>
        <View style={s.sectionRow}><Text style={common.body}>Visually check matches</Text><Switch accessibilityLabel="Visually check matches" value={library.verify} disabled={busy} onValueChange={library.setVerify}/></View>
        <Button label="My context" secondary onPress={()=>{library.setEditingQuestion(null);router.push('/context');}} disabled={busy||!library.workspace}/>
        {library.questions.map(q=><View key={q.term} style={s.consentCard}>
          <Text style={s.cardTitle}>{q.choices.length ? `Which ${q.term}?` : `What does “${q.term}” refer to?`}</Text>
          {(q.choices.length ? q.choices : library.memories.filter(m=>m.kind===q.kind)).map(m=><Button key={m.id} secondary label={`${m.name}${m.qualifier ? ' · '+m.qualifier : ''}`} disabled={busy} onPress={()=>{void library.bind(q,m);}}/>)}
          <Button label="Add context" disabled={busy} onPress={()=>{library.setEditingQuestion(q);router.push('/context');}}/>
        </View>)}
        {library.searchingView && <View style={{gap:10}}>
          <Text style={common.body}>{library.query}</Text>
          <View style={s.sectionRow}><Text style={s.small}>Broader</Text><Slider accessibilityLabel="Search strictness: broader to stricter" style={{flex:1,height:44}} minimumValue={0} maximumValue={1} step={.001} value={library.strictness} onValueChange={library.setStrictness} disabled={!library.results||busy} minimumTrackTintColor={colors.green}/><Text style={s.small}>Stricter</Text></View>
          <Button label="Reset filter" secondary onPress={()=>library.setStrictness(.5)} disabled={!library.results||busy}/>
          {library.results?.verified && <View style={s.sectionRow}><Text style={common.body}>Include uncertain matches</Text><Switch accessibilityLabel="Include uncertain matches" value={library.includeUncertain} onValueChange={library.setIncludeUncertain}/></View>}
          {!!library.results?.contextUsed.length && <Text style={s.small}>Using: {library.results.contextUsed.map(m=>m.name+(m.qualifier?' · '+m.qualifier:'')).join(', ')}</Text>}
          <Button label="Browse collection" secondary onPress={library.browse} disabled={busy}/>
        </View>}
        {!!library.notice && <Notice text={library.notice}/>}
        <View style={s.sectionRow}><Text style={s.sectionTitle}>{library.searchingView ? `${photos.length} matches` : `${photos.length} selected photos`}</Text><Button label="Add photos" secondary onPress={()=>{void library.add();}} disabled={busy||library.photos.length>=COLLECTION_LIMIT}/></View>
        <Text style={s.small}>{indexed} searchable{library.workspace ? ` · ${library.workspace.providerLabel} · ${library.workspace.dimensions.toLocaleString()} dimensions` : ''}</Text>
        {library.workspace?.indexing ? <Button label="Pause analysis" secondary onPress={()=>{void library.pause();}} disabled={busy}/> : library.photos.length>0 && <Button label="Analyze selected photos" onPress={()=>{void library.index();}} disabled={busy||!library.consent||!library.workspace} busy={library.activity==='uploading'}/>}
      </View>}
      ListEmptyComponent={<View style={s.empty}><Text style={s.emptyTitle}>{library.searchingView ? 'No matches to show' : 'Start with photos you know.'}</Text><Text style={common.body}>{library.searchingView ? 'Broaden the filter, answer any clarification, or run another search.' : 'Your originals stay in Photos. Only photos you choose are imported.'}</Text></View>}
      renderItem={({item,index})=><Pressable accessibilityRole="button" accessibilityLabel={`Open photo ${index+1}`} onPress={()=>router.push(`/photo/${item.id}`)} style={[s.tile,{width:size,height:size*1.15}]}>
        <Image source={{uri:item.uri}} style={StyleSheet.absoluteFill}/><View style={s.tileBadge}><Text style={s.rank}>{library.searchingView ? `#${index+1}` : item.indexed ? 'Ready' : 'Pending'}</Text></View>
      </Pressable>}/>
  </KeyboardAvoidingView></SafeAreaView>;
}

const s = StyleSheet.create({
  screen: {flex:1,backgroundColor:colors.background},
  content: {padding:24,paddingBottom:40},
  brandRow: {flexDirection:'row',alignItems:'center',justifyContent:'space-between'},
  wordmark: {fontSize:14,fontWeight:'600',color:colors.ink},
  title: {color:colors.ink,fontSize:40,lineHeight:46,letterSpacing:-1.6,fontWeight:'500',fontFamily:Platform.OS==='ios'?'Georgia':'serif'},
  subtitle: {fontSize:16,lineHeight:24,color:colors.muted},
  consentCard: {borderRadius:22,backgroundColor:colors.light,padding:20,gap:12},
  cardTitle: {color:colors.ink,fontSize:19,fontWeight:'600'},
  searchBox: {borderRadius:24,backgroundColor:colors.paper,borderWidth:1,borderColor:colors.line,padding:18,gap:15},
  searchInput: {color:colors.ink,fontSize:17,minHeight:50,maxHeight:150,paddingTop:0},
  sectionRow: {flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:10},
  small: {color:colors.muted,fontSize:12,lineHeight:19,marginTop:4},
  sectionTitle: {fontSize:20,color:colors.ink,fontWeight:'600',flex:1},
  empty: {padding:24,alignItems:'center',borderWidth:1,borderColor:colors.line,borderStyle:'dashed',borderRadius:24,gap:10},
  emptyTitle: {color:colors.ink,fontWeight:'600',fontSize:18,textAlign:'center',lineHeight:24},
  tile: {borderRadius:13,overflow:'hidden',backgroundColor:colors.light,marginBottom:8},
  tileBadge: {position:'absolute',right:7,bottom:7,borderRadius:8,backgroundColor:'rgba(255,255,255,0.9)',padding:5},
  rank: {color:colors.ink,fontSize:11,fontWeight:'700'},
});
