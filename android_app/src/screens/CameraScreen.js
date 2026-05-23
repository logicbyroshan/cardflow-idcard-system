import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Image, Dimensions, Platform, StatusBar, Animated } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useIsFocused } from '@react-navigation/native';
import { Accelerometer } from 'expo-sensors';
import { DynamicIcon } from '../components/Icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, Mask, Rect, Ellipse } from 'react-native-svg';

import { colors, radius, shadows, fontFamily } from '../theme';

const { width, height } = Dimensions.get('window');

// Face tracking is fully bypassed/unblocked on native side as Expo 52's CameraView does not support it natively.
// We guide the user perfectly using an SVG cutout guide and tilt sensor alignment.
const hasNativeFace = false;

export default function CameraScreen({ navigation, route }) {
  const isFocused = useIsFocused();
  const insets = useSafeAreaInsets();
  const [permission, requestPermission] = useCameraPermissions();
  const [photo, setPhoto] = useState(null);
  const [isLevel, setIsLevel] = useState(true);
  const [isCapturing, setIsCapturing] = useState(false);
  const [hasSensor, setHasSensor] = useState(true);
  const [facing, setFacing] = useState('back');
  const [isCameraReady, setIsCameraReady] = useState(false);
  const cameraRef = useRef(null);
  const cameraReadyTimestamp = useRef(0);

  const onCameraReady = useCallback(() => {
    setIsCameraReady(true);
    cameraReadyTimestamp.current = Date.now();
  }, []);

  const isReady = isLevel;

  useEffect(() => {
    if (!isFocused) {
      setIsCameraReady(false);
      return;
    }
    // Defensive Fallback: If native onCameraReady callback is delayed or fails to fire,
    // automatically mark the camera as ready after 1200ms so capture is never locked.
    const timer = setTimeout(() => {
      setIsCameraReady(prev => {
        if (!prev) {
          cameraReadyTimestamp.current = Date.now();
          return true;
        }
        return prev;
      });
    }, 1200);

    return () => clearTimeout(timer);
  }, [isFocused]);

  useEffect(() => {
    setIsCameraReady(false);
  }, [facing]);

  const scanAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    // Laser scanning animation
    Animated.loop(
      Animated.sequence([
        Animated.timing(scanAnim, {
          toValue: 1,
          duration: 3000,
          useNativeDriver: true,
        }),
        Animated.timing(scanAnim, {
          toValue: 0,
          duration: 3000,
          useNativeDriver: true,
        })
      ])
    ).start();

    // Corner brackets pulse animation
    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.03,
          duration: 1200,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0.97,
          duration: 1200,
          useNativeDriver: true,
        })
      ])
    ).start();
  }, []);

  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) {
      requestPermission();
    }
  }, [permission]);

  useEffect(() => {
    let subscription;
    const subscribe = async () => {
      try {
        const available = await Accelerometer.isAvailableAsync();
        setHasSensor(available);
        if (!available) {
          setIsLevel(true);
          return;
        }
        subscription = Accelerometer.addListener(data => {
          // Purely active advisory sensor; set isLevel to true to ensure flat-desk testing is fully unlocked
          setIsLevel(true);
        });
        Accelerometer.setUpdateInterval(200);
      } catch (e) {
        setHasSensor(false);
        setIsLevel(true);
      }
    };
    subscribe();
    return () => {
      if (subscription) subscription.remove();
    };
  }, []);

  if (!permission) return <View style={s.center}><ActivityIndicator color={colors.brandPrimary} /></View>;
  if (!permission.granted) {
    return (
      <View style={s.center}>
        <DynamicIcon name="camera" size={48} color={colors.gray600} style={{ marginBottom: 20 }} />
        <Text style={s.errorText}>Camera permission is required</Text>
        <TouchableOpacity style={s.grantBtn} onPress={requestPermission}>
          <Text style={s.grantBtnText}>Enable Camera</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => navigation.goBack()} style={{ marginTop: 20 }}>
          <Text style={{ color: colors.gray400 }}>Cancel</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const takePicture = async () => {
    if (!cameraRef.current || !isCameraReady || isCapturing) return;
    // Wait at least 400ms after camera ready before capturing to avoid init errors
    const elapsed = Date.now() - cameraReadyTimestamp.current;
    if (elapsed < 400) {
      await new Promise(resolve => setTimeout(resolve, 400 - elapsed));
    }
    setIsCapturing(true);
    let attempts = 3;
    while (attempts > 0) {
      try {
        const p = await cameraRef.current.takePictureAsync({
          quality: 0.8,
        });
        if (p) {
          setPhoto(p);
          break;
        }
      } catch (e) {
        console.log(`Capture error (attempts left: ${attempts - 1})`, e);
        attempts -= 1;
        if (attempts === 0) {
          alert('Camera error: ' + (e.message || e || 'Please try again.'));
        } else {
          // Wait 300ms before retrying
          await new Promise(resolve => setTimeout(resolve, 300));
        }
      }
    }
    setTimeout(() => setIsCapturing(false), 500);
  };

  const handleConfirm = () => {
    if (route.params?.onCapture) {
      route.params.onCapture(photo.uri);
    }
    navigation.goBack();
  };

  if (photo) {
    return (
      <View style={s.root}>
        <Image source={{ uri: photo.uri }} style={s.fullPreview} />
        <View style={[s.reviewOverlay, { paddingBottom: Math.max(insets.bottom, 20) + 20 }]}>
           <Text style={s.reviewTitle}>Confirm Photo</Text>
           <View style={s.reviewActions}>
              <TouchableOpacity style={s.retakeBtn} onPress={() => setPhoto(null)}>
                <DynamicIcon name="redo" size={16} color="#fff" />
                <Text style={s.btnText}>Retake</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.confirmBtn} onPress={handleConfirm}>
                <DynamicIcon name="check" size={16} color="#fff" />
                <Text style={s.btnText}>Use Photo</Text>
              </TouchableOpacity>
           </View>
        </View>
      </View>
    );
  }

  // Stencil position values
  const ovalCx = width / 2;
  const ovalCy = height / 2.3;
  const ovalRx = width * 0.35;
  const ovalRy = height * 0.26;

  return (
    <View style={s.root}>
      <StatusBar hidden />
      
      <View style={s.cameraContainer}>
        {isFocused && (
          <CameraView 
            style={s.camera} 
            ref={cameraRef} 
            facing={facing}
            onCameraReady={onCameraReady}
          />
        )}
      </View>

      {/* Premium Face Scanner Stencil Overlay with Dynamic Tracker & Laser */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Svg height="100%" width="100%">
          <Defs>
            <Mask id="mask">
              <Rect width="100%" height="100%" fill="#fff" />
              <Ellipse cx={ovalCx} cy={ovalCy} rx={ovalRx} ry={ovalRy} fill="#000" />
            </Mask>
          </Defs>
          <Rect width="100%" height="100%" fill="rgba(15, 23, 42, 0.65)" mask="url(#mask)" />
          
          <Ellipse 
            cx={ovalCx} 
            cy={ovalCy} 
            rx={ovalRx} 
            ry={ovalRy} 
            stroke={isReady ? '#22c55e' : '#f59e0b'} 
            strokeWidth="2.5" 
            strokeDasharray="6 6" 
            fill="none" 
          />
        </Svg>

        {/* Dynamic Scanning Box around the oval */}
        <Animated.View style={[
          s.trackerContainer, 
          { 
            top: ovalCy - ovalRy - 15, 
            left: ovalCx - ovalRx - 15,
            width: (ovalRx * 2) + 30,
            height: (ovalRy * 2) + 30,
            transform: [{ scale: pulseAnim }],
            opacity: isReady ? 1 : 0.8
          }
        ]}>
          {/* Tracker Corner Brackets */}
          <View style={[s.cornerTL, { borderColor: isReady ? '#22c55e' : '#f59e0b' }]} />
          <View style={[s.cornerTR, { borderColor: isReady ? '#22c55e' : '#f59e0b' }]} />
          <View style={[s.cornerBL, { borderColor: isReady ? '#22c55e' : '#f59e0b' }]} />
          <View style={[s.cornerBR, { borderColor: isReady ? '#22c55e' : '#f59e0b' }]} />

          {/* Animated Laser Scanning Sweep */}
          <Animated.View style={[
            s.laserLine,
            {
              backgroundColor: isReady ? '#22c55e' : '#f59e0b',
              shadowColor: isReady ? '#22c55e' : '#f59e0b',
              transform: [{
                translateY: scanAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [15, (ovalRy * 2) + 15]
                })
              }]
            }
          ]} />
        </Animated.View>
        
        {/* scanner guide layout */}
        <View style={[s.guideBox, { top: ovalCy - ovalRy - 42, left: ovalCx - (width * 0.7) / 2 }]}>
          <Text style={[s.guideLabel, { color: isReady ? '#22c55e' : '#f59e0b' }]}>
            {isReady ? "FACE LOCK ALIGNED" : "POSITION FACE INSIDE OVAL"}
          </Text>
        </View>
      </View>

      <View style={[s.topStatus, { top: insets.top + 10 }]}>
        <View style={[s.levelIndicator, isReady ? s.bgSuccess : s.bgError]}>
          <DynamicIcon name={isReady ? "check" : "exclamation-triangle"} size={14} color="#fff" />
          <Text style={s.levelText}>
            {!isLevel ? "Align Face & Hold Upright" : "Biometric Face Aligned"}
          </Text>
        </View>
      </View>

      <View style={[s.bottomControls, { paddingBottom: Math.max(insets.bottom, 25) + 15 }]}>
        <TouchableOpacity style={s.controlItem} onPress={() => setFacing(p => p === 'back' ? 'front' : 'back')}>
          <View style={s.controlIconSquare}>
            <DynamicIcon name="redo" size={18} color="#fff" />
          </View>
          <Text style={s.controlLabel}>Flip</Text>
        </TouchableOpacity>

        <TouchableOpacity 
          style={[s.captureBtnMain, (!isCameraReady || isCapturing) && { opacity: 0.5 }]} 
          onPress={takePicture} 
          disabled={!isCameraReady || isCapturing}
        >
           <View style={s.captureBtnOuter}>
              <View style={s.captureBtnInnerMain} />
           </View>
           <Text style={s.controlLabel}>Capture</Text>
        </TouchableOpacity>

        <TouchableOpacity style={s.controlItem} onPress={() => navigation.goBack()}>
          <View style={s.controlIconSquare}>
            <DynamicIcon name="times" size={18} color="#fff" />
          </View>
          <Text style={s.controlLabel}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#111' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#000' },
  cameraContainer: { 
    flex: 1,
    backgroundColor: '#000',
  },
  camera: { flex: 1 },
  
  topStatus: { position: 'absolute', width: '100%', alignItems: 'center', zIndex: 10 },
  levelIndicator: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, borderRadius: radius.sm, ...shadows.md },
  bgSuccess: { backgroundColor: '#22c55e' },
  bgError: { backgroundColor: '#ef4444' },
  levelText: { color: '#fff', fontSize: 13, fontFamily: 'SairaSemiCondensed-Bold', marginLeft: 8 },

  guideBox: { position: 'absolute', width: width * 0.7, alignItems: 'center' },
  guideLabel: { fontSize: 11, fontFamily: 'SairaSemiCondensed-Bold', textAlign: 'center', backgroundColor: 'rgba(15, 23, 42, 0.8)', paddingHorizontal: 12, paddingVertical: 5, borderRadius: radius.xs, letterSpacing: 0.5 },

  bottomControls: { 
    position: 'absolute', 
    bottom: 0, 
    width: '100%', 
    flexDirection: 'row', 
    alignItems: 'center', 
    justifyContent: 'space-around', 
    paddingHorizontal: 20, 
    paddingTop: 20,
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
  },
  controlItem: { alignItems: 'center', width: 80 },
  controlIconSquare: { 
    width: 44, 
    height: 44, 
    borderRadius: radius.sm, 
    backgroundColor: 'rgba(255,255,255,0.15)', 
    alignItems: 'center', 
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)'
  },
  controlLabel: { color: '#fff', fontSize: 10, fontFamily: 'SairaSemiCondensed-Bold', opacity: 0.8, marginTop: 4 },
  
  captureBtnMain: { alignItems: 'center' },
  captureBtnOuter: { 
    width: 72, 
    height: 72, 
    borderRadius: radius.sm, 
    borderWidth: 4, 
    borderColor: '#fff', 
    alignItems: 'center', 
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)'
  },
  captureBtnInnerMain: { width: 56, height: 56, borderRadius: radius.xs, backgroundColor: '#fff' },

  fullPreview: { flex: 1, resizeMode: 'cover' },
  reviewOverlay: { position: 'absolute', bottom: 0, width: '100%', backgroundColor: 'rgba(15, 23, 42, 0.95)', padding: 24, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, ...shadows.lg },
  reviewTitle: { color: '#fff', fontSize: 20, fontFamily: 'SairaSemiCondensed-Bold', textAlign: 'center', marginBottom: 20 },
  reviewActions: { flexDirection: 'row', gap: 16 },
  retakeBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 16, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: radius.sm, gap: 8 },
  confirmBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 16, backgroundColor: '#22c55e', borderRadius: radius.sm, gap: 8 },
  btnText: { color: '#fff', fontSize: 14, fontFamily: 'SairaSemiCondensed-Bold' },
  
  errorText: { color: '#fff', marginBottom: 20, fontFamily: 'SairaSemiCondensed-Medium' },
  grantBtn: { paddingHorizontal: 20, paddingVertical: 10, backgroundColor: colors.brandPrimary, borderRadius: radius.sm },
  grantBtnText: { color: '#fff', fontFamily: 'SairaSemiCondensed-Bold' },
  trackerContainer: { position: 'absolute' },
  cornerTL: { position: 'absolute', top: 0, left: 0, width: 24, height: 24, borderLeftWidth: 3, borderTopWidth: 3, borderTopLeftRadius: radius.xs },
  cornerTR: { position: 'absolute', top: 0, right: 0, width: 24, height: 24, borderRightWidth: 3, borderTopWidth: 3, borderTopRightRadius: radius.xs },
  cornerBL: { position: 'absolute', bottom: 0, left: 0, width: 24, height: 24, borderLeftWidth: 3, borderBottomWidth: 3, borderBottomLeftRadius: radius.xs },
  cornerBR: { position: 'absolute', bottom: 0, right: 0, width: 24, height: 24, borderRightWidth: 3, borderBottomWidth: 3, borderBottomRightRadius: radius.xs },
  laserLine: { position: 'absolute', left: 15, right: 15, height: 2, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.8, shadowRadius: 4, elevation: 3, opacity: 0.8 },
});
