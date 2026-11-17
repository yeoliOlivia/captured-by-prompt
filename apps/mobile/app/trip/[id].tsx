import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, Text, View, useWindowDimensions } from 'react-native';
import { Stack, useLocalSearchParams } from 'expo-router';
import { AppleMaps } from 'expo-maps';
import type { TripSummary } from '@captured/core/current';
import { api } from '../../src/api';
import { store } from '../../src/store';
import { Notice, styles } from '../../src/components';
import { colors } from '../../src/theme';

type Spot = TripSummary['places'][number];
// Zoom that fits all spots: about one level per halving of the area they span.
function camera(spots: Spot[]) {
  const lats=spots.map(s=>s.lat), lons=spots.map(s=>s.lon);
  const span=Math.max(Math.max(...lats)-Math.min(...lats),Math.max(...lons)-Math.min(...lons),.02);
  return { coordinates:{ latitude:(Math.max(...lats)+Math.min(...lats))/2, longitude:(Math.max(...lons)+Math.min(...lons))/2 }, zoom:Math.max(2,Math.min(14,Math.log2(360/span)-.5)) };
}

export default function TripMap() {
  const { id } = useLocalSearchParams<{ id: string }>(), { width } = useWindowDimensions();
  const [trip,setTrip]=useState<TripSummary|null>(null),[error,setError]=useState(''),[person,setPerson]=useState(''),[spot,setSpot]=useState<Spot|null>(null);
  const [credentials,setCredentials]=useState({url:'',token:''});
  useEffect(()=>{
    api.trip(id).then(setTrip).catch(e=>setError(e instanceof Error?e.message:'Could not load this trip.'));
    Promise.all([store.setting('server-url'),store.token()]).then(([url,token])=>setCredentials({url:url??'',token})).catch(()=>{});
  },[id]);
  const spots=useMemo(()=>(trip?.places??[]).filter(s=>!person||s.people.includes(person)),[trip,person]);
  if(error) return <View style={{padding:24}}><Notice text={error}/></View>;
  if(!trip) return <ActivityIndicator style={{marginTop:40}}/>;
  const names=new Map(trip.members.map(m=>[m.id,m.name]));
  const size=(width-64)/3;
  return <ScrollView style={{backgroundColor:colors.background}} contentContainerStyle={{padding:24,gap:14}}>
    <Stack.Screen options={{ title: trip.trip.name }}/>
    <Text style={styles.body}>{trip.places.length ? `${trip.photos-trip.unplaced} of ${trip.photos} trip photos have a location, rounded to about 1 km.` : `None of the ${trip.photos} trip photos have a location yet.`}</Text>
    <View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>
      {[{id:'',name:'Everyone'},...trip.members].map(m=><Pressable key={m.id} accessibilityRole="button" accessibilityState={{selected:person===m.id}} onPress={()=>{setPerson(m.id);setSpot(null);}}
        style={{paddingHorizontal:14,paddingVertical:8,borderRadius:999,backgroundColor:person===m.id?colors.green:colors.light}}>
        <Text style={{color:person===m.id?'#FFF':colors.ink,fontWeight:'600'}}>{m.name}</Text></Pressable>)}
    </View>
    {!!spots.length&&<AppleMaps.View key={`${person}:${spots.length}`} style={{height:320,borderRadius:16,overflow:'hidden'}} cameraPosition={camera(spots)}
      markers={spots.map((s,i)=>({ id:String(i), coordinates:{latitude:s.lat,longitude:s.lon}, monogram:s.count<100?String(s.count):'99+', tintColor:colors.green,
        title:`${s.count} ${s.count===1?'photo':'photos'}${s.people.length?' · '+s.people.map(p=>names.get(p)).filter(Boolean).join(', '):''}` }))}
      onMarkerClick={m=>setSpot(spots[Number(m.id)]??null)}/>}
    {spot&&<View style={{gap:8}}>
      <Text style={styles.label}>{spot.count} {spot.count===1?'photo':'photos'} here</Text>
      <Text style={styles.body}>{spot.people.length?`Found here: ${spot.people.map(p=>names.get(p)).filter(Boolean).join(', ')}`:'Nobody found here yet.'}</Text>
      <View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>{spot.photoIds.map(pid=><Image key={pid} accessibilityIgnoresInvertColors
        source={{uri:`${credentials.url}/photos/${pid}`,headers:{Authorization:`Bearer ${credentials.token}`}}} style={{width:size,height:size,borderRadius:10,backgroundColor:colors.light}}/>)}</View>
    </View>}
    {!spot&&!!spots.length&&<Text style={styles.body}>Tap a marker to see its photos.</Text>}
  </ScrollView>;
}
