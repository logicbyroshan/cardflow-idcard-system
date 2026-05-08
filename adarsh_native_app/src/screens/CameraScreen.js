import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Image, Dimensions, Platform, StatusBar } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useIsFocused } from '@react-navigation/native';
import { Accelerometer } from 'expo-sensors';
import { FontAwesome5 } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

let FaceDetector = null;
try {
  FaceDetector = require('expo-face-detector');
} catch (e) {
  // Silent catch
}
const hasNativeFace = !!(FaceDetector && FaceDetector.FaceDetectorMode);

import { colors, radius, shadows, fontFamily } from '../theme';

const { width, height } = Dimensions.get('window');

export default function CameraScreen({ navigation, route }) {
  const isFocused = useIsFocused();
  const insets = useSafeAreaInsets();
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
          const { x, y } = data;
          const tiltX = Math.abs(x) < 0.25; 
          const tiltY = Math.abs(y) > 0.75; 
          setIsLevel(tiltX && tiltY);
        });
        Accelerometer.setUpdateInterval(250);
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
        <FontAwesome5 name="camera-retro" size={48} color={colors.gray600} style={{ marginBottom: 20 }} />
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
    if (!cameraRef.current || isCapturing) return;
    setIsCapturing(true);
    try {
      const p = await cameraRef.current.takePictureAsync({
        quality: 0.8, // Slightly lower quality for better success
        base64: false,
        skipProcessing: false, // Standard processing for better results
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
        <View style={[s.reviewOverlay, { paddingBottom: Math.max(insets.bottom, 20) + 20 }]}>
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
      <StatusBar hidden />
      <View style={[s.topStatus, { top: insets.top + 10 }]}>
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
        {isFocused && (
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
          />
        )}
      </View>

      <View style={[s.bottomControls, { paddingBottom: Math.max(insets.bottom, 25) + 15 }]}>
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
  root: { flex: 1, backgroundColor: '#111' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#000' },
  cameraContainer: { 
    flex: 1,
    backgroundColor: '#000',
  },
  camera: { flex: 1 },
  
  topStatus: { position: 'absolute', width: '100%', alignItems: 'center', zIndex: 10 },
  levelIndicator: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 10, borderRadius: 25 },
  bgSuccess: { backgroundColor: '#22c55e' },
  bgError: { backgroundColor: '#ef4444' },
  levelText: { color: '#fff', fontSize: 13, fontFamily: fontFamily.bold },

  bottomControls: { 
    position: 'absolute', 
    bottom: 0, 
    width: '100%', 
    flexDirection: 'row', 
    alignItems: 'center', 
    justifyContent: 'space-around', 
    paddingHorizontal: 20, 
    paddingTop: 20,
    backgroundColor: 'rgba(0,0,0,0.6)',
  },
  controlItem: { alignItems: 'center', width: 80 },
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
  
  captureBtnMain: { alignItems: 'center' },
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
  reviewOverlay: { position: 'absolute', bottom: 0, width: '100%', backgroundColor: 'rgba(0,0,0,0.85)', padding: 24, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl },
  reviewTitle: { color: '#fff', fontSize: 20, fontFamily: fontFamily.bold, textAlign: 'center', marginBottom: 20 },
  reviewActions: { flexDirection: 'row' },
  retakeBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 16, backgroundColor: 'rgba(255,255,255,0.15)', borderRadius: radius.md },
  confirmBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 16, backgroundColor: '#22c55e', borderRadius: radius.md },
  btnText: { color: '#fff', fontSize: 15, fontFamily: fontFamily.bold },
  
  errorText: { color: '#fff', marginBottom: 20, fontFamily: fontFamily.medium },
  grantBtn: { paddingHorizontal: 20, paddingVertical: 10, backgroundColor: colors.brandPrimary, borderRadius: radius.md },
  grantBtnText: { color: '#fff', fontFamily: fontFamily.bold },
});
