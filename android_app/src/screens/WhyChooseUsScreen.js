import React from "react";
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Image,
  TouchableOpacity,
  Dimensions,
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

export default function WhyChooseUsScreen({ navigation }) {
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.root}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
          activeOpacity={0.8}
        >
          <DynamicIcon name="chevron-left" size={20} color={colors.brandPrimary} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Why Choose Adarsh</Text>
        <View style={{ width: 36 }} /> {/* spacer */}
      </View>

      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Hero Section */}
        <LinearGradient
          colors={gradients.brand}
          style={styles.heroSection}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
        >
          <View style={styles.heroBadge}>
            <DynamicIcon name="star" size={12} color="#fff" />
            <Text style={styles.heroBadgeText}>Trusted Since 2004</Text>
          </View>
          <Text style={styles.heroTitle}>We Don't Just Print ID Cards — We Engineer Confidence</Text>
          <Text style={styles.heroSub}>
            Two decades of industry-leading innovation, state-of-the-art high-definition print technology, and elite security standards.
          </Text>
        </LinearGradient>

        {/* Bento Cards Layout */}
        <Text style={styles.sectionTitle}>Built For Enterprise Scale</Text>
        
        {/* Bento 1: Built for Schools */}
        <View style={styles.bentoCard}>
          <View style={styles.bentoImageContainer}>
            <Image
              source={require("../../assets/built-for-schools.webp")}
              style={styles.bentoImage}
              resizeMode="contain"
            />
          </View>
          <View style={styles.bentoBody}>
            <Text style={styles.bentoEyebrow}>BULK EXCELLENCE</Text>
            <Text style={styles.bentoCardTitle}>Built for Schools & Bulk Orders</Text>
            <Text style={styles.bentoCopy}>
              We specialize in high-volume printing for schools and corporate institutions. From ID cards to diaries and lanyards, our processes are designed to handle bulk requirements without compromising quality.
            </Text>
            
            <View style={styles.pointsCol}>
              <View style={styles.pointRow}>
                <DynamicIcon name="check" size={12} color={colors.brandPrimary} />
                <Text style={styles.pointText}>Bulk order expertise and scaling</Text>
              </View>
              <View style={styles.pointRow}>
                <DynamicIcon name="check" size={12} color={colors.brandPrimary} />
                <Text style={styles.pointText}>Consistent output across large batches</Text>
              </View>
              <View style={styles.pointRow}>
                <DynamicIcon name="check" size={12} color={colors.brandPrimary} />
                <Text style={styles.pointText}>Fast turnarounds, even in peak seasons</Text>
              </View>
            </View>
          </View>
        </View>

        {/* Bento 2: Complete Customization */}
        <View style={styles.bentoCard}>
          <View style={styles.bentoImageContainer}>
            <Image
              source={require("../../assets/customization.webp")}
              style={styles.bentoImage}
              resizeMode="contain"
            />
          </View>
          <View style={styles.bentoBody}>
            <Text style={styles.bentoEyebrow}>TOTAL CUSTOMIZATION</Text>
            <Text style={styles.bentoCardTitle}>Complete Customization Under One Roof</Text>
            <Text style={styles.bentoCopy}>
              From corporate identification to personalized gifting items, we offer end-to-end customization. We bring your unique templates and layouts to life with precision.
            </Text>
            
            <View style={styles.pointsCol}>
              <View style={styles.pointRow}>
                <DynamicIcon name="check" size={12} color={colors.brandPrimary} />
                <Text style={styles.pointText}>Custom gifts, lanyards & accessories</Text>
              </View>
              <View style={styles.pointRow}>
                <DynamicIcon name="check" size={12} color={colors.brandPrimary} />
                <Text style={styles.pointText}>One vendor for all printing needs</Text>
              </View>
              <View style={styles.pointRow}>
                <DynamicIcon name="check" size={12} color={colors.brandPrimary} />
                <Text style={styles.pointText}>Full design & template customization</Text>
              </View>
            </View>
          </View>
        </View>

        {/* Bento 3 & 4 Grid: Reliable & Affordable */}
        <View style={styles.bentoGrid}>
          <View style={styles.bentoHalfCard}>
            <Text style={styles.bentoEyebrow}>RELIABLE & TIMELY</Text>
            <Text style={styles.halfCardTitle}>Guaranteed Delivery</Text>
            <Text style={styles.halfCardCopy}>
              We understand deadlines. We align production with your academic or onboarding milestones for zero delays.
            </Text>
            <View style={styles.miniChips}>
              <Text style={styles.miniChip}>✔ On-time promise</Text>
              <Text style={styles.miniChip}>✔ Multi-stage QC</Text>
            </View>
          </View>

          <View style={styles.bentoHalfCard}>
            <Text style={styles.bentoEyebrow}>VALUE DRIVEN</Text>
            <Text style={styles.halfCardTitle}>Budget Friendly</Text>
            <Text style={styles.halfCardCopy}>
              Competitive wholesale rates without compromise. Get maximum durability at highly optimal printing rates.
            </Text>
            <View style={styles.miniChips}>
              <Text style={styles.miniChip}>✔ Bulk discounts</Text>
              <Text style={styles.miniChip}>✔ Priority support</Text>
            </View>
          </View>
        </View>

        {/* 3D Illustration Strengths Grid */}
        <Text style={styles.sectionTitle}>What Makes Us Different</Text>
        <Text style={styles.sectionSubtitle}>We combine decades of experience with state-of-the-art machinery</Text>

        <View style={styles.strengthsGrid}>
          <StrengthCard
            image={require("../../assets/3d_star.webp")}
            title="Celebrating 25 Years"
            desc="Over 25 years of crafting premium ID solutions across India with unmatched domain expertise."
          />
          <StrengthCard
            image={require("../../assets/3d_id_badge.webp")}
            title="HD PVC Printing"
            desc="Advanced printing technology delivering sharp text, photo quality details, and rich colors."
          />
          <StrengthCard
            image={require("../../assets/3d_lanyard.webp")}
            title="Express Shipments"
            desc="Lightning-fast processing and logistics handling to make sure bulk orders reach on time."
          />
          <StrengthCard
            image={require("../../assets/3d_lock.webp")}
            title="Tamper-Proof Cards"
            desc="Multi-layer security options including holograms, custom barcodes, and QR code prints."
          />
          <StrengthCard
            image={require("../../assets/3d_notebook.webp")}
            title="Custom Templates"
            desc="Tailor-made dimensions, colors, double-sided designs, and custom accessories."
          />
          <StrengthCard
            image={require("../../assets/3d_grad_cap.webp")}
            title="School Specialist"
            desc="Process workflows customized for academic portals, student databases, and cards replacements."
          />
        </View>

        {/* Service Standards Section */}
        <View style={styles.standardsSection}>
          <Text style={styles.standardsTitle}>Standards You Can Rely On</Text>
          <Text style={styles.standardsSubtitle}>Clear commitments designed to reduce risk and rework for your team</Text>

          <View style={styles.standardsCol}>
            <StandardItem
              icon="clock"
              title="Timeline-Backed Delivery"
              desc="Delivery dates are planned with your academic milestones so cards reach you before rollouts and onboarding."
            />
            <StandardItem
              icon="approved"
              title="Consistent Print Quality"
              desc="Each batch is checked for color accuracy, text crispness, and finish uniformity."
            />
            <StandardItem
              icon="redo"
              title="Fast Proof Revisions"
              desc="Correction reviews are resolved within hours so production begins without unnecessary administrative delays."
            />
            <StandardItem
              icon="lock"
              title="Data Handling Discipline"
              desc="Student and staff records are handled securely using encrypted vaults with strict access protocols."
            />
          </View>
        </View>

        {/* Call to action */}
        <View style={styles.ctaCard}>
          <Text style={styles.ctaTitle}>Ready to start your project?</Text>
          <Text style={styles.ctaDesc}>Get in touch with our design studio and request samples today.</Text>
          <TouchableOpacity
            style={styles.ctaBtn}
            onPress={() => navigation.navigate("Landing")}
            activeOpacity={0.8}
          >
            <Text style={styles.ctaBtnText}>REQUEST A QUOTE</Text>
          </TouchableOpacity>
        </View>

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  );
}

function StrengthCard({ image, title, desc }) {
  return (
    <View style={styles.strengthCard}>
      <View style={styles.illustrationContainer}>
        <Image source={image} style={styles.strengthImg} resizeMode="contain" />
      </View>
      <Text style={styles.strengthCardTitle}>{title}</Text>
      <Text style={styles.strengthCardDesc}>{desc}</Text>
    </View>
  );
}

function StandardItem({ icon, title, desc }) {
  return (
    <View style={styles.standardRow}>
      <View style={styles.standardIconWrap}>
        <DynamicIcon name={icon} size={14} color={colors.brandPrimary} />
      </View>
      <View style={styles.standardText}>
        <Text style={styles.standardItemTitle}>{title}</Text>
        <Text style={styles.standardItemDesc}>{desc}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.surfaceBg,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: "#fff",
    borderBottomWidth: 1,
    borderBottomColor: colors.gray100,
    ...shadows.sm,
  },
  backBtn: {
    width: 36,
    height: 36,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.md,
    backgroundColor: colors.gray50,
  },
  headerTitle: {
    fontSize: 16,
    fontFamily: fontFamily.bold,
    color: colors.gray900,
  },
  scrollContent: {
    padding: 16,
    gap: 20,
  },
  heroSection: {
    padding: 24,
    borderRadius: radius.md,
    ...shadows.md,
  },
  heroBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(255, 255, 255, 0.2)",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.sm,
    alignSelf: "flex-start",
    marginBottom: 16,
  },
  heroBadgeText: {
    fontSize: 10,
    fontFamily: fontFamily.bold,
    color: "#fff",
    textTransform: "uppercase",
  },
  heroTitle: {
    fontSize: 24,
    fontFamily: fontFamily.bold,
    color: "#fff",
    lineHeight: 30,
    marginBottom: 8,
  },
  heroSub: {
    fontSize: 13,
    fontFamily: fontFamily.regular,
    color: "rgba(255, 255, 255, 0.85)",
    lineHeight: 18,
  },
  sectionTitle: {
    fontSize: 18,
    fontFamily: fontFamily.bold,
    color: colors.gray800,
    marginTop: 8,
    marginBottom: -4,
  },
  sectionSubtitle: {
    fontSize: 12,
    fontFamily: fontFamily.regular,
    color: colors.gray500,
    marginTop: -16,
    marginBottom: 4,
  },
  bentoCard: {
    backgroundColor: "#fff",
    borderRadius: radius.md,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.gray100,
    ...shadows.sm,
  },
  bentoImageContainer: {
    width: "100%",
    height: 160,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 16,
  },
  bentoImage: {
    width: 140,
    height: 140,
    backgroundColor: "#fff",
  },
  bentoBody: {
    padding: 20,
  },
  bentoEyebrow: {
    fontSize: 9,
    fontFamily: fontFamily.bold,
    color: colors.brandPrimary,
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  bentoCardTitle: {
    fontSize: 16,
    fontFamily: fontFamily.bold,
    color: colors.gray900,
    marginBottom: 8,
  },
  bentoCopy: {
    fontSize: 12,
    fontFamily: fontFamily.regular,
    color: colors.gray600,
    lineHeight: 18,
    marginBottom: 16,
  },
  pointsCol: {
    gap: 8,
  },
  pointRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  pointText: {
    fontSize: 12,
    fontFamily: fontFamily.medium,
    color: colors.gray700,
  },
  bentoGrid: {
    flexDirection: "row",
    gap: 12,
  },
  bentoHalfCard: {
    flex: 1,
    backgroundColor: "#fff",
    borderRadius: radius.md,
    padding: 16,
    borderWidth: 1,
    borderColor: colors.gray100,
    ...shadows.sm,
  },
  halfCardTitle: {
    fontSize: 14,
    fontFamily: fontFamily.bold,
    color: colors.gray900,
    marginVertical: 4,
  },
  halfCardCopy: {
    fontSize: 11,
    fontFamily: fontFamily.regular,
    color: colors.gray500,
    lineHeight: 16,
    marginBottom: 12,
  },
  miniChips: {
    gap: 4,
  },
  miniChip: {
    fontSize: 9,
    fontFamily: fontFamily.semibold,
    color: colors.gray700,
    backgroundColor: colors.gray50,
    paddingHorizontal: 6,
    paddingVertical: 3,
    borderRadius: radius.xs,
    alignSelf: "flex-start",
  },
  strengthsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
  },
  strengthCard: {
    width: (width - 44) / 2,
    backgroundColor: "#fff",
    borderRadius: radius.md,
    padding: 14,
    borderWidth: 1,
    borderColor: colors.gray100,
    ...shadows.sm,
    alignItems: "center",
  },
  illustrationContainer: {
    width: 90,
    height: 90,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 8,
  },
  strengthImg: {
    width: "100%",
    height: "100%",
  },
  strengthCardTitle: {
    fontSize: 13,
    fontFamily: fontFamily.bold,
    color: colors.gray800,
    textAlign: "center",
    marginBottom: 4,
  },
  strengthCardDesc: {
    fontSize: 11,
    fontFamily: fontFamily.regular,
    color: colors.gray500,
    textAlign: "center",
    lineHeight: 15,
  },
  standardsSection: {
    backgroundColor: "#fff",
    borderRadius: radius.md,
    padding: 20,
    borderWidth: 1,
    borderColor: colors.gray100,
    ...shadows.sm,
    marginTop: 8,
  },
  standardsTitle: {
    fontSize: 16,
    fontFamily: fontFamily.bold,
    color: colors.gray900,
    textAlign: "center",
  },
  standardsSubtitle: {
    fontSize: 11,
    color: colors.gray500,
    textAlign: "center",
    fontFamily: fontFamily.regular,
    marginTop: 4,
    marginBottom: 20,
    lineHeight: 16,
  },
  standardsCol: {
    gap: 16,
  },
  standardRow: {
    flexDirection: "row",
    gap: 12,
  },
  standardIconWrap: {
    width: 28,
    height: 28,
    borderRadius: radius.sm,
    backgroundColor: colors.indigo50,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  standardText: {
    flex: 1,
  },
  standardItemTitle: {
    fontSize: 13,
    fontFamily: fontFamily.bold,
    color: colors.gray800,
  },
  standardItemDesc: {
    fontSize: 11,
    fontFamily: fontFamily.regular,
    color: colors.gray500,
    lineHeight: 16,
    marginTop: 2,
  },
  ctaCard: {
    backgroundColor: colors.gray900,
    borderRadius: radius.md,
    padding: 24,
    alignItems: "center",
    ...shadows.md,
  },
  ctaTitle: {
    fontSize: 18,
    fontFamily: fontFamily.bold,
    color: "#fff",
    textAlign: "center",
  },
  ctaDesc: {
    fontSize: 12,
    fontFamily: fontFamily.regular,
    color: colors.gray400,
    textAlign: "center",
    marginTop: 6,
    marginBottom: 20,
  },
  ctaBtn: {
    backgroundColor: colors.brandPrimary,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: radius.md,
  },
  ctaBtnText: {
    color: "#fff",
    fontFamily: fontFamily.bold,
    fontSize: 12,
    letterSpacing: 0.5,
  },
});
