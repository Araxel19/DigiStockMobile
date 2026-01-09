import { ThemedText } from '@/components/themed-text';
import { useThemeColor } from '@/hooks/use-theme-color';
import { uploadPdfToN8n } from '@/services/n8nApi';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system';
import * as ImageManipulator from 'expo-image-manipulator';
import * as Print from 'expo-print';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Platform, StyleSheet, TouchableOpacity, View, useColorScheme } from 'react-native';
import { WebView } from 'react-native-webview';

export default function PreviewScreen() {
    const { photos: photosParam } = useLocalSearchParams();
    const [pdfUri, setPdfUri] = useState<string | null>(null);
    const [previewHtml, setPreviewHtml] = useState<string | null>(null);
    const [isGenerating, setIsGenerating] = useState(false);
    const router = useRouter();

    // Convertimos el parámetro de string a array
    const photos = typeof photosParam === 'string' ? (() => {
        try { return JSON.parse(photosParam); } catch { return []; }
    })() : [];

    const pageCount = photos.length;
    const theme = useColorScheme() ?? 'light';
    const headerBg = theme === 'dark' ? useThemeColor({}, 'background') : useThemeColor({}, 'tint');
    const bg = useThemeColor({}, 'background');
    const headerTextColor = theme === 'light' ? '#fff' : useThemeColor({}, 'text');
    useEffect(() => {
        if (!photos || photos.length === 0) {
            Alert.alert('Sin fotos', 'No hay fotos para previsualizar.', [{ text: 'OK', onPress: () => router.back() }]);
            return;
        }
        generatePreview();
    }, []);

    const generatePreview = async () => {
        setIsGenerating(true);
        try {
            // --- NUEVA LÓGICA: Convertir URIs a Base64 ---
            const photosBase64 = await Promise.all(
                photos.map(async (uri: string) => {
                    const manipResult = await ImageManipulator.manipulateAsync(
                        uri,
                        [{ resize: { width: 1000 } }], // Reducimos un poco para no saturar la memoria
                        { base64: true, format: ImageManipulator.SaveFormat.JPEG, compress: 0.7 }
                    );
                    return `data:image/jpeg;base64,${manipResult.base64}`;
                })
            );

            const previewBg = theme === 'dark' ? '#0b0c0d' : '#f2f4f8';
            const pageBg = theme === 'dark' ? '#121314' : '#ffffff';

            const htmlContent = `
        <html>
          <body style="margin:0; padding:20px; background:${previewBg};">
            ${photosBase64.map((b64, idx) => `
              <div style="background:${pageBg}; margin-bottom:20px; padding:10px; page-break-after:always;">
                <img src="${b64}" style="width:100%;" />
                <div style="text-align:center;">Página ${idx + 1} / ${photos.length}</div>
              </div>
            `).join('')}
          </body>
        </html>
      `;

            setPreviewHtml(htmlContent);

            const { uri } = await Print.printToFileAsync({
                html: htmlContent,
                base64: false
            });

            setPdfUri(uri);
        } catch (err) {
            console.error('Error al incrustar imágenes:', err);
            Alert.alert("Error", "No se pudieron procesar las imágenes para el PDF");
        } finally {
            setIsGenerating(false);
        }
    };

    const [isUploading, setIsUploading] = useState(false);

    const handleSend = async () => {
        if (!pdfUri || isGenerating || isUploading) return;

        setIsUploading(true);
        try {
            const fileName = pdfUri.split('/').pop() ?? 'document.pdf';
            // Generar planillaId (UUIDv4 simple)
            const generateUUID = () => {
                try {
                    // Preferir crypto si está disponible
                    // @ts-ignore
                    if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
                        // @ts-ignore
                        const buf = new Uint8Array(16);
                        // @ts-ignore
                        crypto.getRandomValues(buf);
                        buf[6] = (buf[6] & 0x0f) | 0x40;
                        buf[8] = (buf[8] & 0x3f) | 0x80;
                        const hex = Array.from(buf).map((b) => b.toString(16).padStart(2, '0'));
                        return `${hex.slice(0, 4).join('')}-${hex.slice(4, 6).join('')}-${hex.slice(6, 8).join('')}-${hex.slice(8, 10).join('')}-${hex.slice(10, 16).join('')}`;
                    }
                } catch (e) {
                    // fallthrough
                }
                return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
                    const r = (Math.random() * 16) | 0;
                    const v = c === 'x' ? r : (r & 0x3) | 0x8;
                    return v.toString(16);
                });
            };

            const planillaId = generateUUID();

            console.debug('Enviando PDF a n8n', { pdfUri, fileName, pageCount, planillaId });
            try {
                const info = await FileSystem.getInfoAsync(pdfUri);
                console.debug('PDF info:', info);
            } catch (infoErr) {
                console.warn('No se pudo obtener info del PDF:', infoErr);
            }

            const result = await uploadPdfToN8n(pdfUri, {
                fileName,
                pageCount,
                planillaId,
            });

            Alert.alert(
                '¡Enviado!',
                `El documento se está procesando. ID: ${planillaId}. El Excel estará listo pronto.`,
                [{ text: 'OK', onPress: () => router.replace('/') }]
            );

            console.log("Respuesta de n8n:", result);
        } catch (err: any) {
            console.error('Upload error', err, 'serverResponse:', err?.serverResponse ?? null);
            Alert.alert(
                'Error de Envío',
                `No se pudo conectar con el servidor de n8n. ${err?.message ?? ''}\n${err?.serverResponse ? JSON.stringify(err.serverResponse) : ''}`
            );
        } finally {
            setIsUploading(false);
        }
    };

    const handleOpenPDF = async () => {
        if (!pdfUri) {
            Alert.alert('No disponible', 'El PDF todavía no está listo.');
            return;
        }

        try {
            if (Platform.OS === 'android') {
                try {
                    const contentUri = await FileSystem.getContentUriAsync(pdfUri);
                    await import('expo-sharing').then(sh => sh.shareAsync(contentUri));
                    return;
                } catch (innerErr) {
                    console.warn('getContentUriAsync failed, fallback to share/open:', innerErr);
                }
            }

            await import('expo-sharing').then(sh => sh.shareAsync(pdfUri));
        } catch (err) {
            console.error('open error', err);
            // Fallback: intentar abrir con Linking (al menos el usuario podrá elegir una app que lo abra)
            try {
                await Linking.openURL(pdfUri);
            } catch (linkErr) {
                console.error('link open error', linkErr);
                Alert.alert('Error', 'No se pudo abrir el PDF. Ruta: ' + pdfUri);
            }
        }
    };

    const handleRegenerate = () => {
        if (isGenerating) return;
        generatePreview();
    };

    return (
        <View style={[styles.container, { backgroundColor: bg }]}>
            <View style={[styles.header, { backgroundColor: headerBg, paddingTop: Platform.OS === 'ios' ? 36 : 20 }]}>
                <View style={styles.headerLeft}>
                    <TouchableOpacity onPress={() => router.back()} style={styles.iconButton}>
                        <Ionicons name="chevron-back" size={22} color={headerTextColor} />
                    </TouchableOpacity>
                </View>

                <View style={styles.headerCenter}>
                    <ThemedText style={[styles.headerTitle, { color: headerTextColor }]}>Preview — PDF</ThemedText>
                    <View style={styles.headerMeta}>
                        <ThemedText style={[styles.metaText, { color: headerTextColor }]}>{pageCount} página{pageCount === 1 ? '' : 's'}</ThemedText>
                        {isGenerating && <ActivityIndicator size="small" color={headerTextColor} style={{ marginLeft: 8 }} />}
                        {pdfUri && !isGenerating && (
                            <View style={styles.readyBadge}>
                                <ThemedText style={styles.readyText}>PDF listo</ThemedText>
                            </View>
                        )}
                    </View>
                </View>

                <View style={styles.headerRight}>
                    <TouchableOpacity style={styles.iconButton} onPress={() => router.back()}>
                        <Ionicons name="create-outline" size={18} color={headerTextColor} />
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.iconButton, { marginLeft: 8 }]} onPress={handleRegenerate} disabled={isGenerating}>
                        <Ionicons name="refresh" size={18} color={headerTextColor} />
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.iconButton, { marginLeft: 8 }]} onPress={handleOpenPDF} disabled={!pdfUri}>
                        <Ionicons name="open-outline" size={18} color={headerTextColor} />
                    </TouchableOpacity>
                </View>
            </View>

            {previewHtml ? (
                <WebView
                    originWhitelist={['*']}
                    source={{ html: previewHtml }}
                    style={{ flex: 1 }}
                    allowFileAccess={true}
                    allowFileAccessFromFileURLs={true}
                    allowUniversalAccessFromFileURLs={true}
                    mixedContentMode="always"
                />
            ) : (
                <View style={styles.center}>
                    <ActivityIndicator size="large" color="#007AFF" />
                    <ThemedText>{isGenerating ? 'Generando vista previa...' : 'Preparando vista...'}</ThemedText>
                </View>
            )}

            <View style={[styles.footer, { backgroundColor: bg }]}>
                <TouchableOpacity
                    style={[styles.sendButton, (isUploading || isGenerating) && { opacity: 0.5 }]}
                    onPress={handleSend}
                    disabled={isUploading || isGenerating}
                >
                    {isUploading ? (
                        <ActivityIndicator color="white" size="small" />
                    ) : (
                        <Ionicons name="cloud-upload-outline" size={20} color="white" />
                    )}
                    <ThemedText style={styles.sendText}>
                        {isUploading ? 'Enviando...' : 'Procesar Documento'}
                    </ThemedText>
                </TouchableOpacity>
            </View>
        </View>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#f2f4f8' },
    center: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 10 },

    header: { height: 72, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingTop: 12 },
    headerLeft: { width: 44, height: 44, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
    headerCenter: { flex: 1, alignItems: 'flex-start', paddingLeft: 8 },
    headerTitle: { fontWeight: '700', fontSize: 18, marginBottom: 2 },
    headerMeta: { flexDirection: 'row', alignItems: 'center', marginTop: 4 },
    metaText: { fontSize: 12 },
    readyBadge: { backgroundColor: '#1dd36b', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, marginLeft: 8 },
    readyText: { color: 'white', fontSize: 11, fontWeight: '700' },

    headerRight: { flexDirection: 'row', alignItems: 'center' },
    iconButton: { backgroundColor: 'rgba(255,255,255,0.14)', padding: 8, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },

    footer: { flexDirection: 'row', padding: 16, borderTopWidth: 1, borderTopColor: '#e6e9ee', gap: 10, backgroundColor: 'white' },

    sendButton: { flex: 2, flexDirection: 'row', padding: 12, borderRadius: 10, backgroundColor: '#2ecc71', justifyContent: 'center', alignItems: 'center', gap: 8 },
    openButton: { flex: 1, flexDirection: 'row', padding: 12, borderRadius: 10, backgroundColor: '#007AFF', justifyContent: 'center', alignItems: 'center', gap: 8 },

    buttonText: { color: 'white', fontWeight: '700' },
    sendText: { color: 'white', fontWeight: '700', fontSize: 14 },
    openText: { color: 'white', fontWeight: '700', fontSize: 14 }
});

export const screenOptions = {
    headerShown: false,
};