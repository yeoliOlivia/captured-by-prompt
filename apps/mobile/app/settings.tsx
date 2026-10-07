import { useEffect, useState } from 'react';
import { Alert, ScrollView, Text, TextInput } from 'react-native';
import Constants from 'expo-constants';
import { store } from '../src/store';
import { useLibrary } from '../src/library';
import { Button, Notice, styles } from '../src/components';
import { colors } from '../src/theme';

export default function Settings() {
  const library=useLibrary();
  const [url,setUrl]=useState(''),[token,setToken]=useState(''),[checking,setChecking]=useState(false),[message,setMessage]=useState('');
  useEffect(()=>{Promise.all([store.setting('server-url'),store.token()]).then(([saved,secret])=>{
    const host=Constants.expoConfig?.hostUri?.split(':')[0]??'192.168.1.100';setUrl(saved??`http://${host}:8790`);setToken(secret);
  }).catch(()=>setMessage('Could not load settings.'));},[]);
  async function save(){
    setChecking(true);setMessage('');
    try {
      const parsed=new URL(url.trim());
      if(!['http:','https:'].includes(parsed.protocol)||parsed.username||parsed.password||parsed.pathname!=='/'||parsed.search||parsed.hash) throw new Error('Enter a server address such as http://192.168.1.20:8790.');
      if(token.trim().length<32||/\s/.test(token.trim())) throw new Error('Paste the workspace token from your Mac.');
      await store.setSetting('server-url',parsed.origin);await store.setToken(token.trim());await library.connectionChanged();setMessage('Connected to the shared workspace.');
    }catch(e){setMessage(e instanceof Error?e.message:'Could not connect.');}finally{setChecking(false);}
  }
  const busy=checking||!!library.activity;
  return <ScrollView style={{backgroundColor:colors.background}} contentContainerStyle={{padding:24,gap:16}} keyboardShouldPersistTaps="handled">
    <Text style={styles.label}>ONE WORKSPACE, PHONE AND BROWSER</Text>
    <Text style={styles.body}>Start the shared server on your Mac with npm run dev:lan. Keep both devices on the same trusted Wi-Fi. Use your Mac’s network address below.</Text>
    <Text style={styles.label}>Server address</Text><TextInput accessibilityLabel="Server address" style={styles.input} value={url} onChangeText={setUrl} autoCapitalize="none" autoCorrect={false} keyboardType="url" editable={!busy}/>
    <Text style={styles.label}>Workspace token</Text><TextInput accessibilityLabel="Workspace token" style={styles.input} value={token} onChangeText={setToken} secureTextEntry autoCapitalize="none" autoCorrect={false} editable={!busy}/>
    <Text style={styles.body}>The token is in sample-dataset/.mobile-token on your Mac. This is separate from your model API key.</Text>
    <Button label="Save & connect" onPress={()=>{void save();}} disabled={busy} busy={checking}/>
    {!!message&&<Notice text={message}/>}
    {library.workspace&&<>
      <Text style={styles.label}>Model connection</Text>
      <Text style={styles.body}>{library.workspace.providerLabel} · {library.workspace.model} · {library.workspace.dimensions.toLocaleString()} dimensions</Text>
      <Text style={styles.body}>{library.workspace.configured?'Model key loaded.':'Model setup needed.'} Choose Gemini or Qwen and enter its key in the browser on your Mac. The phone uses that same connection.</Text>
    </>}
    <Text style={styles.label}>Your data</Text>
    <Text style={styles.body}>Only chosen photos are imported. Analyze uploads resized previews to the workspace, which stores them and their embeddings. Cloud analysis sends previews, prompts, and relevant saved context to the selected provider. Provider billing and data-use terms apply.</Text>
    <Text style={styles.body}>Removing a photo here removes this app’s phone copy. Apple Photos originals, workspace copies, and saved context remain. No native favorite, album, sharing, or original-deletion actions are implemented yet.</Text>
    <Button label="Turn off cloud analysis" secondary disabled={!library.consent||busy} onPress={()=>{void library.revokeConsent().catch(e=>setMessage(e.message));}}/>
    <Button label="Remove phone collection" secondary disabled={busy||!library.photos.length} onPress={()=>Alert.alert('Remove phone copies?','Your Apple Photos originals and the workspace on your Mac will remain.',[{text:'Cancel',style:'cancel'},{text:'Remove',style:'destructive',onPress:()=>{void library.clear();}}])}/>
    {!!library.notice&&<Notice text={library.notice}/>}
  </ScrollView>;
}
