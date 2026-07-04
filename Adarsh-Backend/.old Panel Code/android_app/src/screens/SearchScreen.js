import React, { useState, useRef, useCallback, useMemo } from 'react';
import { View, Text, TextInput, FlatList, TouchableOpacity, Image, StyleSheet, ActivityIndicator } from 'react-native';
import { IconSearch, IconFilter, IconCheck, IconProfile, IconMail, IconPhone } from '../components/Icons';
import CardItem from '../components/CardItem';
import TopBar from '../components/TopBar';
import StatusBadge from '../components/StatusBadge';
import { CardListSkeleton } from '../components/Skeleton';
import { apiGet } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { colors, typography, spacing, radius, shadows, fontFamily } from '../theme';

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
      const { data } = await apiGet(`/api/mobile/search/?${params.toString()}`);
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

  const { user } = useAuth();
  const perms = useMemo(() => ({
    ...(user?.permissions || {}),
    isSuperAdmin: !!(user?.isSuperAdmin || user?.role === 'super_admin' || user?.role === 'admin'),
    role: user?.role,
  }), [user]);

  const renderItem = ({ item }) => (
    <TouchableOpacity 
      activeOpacity={0.8} 
      onPress={() => navigation.navigate('CardDetail', { cardId: item.id })}
    >
      <CardItem item={item} permissions={perms} currentStatus={item.status} />
    </TouchableOpacity>
  );

  const currentFilter = FILTERS.find(f => f.key === filterType) || FILTERS[0];

  return (
    <View style={s.root}>
      <TopBar title="Search" onBack={() => navigation.goBack()}>
        <View style={s.searchRow}>
          <TouchableOpacity 
            style={s.leftIconBtn} 
            onPress={() => setShowFilters(!showFilters)}
            activeOpacity={0.7}
          >
            <IconFilter size={14} color="#fff" />
          </TouchableOpacity>
          <TextInput
            style={s.searchInput}
            value={query}
            onChangeText={onChangeText}
            placeholder="Search cards..."
            placeholderTextColor="rgba(255,255,255,0.5)"
            returnKeyType="search"
            onSubmitEditing={() => doSearch(query, filterType)}
            autoFocus
          />
          <TouchableOpacity 
            style={s.rightIconBtn} 
            onPress={() => doSearch(query, filterType)}
            activeOpacity={0.7}
          >
            <IconSearch size={14} color="#fff" />
          </TouchableOpacity>
        </View>
      </TopBar>

      {query.trim() && !loading && (
        <View style={s.floatingCount}>
          <Text style={s.countText}>{results.length} results found</Text>
        </View>
      )}

      {showFilters && (
        <View style={s.filterDropdown}>
          {FILTERS.map(f => (
            <TouchableOpacity
              key={f.key}
              style={[s.filterItem, filterType === f.key && s.filterItemActive]}
              onPress={() => onFilterChange(f.key)}
              activeOpacity={0.7}
            >
              <IconSearch size={11} color={filterType === f.key ? colors.brandLight : colors.gray500} />
              <Text style={[s.filterItemText, filterType === f.key && s.filterItemTextActive]}>{f.label}</Text>
              {filterType === f.key && <IconCheck size={10} color={colors.brandLight} />}
            </TouchableOpacity>
          ))}
        </View>
      )}

      {loading ? (
        <CardListSkeleton />
      ) : (
        <FlatList
          data={results}
          renderItem={renderItem}
          keyExtractor={item => item.id.toString()}
          contentContainerStyle={s.list}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          ListEmptyComponent={
            <View style={s.empty}>
              <View style={s.emptyIcon}><IconSearch size={24} color={colors.gray300} /></View>
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
  searchRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: radius.sm, height: 44, marginTop: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)', overflow: 'hidden' },
  leftIconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.1)' },
  searchInput: { flex: 1, color: '#fff', fontSize: 14, height: '100%', paddingHorizontal: 12, fontFamily: 'SairaSemiCondensed-Bold' },
  rightIconBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.1)' },
  floatingCount: { paddingHorizontal: 20, paddingVertical: 10, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  countText: { fontSize: 11, fontFamily: 'SairaSemiCondensed-Bold', color: colors.gray400, textTransform: 'uppercase', letterSpacing: 0.5 },
  filterDropdown: { position: 'absolute', top: 120, left: 16, right: 16, zIndex: 100, backgroundColor: '#fff', borderRadius: radius.sm, borderWidth: 1, borderColor: '#f1f5f9', ...shadows.lg, overflow: 'hidden' },
  filterItem: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#f8fafc' },
  filterItemActive: { backgroundColor: 'rgba(51,183,239,0.03)' },
  filterItemText: { flex: 1, fontSize: 13, fontFamily: 'SairaSemiCondensed-Bold', color: colors.gray500 },
  filterItemTextActive: { color: colors.brandLight },
  list: { padding: 16, paddingBottom: 40 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 80 },
  emptyIcon: { width: 64, height: 64, borderRadius: radius.xxl, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', marginBottom: 16, ...shadows.sm },
  emptyTitle: { fontSize: 14, fontFamily: 'SairaSemiCondensed-Bold', color: colors.gray800 },
  emptySub: { fontSize: 12, color: colors.gray400, marginTop: 6, textAlign: 'center', paddingHorizontal: 40 },
});
