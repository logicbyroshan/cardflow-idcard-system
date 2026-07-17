import React from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Image,
  TouchableOpacity,
  Dimensions,
  Linking,
  Share,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { DynamicIcon } from "../components/Icons";
import {
  colors,
  gradients,
  spacing,
  radius,
  fontFamily,
  shadows,
} from "../theme";

const { width } = Dimensions.get("window");

export default function PublicProductDetailScreen({ route, navigation }) {
  const insets = useSafeAreaInsets();
  const { product, categoryName = "Products", businessContact = {} } = route.params || {};

  if (!product) {
    return (
      <View style={[styles.root, styles.center, { paddingTop: insets.top }]}>
        <Text style={styles.errorText}>No product details found.</Text>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()}>
          <Text style={styles.backBtnText}>Go Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const isVideo = product.item_type === "video";
  const mediaUrl = product.media_url || product.video_thumbnail_url;

  const handlePlayVideo = () => {
    const videoUrl = product.video_stream_url || product.video_url || product.media_url;
    if (videoUrl) {
      Linking.openURL(videoUrl).catch((err) =>
        console.error("Failed to open video link:", err)
      );
    }
  };

  const handleWhatsAppEnquiry = () => {
    const whatsappNum = businessContact.whatsapp || "91XXXXXXXXXX"; // Fallback
    const cleanNum = whatsappNum.replace(/\D/g, ""); // numeric only
    const message = `Hi Adarsh, I am interested in your product: *${product.title}* (${categoryName}). Could you please share pricing and order details?\n\nImage: ${product.media_url}`;
    const url = `https://wa.me/${cleanNum}?text=${encodeURIComponent(message)}`;
    
    Linking.openURL(url).catch((err) =>
      console.error("Failed to open WhatsApp:", err)
    );
  };

  const handleAppEnquiry = () => {
    // Navigate back to Landing screen and pass pre-filled enquiry parameters
    navigation.navigate("Landing", {
      prefillProduct: product,
      categoryName,
    });
  };

  const handleShare = async () => {
    try {
      await Share.share({
        message: `Check out this premium PVC product from Adarsh ID Cards: ${product.title}\nDescription: ${product.description || ""}\nLink: ${product.media_url || ""}`,
      });
    } catch (error) {
      console.error("Error sharing:", error);
    }
  };

  return (
    <View style={styles.root}>
      {/* Media Header */}
      <View style={styles.mediaContainer}>
        {mediaUrl ? (
          <Image source={{ uri: mediaUrl }} style={styles.heroImage} resizeMode="cover" />
        ) : (
          <View style={[styles.heroImage, styles.center, { backgroundColor: colors.gray100 }]}>
            <DynamicIcon name="image" size={48} color={colors.gray300} />
          </View>
        )}
        
        {/* Soft dark overlay for status bar/back btn readability */}
        <LinearGradient
          colors={["rgba(0,0,0,0.5)", "transparent"]}
          style={StyleSheet.absoluteFill}
        />

        {/* Floating Back and Share buttons */}
        <View style={[styles.floatingHeader, { paddingTop: insets.top + 10 }]}>
          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={styles.floatingBtn}
            activeOpacity={0.8}
          >
            <DynamicIcon name="chevron-left" size={20} color="#fff" />
          </TouchableOpacity>
          
          <TouchableOpacity
            onPress={handleShare}
            style={styles.floatingBtn}
            activeOpacity={0.8}
          >
            <DynamicIcon name="paper-plane" size={16} color="#fff" />
          </TouchableOpacity>
        </View>

        {/* Video Play Overlay */}
        {isVideo && (
          <TouchableOpacity
            style={styles.playOverlay}
            onPress={handlePlayVideo}
            activeOpacity={0.9}
          >
            <View style={styles.playButtonCircle}>
              <DynamicIcon name="redo" size={28} color="#fff" />
            </View>
            <Text style={styles.playOverlayText}>Tap to Play Demo Video</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Details Scroll */}
      <ScrollView
        style={styles.contentScroll}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        <View style={styles.detailsCard}>
          {/* Category Badge & Orientation */}
          <View style={styles.badgeRow}>
            <View style={styles.categoryBadge}>
              <Text style={styles.categoryBadgeText}>{categoryName}</Text>
            </View>
            <View style={styles.tagRow}>
              {product.orientation && (
                <View style={[styles.infoTag, { backgroundColor: colors.indigo50 }]}>
                  <Text style={[styles.infoTagText, { color: colors.gray700 }]}>
                    {product.orientation.toUpperCase()}
                  </Text>
                </View>
              )}
              {product.is_featured && (
                <View style={[styles.infoTag, { backgroundColor: colors.pending.bg }]}>
                  <Text style={[styles.infoTagText, { color: colors.pending.text }]}>
                    FEATURED
                  </Text>
                </View>
              )}
            </View>
          </View>

          {/* Product Title */}
          <Text style={styles.productTitle}>{product.title}</Text>
          <View style={styles.titleDivider} />

          {/* Description */}
          <Text style={styles.sectionTitle}>Product Details</Text>
          <Text style={styles.productDesc}>
            {product.description || "Premium quality specifications and design tailored for institutional and enterprise use cases. Contact our support for customized templates."}
          </Text>

          {isVideo && (
            <TouchableOpacity style={styles.inlinePlayBtn} onPress={handlePlayVideo}>
              <DynamicIcon name="redo" size={12} color={colors.brandPrimary} />
              <Text style={styles.inlinePlayBtnText}>Watch Demonstration Video</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Enquiry Marketing Actions */}
        <View style={styles.actionsCard}>
          <Text style={styles.actionsTitle}>Interested in this product?</Text>
          <Text style={styles.actionsSub}>
            Reach out to get a custom quote with your institutional brand logo and colors.
          </Text>

          <View style={styles.buttonCol}>
            {/* WhatsApp CTA */}
            <TouchableOpacity
              onPress={handleWhatsAppEnquiry}
              style={styles.whatsappBtn}
              activeOpacity={0.85}
            >
              <LinearGradient
                colors={["#25D366", "#128C7E"]}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.gradientBtnContent}
              >
                <DynamicIcon name="approved" size={16} color="#fff" />
                <Text style={styles.btnText}>ENQUIRE ON WHATSAPP</Text>
              </LinearGradient>
            </TouchableOpacity>

            {/* Standard Form CTA */}
            <TouchableOpacity
              onPress={handleAppEnquiry}
              style={styles.standardBtn}
              activeOpacity={0.8}
            >
              <Text style={styles.standardBtnText}>QUICK IN-APP ENQUIRY</Text>
              <DynamicIcon name="arrow-right" size={14} color={colors.brandPrimary} />
            </TouchableOpacity>
          </View>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.surfaceBg,
  },
  center: {
    alignItems: "center",
    justifyContent: "center",
  },
  errorText: {
    fontSize: 16,
    fontFamily: fontFamily.semibold,
    color: colors.gray600,
    marginBottom: 20,
  },
  backBtn: {
    paddingHorizontal: 20,
    paddingVertical: 10,
    backgroundColor: colors.brandPrimary,
    borderRadius: radius.md,
  },
  backBtnText: {
    color: "#fff",
    fontFamily: fontFamily.bold,
  },
  mediaContainer: {
    height: 320,
    position: "relative",
    backgroundColor: colors.black,
  },
  heroImage: {
    width: "100%",
    height: "100%",
  },
  floatingHeader: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 0,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    zIndex: 10,
  },
  floatingBtn: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    backgroundColor: "rgba(0, 0, 0, 0.4)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.15)",
  },
  playOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(0, 0, 0, 0.35)",
    alignItems: "center",
    justifyContent: "center",
  },
  playButtonCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
    ...shadows.lg,
    borderWidth: 2,
    borderColor: "#fff",
  },
  playOverlayText: {
    color: "#fff",
    marginTop: 12,
    fontSize: 13,
    fontFamily: fontFamily.semibold,
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  contentScroll: {
    flex: 1,
    marginTop: -15,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    backgroundColor: colors.surfaceBg,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
    gap: 16,
  },
  detailsCard: {
    backgroundColor: colors.white,
    borderRadius: radius.md,
    padding: 20,
    ...shadows.sm,
    borderWidth: 1,
    borderColor: colors.gray100,
  },
  badgeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 12,
  },
  categoryBadge: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    backgroundColor: colors.gray100,
    borderRadius: radius.sm,
  },
  categoryBadgeText: {
    fontSize: 11,
    color: colors.gray700,
    fontFamily: fontFamily.bold,
    textTransform: "uppercase",
  },
  tagRow: {
    flexDirection: "row",
    gap: 6,
  },
  infoTag: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.xs,
  },
  infoTagText: {
    fontSize: 9,
    fontFamily: fontFamily.bold,
  },
  productTitle: {
    fontSize: 22,
    fontFamily: fontFamily.bold,
    color: colors.gray900,
    lineHeight: 28,
  },
  titleDivider: {
    height: 2,
    backgroundColor: colors.gray50,
    marginVertical: 16,
  },
  sectionTitle: {
    fontSize: 14,
    fontFamily: fontFamily.semibold,
    color: colors.gray800,
    marginBottom: 8,
  },
  productDesc: {
    fontSize: 13,
    fontFamily: fontFamily.regular,
    color: colors.gray600,
    lineHeight: 20,
  },
  inlinePlayBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: 16,
    alignSelf: "flex-start",
  },
  inlinePlayBtnText: {
    fontSize: 12,
    fontFamily: fontFamily.bold,
    color: colors.brandPrimary,
  },
  actionsCard: {
    backgroundColor: colors.white,
    borderRadius: radius.md,
    padding: 20,
    alignItems: "center",
    ...shadows.sm,
    borderWidth: 1,
    borderColor: colors.gray100,
  },
  actionsTitle: {
    fontSize: 16,
    fontFamily: fontFamily.bold,
    color: colors.gray800,
    textAlign: "center",
  },
  actionsSub: {
    fontSize: 12,
    color: colors.gray500,
    textAlign: "center",
    fontFamily: fontFamily.regular,
    marginTop: 6,
    marginBottom: 20,
    lineHeight: 18,
  },
  buttonCol: {
    width: "100%",
    gap: 12,
  },
  whatsappBtn: {
    width: "100%",
    borderRadius: radius.md,
    overflow: "hidden",
    ...shadows.md,
  },
  gradientBtnContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 14,
    gap: 8,
  },
  btnText: {
    color: "#fff",
    fontSize: 13,
    fontFamily: fontFamily.bold,
    letterSpacing: 0.5,
  },
  standardBtn: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 12,
    backgroundColor: colors.gray50,
    borderWidth: 1,
    borderColor: colors.gray200,
    borderRadius: radius.md,
    gap: 6,
  },
  standardBtnText: {
    color: colors.brandPrimary,
    fontSize: 12,
    fontFamily: fontFamily.bold,
    letterSpacing: 0.5,
  },
});
