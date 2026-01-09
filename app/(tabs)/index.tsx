import * as ImagePicker from 'expo-image-picker';
import { useRouter } from 'expo-router';
import { Alert, Image, StyleSheet, TouchableOpacity } from 'react-native';

import { HelloWave } from '@/components/hello-wave';
import ParallaxScrollView from '@/components/parallax-scroll-view';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';

export default function HomeScreen() {
  const router = useRouter();

  const pickFromGallery = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permiso requerido', 'Necesitamos acceso a la galería para seleccionar fotos.');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsMultipleSelection: true,
        quality: 1,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const uris = result.assets.map((a) => a.uri);
        router.push({ pathname: '/scanner', params: { photos: JSON.stringify(uris) } });
      }
    } catch (err) {
      console.error('Error selecting images:', err);
      Alert.alert('Error', 'No se pudieron seleccionar las imágenes.');
    }
  };

  return (
    <ParallaxScrollView
      headerBackgroundColor={{ light: '#A1CEDC', dark: '#1D3D47' }}
      headerImage={
        <Image
          source={require('@/assets/images/partial-react-logo.png')}
          style={styles.reactLogo}
        />
      }>
      <ThemedView style={styles.titleContainer}>
        <ThemedText type="title">¡Bienvenid@!</ThemedText>
        <HelloWave />
      </ThemedView>

      <ThemedView style={styles.stepContainer}>
        <ThemedText type="subtitle">DigiStockMobile</ThemedText>
        <ThemedText>
          Presiona el botón de abajo para comenzar a capturar las fotos de las planillas de conteo. Al finalizar, generaremos un EXCEL automáticamente.
        </ThemedText>
      </ThemedView>

      <TouchableOpacity 
        style={styles.startButton} 
        onPress={() => router.push('/scanner')}
      >
        <ThemedText style={styles.buttonText}>Iniciar Escaneo</ThemedText>
      </TouchableOpacity>

      <TouchableOpacity
        style={[styles.startButton, styles.galleryButton]}
        onPress={pickFromGallery}
      >
        <ThemedText style={styles.buttonText}>Elegir desde Galería</ThemedText>
      </TouchableOpacity>
    </ParallaxScrollView>
  );
}

const styles = StyleSheet.create({
  titleContainer: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  stepContainer: { gap: 8, marginBottom: 20 },
  reactLogo: { height: 178, width: 290, bottom: 0, left: 0, position: 'absolute' },
  startButton: {
    backgroundColor: '#007AFF',
    padding: 20,
    borderRadius: 15,
    alignItems: 'center',
    marginTop: 20,
  },
  galleryButton: {
    backgroundColor: '#34C759',
    marginTop: 12,
  },
  buttonText: { color: 'white', fontWeight: 'bold', fontSize: 18 }
});
