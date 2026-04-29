import React, { useState, useEffect } from 'react';
import {
  View, Text, FlatList, Image, TouchableOpacity,
  StyleSheet, ActivityIndicator, Dimensions, Modal
} from 'react-native';
import { FontAwesome5 } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, shadows, radius } from '../theme';
import { apiGet } from '../api/client';
import TopBar from '../components/TopBar';

const { width } = Dimensions.get('window');
const COLUMN_COUNT = 2;
const ITEM_WIDTH = (width - 40) / COLUMN_COUNT;

export default function ProductCategoryDetailScreen({ navigation, route }) {
  const category = route?.params?.category || {};
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [products, setProducts] = useState([]);
  const [selectedImage, setSelectedImage] = useState(null);

  useEffect(() => {
    loadProducts();
  }, []);

  const loadProducts = async () => {
    try {
      const { ok, data } = await apiGet(`/app/api/pub/website/category/${category.id}/products/`);
      if (ok && data.success) setProducts(data.products);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  const renderProduct = ({ item }) => (
    <TouchableOpacity activeOpacity={0.9} onPress={() => setSelectedImage(item.image)} style={s.card}>
      <Image source={{ uri: item.image }} style={s.image} />
      <View style={s.info}>
        <Text style={s.title} numberOfLines={1}>{item.title}</Text>
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={s.root}>
      <TopBar 
        title={category.name} 
        subtitle="Product Samples" 
        onBack={() => navigation.goBack()} 
      />
      
      {loading ? (
        <View style={s.center}><ActivityIndicator size="large" color={colors.brandLight} /></View>
      ) : (
        <FlatList
          data={products}
          renderItem={renderProduct}
          keyExtractor={item => item.id.toString()}
          numColumns={COLUMN_COUNT}
          contentContainerStyle={s.list}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={s.empty}><FontAwesome5 name="ghost" size={40} color="#cbd5e1" /><Text style={s.emptyText}>No samples found for this category</Text></View>
          }
        />
      )}

      {/* Image Preview Modal */}
      <Modal visible={!!selectedImage} transparent animationType="fade">
        <View style={s.modalRoot}>
          <TouchableOpacity style={s.modalClose} onPress={() => setSelectedImage(null)}>
            <FontAwesome5 name="times" size={24} color="#fff" />
          </TouchableOpacity>
          <Image source={{ uri: selectedImage }} style={s.modalImg} resizeMode="contain" />
        </View>
      </Modal>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fff' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { padding: 15, paddingBottom: 40 },
  card: { width: ITEM_WIDTH, margin: 5, backgroundColor: '#fff', borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: '#f1f5f9', ...shadows.sm },
  image: { width: '100%', height: ITEM_WIDTH },
  info: { padding: 10 },
  title: { fontSize: 13, fontWeight: '700', color: '#334155' },
  empty: { marginTop: 100, alignItems: 'center', gap: 16 },
  emptyText: { fontSize: 14, color: '#94a3b8' },
  modalRoot: { flex: 1, backgroundColor: 'rgba(0,0,0,0.9)', alignItems: 'center', justifyContent: 'center' },
  modalImg: { width: '90%', height: '80%' },
  modalClose: { position: 'absolute', top: 50, right: 20, zIndex: 10 },
});
