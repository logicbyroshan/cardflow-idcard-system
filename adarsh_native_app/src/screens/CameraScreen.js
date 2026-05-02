import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Image, Dimensions, Platform } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Accelerometer } from 'expo-sensors';
import { FontAwesome5 } from '@expo/vector-icons';
import Svg, { Path } from 'react-native-svg';

let FaceDetector = null;
try {
  FaceDetector = require('expo-face-detector');
} catch (e) {
  // Silent catch: FaceDetector is not available in Expo Go (SDK 50+)
  // We handle this gracefully using the hasNativeFace flag.
}
const hasNativeFace = !!(FaceDetector && FaceDetector.FaceDetectorMode);

import { colors, radius, shadows, fontFamily } from '../theme';

const { width, height } = Dimensions.get('window');

export default function CameraScreen({ navigation, route }) {
  const [permission, requestPermission] = useCameraPermissions();
  const [photo, setPhoto] = useState(null);
  const [isLevel, setIsLevel] = useState(true);
  const [isCapturing, setIsCapturing] = useState(false);
  const [hasSensor, setHasSensor] = useState(true);
  const [facing, setFacing] = useState('back');
  const [faceData, setFaceData] = useState({ 
    detected: false, 
    centered: false, 
    eyesOpen: false, 
    aligned: false 
  });
  const cameraRef = useRef(null);

  const handleFacesDetected = ({ faces }) => {
    if (faces.length === 0) {
      setFaceData({ detected: false, centered: false, eyesOpen: false, aligned: false });
      return;
    }

    const face = faces[0];
    
    const faceCenterX = face.bounds.origin.x + face.bounds.size.width / 2;
    const isCentered = Math.abs(faceCenterX - width / 2) < (width * 0.15);

    const isAligned = Math.abs(face.yawAngle || 0) < 10 && Math.abs(face.rollAngle || 0) < 10;

    const eyesOpen = (face.leftEyeOpenProbability || 0) > 0.6 && (face.rightEyeOpenProbability || 0) > 0.6;

    setFaceData({ 
      detected: true, 
      centered: isCentered, 
      eyesOpen: eyesOpen,
      aligned: isAligned 
    });
  };

  const isReady = hasNativeFace 
    ? (isLevel && faceData.detected && faceData.aligned && faceData.eyesOpen)
    : isLevel;

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
          const { x, y } = data;
          const tiltX = Math.abs(x) < 0.25; 
          const tiltY = Math.abs(y) > 0.75; 
          
          setIsLevel(tiltX && tiltY);
        });
        Accelerometer.setUpdateInterval(250);
      } catch (e) {
        console.log('Accelerometer not available:', e);
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
        <FontAwesome5 name="camera-retro" size={48} color={colors.gray600} style={{ marginBottom: 20 }} />
        <Text style={s.errorText}>Camera permission is required to take photos</Text>
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
    if (!cameraRef.current || isCapturing) return;
    setIsCapturing(true);
    try {
      const p = await cameraRef.current.takePictureAsync({
        quality: 0.9,
        base64: false,
        skipProcessing: Platform.OS === 'android',
      });
      if (p) setPhoto(p);
    } catch (e) {
      console.error('Capture Error:', e);
      alert('Failed to capture photo. Please try again.');
    } finally {
      setIsCapturing(false);
    }
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
        <View style={s.reviewOverlay}>
           <Text style={s.reviewTitle}>Confirm Photo</Text>
           <View style={s.reviewActions}>
              <TouchableOpacity style={s.retakeBtn} onPress={() => setPhoto(null)}>
                <FontAwesome5 name="redo" size={16} color="#fff" />
                <Text style={s.btnText}>Retake</Text>
              </TouchableOpacity>
              <TouchableOpacity style={s.confirmBtn} onPress={handleConfirm}>
                <FontAwesome5 name="check" size={16} color="#fff" />
                <Text style={s.btnText}>Use Photo</Text>
              </TouchableOpacity>
           </View>
        </View>
      </View>
    );
  }

  return (
    <View style={s.root}>
      <View style={s.topStatus}>
        <View style={[s.levelIndicator, isReady ? s.bgSuccess : s.bgError]}>
          <FontAwesome5 name={isReady ? "check-circle" : "exclamation-triangle"} size={14} color="#fff" />
          <Text style={s.levelText}>
            {!isLevel ? "Adjust Phone Angle" : 
             (hasNativeFace && !faceData.detected) ? "No Face Detected" :
             (hasNativeFace && !faceData.aligned) ? "Align Face" :
             (hasNativeFace && !faceData.eyesOpen) ? "Keep Eyes Open" :
             "Ready to Capture"}
          </Text>
        </View>
      </View>

      <View style={s.cameraContainer}>
        <CameraView 
          style={s.camera} 
          ref={cameraRef} 
          facing={facing}
          onFacesDetected={hasNativeFace ? handleFacesDetected : undefined}
          faceDetectorSettings={hasNativeFace ? {
            mode: FaceDetector.FaceDetectorMode.accurate,
            detectLandmarks: FaceDetector.FaceDetectorLandmarks.all,
            runClassifications: FaceDetector.FaceDetectorClassifications.all,
            minDetectionInterval: 125,
            tracking: true,
          } : undefined}
        >
          <View style={s.overlayContainer}>
             {/* All guidelines removed per user request */}
          </View>
        </CameraView>
      </View>

      <View style={s.bottomControls}>
        <TouchableOpacity style={s.controlItem} onPress={() => setFacing(p => p === 'back' ? 'front' : 'back')}>
          <View style={s.controlIconCircle}>
            <FontAwesome5 name="sync-alt" size={18} color="#fff" />
          </View>
          <Text style={s.controlLabel}>Flip</Text>
        </TouchableOpacity>

        <TouchableOpacity style={s.captureBtnMain} onPress={takePicture} disabled={isCapturing}>
           <View style={s.captureBtnOuter}>
              <View style={s.captureBtnInnerMain} />
           </View>
           <Text style={s.controlLabel}>Capture</Text>
        </TouchableOpacity>

        <TouchableOpacity style={s.controlItem} onPress={() => navigation.goBack()}>
          <View style={s.controlIconCircle}>
            <FontAwesome5 name="times" size={18} color="#fff" />
          </View>
          <Text style={s.controlLabel}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#111', justifyContent: 'center' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#000' },
  cameraContainer: { 
    width: width, 
    height: width * 4 / 3, 
    overflow: 'hidden', 
    backgroundColor: '#000',
    ...shadows.xl
  },
  camera: { flex: 1 },
  overlayContainer: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  
  // Status Header
  topStatus: { position: 'absolute', top: 50, width: '100%', alignItems: 'center', zIndex: 10 },
  levelIndicator: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 25, marginBottom: 8 },
  bgSuccess: { backgroundColor: '#22c55e' },
  bgError: { backgroundColor: '#ef4444' },
  levelText: { color: '#fff', fontSize: 13, fontFamily: fontFamily.bold },
  instructionText: { color: 'rgba(255,255,255,0.7)', fontSize: 12, fontFamily: fontFamily.medium },

  // Fluid Silhouette
  fluidSilhouette: { 
    width: width * 0.8, 
    height: width * 0.95, 
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.85
  },
  silhouetteHead: { 
    width: width * 0.5, 
    height: width * 0.65, 
    borderRadius: 100, 
    borderWidth: 2.5, 
    borderColor: '#fff', 
    backgroundColor: 'rgba(255,255,255,0.08)',
    zIndex: 2,
    marginBottom: -15,
  },
  silhouetteShoulders: { 
    width: width * 0.8, 
    height: width * 0.35, 
    borderTopLeftRadius: 120, 
    borderTopRightRadius: 120, 
    borderWidth: 2.5, 
    borderColor: '#fff', 
    backgroundColor: 'rgba(255,255,255,0.08)',
    zIndex: 1,
  },
  borderError: { borderColor: '#ef4444' },

  // Pro Bottom Controls
  bottomControls: { 
    position: 'absolute', 
    bottom: 0, 
    width: '100%', 
    flexDirection: 'row', 
    alignItems: 'flex-end', 
    justifyContent: 'space-around', 
    paddingHorizontal: 20, 
    paddingBottom: Platform.OS === 'ios' ? 40 : 25,
    paddingTop: 20,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  controlItem: { alignItems: 'center', gap: 8, width: 80 },
  controlIconCircle: { 
    width: 44, 
    height: 44, 
    borderRadius: 22, 
    backgroundColor: 'rgba(255,255,255,0.15)', 
    alignItems: 'center', 
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)'
  },
  controlLabel: { color: '#fff', fontSize: 10, fontFamily: fontFamily.bold, opacity: 0.8, marginTop: 4 },
  
  captureBtnMain: { alignItems: 'center', gap: 8 },
  captureBtnOuter: { 
    width: 72, 
    height: 72, 
    borderRadius: 36, 
    borderWidth: 4, 
    borderColor: '#fff', 
    alignItems: 'center', 
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.1)'
  },
  captureBtnInnerMain: { width: 56, height: 56, borderRadius: 28, backgroundColor: '#fff' },

  fullPreview: { flex: 1, resizeMode: 'cover' },
  reviewOverlay: { position: 'absolute', bottom: 0, width: '100%', backgroundColor: 'rgba(0,0,0,0.7)', padding: 30, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl },
  reviewTitle: { color: '#fff', fontSize: 18, fontFamily: fontFamily.bold, textAlign: 'center', marginBottom: 20 },
  reviewActions: { flexDirection: 'row', gap: 16 },
  retakeBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, backgroundColor: 'rgba(255,255,255,0.2)', borderRadius: radius.md },
  confirmBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14, backgroundColor: '#22c55e', borderRadius: radius.md },
  btnText: { color: '#fff', fontSize: 15, fontFamily: fontFamily.bold },
  
  errorText: { color: '#fff', marginBottom: 20, fontFamily: fontFamily.medium },
  grantBtn: { paddingHorizontal: 20, paddingVertical: 10, backgroundColor: colors.brandPrimary, borderRadius: radius.md },
  grantBtnText: { color: '#fff', fontFamily: fontFamily.bold },
});
