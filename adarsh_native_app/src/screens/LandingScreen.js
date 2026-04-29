import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Image, Dimensions, FlatList, TextInput, ActivityIndicator,
  Animated,
} from 'react-native';
import { FontAwesome5 } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, gradients, shadows, radius, typography } from '../theme';
import { apiGet, apiPost } from '../api/client';
import Toast from '../components/Toast';

const { width } = Dimensions.get('window');

export default function LandingScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [activeHero, setActiveHero] = useState(0);
  const heroRef = useRef(null);
  const [form, setForm] = useState({ name: '', email: '', phone: '', message: '' });
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState({ visible: false, message: '', type: 'info' });

  const scrollY = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    loadLandingData();
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      if (data?.hero_images?.length > 1) {
        const next = (activeHero + 1) % data.hero_images.length;
        heroRef.current?.scrollToIndex({ index: next, animated: true });
        setActiveHero(next);
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [data, activeHero]);

  const loadLandingData = async () => {
    try {
      const { ok, data: res } = await apiGet('/app/api/pub/website/landing/');
      if (ok && res.success) setData(res.data);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  const handleContact = async () => {
    if (!form.name || !form.email || !form.message) {
      setToast({ visible: true, message: 'Please fill required fields', type: 'warn' });
      return;
    }
    setSubmitting(true);
    try {
      const { data: res } = await apiPost('/app/api/pub/website/contact/', form);
      setToast({ visible: true, message: res.message || 'Sent successfully', type: res.success ? 'success' : 'error' });
      if (res.success) setForm({ name: '', email: '', phone: '', message: '' });
    } catch (e) {
      setToast({ visible: true, message: 'Connection failed', type: 'error' });
    }
    setSubmitting(false);
  };

  if (loading) return (
    <View style={s.loading}><ActivityIndicator size="large" color={colors.brandLight} /></View>
  );

  const headerBg = scrollY.interpolate({
    inputRange: [0, 100],
    outputRange: ['transparent', 'rgba(255,255,255,0.95)'],
    extrapolate: 'clamp',
  });

  const headerShadow = scrollY.interpolate({
    inputRange: [0, 100],
    outputRange: [0, 1],
    extrapolate: 'clamp',
  });

  return (
    <View style={s.root}>
      {/* Dynamic Header */}
      <Animated.View style={[s.header, { paddingTop: insets.top + 8, backgroundColor: headerBg, borderBottomWidth: headerShadow, borderBottomColor: '#eee' }]}>
        <View style={s.headerInner}>
          <View style={s.logoSide}>
            <View style={s.logoWrap}>
              <Image source={require('../../assets/logo.png')} style={s.logoImg} resizeMode="contain" />
            </View>
            <Text style={s.logoText}>ADARSH</Text>
          </View>
          <TouchableOpacity onPress={() => navigation.navigate('Login')} style={s.loginBtn}>
            <LinearGradient colors={gradients.brand} start={{x:0, y:0}} end={{x:1, y:0}} style={s.loginBtnGrad}>
              <Text style={s.loginBtnText}>LOGIN PANEL</Text>
              <FontAwesome5 name="arrow-right" size={10} color="#fff" />
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </Animated.View>

      <Animated.ScrollView
        onScroll={Animated.event([{ nativeEvent: { contentOffset: { y: scrollY } } }], { useNativeDriver: false })}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero Slider */}
        <View style={s.heroContainer}>
          <FlatList
            ref={heroRef}
            data={data?.hero_images || []}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={(e) => setActiveHero(Math.round(e.nativeEvent.contentOffset.x / width))}
            renderItem={({ item }) => (
              <View style={s.heroSlide}>
                <Image source={{ uri: item.image }} style={s.heroImg} resizeMode="cover" />
                <LinearGradient colors={['transparent', 'rgba(0,0,0,0.8)']} style={s.heroOverlay}>
                  <View style={s.heroContent}>
                    <Text style={s.heroTitle}>{item.title}</Text>
                    <Text style={s.heroSubtitle}>{item.subtitle}</Text>
                  </View>
                </LinearGradient>
              </View>
            )}
            keyExtractor={item => item.id.toString()}
          />
          <View style={s.heroDots}>
            {data?.hero_images?.map((_, i) => (
              <View key={i} style={[s.dot, activeHero === i && s.dotActive]} />
            ))}
          </View>
        </View>

        {/* Category Showcase (Bento Grid) */}
        <View style={s.section}>
          <View style={s.sectionHeader}>
            <Text style={s.sectionTitle}>Explore Categories</Text>
            <TouchableOpacity onPress={() => navigation.navigate('Search')} activeOpacity={0.6}>
              <Text style={s.viewAll}>See All</Text>
            </TouchableOpacity>
          </View>
          <View style={s.bentoGrid}>
            {data?.categories?.filter(c => c.is_active).slice(0, 6).map((cat, i) => (
              <TouchableOpacity
                key={cat.id}
                activeOpacity={0.9}
                onPress={() => navigation.navigate('ProductCategoryDetail', { category: cat })}
                style={[
                  s.bentoItem, 
                  cat.bento_size === 'large' ? s.bentoLarge : cat.bento_size === 'wide' ? s.bentoWide : s.bentoNormal,
                  { backgroundColor: cat.is_bento ? '#f1f5f9' : '#fff' }
                ]}
              >
                {cat.cover_image ? (
                  <Image source={{ uri: cat.cover_image }} style={s.bentoImg} />
                ) : (
                  <LinearGradient colors={['#f8fafc', '#e2e8f0']} style={s.bentoImg} />
                )}
                <LinearGradient colors={['transparent', 'rgba(0,0,0,0.7)']} style={s.bentoOverlay}>
                  <View style={s.bentoContent}>
                    <View style={s.bentoIconWrap}>
                      <FontAwesome5 name={cat.icon?.replace('fas ', '').replace('fa-', '') || 'layer-group'} size={12} color="#fff" />
                    </View>
                    <View>
                      <Text style={s.bentoText}>{cat.name}</Text>
                      {cat.bento_size === 'large' && <Text style={s.bentoSubtext} numberOfLines={1}>{cat.description || 'Premium Quality'}</Text>}
                    </View>
                  </View>
                </LinearGradient>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Featured Products Marquee */}
        <View style={s.section}>
          <View style={s.sectionPadding}><Text style={s.sectionTitle}>Featured Samples</Text></View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.productScroll}>
            {data?.products?.map(prod => (
              <TouchableOpacity key={prod.id} style={s.productCard}>
                <Image source={{ uri: prod.image }} style={s.productImg} />
                <View style={s.productInfo}>
                  <Text style={s.productCat}>{prod.category.toUpperCase()}</Text>
                  <Text style={s.productName} numberOfLines={1}>{prod.title}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {/* Trusted Clients */}
        <View style={s.section}>
          <View style={s.sectionPadding}><Text style={s.sectionTitle}>Trusted by 1000+ Institutions</Text></View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.clientScroll}>
            {data?.clients?.map(client => (
              <View key={client.id} style={s.clientCard}>
                <Image source={{ uri: client.logo }} style={s.clientLogo} resizeMode="contain" />
              </View>
            ))}
          </ScrollView>
        </View>

        {/* Contact Form */}
        <View style={s.contactSection}>
          <LinearGradient colors={['#1e293b', '#0f172a']} style={s.contactCard}>
            <Text style={s.contactTitle}>Quick Enquiry</Text>
            <Text style={s.contactSub}>Have questions? Drop us a message.</Text>
            
            <View style={s.form}>
              <LandingInput placeholder="Full Name" icon="user" value={form.name} onChangeText={t => setForm(p => ({...p, name: t}))} />
              <LandingInput placeholder="Email Address" icon="envelope" keyboardType="email-address" value={form.email} onChangeText={t => setForm(p => ({...p, email: t}))} />
              <LandingInput placeholder="Phone (Optional)" icon="phone" keyboardType="phone-pad" value={form.phone} onChangeText={t => setForm(p => ({...p, phone: t}))} />
              <LandingInput placeholder="How can we help you?" icon="comment" multiline value={form.message} onChangeText={t => setForm(p => ({...p, message: t}))} />
              
              <TouchableOpacity onPress={handleContact} disabled={submitting} style={s.submitBtn}>
                <LinearGradient colors={gradients.brand} style={s.submitGrad}>
                  {submitting ? <ActivityIndicator size="small" color="#fff" /> : <><Text style={s.submitText}>Send Message</Text><FontAwesome5 name="paper-plane" size={12} color="#fff" /></>}
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </LinearGradient>
          
          <View style={s.footer}>
            <Text style={s.footerText}>© 2024 Adarsh Bhopal. All rights reserved.</Text>
            <View style={s.socials}>
              <FontAwesome5 name="facebook" size={16} color={colors.gray400} />
              <FontAwesome5 name="instagram" size={16} color={colors.gray400} />
              <FontAwesome5 name="whatsapp" size={16} color={colors.gray400} />
            </View>
          </View>
        </View>
      </Animated.ScrollView>

      <Toast visible={toast.visible} message={toast.message} type={toast.type} onHide={() => setToast(p => ({...p, visible: false}))} />
    </View>
  );
}

function LandingInput({ icon, ...props }) {
  return (
    <View style={s.inputWrap}>
      <View style={s.inputIcon}><FontAwesome5 name={icon} size={12} color="rgba(255,255,255,0.4)" /></View>
      <TextInput {...props} placeholderTextColor="rgba(255,255,255,0.3)" style={[s.input, props.multiline && { height: 80, textAlignVertical: 'top' }]} />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fff' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 100, paddingBottom: 12 },
  headerInner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20 },
  logoSide: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  logoWrap: { width: 32, height: 32, borderRadius: 8, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', ...shadows.sm, overflow: 'hidden' },
  logoImg: { width: '80%', height: '80%' },
  logoText: { fontSize: 16, fontWeight: '900', color: colors.brandLight, letterSpacing: 1 },
  loginBtn: { borderRadius: 20, overflow: 'hidden', ...shadows.md },
  loginBtnGrad: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 10 },
  loginBtnText: { fontSize: 10, fontWeight: '800', color: '#fff', letterSpacing: 0.5 },

  heroContainer: { height: 450, position: 'relative' },
  heroSlide: { width, height: 450 },
  heroImg: { width: '100%', height: '100%' },
  heroOverlay: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 250, justifyContent: 'flex-end', padding: 24, paddingBottom: 40 },
  heroTitle: { fontSize: 32, fontWeight: '800', color: '#fff', lineHeight: 38 },
  heroSubtitle: { fontSize: 16, color: 'rgba(255,255,255,0.8)', marginTop: 8 },
  heroDots: { position: 'absolute', bottom: 20, left: 24, flexDirection: 'row', gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.3)' },
  dotActive: { width: 20, backgroundColor: '#fff' },

  section: { marginTop: 32 },
  sectionPadding: { paddingHorizontal: 20 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, marginBottom: 16 },
  sectionTitle: { fontSize: 18, fontWeight: '800', color: '#1e293b', marginBottom: 16 },
  viewAll: { fontSize: 13, fontWeight: '600', color: colors.brandLight },

  bentoGrid: { paddingHorizontal: 20, flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  bentoItem: { borderRadius: 16, overflow: 'hidden', backgroundColor: '#f8fafc' },
  bentoNormal: { width: (width - 50) / 2, height: 160 },
  bentoWide: { width: width - 40, height: 120 },
  bentoLarge: { width: width - 40, height: 200 },
  bentoImg: { width: '100%', height: '100%' },
  bentoOverlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'flex-end', padding: 14 },
  bentoContent: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  bentoIconWrap: { width: 32, height: 32, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  bentoText: { fontSize: 14, fontWeight: '800', color: '#fff', letterSpacing: 0.3 },
  bentoSubtext: { fontSize: 10, color: 'rgba(255,255,255,0.7)', marginTop: 2, fontWeight: '600' },

  productScroll: { paddingHorizontal: 15, gap: 12 },
  productCard: { width: 160, backgroundColor: '#fff', borderRadius: 20, borderWidth: 1, borderColor: '#f1f5f9', overflow: 'hidden', ...shadows.sm },
  productImg: { width: 160, height: 160, backgroundColor: '#f8fafc' },
  productInfo: { padding: 12 },
  productCat: { fontSize: 8, fontWeight: '800', color: colors.brandLight, letterSpacing: 0.8 },
  productName: { fontSize: 13, fontWeight: '700', color: '#1e293b', marginTop: 2 },

  clientScroll: { paddingHorizontal: 15, gap: 15, paddingBottom: 10 },
  clientCard: { width: 100, height: 64, backgroundColor: '#fff', borderRadius: 16, borderWidth: 1, borderColor: '#f1f5f9', alignItems: 'center', justifyContent: 'center', padding: 12, ...shadows.sm },
  clientLogo: { width: '100%', height: '100%' },

  contactSection: { marginTop: 40, paddingHorizontal: 20, paddingBottom: 40 },
  contactCard: { borderRadius: 24, padding: 24, ...shadows.xl },
  contactTitle: { fontSize: 24, fontWeight: '800', color: '#fff' },
  contactSub: { fontSize: 14, color: 'rgba(255,255,255,0.5)', marginTop: 4, marginBottom: 24 },
  form: { gap: 12 },
  inputWrap: { flexDirection: 'row', backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 12, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  inputIcon: { width: 40, alignItems: 'center', justifyContent: 'center' },
  input: { flex: 1, paddingVertical: 12, paddingRight: 12, color: '#fff', fontSize: 14 },
  submitBtn: { marginTop: 8, borderRadius: 12, overflow: 'hidden' },
  submitGrad: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 16 },
  submitText: { fontSize: 14, fontWeight: '800', color: '#fff' },

  footer: { marginTop: 40, alignItems: 'center', gap: 16 },
  footerText: { fontSize: 11, color: colors.gray400 },
  socials: { flexDirection: 'row', gap: 20 },
});
