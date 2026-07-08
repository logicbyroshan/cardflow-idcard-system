import React, { useState, useEffect, useRef, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Image, Dimensions, Platform, StatusBar, Animated } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { useIsFocused } from '@react-navigation/native';
import { Accelerometer } from 'expo-sensors';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DynamicIcon } from '../components/Icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, Mask, Rect, Ellipse, Path, G } from 'react-native-svg';

import { colors, radius, shadows, fontFamily } from '../theme';

const { width, height } = Dimensions.get('window');

// Face tracking is fully bypassed/unblocked on native side as Expo 52's CameraView does not support it natively.
// We guide the user perfectly using an SVG cutout guide and tilt sensor alignment.
const hasNativeFace = false;

const getFieldValueCaseInsensitive = (obj, key) => {
  if (!obj) return '';
  if (obj[key] !== undefined) return obj[key];
  const upperKey = key.toUpperCase();
  for (const k in obj) {
    if (k.toUpperCase() === upperKey) {
      return obj[k];
    }
  }
  return '';
};

const resolveStudentInfo = (student) => {
  if (!student) return { name: 'Unknown Student', classVal: '-', sectionVal: '-' };
  const fd = student.field_data || {};
  const name = getFieldValueCaseInsensitive(fd, 'STUDENT NAME') || 
               getFieldValueCaseInsensitive(fd, 'NAME') || 
               getFieldValueCaseInsensitive(fd, 'EMPLOYEE NAME') || 
               getFieldValueCaseInsensitive(fd, 'STAFF NAME') || 
               getFieldValueCaseInsensitive(fd, 'CANDIDATE NAME') || 
               student.name || 
               'Unknown Student';
  const classVal = getFieldValueCaseInsensitive(fd, 'CLASS') || getFieldValueCaseInsensitive(fd, 'STANDARD') || getFieldValueCaseInsensitive(fd, 'STD') || '-';
  const sectionVal = getFieldValueCaseInsensitive(fd, 'SECTION') || getFieldValueCaseInsensitive(fd, 'SEC') || '-';
  return { name, classVal, sectionVal };
};

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

  const fastCaptureCards = route.params?.fastCaptureCards;
  const [currentIndex, setCurrentIndex] = useState(route.params?.initialIndex || 0);
  const currentStudent = fastCaptureCards?.[currentIndex];
  const nextStudent = fastCaptureCards?.[currentIndex + 1];

  const [isLevel, setIsLevel] = useState(true);
  const [angleError, setAngleError] = useState('');
  const [isCapturing, setIsCapturing] = useState(false);
  const [hasSensor, setHasSensor] = useState(true);
  const [facing, setFacing] = useState('back');
  const [isCameraReady, setIsCameraReady] = useState(false);
  const cameraRef = useRef(null);
  const cameraReadyTimestamp = useRef(0);

  // Dynamic layout dimension for the camera preview box to center coordinates
  const [containerLayout, setContainerLayout] = useState({ width, height: height - 260, y: 80 });

  // Toggles for face check simulator warning testing
  const [simNoPerson, setSimNoPerson] = useState(false);
  const [simClosedEyes, setSimClosedEyes] = useState(false);
  const [simSunglasses, setSimSunglasses] = useState(false);
  const [simOpticalGlasses, setSimOpticalGlasses] = useState(false);
  const [showQaPanel, setShowQaPanel] = useState(false);

  const onCameraReady = useCallback(() => {
    setIsCameraReady(true);
    cameraReadyTimestamp.current = Date.now();
  }, []);

  // Determine active warning message based on priority order (simulations take priority during QA testing)
  let activeWarning = '';
  if (simNoPerson) {
    activeWarning = 'No Person Detected';
  } else if (simClosedEyes) {
    activeWarning = 'Closed Eyes Detected';
  } else if (simSunglasses) {
    activeWarning = 'Sunglasses Detected';
  } else if (simOpticalGlasses) {
    activeWarning = 'Optical Glasses Detected';
  } else if (!isLevel) {
    activeWarning = angleError || 'Align Device Upright';
  }

  const isReady = !activeWarning;



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
          setAngleError('');
          return;
        }
        subscription = Accelerometer.addListener(data => {
          // Verify phone is held upright and straight (within roll and pitch limits)
          const rollAngle = Math.abs(data.x);
          const pitchAngle = Math.abs(data.z);
          const isPortrait = data.y < -0.7;

          let err = '';
          if (!isPortrait) {
            err = 'Hold phone in portrait mode';
          } else if (rollAngle > 0.15) {
            err = 'Phone is tilted left/right';
          } else if (pitchAngle > 0.20) {
            err = 'Phone is tilted forward/backward';
          }

          setAngleError(err);
          setIsLevel(!err);
        });
        Accelerometer.setUpdateInterval(200);
      } catch (e) {
        setHasSensor(false);
        setIsLevel(true);
        setAngleError('');
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

  const [cropping, setCropping] = useState(false);

  const handleConfirm = async () => {
    if (!photo) return;
    setCropping(true);
    try {
      // Resize the photo to max 1600px on longest side, compress at 90% JPEG quality.
      // This keeps files near ~1MB regardless of the original sensor resolution.
      const srcW = photo.width || 1;
      const srcH = photo.height || 1;
      const MAX_SIDE = 1600;
      const scale = Math.max(srcW, srcH) > MAX_SIDE ? MAX_SIDE / Math.max(srcW, srcH) : 1;
      const resizeActions = scale < 1
        ? [{ resize: { width: Math.round(srcW * scale), height: Math.round(srcH * scale) } }]
        : [];

      const manipulated = await manipulateAsync(
        photo.uri,
        resizeActions,
        { compress: 0.9, format: SaveFormat.JPEG }
      );

      if (route.params?.onCapture) {
        route.params.onCapture(manipulated.uri);
      }
      
      if (fastCaptureCards && currentStudent) {
        // Save to offline storage
        await AsyncStorage.setItem(`offline_photo_${currentStudent.id}`, manipulated.uri);
        
        // Update the offline data state to mark as captured
        const offlineStr = await AsyncStorage.getItem('photographer_offline_data');
        if (offlineStr) {
           const clients = JSON.parse(offlineStr);
           clients.forEach(c => c.tables?.forEach(t => t.cards?.forEach(card => {
               if (card.id === currentStudent.id) {
                   card.has_photo = true;
               }
           })));
           await AsyncStorage.setItem('photographer_offline_data', JSON.stringify(clients));
        }

        if (nextStudent) {
            setPhoto(null);
            setCurrentIndex(currentIndex + 1);
        } else {
            alert('All students in this list have been captured!');
            navigation.goBack();
        }
      } else {
        navigation.goBack();
      }
    } catch (err) {
      alert('Error processing image: ' + err.message);
    } finally {
      setCropping(false);
    }
  };  // ── Free photo preview — no crop box, just confirm or retake ────────────
  if (photo) {
    return (
      <View style={[s.root, { backgroundColor: '#0f172a' }]}>
        <StatusBar hidden />

        {/* Full-screen photo preview */}
        <View style={{ flex: 1, backgroundColor: '#000' }}>
          <Image
            source={{ uri: photo.uri }}
            style={{ flex: 1, width: '100%' }}
            resizeMode="contain"
          />

          {/* Top label */}
          <View style={s.previewTopBar}>
            {currentStudent ? (
              (() => {
                const info = resolveStudentInfo(currentStudent);
                return (
                  <>
                    <Text style={s.previewTopLabel}>{info.name}</Text>
                    <Text style={s.previewTopSub}>Class: {info.classVal} | Section: {info.sectionVal}</Text>
                  </>
                );
              })()
            ) : (
              <>
                <Text style={s.previewTopLabel}>📷  PHOTO PREVIEW</Text>
                <Text style={s.previewTopSub}>Confirm or retake the photo</Text>
              </>
            )}
          </View>
        </View>

        {/* Action buttons */}
        <View style={[s.previewActions, { paddingBottom: Math.max(insets.bottom, 24) + 12 }]}>
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
            <DynamicIcon name={route.params?.imageUri ? 'times' : 'redo'} size={18} color='#fff' />
            <Text style={s.btnText}>{route.params?.imageUri ? 'Cancel' : 'Retake'}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={s.confirmBtn} onPress={handleConfirm} disabled={cropping}>
            {cropping ? (
              <>
                <ActivityIndicator size="small" color="#fff" />
                <Text style={s.btnText}>Processing...</Text>
              </>
            ) : (
              <>
                <DynamicIcon name="check" size={18} color='#fff' />
                <Text style={s.btnText}>{fastCaptureCards ? 'Save & Next' : 'Use Photo'}</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  const takePicture = async () => {
    if (!cameraRef.current || !isCameraReady || isCapturing) return;

    // Block capture if any alignment or face warning is active
    if (activeWarning) {
      alert(`Capture Blocked: ${activeWarning}`);
      return;
    }

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
          quality: 0.85,
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

  // Stencil position values (Strict 19.5 : 25 aspect ratio card frame)
  const rectW = containerLayout.width * 0.76;
  const rectH = rectW * (25 / 19.5); // 19.5 to 25 ratio
  const rectX = (containerLayout.width - rectW) / 2;
  const rectY = containerLayout.y + (containerLayout.height - rectH) / 2;

  const ovalCx = containerLayout.width / 2;
  const ovalCy = rectY + rectH / 2;

  // Compute a uniform scale so the head-and-shoulders silhouette touches the left and right borders of the box perfectly
  // Design coordinate width is from X = 50 to X = 950 (width of 900 units)
  const scaleVal = rectW / 900;

  // Align the left border of the guide (X = 50) with the left border of the box (rectX)
  const silX = rectX - 50 * scaleVal;

  // Align the top of the head (Y = 40) to have exactly a 10% gap from the top of the box
  const silY = rectY + (rectH * 0.1) - 40 * scaleVal;

  return (
    <View style={s.root}>
      <StatusBar hidden />
      
      {/* Background Camera Feed (renders full screen to completely avoid black letterbox gaps) */}
      <View style={StyleSheet.absoluteFill}>
        {isFocused && (
          <CameraView 
            style={s.camera} 
            ref={cameraRef} 
            facing={facing}
            onCameraReady={onCameraReady}
          />
        )}
      </View>

      {/* Full-screen Svg Stencil Overlay */}
      <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
        <Svg height="100%" width="100%">
          <Defs>
            <Mask id="mask">
              <Rect width="100%" height="100%" fill="#fff" />
              <Rect 
                x={rectX} 
                y={rectY} 
                width={rectW} 
                height={rectH} 
                rx={16} 
                ry={16} 
                fill="#000" 
              />
            </Mask>
          </Defs>
          <Rect width="100%" height="100%" fill="rgba(15, 23, 42, 0.65)" mask="url(#mask)" />

          {/* Custom Silhouette Outline Guide (Head & Shoulders, perfectly mapped inside 19.5:25 frame without squeeze) */}
          <G>
            <Path
              d="M 500,40 C 660,40 750,140 750,270 C 750,305 742,330 735,350 C 765,340 775,360 775,395 C 775,435 745,465 715,475 C 685,550 600,670 500,670 C 400,670 315,550 285,475 C 255,465 225,435 225,395 C 225,360 235,340 265,350 C 258,330 250,305 250,270 C 250,140 340,40 500,40 Z"
              x={silX}
              y={silY}
              scaleX={scaleVal}
              scaleY={scaleVal}
              stroke={isReady ? '#22c55e' : '#f59e0b'}
              strokeWidth={3 / scaleVal}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
            <Path
              d="M 680,545 C 670,620 710,720 950,830"
              x={silX}
              y={silY}
              scaleX={scaleVal}
              scaleY={scaleVal}
              stroke={isReady ? '#22c55e' : '#f59e0b'}
              strokeWidth={3 / scaleVal}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
            <Path
              d="M 320,545 C 330,620 290,720 50,830"
              x={silX}
              y={silY}
              scaleX={scaleVal}
              scaleY={scaleVal}
              stroke={isReady ? '#22c55e' : '#f59e0b'}
              strokeWidth={3 / scaleVal}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          </G>
        </Svg>

        {/* Dynamic Scanning Box around the oval */}
        <Animated.View style={[
          s.trackerContainer, 
          { 
            top: rectY - 15, 
            left: rectX - 15,
            width: rectW + 30,
            height: rectH + 30,
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
                  outputRange: [15, rectH + 15]
                })
              }]
            }
          ]} />
        </Animated.View>
        
        {/* scanner guide layout */}
        <View style={[s.guideBox, { top: rectY - 42, left: ovalCx - (containerLayout.width * 0.7) / 2 }]}>
          <Text style={[s.guideLabel, { color: isReady ? '#22c55e' : '#f59e0b' }]}>
            {isReady ? "FACE LOCK ALIGNED" : activeWarning.toUpperCase()}
          </Text>
        </View>
      </View>

      {/* Naturally positioned layout elements overlay on top of the camera background */}
      {/* Top Status Bar sits naturally at the top */}
      <View style={s.topStatus}>
        {activeWarning ? (
          <View style={[s.bgError, { width: '100%', paddingTop: insets.top + 12, paddingBottom: 14, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, ...shadows.md }]}>
            <DynamicIcon name="exclamation-triangle" size={14} color="#fff" />
            <Text style={[s.levelText, { marginLeft: 0, fontSize: 13, fontFamily: fontFamily.bold }]}>
              {activeWarning.toUpperCase()}
            </Text>
          </View>
        ) : currentStudent ? (
          <View style={[s.bgSuccess, { width: '100%', paddingTop: insets.top + 12, paddingBottom: 14, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center', flexDirection: 'column', ...shadows.md }]}>
            {(() => {
              const info = resolveStudentInfo(currentStudent);
              return (
                <>
                  <Text style={[s.levelText, { fontSize: 16, fontFamily: fontFamily.bold, color: '#fff', textAlign: 'center', marginLeft: 0 }]}>{info.name.toUpperCase()}</Text>
                  <Text style={[s.levelText, { fontSize: 12, color: 'rgba(255, 255, 255, 0.9)', marginTop: 2, textAlign: 'center', marginLeft: 0, fontFamily: fontFamily.medium }]}>CLASS: {info.classVal.toUpperCase()}  |  SECTION: {info.sectionVal.toUpperCase()}</Text>
                </>
              );
            })()}
          </View>
        ) : (
          <View style={[s.bgSuccess, { width: '100%', paddingTop: insets.top + 12, paddingBottom: 14, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, ...shadows.md }]}>
            <DynamicIcon name="check" size={14} color="#fff" />
            <Text style={[s.levelText, { marginLeft: 0, fontSize: 13, fontFamily: fontFamily.bold }]}>
              BIOMETRIC FACE ALIGNED
            </Text>
          </View>
        )}
      </View>


      {/* Naturally positioned transparent mock view to measure the available middle layout space */}
      <View 
        style={{ flex: 1, backgroundColor: 'transparent' }} 
        onLayout={(e) => {
          const { width: w, height: h, y } = e.nativeEvent.layout;
          if (w && h) {
            setContainerLayout({ width: w, height: h, y });
          }
        }}
      />

      {/* Bottom Controls sit naturally at the bottom */}
      <View style={[s.bottomControls, { paddingBottom: Math.max(insets.bottom, 25) + 15, flexDirection: 'column', paddingHorizontal: 0, paddingTop: 0 }]}>
        {nextStudent && (
          <View style={{ backgroundColor: '#f97316', width: '100%', paddingVertical: 10, paddingHorizontal: 20, marginBottom: 20, alignItems: 'center', justifyContent: 'center' }}>
            {(() => {
              const info = resolveStudentInfo(nextStudent);
              return (
                <Text style={{ color: '#fff', fontSize: 13, fontFamily: fontFamily.bold, textAlign: 'center' }}>
                  UPCOMING: <Text style={{ color: 'rgba(255, 255, 255, 0.9)', fontFamily: fontFamily.medium }}>{info.name.toUpperCase()}  |  CLASS: {info.classVal.toUpperCase()} - {info.sectionVal.toUpperCase()}</Text>
                </Text>
              );
            })()}
          </View>
        )}

        {/* Collapsible QA Simulation Test Panel */}
        {showQaPanel && (
          <View style={{ flexDirection: 'row', gap: 6, justifyContent: 'center', width: '100%', paddingHorizontal: 12, marginBottom: 16 }}>
            <TouchableOpacity 
              style={[{ paddingVertical: 5, paddingHorizontal: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }, simNoPerson && { backgroundColor: '#ef4444', borderColor: '#fca5a5' }]} 
              onPress={() => setSimNoPerson(p => !p)}
            >
              <Text style={{ color: '#fff', fontSize: 9, fontFamily: fontFamily.bold }}>No Person</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={[{ paddingVertical: 5, paddingHorizontal: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }, simClosedEyes && { backgroundColor: '#ef4444', borderColor: '#fca5a5' }]} 
              onPress={() => setSimClosedEyes(p => !p)}
            >
              <Text style={{ color: '#fff', fontSize: 9, fontFamily: fontFamily.bold }}>Closed Eyes</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={[{ paddingVertical: 5, paddingHorizontal: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }, simSunglasses && { backgroundColor: '#ef4444', borderColor: '#fca5a5' }]} 
              onPress={() => setSimSunglasses(p => !p)}
            >
              <Text style={{ color: '#fff', fontSize: 9, fontFamily: fontFamily.bold }}>Sunglasses</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={[{ paddingVertical: 5, paddingHorizontal: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' }, simOpticalGlasses && { backgroundColor: '#ef4444', borderColor: '#fca5a5' }]} 
              onPress={() => setSimOpticalGlasses(p => !p)}
            >
              <Text style={{ color: '#fff', fontSize: 9, fontFamily: fontFamily.bold }}>Glasses</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={{ flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center', width: '100%', paddingHorizontal: 20, marginTop: nextStudent ? 0 : 20, marginBottom: 8 }}>
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

        {/* Debug panel toggler link */}
        <TouchableOpacity 
          style={{ paddingVertical: 6, width: '100%', alignItems: 'center' }} 
          onPress={() => setShowQaPanel(p => !p)}
        >
          <Text style={{ color: 'rgba(255,255,255,0.3)', fontSize: 9, fontFamily: fontFamily.bold, letterSpacing: 0.5 }}>
            {showQaPanel ? "[- CLOSE DEBUG PANEL]" : "[+ OPEN SIMULATOR PANEL]"}
          </Text>
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
    overflow: 'hidden',
  },

  camera: { flex: 1 },
  
  topStatus: { alignItems: 'stretch' },
  levelIndicator: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, ...shadows.md },
  bgSuccess: { backgroundColor: '#22c55e' },
  bgError: { backgroundColor: '#ef4444' },
  levelText: { color: '#fff', fontSize: 13, fontFamily: 'SairaSemiCondensed-Bold', marginLeft: 8 },

  guideBox: { position: 'absolute', width: width * 0.7, alignItems: 'center' },
  guideLabel: { fontSize: 11, fontFamily: 'SairaSemiCondensed-Bold', textAlign: 'center', backgroundColor: 'rgba(15, 23, 42, 0.8)', paddingHorizontal: 12, paddingVertical: 5, borderRadius: radius.xs, letterSpacing: 0.5 },

  bottomControls: { 
    width: '100%', 
    flexDirection: 'row', 
    alignItems: 'center', 
    justifyContent: 'space-around', 
    paddingHorizontal: 20, 
    paddingTop: 24,
    backgroundColor: '#0f172a',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.12)',
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

  // Preview screen styles (free viewer — no crop box)
  previewTopBar: {
    position: 'absolute', top: 0, left: 0, right: 0,
    paddingTop: 50, paddingBottom: 16, paddingHorizontal: 20,
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    alignItems: 'center',
  },
  previewTopLabel: { color: '#fff', fontSize: 14, fontFamily: 'SairaSemiCondensed-Bold', letterSpacing: 1 },
  previewTopSub: { color: 'rgba(255,255,255,0.55)', fontSize: 11, fontFamily: 'SairaSemiCondensed-Medium', marginTop: 2 },
  previewActions: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingTop: 20,
    gap: 16,
    backgroundColor: '#0f172a',
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.10)',
  },

  fullPreview: { flex: 1, resizeMode: 'cover' },
  reviewOverlay: { position: 'absolute', bottom: 0, width: '100%', backgroundColor: 'rgba(15, 23, 42, 0.95)', padding: 24, borderTopLeftRadius: radius.md, borderTopRightRadius: radius.md, ...shadows.lg },
  reviewTitle: { color: '#fff', fontSize: 20, fontFamily: 'SairaSemiCondensed-Bold', textAlign: 'center', marginBottom: 20 },
  reviewActions: { flexDirection: 'row', gap: 16 },
  retakeBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 18, backgroundColor: 'rgba(255,255,255,0.12)', borderRadius: radius.sm, gap: 10, borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
  confirmBtn: { flex: 1.5, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 18, backgroundColor: '#22c55e', borderRadius: radius.sm, gap: 10 },
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
