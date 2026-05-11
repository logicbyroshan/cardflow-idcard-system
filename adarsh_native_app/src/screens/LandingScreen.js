import React, { useState, useEffect, useRef, useCallback } from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Image,
  Dimensions,
  FlatList,
  TextInput,
  ActivityIndicator,
  Animated,
} from "react-native";
import { DynamicIcon } from "../components/Icons";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  colors,
  gradients,
  shadows,
  radius,
  typography,
  fontFamily,
} from "../theme";
import { apiGet, apiPost, BASE_URL } from "../api/client";
import { useAuth } from "../context/AuthContext";
import Toast from "../components/Toast";
import useRefreshableResource from "../hooks/useRefreshableResource";

const { width } = Dimensions.get("window");

export default function LandingScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const { isAuthenticated } = useAuth();
  const [activeHero, setActiveHero] = useState(0);
  const heroRef = useRef(null);
  const [form, setForm] = useState({
    name: "",
    email: "",
    phone: "",
    message: "",
  });
  const [submitting, setSubmitting] = useState(false);
  const [toast, setToast] = useState({
    visible: false,
    message: "",
    type: "info",
  });
  const scrollY = useRef(new Animated.Value(0)).current;

  const loadLandingData = useCallback(async () => {
    try {
      const { ok, data: res } = await apiGet(
        "https://adarshbhopal.in/api/mobile/pub/website/landing/",
      );
      if (ok && res.success) return res.data;
      throw new Error(
        res.message || "Failed to load content. Please try again.",
      );
    } catch (e) {
      console.error(e);
      throw e;
    }
  }, []);

  const {
    data: landingData = null,
    loading,
    error,
    refresh,
  } = useRefreshableResource(loadLandingData, { initialData: null });

  useEffect(() => {
    const interval = setInterval(() => {
      if (landingData?.hero_images?.length > 1) {
        const next = (activeHero + 1) % landingData.hero_images.length;
        heroRef.current?.scrollToIndex({ index: next, animated: true });
        setActiveHero(next);
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [landingData, activeHero]);

  const handleContact = async () => {
    if (!form.name || !form.email || !form.message) {
      setToast({
        visible: true,
        message: "Please fill required fields",
        type: "warn",
      });
      return;
    }
    setSubmitting(true);
    try {
      const { data: res } = await apiPost(
        "https://adarshbhopal.in/api/mobile/pub/website/contact/",
        form,
      );
      setToast({
        visible: true,
        message: res.message || "Sent successfully",
        type: res.success ? "success" : "error",
      });
      if (res.success) setForm({ name: "", email: "", phone: "", message: "" });
    } catch (e) {
      setToast({ visible: true, message: "Connection failed", type: "error" });
    }
    setSubmitting(false);
  };

  if (loading)
    return (
      <View style={s.loading}>
        <ActivityIndicator size="large" color={colors.brandPrimary} />
        <Text style={s.loadingText}>Loading v38 Experience...</Text>
      </View>
    );

  if (error)
    return (
      <View style={s.errorRoot}>
        <LinearGradient
          colors={["#fff", "#f8fafc"]}
          style={StyleSheet.absoluteFill}
        />
        <View style={s.errorIconCircle}>
          <DynamicIcon name="wifi" size={32} color={colors.red} />
          <View style={s.slash} />
        </View>
        <Text style={s.errorTitle}>Connection Issue</Text>
        <Text style={s.errorMsg}>{error}</Text>
        <TouchableOpacity onPress={refresh} style={s.retryBtn}>
          <LinearGradient
            colors={gradients.brand}
            style={s.retryBtnGrad}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 0 }}
          >
            <DynamicIcon name="redo" size={12} color="#fff" />
            <Text style={s.retryBtnText}>TAP TO RETRY</Text>
          </LinearGradient>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={() =>
            navigation.navigate(isAuthenticated ? "Home" : "Login")
          }
          style={s.errorLoginLink}
        >
          <Text style={s.errorLoginLinkText}>Skip to Login Panel</Text>
        </TouchableOpacity>
      </View>
    );

  const headerBg = scrollY.interpolate({
    inputRange: [0, 100],
    outputRange: ["transparent", "rgba(255,255,255,0.95)"],
    extrapolate: "clamp",
  });

  const headerShadow = scrollY.interpolate({
    inputRange: [0, 100],
    outputRange: [0, 1],
    extrapolate: "clamp",
  });

  return (
    <View style={s.root}>
      <Animated.View
        style={[
          s.header,
          {
            paddingTop: insets.top + 8,
            backgroundColor: headerBg,
            borderBottomWidth: headerShadow,
            borderBottomColor: "#eee",
          },
        ]}
      >
        <View style={s.headerInner}>
          <View style={s.logoSide}>
            <View style={s.logoWrap}>
              <View style={s.logoCircle}>
                <DynamicIcon name="id-card" size={20} color="#fff" />
              </View>
            </View>
            <Text style={s.logoText}>ADARSH</Text>
          </View>
          <TouchableOpacity
            onPress={() =>
              navigation.navigate(isAuthenticated ? "Home" : "Login")
            }
            style={s.loginBtn}
          >
            <LinearGradient
              colors={gradients.brand}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={s.loginBtnGrad}
            >
              <Text style={s.loginBtnText}>
                {isAuthenticated ? "GO TO DASHBOARD" : "LOGIN PANEL"}
              </Text>
              <DynamicIcon
                name={isAuthenticated ? "th-large" : "arrow-right"}
                size={10}
                color="#fff"
              />
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </Animated.View>

      <Animated.ScrollView
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { y: scrollY } } }],
          { useNativeDriver: false },
        )}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
      >
        <View style={s.heroContainer}>
          <FlatList
            ref={heroRef}
            data={landingData?.hero_images || []}
            horizontal
            pagingEnabled
            showsHorizontalScrollIndicator={false}
            onMomentumScrollEnd={(e) =>
              setActiveHero(Math.round(e.nativeEvent.contentOffset.x / width))
            }
            renderItem={({ item }) => (
              <View style={s.heroSlide}>
                <Image
                  source={{
                    uri: item.image?.startsWith("http")
                      ? item.image
                      : `${BASE_URL}${item.image}`,
                  }}
                  style={s.heroImg}
                  resizeMode="cover"
                />
                <LinearGradient
                  colors={["transparent", "rgba(0,0,0,0.8)"]}
                  style={s.heroOverlay}
                >
                  <View style={s.heroContent}>
                    <Text style={s.heroTitle}>{item.title}</Text>
                    <Text style={s.heroSubtitle}>{item.subtitle}</Text>
                  </View>
                </LinearGradient>
              </View>
            )}
            keyExtractor={(item) => item.id.toString()}
          />
          <View style={s.heroDots}>
            {landingData?.hero_images?.map((_, i) => (
              <View key={i} style={[s.dot, activeHero === i && s.dotActive]} />
            ))}
          </View>
        </View>

        <View style={s.quickCatRow}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={s.quickCatScroll}
          >
            {landingData?.categories?.map((cat) => (
              <TouchableOpacity
                key={cat.id}
                onPress={() =>
                  navigation.navigate("ProductCategoryDetail", {
                    category: cat,
                  })
                }
                style={s.quickCatChip}
              >
                <View style={s.catIconWrap}>
                  <DynamicIcon
                    name={cat.icon || "star"}
                    size={18}
                    color={colors.brandPrimary}
                  />
                </View>
                <Text style={s.quickCatText}>{cat.name}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        <View style={s.section}>
          <View style={s.sectionPadding}>
            <Text style={s.sectionTitle}>Featured Products</Text>
          </View>
          <FlatList
            data={landingData?.products || []}
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={s.shelfScroll}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={s.featuredProdCard}
                onPress={() =>
                  navigation.navigate("ProductDetail", { product: item })
                }
              >
                <Image
                  source={{
                    uri: item.image?.startsWith("http")
                      ? item.image
                      : `${BASE_URL}${item.image}`,
                  }}
                  style={s.featuredProdImg}
                />
                <View style={s.featuredProdInfo}>
                  <Text style={s.featuredProdTag}>{item.category}</Text>
                  <Text style={s.featuredProdTitle} numberOfLines={1}>
                    {item.title}
                  </Text>
                </View>
              </TouchableOpacity>
            )}
            keyExtractor={(item) => "featured-" + item.id}
          />
        </View>

        <View style={s.section}>
          <View style={s.sectionPadding}>
            <Text style={s.sectionTitle}>Trusted by 1000+ Institutions</Text>
            <Text style={s.sectionSub}>
              Partnering with leading organizations across the country.
            </Text>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={s.clientScroll}
          >
            {landingData?.clients?.map((client) => (
              <View key={client.id} style={s.clientCard}>
                <Image
                  source={{
                    uri: client.logo?.startsWith("http")
                      ? client.logo
                      : `${BASE_URL}${client.logo}`,
                  }}
                  style={s.clientLogo}
                  resizeMode="contain"
                />
              </View>
            ))}
          </ScrollView>
        </View>

        <View style={s.contactSection}>
          <View style={s.contactCard}>
            <Text style={s.contactTitle}>Quick Enquiry</Text>
            <Text style={s.contactSub}>Have questions? Drop us a message.</Text>
            <View style={s.form}>
              <LandingInput
                placeholder="Full Name"
                icon="user"
                value={form.name}
                onChangeText={(t) => setForm((p) => ({ ...p, name: t }))}
              />
              <LandingInput
                placeholder="Email Address"
                icon="envelope"
                keyboardType="email-address"
                value={form.email}
                onChangeText={(t) => setForm((p) => ({ ...p, email: t }))}
              />
              <LandingInput
                placeholder="Phone (Optional)"
                icon="phone"
                keyboardType="phone-pad"
                value={form.phone}
                onChangeText={(t) => setForm((p) => ({ ...p, phone: t }))}
              />
              <LandingInput
                placeholder="How can we help you?"
                icon="comment"
                multiline
                value={form.message}
                onChangeText={(t) => setForm((p) => ({ ...p, message: t }))}
              />
              <TouchableOpacity
                onPress={handleContact}
                disabled={submitting}
                style={s.submitBtn}
              >
                <LinearGradient
                  colors={gradients.brand}
                  style={s.submitGrad}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                >
                  {submitting ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <>
                      <Text style={s.submitText}>Send Message</Text>
                      <DynamicIcon name="paper-plane" size={12} color="#fff" />
                    </>
                  )}
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </View>

          <View style={s.footer}>
            <Text style={s.footerText}>
              © 2024 Adarsh Bhopal. All rights reserved.
            </Text>
            <View style={s.socials}>
              <TouchableOpacity>
                <DynamicIcon
                  name="facebook"
                  size={18}
                  color={colors.gray400}
                />
              </TouchableOpacity>
              <TouchableOpacity>
                <DynamicIcon
                  name="instagram"
                  size={18}
                  color={colors.gray400}
                />
              </TouchableOpacity>
              <TouchableOpacity>
                <DynamicIcon
                  name="whatsapp"
                  size={18}
                  color={colors.gray400}
                />
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Animated.ScrollView>

      <Toast
        visible={toast.visible}
        message={toast.message}
        type={toast.type}
        onHide={() => setToast((p) => ({ ...p, visible: false }))}
      />
    </View>
  );
}

function BenefitItem({ icon, title, sub }) {
  return (
    <View style={s.benefitCard}>
      <View style={s.benefitIcon}>
        <DynamicIcon name={icon} size={14} color={colors.brandLight} />
      </View>
      <Text style={s.benefitTitle}>{title}</Text>
      <Text style={s.benefitSub}>{sub}</Text>
    </View>
  );
}

function LandingInput({ icon, ...props }) {
  return (
    <View style={s.inputWrap}>
      <View style={s.inputIcon}>
        <DynamicIcon name={icon} size={12} color={colors.brandLight} />
      </View>
      <TextInput
        {...props}
        placeholderTextColor={colors.gray400}
        style={[
          s.input,
          props.multiline && { height: 80, textAlignVertical: "top" },
        ]}
      />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#fff" },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
  header: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 100,
    paddingBottom: 12,
  },
  headerInner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
  },
  logoSide: { flexDirection: "row", alignItems: "center" },
  logoWrap: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    ...shadows.sm,
    overflow: "hidden",
  },
  logoImg: { width: "80%", height: "80%" },
  logoText: {
    fontSize: 16,
    fontFamily: fontFamily.bold,
    color: colors.brandLight,
    letterSpacing: 1,
  },
  loginBtn: { borderRadius: 20, overflow: "hidden", ...shadows.md },
  loginBtnGrad: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  loginBtnText: {
    fontSize: 10,
    fontFamily: fontFamily.bold,
    color: "#fff",
    letterSpacing: 0.5,
  },

  heroContainer: { height: 450, position: "relative" },
  heroSlide: { width, height: 450 },
  heroImg: { width: "100%", height: "100%" },
  heroOverlay: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    height: 250,
    justifyContent: "flex-end",
    padding: 24,
    paddingBottom: 40,
  },
  heroTitle: {
    fontSize: 32,
    fontFamily: fontFamily.bold,
    color: "#fff",
    lineHeight: 38,
  },
  heroSubtitle: {
    fontSize: 16,
    color: "rgba(255,255,255,0.8)",
    marginTop: 8,
    fontFamily: fontFamily.regular,
  },
  heroDots: {
    position: "absolute",
    bottom: 20,
    left: 24,
    flexDirection: "row",
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "rgba(255,255,255,0.3)",
  },
  dotActive: { width: 20, backgroundColor: "#fff" },

  section: { marginTop: 32 },
  sectionPadding: { paddingHorizontal: 20 },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontFamily: fontFamily.bold,
    color: "#1e293b",
    marginBottom: 16,
  },
  sectionSub: {
    fontSize: 13,
    color: "#64748b",
    marginTop: -8,
    marginBottom: 16,
    fontFamily: fontFamily.regular,
  },
  viewAll: {
    fontSize: 13,
    fontFamily: fontFamily.semibold,
    color: colors.brandLight,
  },

  featuredProdCard: {
    width: 220,
    backgroundColor: "#fff",
    borderRadius: 20,
    marginRight: 15,
    overflow: "hidden",
    ...shadows.md,
    borderWidth: 1,
    borderColor: "#f1f5f9",
  },
  featuredProdImg: { width: "100%", height: 160, backgroundColor: "#f8fafc" },
  featuredProdInfo: { padding: 15 },
  featuredProdTag: {
    fontSize: 9,
    fontFamily: fontFamily.bold,
    color: colors.brandLight,
    textTransform: "uppercase",
    marginBottom: 4,
  },
  featuredProdTitle: {
    fontSize: 14,
    fontFamily: fontFamily.bold,
    color: "#1e293b",
  },

  quickCatRow: {
    marginTop: -25,
    backgroundColor: "#fff",
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    paddingTop: 20,
  },
  quickCatScroll: { paddingHorizontal: 15, paddingBottom: 10 },
  quickCatChip: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#f1f5f9",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
  },
  quickCatText: { fontSize: 11, fontFamily: fontFamily.bold, color: "#475569" },

  shelfSection: { marginTop: 24, paddingVertical: 10 },
  shelfHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  shelfTitleWrap: { flexDirection: "row", alignItems: "center" },
  shelfIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  shelfTitle: { fontSize: 18, fontFamily: fontFamily.bold, color: "#1e293b" },
  shelfSub: {
    fontSize: 10,
    color: "#94a3b8",
    marginTop: 1,
    fontFamily: fontFamily.semibold,
  },
  shelfViewAll: { flexDirection: "row", alignItems: "center" },
  viewAllText: {
    fontSize: 12,
    fontFamily: fontFamily.bold,
    color: colors.brandLight,
  },

  shelfScroll: { paddingHorizontal: 15, paddingBottom: 10 },
  shelfCard: {
    width: 140,
    backgroundColor: "#fff",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#f1f5f9",
    overflow: "hidden",
    ...shadows.sm,
  },
  shelfImg: { width: 140, height: 140, backgroundColor: "#f8fafc" },
  shelfInfo: { padding: 10 },
  shelfProdName: {
    fontSize: 12,
    fontFamily: fontFamily.bold,
    color: "#1e293b",
  },

  shelfMoreCard: {
    width: 100,
    height: 180,
    alignItems: "center",
    justifyContent: "center",
  },
  shelfMoreCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#f1f5f9",
    alignItems: "center",
    justifyContent: "center",
  },
  shelfMoreText: {
    fontSize: 11,
    fontFamily: fontFamily.bold,
    color: colors.brandLight,
  },

  emptyShelf: {
    marginHorizontal: 20,
    padding: 20,
    backgroundColor: "#f8fafc",
    borderRadius: 16,
    alignItems: "center",
    borderStyle: "dashed",
    borderWidth: 1,
    borderColor: "#cbd5e1",
  },
  emptyShelfText: {
    fontSize: 12,
    color: "#94a3b8",
    fontFamily: fontFamily.semibold,
  },

  clientScroll: { paddingHorizontal: 15, paddingBottom: 10 },
  clientCard: {
    width: 100,
    height: 64,
    backgroundColor: "#fff",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#f1f5f9",
    alignItems: "center",
    justifyContent: "center",
    padding: 12,
    ...shadows.sm,
  },
  clientLogo: { width: "100%", height: "100%" },

  contactSection: { marginTop: 40, paddingHorizontal: 20, paddingBottom: 40 },
  contactCard: {
    backgroundColor: "#fff",
    borderRadius: 24,
    padding: 24,
    borderWidth: 1,
    borderColor: "#f1f5f9",
    ...shadows.xl,
  },
  contactTitle: { fontSize: 24, fontFamily: fontFamily.bold, color: "#1e293b" },
  contactSub: {
    fontSize: 14,
    color: "#64748b",
    marginTop: 4,
    marginBottom: 24,
    fontFamily: fontFamily.regular,
  },
  form: {},
  inputWrap: {
    flexDirection: "row",
    backgroundColor: "#f8fafc",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  inputIcon: { width: 40, alignItems: "center", justifyContent: "center" },
  input: {
    flex: 1,
    paddingVertical: 12,
    paddingRight: 12,
    color: "#1e293b",
    fontSize: 14,
    fontFamily: fontFamily.regular,
  },
  submitBtn: { marginTop: 8, borderRadius: 12, overflow: "hidden" },
  submitGrad: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 16,
  },
  submitText: { fontSize: 14, fontFamily: fontFamily.bold, color: "#fff" },

  footer: { marginTop: 40, alignItems: "center" },
  footerText: {
    fontSize: 11,
    color: colors.gray400,
    fontFamily: fontFamily.regular,
  },
  socials: { flexDirection: "row" },

  benefitsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 16,
  },
  benefitCard: {
    flex: 1,
    backgroundColor: "#f8fafc",
    borderRadius: 16,
    padding: 16,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  benefitIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
    ...shadows.sm,
  },
  benefitTitle: {
    fontSize: 13,
    fontFamily: fontFamily.bold,
    color: "#1e293b",
    textAlign: "center",
  },
  benefitSub: {
    fontSize: 10,
    color: "#64748b",
    textAlign: "center",
    marginTop: 4,
    fontFamily: fontFamily.regular,
  },

  loadingText: {
    marginTop: 16,
    fontSize: 12,
    fontFamily: fontFamily.semibold,
    color: colors.gray400,
    letterSpacing: 1,
  },
  errorRoot: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    backgroundColor: "#fff",
  },
  errorIconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: "#fef2f2",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 24,
    borderWidth: 1,
    borderColor: "#fee2e2",
  },
  slash: {
    position: "absolute",
    width: 40,
    height: 2,
    backgroundColor: colors.red,
    transform: [{ rotate: "45deg" }],
  },
  errorTitle: {
    fontSize: 24,
    fontFamily: fontFamily.bold,
    color: "#1e293b",
    marginBottom: 8,
  },
  errorMsg: {
    fontSize: 14,
    fontFamily: fontFamily.regular,
    color: "#64748b",
    textAlign: "center",
    lineHeight: 22,
    marginBottom: 32,
  },
  retryBtn: {
    width: "100%",
    borderRadius: 12,
    overflow: "hidden",
    ...shadows.lg,
  },
  retryBtnGrad: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 16,
  },
  retryBtnText: {
    fontSize: 14,
    fontFamily: fontFamily.bold,
    color: "#fff",
    letterSpacing: 1,
  },
  errorLoginLink: { marginTop: 24, padding: 12 },
  errorLoginLinkText: {
    fontSize: 14,
    fontFamily: fontFamily.semibold,
    color: colors.brandLight,
    textDecorationLine: "underline",
  },
});
