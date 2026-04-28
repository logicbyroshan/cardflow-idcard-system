import React, { useState, useRef, useCallback } from 'react';
import { View, Text, TextInput, FlatList, TouchableOpacity, Image, StyleSheet, ActivityIndicator } from 'react-native';
import { FontAwesome5 } from '@expo/vector-icons';
import TopBar from '../components/TopBar';
import StatusBadge from '../components/StatusBadge';
import { CardListSkeleton } from '../components/Skeleton';
import { apiGet } from '../api/client';
import { colors, typography, spacing, radius, shadows } from '../theme';

export default function SearchScreen({ navigation }) {
  const [query, setQuery] = useState('');
  const [filterType, setFilterType] = useState('all');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const timerRef = useRef(null);
  const [showFilters, setShowFilters] = useState(false);

  const FILTERS = [
    { key: 'all', label: 'All Fields', icon: 'search' },
    { key: 'name', label: 'Name', icon: 'user' },
    { key: 'address', label: 'Address', icon: 'map-marker-alt' },
    { key: 'mobile', label: 'Mobile', icon: 'phone' },
  ];

  const doSearch = useCallback(async (q, filter) => {
    if (!q || q.trim().length < 2) { setResults([]); return; }
    setLoading(true);
    try {
      const params = new URLSearchParams({ q: q.trim() });
      if (filter && filter !== 'all') params.set('filter', filter);
      const { data } = await apiGet(`/app/api/search/?${params.toString()}`);
      if (data?.success) setResults(data.data?.results || []);
    } catch (e) { /* silent */ }
    setLoading(false);
  }, []);

  const onChangeText = (text) => {
    setQuery(text);
    clearTimeout(timerRef.current);
    if (text.trim().length < 2) { setResults([]); return; }
    timerRef.current = setTimeout(() => doSearch(text, filterType), 350);
  };

  const onFilterChange = (f) => {
    setFilterType(f);
    setShowFilters(false);
    if (query.trim().length >= 2) doSearch(query, f);
  };

  const renderItem = ({ item }) => (
    <TouchableOpacity
      style={s.card}
      activeOpacity={0.7}
      onPress={() => navigation.navigate('CardDetail', { cardId: item.id })}
    >
      <View style={s.photoWrap}>
        {item.photo_url ? (
          <Image source={{ uri: item.photo_url }} style={s.photo} />
        ) : (
          <View style={s.photoPlaceholder}><FontAwesome5 name="user" size={14} color={colors.gray400} solid /></View>
        )}
      </View>
      <View style={s.info}>
        <Text style={s.name} numberOfLines={1}>{item.name}</Text>
        <View style={s.metaRow}>
          {!!item.roll_no && <Text style={s.rollNo}>{item.roll_no}</Text>}
          <Text style={s.tableName}>{item.table_name}</Text>
          {!!item.client_name && <Text style={s.clientName}>· {item.client_name}</Text>}
        </View>
      </View>
      <StatusBadge status={item.status} />
    </TouchableOpacity>
  );

  const currentFilter = FILTERS.find(f => f.key === filterType) || FILTERS[0];

  return (
    <View style={s.root}>
      <TopBar title="Search" onBack={() => navigation.goBack()}>
        <View style={s.searchRow}>
          <FontAwesome5 name="search" size={12} color="rgba(255,255,255,0.6)" style={s.searchIcon} />
          <TextInput
            style={s.searchInput}
            value={query}
            onChangeText={onChangeText}
            placeholder="Search by name, roll no, ID..."
            placeholderTextColor="rgba(255,255,255,0.5)"
            returnKeyType="search"
            onSubmitEditing={() => doSearch(query, filterType)}
            autoFocus
          />
        </View>
      </TopBar>

      {/* Filter bar */}
      <View style={s.filterBar}>
        <TouchableOpacity style={s.filterBtn} onPress={() => setShowFilters(!showFilters)} activeOpacity={0.7}>
          <FontAwesome5 name={currentFilter.icon} size={10} color={colors.brandLight} solid />
          <Text style={s.filterBtnText}>{currentFilter.label}</Text>
          <FontAwesome5 name="chevron-down" size={8} color={colors.gray400} />
        </TouchableOpacity>
        {query.trim() && !loading && (
          <View style={s.countPill}>
            <FontAwesome5 name="list-ul" size={8} color={colors.brandLight} />
            <Text style={s.countText}>{results.length} result{results.length !== 1 ? 's' : ''}</Text>
          </View>
        )}
      </View>

      {/* Filter dropdown */}
      {showFilters && (
        <View style={s.filterDropdown}>
          {FILTERS.map(f => (
            <TouchableOpacity
              key={f.key}
              style={[s.filterItem, filterType === f.key && s.filterItemActive]}
              onPress={() => onFilterChange(f.key)}
              activeOpacity={0.7}
            >
              <FontAwesome5 name={f.icon} size={11} color={filterType === f.key ? colors.brandLight : colors.gray500} solid />
              <Text style={[s.filterItemText, filterType === f.key && s.filterItemTextActive]}>{f.label}</Text>
              {filterType === f.key && <FontAwesome5 name="check" size={10} color={colors.brandLight} />}
            </TouchableOpacity>
          ))}
        </View>
      )}

      {/* Results */}
      {loading ? (
        <CardListSkeleton />
      ) : (
        <FlatList
          data={results}
          renderItem={renderItem}
          keyExtractor={item => item.id.toString()}
          contentContainerStyle={s.list}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={s.empty}>
              <View style={s.emptyIcon}><FontAwesome5 name="search" size={24} color={colors.gray300} /></View>
              <Text style={s.emptyTitle}>{query.trim() ? 'No results found' : 'Search for cards'}</Text>
              <Text style={s.emptySub}>{query.trim() ? 'Try a different search term' : 'Type a name, roll number, or ID'}</Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.surfaceBg },
  searchRow: { flexDirection: 'row', alignItems: 'center', flex: 1, backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
  searchIcon: { position: 'absolute', left: 12, zIndex: 1 },
  searchInput: { flex: 1, paddingLeft: 34, paddingRight: 12, paddingVertical: 10, fontSize: 13, color: '#fff' },
  filterBar: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
  filterBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: '#fff', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 7, borderWidth: 1, borderColor: '#e2e8f0', ...shadows.sm },
  filterBtnText: { fontSize: 11, fontWeight: '600', color: colors.gray700 },
  countPill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.indigo50, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: '#e2e8f0' },
  countText: { fontSize: 11, fontWeight: '600', color: '#4f46e5' },
  filterDropdown: { marginHorizontal: 16, backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: '#e2e8f0', ...shadows.md, marginBottom: 8 },
  filterItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  filterItemActive: { backgroundColor: 'rgba(51,183,239,0.05)' },
  filterItemText: { flex: 1, fontSize: 13, fontWeight: '500', color: colors.gray700 },
  filterItemTextActive: { color: colors.brandLight, fontWeight: '600' },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { padding: 16, gap: 10, paddingBottom: 32 },
  card: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: '#fff', borderRadius: 20, padding: 14, borderWidth: 1, borderColor: '#f1f5f9', ...shadows.sm },
  photoWrap: { width: 48, height: 48, borderRadius: 12, overflow: 'hidden', backgroundColor: 'rgba(51,183,239,0.06)', borderWidth: 1, borderColor: '#f1f5f9' },
  photo: { width: '100%', height: '100%' },
  photoPlaceholder: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  info: { flex: 1, minWidth: 0 },
  name: { fontSize: 13, fontWeight: '700', color: colors.gray800 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2, flexWrap: 'wrap' },
  rollNo: { fontSize: 10, fontWeight: '500', color: colors.gray500 },
  tableName: { fontSize: 10, color: colors.gray400 },
  clientName: { fontSize: 10, color: colors.gray400 },
  empty: { alignItems: 'center', paddingTop: 80 },
  emptyIcon: { width: 64, height: 64, borderRadius: 20, backgroundColor: colors.gray100, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  emptyTitle: { fontSize: 13, fontWeight: '600', color: colors.gray400 },
  emptySub: { fontSize: 11, color: colors.gray300, marginTop: 4 },
});
