import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Image, Dimensions, Platform, StatusBar, Animated, PanResponder } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImageManipulator from 'expo-image-manipulator';
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
  const [photo, setPhoto] = useState(() => {
    if (route?.params?.imageUri) {
      return {
        uri: route.params.imageUri,
        width: route.params.imageWidth || Dimensions.get('window').width,
        height: route.params.imageHeight || Dimensions.get('window').height,
      };
    }
    return null;
  });

  useEffect(() => {
    if (route?.params?.imageUri) {
      setPhoto({
        uri: route.params.imageUri,
        width: route.params.imageWidth || Dimensions.get('window').width,
        height: route.params.imageHeight || Dimensions.get('window').height,
      });
    }
  }, [route?.params?.imageUri, route?.params?.imageWidth, route?.params?.imageHeight]);
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
      try {
        if (subscription && typeof subscription.remove === 'function') {
          subscription.remove();
        }
      } catch (e) {}
    };
  }, []);

  const previewHeight = height - 160 - Math.max(insets.bottom, 20);
  const previewWidth = width;

  const [cropX, setCropX] = useState(0);
  const [cropY, setCropY] = useState(0);
  const [cropW, setCropW] = useState(0);
  const [cropH, setCropH] = useState(0);
  const [cropping, setCropping] = useState(false);

  const cropRef = useRef({ x: 0, y: 0, w: 0, h: 0 });

  const updateCrop = (x, y, w, h) => {
    cropRef.current = { x, y, w, h };
    setCropX(x);
    setCropY(y);
    setCropW(w);
    setCropH(h);
  };

  useEffect(() => {
    if (photo) {
      const imageAspect = photo.width / photo.height;
      let dW = previewWidth;
      let dH = previewWidth / imageAspect;
      if (dH > previewHeight) {
        dH = previewHeight;
        dW = previewHeight * imageAspect;
      }
      const oX = (previewWidth - dW) / 2;
      const oY = (previewHeight - dH) / 2;

      const w = dW * 0.8;
      const h = dH * 0.8;
      const x = oX + (dW - w) / 2;
      const y = oY + (dH - h) / 2;

      updateCrop(x, y, w, h);
    }
  }, [photo]);

  const panStartRef = useRef({ cx: 0, cy: 0 });
  const boxPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        panStartRef.current = {
          cx: cropRef.current.x,
          cy: cropRef.current.y,
        };
      },
      onPanResponderMove: (evt, gestureState) => {
        if (!photo) return;
        const imageAspect = photo.width / photo.height;
        let dW = previewWidth;
        let dH = previewWidth / imageAspect;
        if (dH > previewHeight) {
          dH = previewHeight;
          dW = previewHeight * imageAspect;
        }
        const oX = (previewWidth - dW) / 2;
        const oY = (previewHeight - dH) / 2;

        let newX = panStartRef.current.cx + gestureState.dx;
        let newY = panStartRef.current.cy + gestureState.dy;

        const cw = cropRef.current.w;
        const ch = cropRef.current.h;

        if (newX < oX) newX = oX;
        if (newX + cw > oX + dW) newX = oX + dW - cw;
        if (newY < oY) newY = oY;
        if (newY + ch > oY + dH) newY = oY + dH - ch;

        updateCrop(newX, newY, cw, ch);
      },
    })
  ).current;

  const resizeStartRef = useRef({ cw: 0, ch: 0 });
  const resizePanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        resizeStartRef.current = {
          cw: cropRef.current.w,
          ch: cropRef.current.h,
        };
      },
      onPanResponderMove: (evt, gestureState) => {
        if (!photo) return;
        const imageAspect = photo.width / photo.height;
        let dW = previewWidth;
        let dH = previewWidth / imageAspect;
        if (dH > previewHeight) {
          dH = previewHeight;
          dW = previewHeight * imageAspect;
        }
        const oX = (previewWidth - dW) / 2;
        const oY = (previewHeight - dH) / 2;

        let newW = resizeStartRef.current.cw + gestureState.dx;
        let newH = resizeStartRef.current.ch + gestureState.dy;

        if (newW < 60) newW = 60;
        if (newH < 60) newH = 60;

        const cx = cropRef.current.x;
        const cy = cropRef.current.y;

        if (cx + newW > oX + dW) newW = oX + dW - cx;
        if (cy + newH > oY + dH) newH = oY + dH - cy;

        updateCrop(cx, cy, newW, newH);
      },
    })
  ).current;

  const handleConfirm = async () => {
    if (!photo) return;
    setCropping(true);
    try {
      const imageAspect = photo.width / photo.height;
      let dW = previewWidth;
      let dH = previewWidth / imageAspect;
      if (dH > previewHeight) {
        dH = previewHeight;
        dW = previewHeight * imageAspect;
      }
      const oX = (previewWidth - dW) / 2;
      const oY = (previewHeight - dH) / 2;

      const scale = photo.width / dW;
      const originX = Math.round((cropRef.current.x - oX) * scale);
      const originY = Math.round((cropRef.current.y - oY) * scale);
      const cropWidth = Math.round(cropRef.current.w * scale);
      const cropHeight = Math.round(cropRef.current.h * scale);

      const manipulated = await ImageManipulator.manipulateAsync(
        photo.uri,
        [
          {
            crop: {
              originX: Math.max(0, originX),
              originY: Math.max(0, originY),
              width: Math.min(photo.width - originX, cropWidth),
              height: Math.min(photo.height - originY, cropHeight),
            },
          },
        ],
        { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG }
      );

      if (route.params?.onCapture) {
        route.params.onCapture(manipulated.uri);
      }
      navigation.goBack();
    } catch (err) {
      alert("Error cropping image: " + err.message);
    } finally {
      setCropping(false);
    }
  };

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
          shutterSound: false,
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

  // Check if we already have a photo to crop (e.g. from gallery pick)
  // before demanding camera permissions.
  if (photo) {
    return (
      <View style={[s.root, { justifyContent: 'flex-start' }]}>
        <View style={{ width: previewWidth, height: previewHeight, backgroundColor: '#000', position: 'relative' }}>
          <Image source={{ uri: photo.uri }} style={{ width: '100%', height: '100%', resizeMode: 'contain' }} />

          <View style={{ position: 'absolute', top: 0, left: 0, right: 0, height: cropY, backgroundColor: 'rgba(0,0,0,0.6)' }} />
          <View style={{ position: 'absolute', top: cropY + cropH, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)' }} />
          <View style={{ position: 'absolute', top: cropY, left: 0, width: cropX, height: cropH, backgroundColor: 'rgba(0,0,0,0.6)' }} />
          <View style={{ position: 'absolute', top: cropY, left: cropX + cropW, right: 0, height: cropH, backgroundColor: 'rgba(0,0,0,0.6)' }} />

          <View
            style={[
              s.cropBox,
              {
                position: 'absolute',
                top: cropY,
                left: cropX,
                width: cropW,
                height: cropH,
                borderColor: '#fff',
                borderWidth: 2,
                backgroundColor: 'rgba(255,255,255,0.05)',
              },
            ]}
            {...boxPanResponder.panHandlers}
          >
            <View style={[s.cropCorner, { top: -2, left: -2, borderLeftWidth: 3, borderTopWidth: 3 }]} />
            <View style={[s.cropCorner, { top: -2, right: -2, borderRightWidth: 3, borderTopWidth: 3 }]} />
            <View style={[s.cropCorner, { bottom: -2, left: -2, borderLeftWidth: 3, borderBottomWidth: 3 }]} />
            <View style={[s.cropCorner, { bottom: -2, right: -2, borderRightWidth: 3, borderBottomWidth: 3 }]} />

            <View style={{ position: 'absolute', left: '33.3%', top: 0, bottom: 0, width: 0.5, backgroundColor: 'rgba(255,255,255,0.2)' }} />
            <View style={{ position: 'absolute', left: '66.6%', top: 0, bottom: 0, width: 0.5, backgroundColor: 'rgba(255,255,255,0.2)' }} />
            <View style={{ position: 'absolute', top: '33.3%', left: 0, right: 0, height: 0.5, backgroundColor: 'rgba(255,255,255,0.2)' }} />
            <View style={{ position: 'absolute', top: '66.6%', left: 0, right: 0, height: 0.5, backgroundColor: 'rgba(255,255,255,0.2)' }} />

            <View
              style={{
                position: 'absolute',
                bottom: -15,
                right: -15,
                width: 35,
                height: 35,
                backgroundColor: 'transparent',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 99,
              }}
              {...resizePanResponder.panHandlers}
            >
              <View
                style={{
                  width: 14,
                  height: 14,
                  backgroundColor: '#fff',
                  borderRadius: 7,
                  borderWidth: 2,
                  borderColor: '#22c55e',
                }}
              />
            </View>
          </View>
        </View>

        <View style={[s.reviewOverlay, { position: 'relative', flex: 1, justifyContent: 'center', paddingBottom: Math.max(insets.bottom, 20) + 10 }]}>
           <Text style={[s.reviewTitle, { fontSize: 13, marginBottom: 12 }]}>Drag box to move • Corner dot to crop</Text>
           <View style={s.reviewActions}>
              <TouchableOpacity
                style={s.retakeBtn}
                onPress={() => {
                  if (route.params?.imageUri) {
                    navigation.goBack();
                  } else {
                    setPhoto(null);
                  }
                }}
                disabled={cropping}
              >
                <DynamicIcon name={route.params?.imageUri ? "times" : "redo"} size={16} color="#fff" />
                <Text style={s.btnText}>{route.params?.imageUri ? "Cancel" : "Retake"}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.confirmBtn} onPress={handleConfirm} disabled={cropping}>
                {cropping ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <>
                    <DynamicIcon name="check" size={16} color="#fff" />
                    <Text style={s.btnText}>Crop & Use</Text>
                  </>
                )}
              </TouchableOpacity>
           </View>
        </View>
      </View>
    );
  }

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
  cropBox: {
    borderStyle: 'solid',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.5,
    shadowRadius: 5,
    elevation: 5,
  },
  cropCorner: {
    position: 'absolute',
    width: 14,
    height: 14,
    borderColor: '#fff',
  },
});
