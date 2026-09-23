import { useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Image, Keyboard, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { PHOTO_LIMIT } from '@captured/core';
import { useLibrary } from '../src/library';
import { Button, Notice, styles as common } from '../src/components';
import { colors } from '../src/theme';

const examples = ['The restaurant with green booths', 'A red umbrella on the beach', 'A handwritten recipe with lemon'];

export default function Home() {
  const library = useLibrary();
  const { width } = useWindowDimensions();
  const [prompt, setPrompt] = useState('');
  const indexed = library.photos.filter(p => p.status === 'ready').length;
  const busy = Boolean(library.activity);
  const pending = library.photos.length - indexed;
  const photos = library.hits ? library.hits.map(h => h.photo) : library.photos;
  const size = (width - 48 - 16) / 3;
  const newSearch = () => { library.newSearch(); setPrompt(''); };
  const search = () => { Keyboard.dismiss(); void library.search(prompt); };
  const accept = () => Alert.alert('Use free cloud AI?', 'Selected photo previews, prompts, and derived descriptions go to Google and, when enabled, descriptions go to TypeSafe. Google’s free tier may use submitted content to improve its products. Choose non-sensitive test photos. Your entire camera roll is never uploaded.', [
    { text: 'Not now', style: 'cancel' },
    { text: 'I understand', onPress: () => { void library.acceptConsent().catch(() => library.setNotice('Could not save your choice. Try again.')); } },
  ]);

  if (!library.ready) return <SafeAreaView style={s.screen}><ActivityIndicator style={{ marginTop: 80 }} color={colors.green} /></SafeAreaView>;
  return <SafeAreaView style={s.screen} edges={['top']}><KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <FlatList data={photos} keyExtractor={p => p.id} numColumns={3} contentContainerStyle={s.content} columnWrapperStyle={{ gap: 8 }} keyboardShouldPersistTaps="handled"
      ListHeaderComponent={<View style={{ gap: 22, marginBottom: 18 }}>
        <View style={s.brandRow}>
          <View style={s.brand}><View style={s.logo}><Ionicons name="scan-outline" size={20} color={colors.ink} /></View><Text style={s.wordmark}>captured<Text style={{ color: colors.muted }}> / by prompt</Text></Text></View>
          <Pressable accessibilityRole="button" accessibilityLabel="Open settings" onPress={() => router.push('/settings')} style={s.settings}><Ionicons name="options-outline" size={23} color={colors.ink} /></Pressable>
        </View>
        <View style={s.hero}>
          <View style={s.eyebrow}><View style={s.dot} /><Text style={common.label}>YOUR MEMORIES, WITHIN REACH</Text></View>
          <Text style={s.title}>You remember it.{'\n'}Let’s find it.</Text>
          <Text style={s.subtitle}>A place. A color. A little detail.{'\n'}Describe the photo you’re looking for.</Text>
        </View>
        {!library.consent && <View style={s.consentCard}>
          <Ionicons name="leaf-outline" size={22} color={colors.green} />
          <Text style={s.cardTitle}>A small, thoughtful start.</Text>
          <Text style={common.body}>Choose 20–30 non-sensitive photos. Free cloud AI makes them searchable; free-tier submissions may be used to improve provider products.</Text>
          <Button label="Review cloud analysis" onPress={accept} disabled={busy} />
        </View>}
        <View style={s.searchBox}>
          <View style={s.searchInputRow}><Ionicons name="search" color={colors.green} size={22} />
            <TextInput accessibilityLabel="Describe a photo" placeholder={library.history.length ? 'Refine your search…' : 'The photo of…'} placeholderTextColor="#8A938B" value={prompt} onChangeText={setPrompt} maxLength={1000} multiline style={s.searchInput} editable={!busy} />
          </View>
          <View style={s.searchBottom}><Text style={s.searchHint}>{library.history.length ? 'Keep the details. Add a new clue.' : `${indexed} photos ready to search`}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel="Search selected photos" onPress={search} disabled={busy || !library.consent || !indexed || !prompt.trim()} style={[s.searchButton, (busy || !library.consent || !indexed || !prompt.trim()) && { opacity: 0.4 }]}>
              {library.activity === 'searching' ? <ActivityIndicator color="white" /> : <Ionicons name="arrow-forward" size={22} color="white" />}
            </Pressable>
          </View>
        </View>
        {!library.history.length && <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {examples.map(example => <Pressable accessibilityRole="button" key={example} disabled={busy} onPress={() => setPrompt(example)} style={s.chip}><Text style={s.chipText}>{example}</Text></Pressable>)}
        </ScrollView>}
        {library.history.length > 0 && <View style={{ gap: 9 }}>
          <View style={s.sectionRow}><Text style={common.label}>YOUR SEARCH</Text><Pressable accessibilityRole="button" disabled={busy} onPress={newSearch} hitSlop={10}><Text style={s.textLink}>New search</Text></Pressable></View>
          <Text style={s.resolved}>{library.resolved?.text}</Text>
          {library.resolved && (library.resolved.dates.from || library.resolved.dates.to) && <Text style={common.body}>{library.resolved.dates.from ?? 'Any date'} → {library.resolved.dates.to ?? 'Any date'} · unknown dates excluded</Text>}
          <Text style={s.small}>{library.searchSource} · {library.rankingMode === 'jev' ? 'Ranked with Jev' : 'Embedding + text search'}</Text>
        </View>}
        {!!library.notice && <Notice text={library.notice} />}
        <View style={s.collectionHeader}>
          <View style={s.sectionRow}><View><Text style={s.sectionTitle}>{library.hits ? 'Possible matches' : 'Your collection'}</Text><Text style={s.small}>{library.hits ? 'Closest results — a match isn’t guaranteed.' : `${library.photos.length} of ${PHOTO_LIMIT} selected · ${indexed} searchable`}</Text></View>
            <Pressable accessibilityRole="button" accessibilityLabel="Add photos" onPress={() => { void library.add(); }} disabled={busy || library.photos.length >= PHOTO_LIMIT} style={[s.addButton, (busy || library.photos.length >= PHOTO_LIMIT) && { opacity: 0.4 }]}><Ionicons name="add" size={24} color={colors.green} /></Pressable>
          </View>
          {library.photos.length > 0 && <View style={s.progressTrack}><View style={[s.progressFill, { width: `${indexed / library.photos.length * 100}%` }]} /></View>}
          {pending > 0 && <Button label={library.activity === 'indexing' ? 'Pause after this photo' : indexed ? 'Resume indexing' : 'Start indexing'} icon={library.activity === 'indexing' ? 'pause-outline' : 'sparkles-outline'} secondary disabled={!library.consent || (busy && library.activity !== 'indexing')} onPress={() => library.activity === 'indexing' ? library.pause() : void library.index()} />}
        </View>
      </View>}
      ListEmptyComponent={<View style={s.empty}>
        <View style={s.photoStack}><View style={[s.blankPhoto, { transform: [{ rotate: '-12deg' }], left: 8, backgroundColor: colors.peach }]} /><View style={[s.blankPhoto, { transform: [{ rotate: '7deg' }], right: 8, top: 10 }]}><Ionicons name="images-outline" size={35} color={colors.green} /></View></View>
        <Text style={s.emptyTitle}>{library.hits ? 'No photos in this search' : 'Start with a handful of memories.'}</Text>
        <Text style={[common.body, { textAlign: 'center' }]}>{library.hits ? 'Try a different clue or start a new search.' : 'Pick 20 photos you know well. You can add up to 30, and remove them anytime.'}</Text>
        <Button label={library.hits ? 'New search' : 'Choose photos'} icon={library.hits ? 'refresh-outline' : 'add-outline'} onPress={library.hits ? newSearch : () => { void library.add(); }} disabled={busy} style={{ marginTop: 10 }} />
      </View>}
      renderItem={({ item, index }) => <Pressable accessibilityRole="button" accessibilityLabel={`Open photo ${index + 1}, ${item.status}`} onPress={() => router.push(`/photo/${item.id}`)} style={[s.tile, { width: size, height: size * 1.15 }]}>
        <Image source={{ uri: item.uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />
        {item.status !== 'ready' && <View style={s.tileBadge}>{item.status === 'indexing' ? <ActivityIndicator size="small" color={colors.ink} /> : <Ionicons name={item.status === 'error' ? 'alert-circle-outline' : 'time-outline'} size={15} color={colors.ink} />}</View>}
        {library.hits && <View style={[s.tileBadge, { left: 7, right: undefined }]}><Text style={s.rank}>{index + 1}</Text></View>}
      </Pressable>}
      ListFooterComponent={<Text style={s.footer}>ONLY THE PHOTOS YOU CHOOSE. ALWAYS YOURS.</Text>} />
  </KeyboardAvoidingView></SafeAreaView>;
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background }, content: { padding: 24, paddingBottom: 40 },
  brandRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, brand: { flexDirection: 'row', gap: 9, alignItems: 'center' },
  logo: { width: 33, height: 33, borderRadius: 10, backgroundColor: colors.peach, alignItems: 'center', justifyContent: 'center' }, wordmark: { fontSize: 14, fontWeight: '600', color: colors.ink },
  settings: { padding: 10, marginRight: -10 }, hero: { paddingTop: 14, gap: 16 }, eyebrow: { flexDirection: 'row', alignItems: 'center', gap: 7 }, dot: { width: 5, height: 5, borderRadius: 3, backgroundColor: colors.orange },
  title: { color: colors.ink, fontSize: 40, lineHeight: 46, letterSpacing: -1.6, fontWeight: '500', fontFamily: Platform.OS === 'ios' ? 'Georgia' : 'serif' }, subtitle: { fontSize: 16, lineHeight: 24, color: colors.muted },
  consentCard: { borderRadius: 22, backgroundColor: colors.light, padding: 20, gap: 12 }, cardTitle: { color: colors.ink, fontSize: 19, fontWeight: '600' },
  searchBox: { borderRadius: 24, backgroundColor: colors.paper, borderWidth: 1, borderColor: colors.line, padding: 18, gap: 15 }, searchInputRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 }, searchInput: { flex: 1, color: colors.ink, fontSize: 17, minHeight: 50, maxHeight: 150, paddingTop: 0 }, searchBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }, searchHint: { fontSize: 12, color: colors.muted, flex: 1 }, searchButton: { width: 43, height: 43, borderRadius: 14, backgroundColor: colors.green, alignItems: 'center', justifyContent: 'center' },
  chip: { paddingVertical: 11, paddingHorizontal: 14, borderWidth: 1, borderColor: colors.line, borderRadius: 20 }, chipText: { color: colors.muted, fontSize: 12 },
  sectionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 }, textLink: { color: colors.green, fontSize: 13, fontWeight: '700' }, resolved: { fontSize: 16, lineHeight: 24, color: colors.ink }, small: { color: colors.muted, fontSize: 12, lineHeight: 19, marginTop: 4 },
  collectionHeader: { gap: 12, marginTop: 2 }, sectionTitle: { fontSize: 20, color: colors.ink, fontWeight: '600' }, addButton: { width: 43, height: 43, borderRadius: 14, backgroundColor: colors.light, alignItems: 'center', justifyContent: 'center' }, progressTrack: { height: 3, borderRadius: 2, backgroundColor: colors.line }, progressFill: { height: 3, borderRadius: 2, backgroundColor: colors.green },
  empty: { padding: 24, alignItems: 'center', borderWidth: 1, borderColor: colors.line, borderStyle: 'dashed', borderRadius: 24, gap: 10 }, photoStack: { height: 113, width: 150, marginBottom: 12 }, blankPhoto: { width: 91, height: 105, position: 'absolute', backgroundColor: colors.light, borderWidth: 5, borderColor: 'white', borderRadius: 9, alignItems: 'center', justifyContent: 'center' }, emptyTitle: { color: colors.ink, fontWeight: '600', fontSize: 18, textAlign: 'center', lineHeight: 24 },
  tile: { borderRadius: 13, overflow: 'hidden', backgroundColor: colors.light, marginBottom: 8 }, tileBadge: { position: 'absolute', right: 7, bottom: 7, borderRadius: 8, backgroundColor: 'rgba(255,255,255,0.9)', padding: 5 }, rank: { color: colors.ink, fontSize: 11, fontWeight: '700' }, footer: { marginTop: 30, color: colors.muted, textAlign: 'center', fontSize: 9, letterSpacing: 1.5 },
});
