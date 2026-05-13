import React, { useState, useEffect, useRef } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Image,
  ScrollView,
  Dimensions,
  FlatList,
  TextInput,
  ActivityIndicator,
  Linking,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { DynamicIcon } from "../components/Icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  colors,
  gradients,
  shadows,
  radius,
  spacing,
  fontFamily,
} from "../theme";
import { apiGet, apiPost, BASE_URL } from "../api/client";
import Toast from "../components/Toast";

const { width } = Dimensions.get("window");

export default function WelcomeScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [connectionError, setConnectionError] = useState(false);
  const [activeHero, setActiveHero] = useState(0);
  const heroRef = useRef(null);

  // Contact Form State
  const [contact, setContact] = useState({
    name: "",
    email: "",
    phone: "",
    message: "",
  });
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState({
    visible: false,
    message: "",
    type: "info",
  });

  useEffect(() => {
    loadLandingData();
  }, []);

  const loadLandingData = async () => {
    setLoading(true);
    setConnectionError(false);
    try {
      const { ok, data } = await apiGet('/api/mobile/pub/website/landing/');
      if (ok && data?.success) {
        setData(data);
      } else {
        setConnectionError(true);
      }
    } catch (e) {
      console.log("Landing data err", e);
      setConnectionError(true);
    }
    setLoading(false);
  };

  const showToast = (msg, type = "info") =>
    setToast({ visible: true, message: msg, type });

  const handleContactSubmit = async () => {
    if (!contact.name || !contact.email || !contact.message) {
      showToast("Please fill required fields", "error");
      return;
    }
    setSending(true);
    try {
      const { ok, data } = await apiPost('/api/mobile/pub/website/contact/', {
          ...contact,
          subject: "Mobile App Landing Enquiry",
        },
      );
      if (ok && data?.success) {
        showToast("Enquiry sent successfully!", "success");
        setContact({ name: "", email: "", phone: "", message: "" });
      } else {
        showToast(data?.message || "Failed to send enquiry", "error");
      }
    } catch (e) {
      showToast("Network error", "error");
    }
    setSending(false);
  };

  if (loading) {
    return (
      <View style={s.loadingRoot}>
        <Image source={require("../../assets/logo.png")} style={s.loadingLogo} />
        <ActivityIndicator size="small" color={colors.brandPrimary} style={{ marginTop: 20 }} />
      </View>
    );
  }

  if (connectionError) {
    return (
      <View style={s.loadingRoot}>
        <DynamicIcon name="wifi-slash" size={48} color={colors.gray300} />
        <Text style={s.errorTitle}>Connection Issue</Text>
        <Text style={s.errorSub}>Unable to reach the server. Please check your internet connection.</Text>
        <TouchableOpacity onPress={loadLandingData} style={s.retryBtn}>
           <Text style={s.retryBtnText}>RETRY</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const renderHeroItem = ({ item }) => (
    <View style={s.heroItem}>
      <Image
        source={{
          uri: item.image.startsWith("http")
            ? item.image
            : `${BASE_URL}${item.image}`,
        }}
        style={s.heroImage}
      />
      <LinearGradient
        colors={["transparent", "rgba(0,0,0,0.8)"]}
        style={s.heroOverlay}
      >
        <Text style={s.heroTitle}>{item.title}</Text>
        <Text style={s.heroSub}>{item.subtitle}</Text>
      </LinearGradient>
    </View>
  );

  return (
    <View style={s.root}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        stickyHeaderIndices={[0]}
      >
        {/* Header */}
        <View style={[s.header, { paddingTop: insets.top + 10 }]}>
          <LinearGradient
            colors={["rgba(0,0,0,0.6)", "transparent"]}
            style={StyleSheet.absoluteFill}
          />
          <View style={s.headerContent}>
            <View style={s.logoArea}>
              <Image source={require("../../assets/logo.png")} style={s.headerLogo} />
              <Text style={s.logoText}>ADARSH</Text>
            </View>
            <TouchableOpacity
              onPress={() => navigation.navigate("Login")}
              style={s.headerLoginBtn}
            >
              <Text style={s.headerLoginText}>LOGIN</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Hero Slider */}
        <View style={s.heroWrap}>
          <FlatList
            ref={heroRef}
            data={data?.hero_images || []}
            renderItem={renderHeroItem}
            keyExtractor={(item) => item.id.toString()}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={(e) =>
              setActiveHero(Math.round(e.nativeEvent.contentOffset.x / width))
            }
          />
          <View style={s.heroDots}>
            {(data?.hero_images || []).map((_, i) => (
              <View
                key={i}
                style={[s.heroDot, activeHero === i && s.heroDotActive]}
              />
            ))}
          </View>
        </View>

        <View style={s.section}>
          <View style={s.sectionHeader}>
            <Text style={s.sectionTitle}>Institutional ID Solutions</Text>
            <View style={s.sectionLine} />
          </View>
          <Text style={s.sectionSubText}>
            Adarsh ID Cards provides end-to-end identification solutions for schools, colleges, and corporate organizations.
          </Text>
        </View>

        {/* Contact Us */}
        <View style={[s.section, s.contactSection]}>
          <LinearGradient colors={gradients.brand} style={s.contactCard}>
            <Text style={s.contactTitle}>Get in Touch</Text>
            <Text style={s.contactSub}>
              Have questions? Send us a message and we'll help you out.
            </Text>

            <View style={s.form}>
              <View style={s.inputGroup}>
                <DynamicIcon
                  name="user"
                  size={12}
                  color="rgba(255,255,255,0.6)"
                  style={s.inputIcon}
                />
                <TextInput
                  style={s.input}
                  value={contact.name}
                  onChangeText={(t) => setContact((p) => ({ ...p, name: t }))}
                  placeholder="Full Name"
                  placeholderTextColor="rgba(255,255,255,0.4)"
                />
              </View>
              <View style={s.inputGroup}>
                <DynamicIcon
                  name="envelope"
                  size={12}
                  color="rgba(255,255,255,0.6)"
                  style={s.inputIcon}
                />
                <TextInput
                  style={s.input}
                  value={contact.email}
                  onChangeText={(t) => setContact((p) => ({ ...p, email: t }))}
                  placeholder="Email Address"
                  placeholderTextColor="rgba(255,255,255,0.4)"
                  keyboardType="email-address"
                />
              </View>
              <View style={s.inputGroup}>
                <DynamicIcon
                  name="comment-alt"
                  size={12}
                  color="rgba(255,255,255,0.6)"
                  style={s.inputIcon}
                />
                <TextInput
                  style={[s.input, s.textArea]}
                  value={contact.message}
                  onChangeText={(t) =>
                    setContact((p) => ({ ...p, message: t }))
                  }
                  placeholder="Your Message..."
                  placeholderTextColor="rgba(255,255,255,0.4)"
                  multiline
                  numberOfLines={4}
                />
              </View>

              <TouchableOpacity
                onPress={handleContactSubmit}
                disabled={sending}
                style={s.submitBtn}
              >
                {sending ? (
                  <ActivityIndicator color={colors.brandPrimary} />
                ) : (
                  <Text style={s.submitBtnText}>SEND MESSAGE</Text>
                )}
              </TouchableOpacity>
            </View>
          </LinearGradient>
        </View>

        {/* Footer */}
        <View style={s.footer}>
          <Text style={s.footerBrand}>ADARSH ID CARDS</Text>
          <Text style={s.footerTag}>
            Specialist in all types of PVC ID cards printing
          </Text>
          <View style={s.socialRow}>
            <TouchableOpacity
              onPress={() =>
                Linking.openURL("https://wa.me/91" + data?.business?.whatsapp)
              }
              style={s.socialIcon}
            >
              <DynamicIcon name="whatsapp" size={16} color={colors.gray400} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => Linking.openURL("https://facebook.com")}
              style={s.socialIcon}
            >
              <DynamicIcon name="facebook" size={16} color={colors.gray400} />
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => Linking.openURL("https://instagram.com")}
              style={s.socialIcon}
            >
              <DynamicIcon name="instagram" size={16} color={colors.gray400} />
            </TouchableOpacity>
          </View>
          <Text style={s.version}>v1.2.0 • Made with ❤️ in Bhopal</Text>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>

      <Toast
        visible={toast.visible}
        message={toast.message}
        type={toast.type}
        onHide={() => setToast((p) => ({ ...p, visible: false }))}
      />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#fff" },
  loadingRoot: { flex: 1, alignItems: "center", justifyContent: "center", padding: 40 },
  loadingLogo: { width: 80, height: 80, resizeMode: 'contain' },
  errorTitle: { fontSize: 20, fontFamily: 'SairaSemiCondensed-Bold', color: colors.gray800, marginTop: 20 },
  errorSub: { fontSize: 14, color: colors.gray500, textAlign: 'center', marginTop: 10, fontFamily: 'SairaSemiCondensed-Regular' },
  retryBtn: { marginTop: 30, paddingHorizontal: 30, paddingVertical: 12, borderRadius: radius.md, backgroundColor: colors.brandPrimary },
  retryBtnText: { color: '#fff', fontFamily: 'SairaSemiCondensed-Bold', fontSize: 14 },
  header: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
    paddingHorizontal: 20,
    paddingBottom: 15,
  },
  headerContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  headerLogo: {
    width: 28,
    height: 28,
    resizeMode: 'contain',
    marginRight: 8
  },
  logoText: {
    fontSize: 18,
    fontFamily: 'SairaSemiCondensed-Bold',
    color: "#fff",
    letterSpacing: 1,
  },
  headerLoginBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: radius.md,
    backgroundColor: "rgba(255,255,255,0.2)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.3)",
  },
  headerLoginText: { fontSize: 12, fontFamily: 'SairaSemiCondensed-Bold', color: "#fff" },

  heroWrap: { height: 450, backgroundColor: colors.gray100 },
  heroItem: { width: width, height: 450 },
  heroImage: { width: "100%", height: "100%", resizeMode: "cover" },
  heroOverlay: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    padding: 30,
    paddingTop: 60,
  },
  heroTitle: {
    fontSize: 32,
    fontFamily: 'SairaSemiCondensed-Bold',
    color: "#fff",
    lineHeight: 38,
  },
  heroSub: {
    fontSize: 16,
    color: "rgba(255,255,255,0.8)",
    marginTop: 8,
    fontFamily: 'SairaSemiCondensed-Regular',
  },
  heroDots: {
    position: "absolute",
    bottom: 20,
    left: 30,
    flexDirection: "row",
  },
  heroDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "rgba(255,255,255,0.3)",
  },
  heroDotActive: { width: 24, backgroundColor: "#fff" },

  section: { marginTop: 30, paddingHorizontal: 20 },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 20,
    fontFamily: 'SairaSemiCondensed-Bold',
    color: colors.gray800,
  },
  sectionLine: {
    flex: 1,
    height: 2,
    backgroundColor: colors.gray100,
    marginLeft: 15,
  },
  sectionSubText: {
    fontSize: 14,
    color: colors.gray500,
    lineHeight: 22,
    fontFamily: 'SairaSemiCondensed-Medium',
  },
  viewAll: {
    fontSize: 14,
    fontFamily: 'SairaSemiCondensed-SemiBold',
    color: colors.brandPrimary,
  },

  catScroll: { paddingRight: 20 },
  catCard: {
    width: 100,
    alignItems: "center",
    padding: 12,
    backgroundColor: colors.gray50,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.gray100,
  },
  catIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
    ...shadows.sm,
  },
  catName: {
    fontSize: 11,
    fontFamily: 'SairaSemiCondensed-Bold',
    color: colors.gray600,
    textAlign: "center",
  },

  productGrid: { flexDirection: "row", flexWrap: "wrap" },
  productCard: {
    width: (width - 52) / 2,
    height: 220,
    borderRadius: radius.sm,
    overflow: "hidden",
    ...shadows.md,
  },
  productImg: { width: "100%", height: "100%" },
  playIconOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(0,0,0,0.2)",
  },
  productOverlay: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    padding: 12,
  },
  productTitle: { fontSize: 14, fontFamily: 'SairaSemiCondensed-Bold', color: "#fff" },
  productCat: {
    fontSize: 11,
    color: "rgba(255,255,255,0.7)",
    marginTop: 2,
    fontFamily: 'SairaSemiCondensed-Medium',
  },

  contactSection: { marginTop: 40 },
  contactCard: { borderRadius: radius.md, padding: 25, ...shadows.lg },
  contactTitle: {
    fontSize: 24,
    fontFamily: 'SairaSemiCondensed-Bold',
    color: "#fff",
    textAlign: "center",
  },
  contactSub: {
    fontSize: 14,
    color: "rgba(255,255,255,0.8)",
    textAlign: "center",
    marginTop: 8,
    marginBottom: 25,
    fontFamily: 'SairaSemiCondensed-Regular',
  },
  form: {},
  inputGroup: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.15)",
    borderRadius: radius.sm,
    paddingHorizontal: 15,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  inputIcon: { marginRight: 10 },
  input: {
    flex: 1,
    color: "#fff",
    paddingVertical: 12,
    fontSize: 14,
    fontFamily: 'SairaSemiCondensed-Regular',
  },
  textArea: { height: 80, textAlignVertical: "top", paddingTop: 12 },
  submitBtn: {
    backgroundColor: "#fff",
    borderRadius: radius.sm,
    paddingVertical: 15,
    alignItems: "center",
    marginTop: 10,
  },
  submitBtnText: {
    fontSize: 14,
    fontFamily: 'SairaSemiCondensed-Bold',
    color: colors.brandPrimary,
    letterSpacing: 1,
  },

  footer: {
    marginTop: 50,
    alignItems: "center",
    borderTopWidth: 1,
    borderTopColor: colors.gray100,
    paddingTop: 40,
  },
  footerBrand: {
    fontSize: 16,
    fontFamily: 'SairaSemiCondensed-Bold',
    color: colors.gray300,
    letterSpacing: 2,
  },
  footerTag: {
    fontSize: 11,
    color: colors.gray400,
    marginTop: 4,
    fontFamily: 'SairaSemiCondensed-Medium',
  },
  socialRow: { flexDirection: "row", marginTop: 25 },
  socialIcon: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    backgroundColor: colors.gray50,
    alignItems: "center",
    justifyContent: "center",
  },
  version: {
    fontSize: 10,
    color: colors.gray300,
    marginTop: 30,
    fontFamily: 'SairaSemiCondensed-Regular',
  },
});
