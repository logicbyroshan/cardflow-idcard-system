import React, { useState, useRef, useCallback } from 'react';
import { View, Text, TextInput, FlatList, TouchableOpacity, Image, StyleSheet, ActivityIndicator } from 'react-native';
import { FontAwesome5 } from '@expo/vector-icons';
import CardItem from '../components/CardItem';
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
    <CardItem item={item} onPress={() => navigation.navigate('CardDetail', { cardId: item.id })} />
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
  searchRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: 16, paddingHorizontal: 14, height: 44, marginTop: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
  searchIcon: { marginRight: 10 },
  searchInput: { flex: 1, color: '#fff', fontSize: 14, height: '100%', paddingVertical: 0, fontWeight: '600' },
  filterBar: { flexDirection: 'row', padding: 16, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#f1f5f9', zIndex: 10, gap: 10 },
  filterBtn: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: '#f8fafc', borderRadius: 12, borderWidth: 1, borderColor: '#f1f5f9' },
  filterBtnText: { fontSize: 11, fontWeight: '800', color: colors.gray700, letterSpacing: 0.5 },
  countPill: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(51,183,239,0.05)', borderRadius: 12, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: 'rgba(51,183,239,0.1)' },
  countText: { fontSize: 11, fontWeight: '800', color: colors.brandLight },
  filterDropdown: { marginHorizontal: 16, backgroundColor: '#fff', borderRadius: 20, borderWidth: 1, borderColor: '#f1f5f9', ...shadows.lg, marginBottom: 12, overflow: 'hidden' },
  filterItem: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#f8fafc' },
  filterItemActive: { backgroundColor: 'rgba(51,183,239,0.03)' },
  filterItemText: { flex: 1, fontSize: 13, fontWeight: '700', color: colors.gray500 },
  filterItemTextActive: { color: colors.brandLight, fontWeight: '800' },
  list: { padding: 16, paddingBottom: 40 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80 },
  emptyIcon: { width: 72, height: 72, borderRadius: 24, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', marginBottom: 20, ...shadows.sm },
  emptyTitle: { fontSize: 14, fontWeight: '800', color: colors.gray800 },
  emptySub: { fontSize: 12, color: colors.gray400, marginTop: 6, textAlign: 'center', paddingHorizontal: 40 },
});
