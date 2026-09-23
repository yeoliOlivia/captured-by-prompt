import { Alert, Image, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useLibrary } from '../../src/library';
import { Button, Notice, styles as common } from '../../src/components';
import { colors } from '../../src/theme';

export default function PhotoDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const library = useLibrary();
  const photo = library.photos.find(p => p.id === id);
  const { width, height } = useWindowDimensions();
  if (!photo) return <View style={{ padding: 24 }}><Notice text="This photo is no longer in your collection." /><Button label="Back to collection" onPress={() => router.replace('/')} /></View>;
  const remove = () => Alert.alert('Remove this photo?', 'Delete its imported copy and search data from this app. The original in your camera roll is unchanged.', [
    { text: 'Keep photo', style: 'cancel' }, { text: 'Remove', style: 'destructive', onPress: () => { void library.remove(id).then(() => router.back()); } },
  ]);
  return <ScrollView style={{ backgroundColor: colors.background }} contentContainerStyle={{ paddingBottom: 40 }}>
    <ScrollView style={{ height: height * 0.49, backgroundColor: '#E3E6DE' }} minimumZoomScale={1} maximumZoomScale={4} centerContent showsHorizontalScrollIndicator={false} showsVerticalScrollIndicator={false}>
      <Image accessibilityLabel="Selected photo, pinch to zoom" source={{ uri: photo.uri }} style={{ width, height: height * 0.49 }} resizeMode="contain" />
    </ScrollView>
    <View style={s.content}>
      <Text style={common.label}>YOUR SELECTED PHOTO · PINCH TO ZOOM</Text>
      <Text style={s.title}>{photo.capturedAt ? `Captured ${photo.capturedAt}` : 'A moment worth finding'}</Text>
      <Text style={common.body}>{photo.width} × {photo.height} · {photo.status === 'ready' ? 'Searchable' : photo.status === 'indexing' ? 'Indexing now' : 'Not indexed yet'}</Text>
      {!photo.capturedAt && <Text style={s.small}>Capture date was not available from this selection.</Text>}
      {photo.error && <Notice text={photo.error} />}
      {photo.analysis && <>
        <View style={s.divider} /><Text style={common.label}>WHAT SEARCH CAN SEE</Text>
        <Text style={common.body}>{photo.analysis.description}</Text>
        {!!photo.analysis.visibleText && <><Text style={common.label}>TEXT IN THIS PHOTO</Text><Text style={common.body}>{photo.analysis.visibleText}</Text></>}
        <Text style={s.small}>AI-generated details can be incomplete or incorrect.</Text>
      </>}
      <Button label="Remove from collection" secondary icon="trash-outline" onPress={remove} disabled={Boolean(library.activity)} />
    </View>
  </ScrollView>;
}
const s = StyleSheet.create({ content: { padding: 24, gap: 14 }, title: { color: colors.ink, fontSize: 25, fontWeight: '500' }, small: { color: colors.muted, fontSize: 12, lineHeight: 19 }, divider: { height: 1, backgroundColor: colors.line, marginVertical: 8 } });
