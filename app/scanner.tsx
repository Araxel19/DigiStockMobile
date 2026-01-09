import { Ionicons, MaterialIcons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImageManipulator from 'expo-image-manipulator';
import { useRouter, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  FlatList,
  Image,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
// Cargamos `react-native-image-crop-picker` dinámicamente dentro de `openCropEditor`.
// Evita que Metro intente resolver el módulo nativo en Expo Go y rompa la app.

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get('window');

interface PhotoData {
  uri: string;
  width: number;
  height: number;
}

export default function ScannerScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [photos, setPhotos] = useState<PhotoData[]>([]);
  const cameraRef = useRef<any>(null);
  
  // Estados de cámara
  const [zoom, setZoom] = useState(0);
  const [type, setType] = useState<'back' | 'front'>('back');
  const [flash, setFlash] = useState<'off' | 'on'>('off');
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  
  const router = useRouter();
  const params = useLocalSearchParams();

  useEffect(() => {
    if (!params || !params.photos) return;
    try {
      const uris = JSON.parse(params.photos as string) as string[];
      if (!Array.isArray(uris) || uris.length === 0) return;

      // Cargamos dimensiones de cada imagen y las insertamos en el estado
      Promise.all(
        uris.map((uri) =>
          new Promise<PhotoData>((resolve) => {
            Image.getSize(
              uri,
              (w, h) => resolve({ uri, width: w, height: h }),
              () => resolve({ uri, width: 1000, height: 1500 })
            );
          })
        )
      )
        .then((loaded) => {
          // Prepend loaded images so se comporten como capturas recientes
          setPhotos((p) => [...loaded, ...p]);
        })
        .catch((e) => console.error('Error loading selected images:', e));
    } catch (e) {
      console.error('Invalid photos param', e);
    }
  }, [params?.photos]);

  // --- Nuevo: editor de recorte interactivo (sin módulo nativo) ---
  const [cropModalVisible, setCropModalVisible] = useState(false);
  const [cropIndex, setCropIndex] = useState<number | null>(null);
  const [cropScale, setCropScale] = useState(1);
  const [cropTx, setCropTx] = useState(0);
  const [cropTy, setCropTy] = useState(0);
  const [imgNatural, setImgNatural] = useState<{ width: number; height: number } | null>(null);

  const startCropEditor = (index: number) => {
    const photo = photos[index];
    setCropIndex(index);
    // Inicializamos valores de transform para que la imagen cubra la guía
    const guideWidth = SCREEN_WIDTH * 0.85;
    const guideHeight = SCREEN_HEIGHT * 0.55;
    const initialScale = Math.max(guideWidth / photo.width, guideHeight / photo.height);
    setCropScale(initialScale);
    setCropTx(0);
    setCropTy(0);
    setImgNatural({ width: photo.width, height: photo.height });
    setCropModalVisible(true);
  };

  const applyCropFromModal = async () => {
    if (cropIndex === null || !imgNatural) return;
    const idx = cropIndex;
    const photo = photos[idx];

    const guideWidth = SCREEN_WIDTH * 0.85;
    const guideHeight = SCREEN_HEIGHT * 0.55;

    const s = cropScale;
    const tx = cropTx;
    const ty = cropTy;

    const imgW = imgNatural.width;
    const imgH = imgNatural.height;

    // Displayed image size
    const dispW = imgW * s;
    const dispH = imgH * s;

    // image center in displayed coordinates is at (dispW/2 + tx, dispH/2 + ty) relative to container center
    // We compute the top-left of crop box in displayed image coordinates
    const leftInDisp = dispW / 2 - guideWidth / 2 - tx;
    const topInDisp = dispH / 2 - guideHeight / 2 - ty;

    // Convert to original image pixels
    const originX = Math.max(0, Math.round(leftInDisp / s));
    const originY = Math.max(0, Math.round(topInDisp / s));
    const cropW = Math.max(1, Math.round(guideWidth / s));
    const cropH = Math.max(1, Math.round(guideHeight / s));

    // Clamp
    const finalOriginX = Math.min(originX, imgW - 1);
    const finalOriginY = Math.min(originY, imgH - 1);
    const finalCropW = Math.min(cropW, imgW - finalOriginX);
    const finalCropH = Math.min(cropH, imgH - finalOriginY);

    try {
      const cropped = await ImageManipulator.manipulateAsync(
        photo.uri,
        [{ crop: { originX: finalOriginX, originY: finalOriginY, width: finalCropW, height: finalCropH } }],
        { compress: 0.92, format: ImageManipulator.SaveFormat.JPEG }
      );

      const newPhotos = [...photos];
      newPhotos[idx] = { uri: cropped.uri, width: cropped.width, height: cropped.height };
      setPhotos(newPhotos);
      setCropModalVisible(false);
      setCropIndex(null);
      setViewerIndex(null);
      Alert.alert('Éxito', 'Recorte aplicado correctamente');
    } catch (err) {
      console.error('Error al aplicar crop desde modal:', err);
      Alert.alert('Error', 'No se pudo aplicar el recorte');
    }
  };

  // Reemplazamos la función abierta por el nuevo flujo interactivo
  const openCropEditor = (index: number) => {
    // Abrimos modal interactivo (funciona en Expo Go y en builds nativos)
    startCropEditor(index);
  };

  // --- CONTROL DE ZOOM MEJORADO SIN GESTURES (evita crash) ---
  const handleZoomIn = () => {
    setZoom((prev) => Math.min(prev + 0.1, 1));
  };

  const handleZoomOut = () => {
    setZoom((prev) => Math.max(prev - 0.1, 0));
  };

  if (!permission) return <View style={{ flex: 1, backgroundColor: 'black' }} />;

  if (!permission.granted) {
    return (
      <View style={styles.centerContainer}>
        <Ionicons name="camera-outline" size={64} color="#ccc" />
        <Text style={styles.permissionText}>Necesitamos acceso a la cámara</Text>
        <TouchableOpacity onPress={requestPermission} style={styles.button}>
          <Text style={styles.buttonText}>Dar Permiso</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const takePicture = async () => {
    if (cameraRef.current && !isCapturing) {
      setIsCapturing(true);
      try {
        // SOLUCIÓN: Capturamos con aspect ratio específico para que coincida con el preview
        const photo = await cameraRef.current.takePictureAsync({
          quality: 1,
          base64: false,
          exif: true,
          skipProcessing: false,
          // Importante: Esto ayuda a mantener la proporción correcta
          imageType: 'jpg',
        });

        // Calculamos las dimensiones ideales para el documento (aspecto 4:3 o A4)
        const targetWidth = 2480; // Alta resolución para OCR
        const targetHeight = 3508; // Proporción similar a A4
        
        // Procesamos la imagen manteniendo alta calidad
        const processed = await ImageManipulator.manipulateAsync(
          photo.uri,
          [
            { resize: { width: targetWidth } } // Redimensionamos a tamaño óptimo
          ],
          { 
            compress: 0.92, // Buena compresión sin perder calidad
            format: ImageManipulator.SaveFormat.JPEG 
          }
        );

        // Ajustamos el crop para que coincida con la guía en pantalla (mapeando la vista previa al tamaño real)
        const guideWidth = SCREEN_WIDTH * 0.85;
        const guideHeight = SCREEN_HEIGHT * 0.55;

        // Mapeo teniendo en cuenta que la preview usa 'cover' (imagen escalada para llenar el contenedor)
        const pW = processed.width ?? targetWidth;
        const pH = processed.height ?? targetHeight;

        const scaleToFill = Math.max(pW / SCREEN_WIDTH, pH / SCREEN_HEIGHT);
        const cropWidth = Math.round(guideWidth * scaleToFill);
        const cropHeight = Math.round(guideHeight * scaleToFill);

        const originX = Math.round((pW - cropWidth) / 2);
        const originY = Math.round((pH - cropHeight) / 2);

        const cropped = await ImageManipulator.manipulateAsync(
          processed.uri,
          [{ crop: { originX, originY, width: cropWidth, height: cropHeight } }],
          { compress: 0.92, format: ImageManipulator.SaveFormat.JPEG }
        );

        const photoData: PhotoData = {
          uri: cropped.uri,
          width: cropped.width,
          height: cropped.height,
        };

        setPhotos((p) => [photoData, ...p]);
        
      } catch (e) {
        console.error(e);
        Alert.alert('Error', 'No se pudo capturar la imagen');
      } finally {
        setIsCapturing(false);
      }
    }
  };

  const toggleType = () => setType((t) => (t === 'back' ? 'front' : 'back'));
  const toggleFlash = () => setFlash((f) => (f === 'off' ? 'on' : 'off'));

  const deletePhoto = (index: number) => {
    Alert.alert('Eliminar', '¿Eliminar esta foto?', [
      { text: 'Cancelar', style: 'cancel' },
      { 
        text: 'Eliminar', 
        style: 'destructive', 
        onPress: () => {
          const newPhotos = [...photos];
          newPhotos.splice(index, 1);
          setPhotos(newPhotos);
          setViewerIndex(null);
        } 
      },
    ]);
  };

  const handleGeneratePDF = () => {
    if (photos.length === 0) return;
    const photoUris = photos.map(p => p.uri);
    router.push({
      pathname: '/preview',
      params: { photos: JSON.stringify(photoUris) }
    });
  };

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <View style={styles.container}>
        <View style={styles.cameraContainer}>
          <CameraView
            style={styles.camera}
            ref={cameraRef}
            zoom={zoom}
            facing={type}
            enableTorch={flash === 'on'}
            responsiveOrientationWhenOrientationLocked={false}
          />
          
          {/* Overlay de Interfaz */}
          <View style={styles.overlayAbsolute}>
            <View style={styles.topBar}>
              <TouchableOpacity onPress={() => router.back()} style={styles.iconButton}>
                <Ionicons name="close" size={28} color="white" />
              </TouchableOpacity>

              <View style={styles.badge}>
                <Text style={styles.badgeText}>{photos.length} capturas</Text>
              </View>

              <View style={styles.rightTop}>
                <TouchableOpacity onPress={toggleFlash} style={styles.iconButton}>
                  <Ionicons name={flash === 'off' ? 'flash-off' : 'flash'} size={22} color="white" />
                </TouchableOpacity>
                <TouchableOpacity onPress={toggleType} style={[styles.iconButton, { marginLeft: 10 }]}>
                  <MaterialIcons name="flip-camera-ios" size={22} color="white" />
                </TouchableOpacity>
              </View>
            </View>

            {/* Guía visual mejorada */}
            <View style={styles.guideContainer}>
              <View style={styles.scanGuide}>
                <View style={[styles.corner, styles.topLeft]} />
                <View style={[styles.corner, styles.topRight]} />
                <View style={[styles.corner, styles.bottomLeft]} />
                <View style={[styles.corner, styles.bottomRight]} />
              </View>
              <Text style={styles.guideText}>Posiciona la planilla dentro del marco</Text>
            </View>

            {/* Controles de Zoom */}
            {zoom > 0 && (
              <View style={styles.zoomIndicatorContainer}>
                <View style={styles.zoomIndicator}>
                  <Text style={styles.zoomText}>{(zoom * 10 + 1).toFixed(1)}x</Text>
                </View>
              </View>
            )}

            <View style={styles.bottomBar}>
              {/* Miniatura de preview */}
              <TouchableOpacity 
                onPress={() => photos.length > 0 && setViewerIndex(0)} 
                style={styles.previewThumbnail}
              >
                {photos.length > 0 ? (
                  <Image source={{ uri: photos[0].uri }} style={styles.miniPreview} />
                ) : (
                  <View style={styles.emptyPreview}>
                    <Ionicons name="images" size={24} color="white" />
                  </View>
                )}
              </TouchableOpacity>

              {/* Controles de zoom + botón de captura */}
              <View style={styles.centerControls}>
                <View style={styles.zoomControls}>
                  <TouchableOpacity 
                    onPress={handleZoomOut} 
                    style={[styles.zoomButton, zoom === 0 && styles.zoomButtonDisabled]}
                    disabled={zoom === 0}
                  >
                    <Ionicons name="remove" size={20} color={zoom === 0 ? '#666' : 'white'} />
                  </TouchableOpacity>
                  
                  <TouchableOpacity 
                    onPress={takePicture} 
                    style={styles.captureButton}
                    disabled={isCapturing}
                  >
                    {isCapturing ? (
                      <ActivityIndicator color="white" size="large" />
                    ) : (
                      <View style={styles.captureOuter}>
                        <View style={styles.captureInner} />
                      </View>
                    )}
                  </TouchableOpacity>

                  <TouchableOpacity 
                    onPress={handleZoomIn} 
                    style={[styles.zoomButton, zoom === 1 && styles.zoomButtonDisabled]}
                    disabled={zoom === 1}
                  >
                    <Ionicons name="add" size={20} color={zoom === 1 ? '#666' : 'white'} />
                  </TouchableOpacity>
                </View>
              </View>

              {/* Botón de continuar */}
              <TouchableOpacity 
                onPress={handleGeneratePDF} 
                style={[styles.doneButton, photos.length === 0 && { backgroundColor: '#555' }]}
                disabled={photos.length === 0}
              >
                <Ionicons name="chevron-forward" size={30} color="white" />
              </TouchableOpacity>
            </View>
          </View>
        </View>

        {/* Modal de Revisión */}
        <Modal visible={viewerIndex !== null} transparent animationType="fade">
          <View style={styles.viewerContainer}>
            <View style={styles.viewerTop}>
              <TouchableOpacity onPress={() => setViewerIndex(null)} style={styles.iconButton}>
                <Ionicons name="arrow-back" size={28} color="white" />
              </TouchableOpacity>
              <Text style={styles.viewerTitle}>
                Revisar capturas ({viewerIndex !== null ? viewerIndex + 1 : 0}/{photos.length})
              </Text>
              <View style={styles.viewerActions}>
                <TouchableOpacity 
                  onPress={() => viewerIndex !== null && openCropEditor(viewerIndex)} 
                  style={[styles.iconButton, { marginRight: 10 }]}
                >
                  <Ionicons name="crop-outline" size={24} color="#00FF88" />
                </TouchableOpacity>
                <TouchableOpacity 
                  onPress={() => viewerIndex !== null && deletePhoto(viewerIndex)} 
                  style={styles.deleteButton}
                >
                  <Ionicons name="trash-outline" size={24} color="#ff4444" />
                </TouchableOpacity>
              </View>
            </View>

            <FlatList
              data={photos}
              horizontal
              pagingEnabled
              initialScrollIndex={viewerIndex || 0}
              onMomentumScrollEnd={(e) => {
                const index = Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH);
                setViewerIndex(index);
              }}
              keyExtractor={(item, index) => index.toString()}
              renderItem={({ item }) => (
                <View style={styles.fullImageContainer}>
                  <Image source={{ uri: item.uri }} style={styles.fullImage} resizeMode="contain" />
                </View>
              )}
              getItemLayout={(data, index) => ({
                length: SCREEN_WIDTH,
                offset: SCREEN_WIDTH * index,
                index,
              })}
            />

            <View style={styles.viewerHint}>
              <Ionicons name="crop-outline" size={20} color="#00FF88" />
              <Text style={styles.viewerHintText}>Toca el ícono de recorte para editar</Text>
            </View>

            {/* Modal de recorte interactivo */}
            <Modal visible={cropModalVisible} transparent animationType="fade">
              <View style={styles.cropModalOverlay}>
                <View style={styles.cropModalContent}>
                  <View style={styles.cropHeader}>
                    <TouchableOpacity onPress={() => setCropModalVisible(false)} style={styles.iconButton}>
                      <Ionicons name="close" size={24} color="white" />
                    </TouchableOpacity>
                    <Text style={{ color: 'white', fontWeight: 'bold' }}>Editor de recorte</Text>
                    <View style={{ width: 40 }} />
                  </View>

                  <View style={styles.cropContainerOuter}>
                    <View style={styles.cropBox}>
                      <View style={styles.cropViewport}>
                        {/* Imagen transformable */}
                        {cropIndex !== null && (
                          <View style={{ width: '100%', height: '100%', overflow: 'hidden' }}>
                            <View
                              style={{
                                position: 'absolute',
                                left: '50%',
                                top: '50%',
                                transform: [
                                  { translateX: cropTx },
                                  { translateY: cropTy },
                                  { translateX: -0.5 * (imgNatural?.width ?? 0) * cropScale },
                                  { translateY: -0.5 * (imgNatural?.height ?? 0) * cropScale },
                                ],
                              }}
                            >
                              <Image
                                source={{ uri: photos[cropIndex].uri }}
                                style={{ width: (imgNatural?.width ?? 0) * cropScale, height: (imgNatural?.height ?? 0) * cropScale }}
                                resizeMode="cover"
                              />
                            </View>
                          </View>
                        )}
                      </View>
                    </View>

                    <View style={styles.cropControls}>
                      <View style={{ flexDirection: 'row', gap: 8 }}>
                        <TouchableOpacity onPress={() => setCropScale((s) => Math.max(0.5, s * 0.9))} style={styles.iconButton}>
                          <Ionicons name="remove" size={20} color="white" />
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => setCropScale((s) => Math.min(4, s * 1.1))} style={styles.iconButton}>
                          <Ionicons name="add" size={20} color="white" />
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => { setCropScale(Math.max((SCREEN_WIDTH * 0.85) / (imgNatural?.width ?? 1), (SCREEN_HEIGHT * 0.55) / (imgNatural?.height ?? 1))); setCropTx(0); setCropTy(0); }} style={styles.iconButton}>
                          <Ionicons name="refresh" size={20} color="white" />
                        </TouchableOpacity>
                      </View>

                      <View style={{ flexDirection: 'row', gap: 8 }}>
                        <TouchableOpacity onPress={() => setCropTy((t) => t - 20)} style={styles.iconButton}><Ionicons name="arrow-up" size={20} color="white" /></TouchableOpacity>
                        <TouchableOpacity onPress={() => setCropTy((t) => t + 20)} style={styles.iconButton}><Ionicons name="arrow-down" size={20} color="white" /></TouchableOpacity>
                        <TouchableOpacity onPress={() => setCropTx((t) => t - 20)} style={styles.iconButton}><Ionicons name="arrow-back" size={20} color="white" /></TouchableOpacity>
                        <TouchableOpacity onPress={() => setCropTx((t) => t + 20)} style={styles.iconButton}><Ionicons name="arrow-forward" size={20} color="white" /></TouchableOpacity>
                      </View>

                      <View style={{ marginTop: 12, flexDirection: 'row', justifyContent: 'space-between' }}>
                        <TouchableOpacity onPress={() => setCropModalVisible(false)} style={[styles.button, { backgroundColor: '#555' }]}><Text style={{ color: 'white' }}>Cancelar</Text></TouchableOpacity>
                        <TouchableOpacity onPress={applyCropFromModal} style={[styles.button, { backgroundColor: '#00FF88' }]}><Text style={{ color: 'black' }}>Aplicar recorte</Text></TouchableOpacity>
                      </View>
                    </View>
                  </View>
                </View>
              </View>
            </Modal>
          </View>
        </Modal>
      </View>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'black' },
  centerContainer: { 
    flex: 1, 
    justifyContent: 'center', 
    alignItems: 'center', 
    backgroundColor: '#121212' 
  },
  cameraContainer: { flex: 1 },
  camera: { flex: 1 },
  overlayAbsolute: { 
    ...StyleSheet.absoluteFillObject, 
    justifyContent: 'space-between', 
    paddingTop: 50, 
    paddingBottom: 40,
    paddingHorizontal: 20 
  },
  topBar: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    justifyContent: 'space-between' 
  },
  rightTop: { flexDirection: 'row' },
  badge: { 
    backgroundColor: 'rgba(0,0,0,0.7)', 
    paddingHorizontal: 15, 
    paddingVertical: 6, 
    borderRadius: 20 
  },
  badgeText: { color: 'white', fontWeight: 'bold', fontSize: 14 },
  iconButton: { 
    backgroundColor: 'rgba(0,0,0,0.6)', 
    borderRadius: 30, 
    padding: 10 
  },
  
  guideContainer: { 
    flex: 1, 
    justifyContent: 'center', 
    alignItems: 'center' 
  },
  scanGuide: {
    width: SCREEN_WIDTH * 0.85,
    height: SCREEN_HEIGHT * 0.55,
    borderRadius: 15,
    position: 'relative',
  },
  corner: {
    position: 'absolute',
    width: 40,
    height: 40,
    borderColor: 'transparent',
    borderWidth: 4,
  },
  topLeft: { 
    top: 0, 
    left: 0, 
    borderRightWidth: 0, 
    borderBottomWidth: 0, 
    borderTopLeftRadius: 15 
  },
  topRight: { 
    top: 0, 
    right: 0, 
    borderLeftWidth: 0, 
    borderBottomWidth: 0, 
    borderTopRightRadius: 15 
  },
  bottomLeft: { 
    bottom: 0, 
    left: 0, 
    borderRightWidth: 0, 
    borderTopWidth: 0, 
    borderBottomLeftRadius: 15 
  },
  bottomRight: { 
    bottom: 0, 
    right: 0, 
    borderLeftWidth: 0, 
    borderTopWidth: 0, 
    borderBottomRightRadius: 15 
  },
  
  guideText: {
    color: 'white',
    fontSize: 14,
    marginTop: 20,
    textAlign: 'center',
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 20,
  },
  
  zoomIndicatorContainer: {
    position: 'absolute',
    top: '50%',
    left: 0,
    right: 0,
    alignItems: 'center',
    marginTop: -120,
  },
  zoomIndicator: {
    backgroundColor: 'rgba(0,0,0,0.7)',
    paddingHorizontal: 15,
    paddingVertical: 5,
    borderRadius: 15,
  },
  zoomText: { 
    color: '#00FF88', 
    fontWeight: 'bold', 
    fontSize: 16 
  },

  bottomBar: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    justifyContent: 'space-between' 
  },
  
  centerControls: {
    alignItems: 'center',
  },
  zoomControls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 15,
  },
  zoomButton: {
    width: 45,
    height: 45,
    borderRadius: 22.5,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#00FF88',
  },
  zoomButtonDisabled: {
    borderColor: '#666',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  
  captureButton: { 
    width: 80, 
    height: 80, 
    borderRadius: 40, 
    backgroundColor: 'rgba(255,255,255,0.3)', 
    justifyContent: 'center', 
    alignItems: 'center' 
  },
  captureOuter: { 
    width: 66, 
    height: 66, 
    borderRadius: 33, 
    backgroundColor: 'white', 
    borderWidth: 3, 
    borderColor: '#00FF88' 
  },
  captureInner: { flex: 1, borderRadius: 30 },
  
  previewThumbnail: { 
    width: 60, 
    height: 60, 
    borderRadius: 10, 
    overflow: 'hidden', 
    backgroundColor: '#333',
    borderWidth: 2,
    borderColor: '#00FF88',
  },
  miniPreview: { width: '100%', height: '100%' },
  emptyPreview: { 
    flex: 1, 
    justifyContent: 'center', 
    alignItems: 'center' 
  },
  
  doneButton: { 
    backgroundColor: '#00FF88', 
    width: 60, 
    height: 60, 
    borderRadius: 30, 
    justifyContent: 'center', 
    alignItems: 'center',
    shadowColor: '#00FF88',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 5,
  },

  permissionText: { 
    color: 'white', 
    fontSize: 16, 
    marginBottom: 20, 
    marginTop: 20 
  },
  button: { 
    backgroundColor: '#00FF88', 
    paddingHorizontal: 30, 
    paddingVertical: 12, 
    borderRadius: 25 
  },
  buttonText: { 
    color: 'black', 
    fontWeight: 'bold', 
    fontSize: 16 
  },

  // Visor de fotos
  viewerContainer: { 
    flex: 1, 
    backgroundColor: 'black' 
  },
  viewerTop: { 
    flexDirection: 'row', 
    padding: 20, 
    paddingTop: 50, 
    alignItems: 'center', 
    justifyContent: 'space-between',
    backgroundColor: 'rgba(0,0,0,0.95)',
  },
  viewerTitle: { 
    color: 'white', 
    fontSize: 16, 
    fontWeight: 'bold', 
    flex: 1, 
    textAlign: 'center' 
  },
  viewerActions: { flexDirection: 'row' },
  fullImageContainer: { 
    width: SCREEN_WIDTH, 
    height: SCREEN_HEIGHT - 150, 
    justifyContent: 'center' 
  },
  fullImage: { width: '100%', height: '100%' },
  deleteButton: { padding: 10 },
  
  viewerHint: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 15,
    backgroundColor: 'rgba(0,0,0,0.8)',
    gap: 8,
  },
  viewerHintText: {
    color: '#00FF88',
    fontSize: 14,
    fontWeight: '500',
  },

  /* Crop modal styles */
  cropModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  cropModalContent: {
    width: '100%',
    maxWidth: 800,
  },
  cropHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  cropContainerOuter: {
    backgroundColor: '#111',
    borderRadius: 12,
    padding: 12,
  },
  cropBox: {
    width: SCREEN_WIDTH * 0.85,
    height: SCREEN_HEIGHT * 0.55,
    backgroundColor: 'black',
    alignSelf: 'center',
    overflow: 'hidden',
    borderRadius: 10,
    marginBottom: 12,
  },
  cropViewport: {
    flex: 1,
    backgroundColor: 'black',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cropControls: {
    marginTop: 8,
  },
});