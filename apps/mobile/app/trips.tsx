import { useEffect } from 'react';
import { ScrollView, Text } from 'react-native';
import { router } from 'expo-router';
import { useLibrary } from '../src/library';
import { Button, Notice, styles } from '../src/components';
import { colors } from '../src/theme';

// Trips are trip or event memories with members, saved in the shared workspace.
export default function Trips() {
  const library=useLibrary();
  useEffect(()=>{library.refresh().catch(e=>library.setNotice(e.message));},[]);
  const trips=library.memories.filter(m=>m.kind==='event'&&m.memberIds?.length);
  return <ScrollView style={{backgroundColor:colors.background}} contentContainerStyle={{padding:24,gap:12}}>
    <Text style={styles.body}>See where each trip’s photos were taken and who was found in them. Create trips with dates and members in My context or on your Mac.</Text>
    {!trips.length&&<Notice text="No trips with members yet."/>}
    {trips.map(t=><Button key={t.id} secondary label={`${t.name}${t.qualifier?' · '+t.qualifier:''} (${t.startDate} to ${t.endDate})`} onPress={()=>router.push({pathname:'/trip/[id]',params:{id:t.id}})}/>)}
  </ScrollView>;
}
