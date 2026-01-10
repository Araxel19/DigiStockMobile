import { ThemedText } from '@/components/themed-text';
import { useThemeColor } from '@/hooks/use-theme-color';
import { uploadPdfToN8n } from '@/services/n8nApi';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImageManipulator from 'expo-image-manipulator';
import * as Print from 'expo-print';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Platform, StyleSheet, TouchableOpacity, View, useColorScheme } from 'react-native';
import { WebView } from 'react-native-webview';

export default function PreviewScreen() {
    const { photos: photosParam } = useLocalSearchParams();
    const [pdfUri, setPdfUri] = useState<string | null>(null);
    const [previewHtml, setPreviewHtml] = useState<string | null>(null);
    const [isGenerating, setIsGenerating] = useState(false);
    const [uploadProgress, setUploadProgress] = useState<number>(0);
    const [serverStatus, setServerStatus] = useState<string | null>(null);
    const [lastPollResponse, setLastPollResponse] = useState<any | null>(null);
    const progressAnimRef = useRef<number | null>(null);
    const progressValueRef = useRef<number>(0);

    const updateProgressImmediate = (v: number) => {
        const safe = Math.max(0, Math.min(100, Math.round(v)));
        progressValueRef.current = safe;
        setUploadProgress(safe);
    };

    const smoothSetProgress = (target: number) => {
        target = Math.max(0, Math.min(100, Math.round(target)));
        // si hay una animación en curso, cancélala
        if (progressAnimRef.current) {
            clearInterval(progressAnimRef.current as unknown as number);
            progressAnimRef.current = null;
        }

        const stepInterval = 350; // ms
        progressAnimRef.current = setInterval(() => {
            const current = progressValueRef.current;
            if (current >= target) {
                clearInterval(progressAnimRef.current as unknown as number);
                progressAnimRef.current = null;
                progressValueRef.current = target;
                setUploadProgress(target);
                return;
            }
            // step: 1..3 depending on gap, keep slow visual
            const gap = target - current;
            const step = Math.max(1, Math.min(3, Math.ceil(gap / 6)));
            const next = Math.min(target, current + step);
            progressValueRef.current = next;
            setUploadProgress(next);
        }, stepInterval) as unknown as number;
    };

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
    const [polling, setPolling] = useState(false);
    const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
    const [localFileUri, setLocalFileUri] = useState<string | null>(null);
    const pollRef = useRef<number | null>(null);
    const fakeProgressRef = useRef<number | null>(null);
    const polledIdRef = useRef<string | null>(null);

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

            updateProgressImmediate(0);
            setServerStatus('Subiendo...');

            // Iniciamos la subida pero no esperamos antes de arrancar polling: esto permite mostrar progreso del servidor incluso si tarda en responder
            const uploadPromise = uploadPdfToN8n(pdfUri, {
                fileName,
                pageCount,
                planillaId,
            }, {
                timeoutMs: 5 * 60 * 1000, // 5 minutos
                onUploadProgress: (p) => {
                    updateProgressImmediate(p);
                }
            });

            // arrancar polling inmediato con el planillaId local (evita que la barra se quede en 0 si el servidor notifica progreso)
            // También forzamos un progreso mínimo visible
            updateProgressImmediate(1);
            startPolling(planillaId);

            const result = await uploadPromise;

            // Si el servidor devolvió un objeto JSON con planillaId o jobId, mostrarlo
            setServerStatus('En procesamiento en el servidor');

            // Si el servidor incluye una URL de descarga directa, guardarla y no hacer polling
            if (result && typeof result === 'object') {
                if (result.downloadUrl) {
                    setDownloadUrl(result.downloadUrl);
                    setServerStatus('Resultado listo para descargar');
                } else {
                    // Iniciamos polling usando planillaId devuelto por el servidor o el planillaId local generado
                    const remoteId = result.planillaId ?? planillaId;
                    startPolling(remoteId);
                }
            }

            // Si la respuesta contiene el archivo en bruto (zip/xlsx) intentamos guardarlo localmente
            if (result?.raw && typeof result.raw === 'string' && result.raw.includes('PK')) {
                try {
                    const fileName = `resultado_${planillaId}.xlsx`;
                    const documentDir = (FileSystem as any).documentDirectory ?? (FileSystem as any).cacheDirectory ?? '/';
                    const dest = `${documentDir}${fileName}`;
                    await FileSystem.writeAsStringAsync(dest, result.raw as string, { encoding: FileSystem.EncodingType.UTF8 });
                    setLocalFileUri(dest);
                    setServerStatus('Archivo recibido y guardado localmente');
                    console.log('Archivo guardado en:', dest);
                } catch (saveErr) {
                    console.warn('No se pudo guardar el archivo recibido:', saveErr);
                }
            }

            // Evitar volcar binarios en consola si estaba en raw
            if (result?.raw && typeof result.raw === 'string' && result.raw.includes('PK')) {
                console.log('Respuesta de n8n: archivo binario recibido (guardado localmente si fue posible)');
            } else {
                console.log('Respuesta de n8n:', result);
            }

            // Mejor alerta con acciones
            const actions: any[] = [];
            if (localFileUri || downloadUrl) {
                actions.push({ text: 'Ver resultado', onPress: async () => {
                    try {
                        if (localFileUri) {
                            if (Platform.OS === 'android') {
                                try { const contentUri = await FileSystem.getContentUriAsync(localFileUri); await import('expo-sharing').then(sh => sh.shareAsync(contentUri)); return; } catch (e) { /* fallback */ }
                            }
                            await import('expo-sharing').then(sh => sh.shareAsync(localFileUri));
                        } else {
                            await downloadResult();
                        }
                    } catch (e) { console.error(e); Alert.alert('Error', 'No se pudo abrir el resultado.'); }
                } });
            }

            actions.push({ text: 'Ir al inicio', onPress: () => router.replace('/') });
            actions.push({ text: 'Cerrar', style: 'cancel' });

            Alert.alert('¡Proceso Completado!', 'El documento se procesó con éxito.', actions);
        } catch (err: any) {
            console.error('Upload error', err, 'serverResponse:', err?.serverResponse ?? null);
            Alert.alert(
                'Error de Envío',
                `No se pudo conectar con el servidor de n8n. ${err?.message ?? ''}\n${err?.serverResponse ? JSON.stringify(err.serverResponse) : ''}`
            );
        } finally {
            setIsUploading(false);
            // si iniciamos polling y no hay progreso real, damos un progreso 'falso' hasta que el servidor responda
            if (!polling && !downloadUrl) {
                // animar progreso lento hasta 80%
                let p = uploadProgress;
                fakeProgressRef.current = setInterval(() => {
                    p = Math.min(80, p + Math.random() * 6);
                    updateProgressImmediate(Math.round(p));
                }, 800) as unknown as number;
            }
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

    /**
     * Polling para progreso en backend. Usa la variable de entorno EXPO_PUBLIC_BACKEND_BASE
     */
    const startPolling = (planillaId: string) => {
        const BACKEND = process.env.EXPO_PUBLIC_BACKEND_BASE;
        console.debug('startPolling called with', planillaId, 'BACKEND=', BACKEND);
        if (!BACKEND) {
            console.warn('No EXPO_PUBLIC_BACKEND_BASE definido; no se puede iniciar polling');
            setServerStatus('En procesamiento (no disponible el progreso)');
            return;
        }

        // Si ya hay polling para la misma planilla, no arrancamos otro
        if (pollRef.current && polledIdRef.current === planillaId) {
            console.debug('Polling ya en curso para esta planilla:', planillaId);
            return;
        }

        // Si hay polling para otra planilla, detenemos y reiniciamos
        if (pollRef.current && polledIdRef.current !== planillaId) {
            console.debug('Cambiando polling desde', polledIdRef.current, 'a', planillaId);
            clearInterval(pollRef.current as unknown as number);
            pollRef.current = null;
            polledIdRef.current = null;
        }

        // detener animación falsa si existe
        if (fakeProgressRef.current) {
            clearInterval(fakeProgressRef.current as unknown as number);
            fakeProgressRef.current = null;
        }

        setPolling(true);
        setServerStatus('Verificando progreso...');
        polledIdRef.current = planillaId;

        // Hacemos una petición inmediata para obtener estado actual sin esperar el primer intervalo
        (async () => {
            try {
                console.debug('Immediate polling fetch for', planillaId);
                const res0 = await fetch(`${BACKEND}/api/v1/inventory/${planillaId}/progress`);
                if (res0.ok) {
                    const j0 = await res0.json();
                    console.debug('Immediate polling response', j0);
                    if (j0.progress !== undefined) smoothSetProgress(Math.max(0, Math.min(100, Number(j0.progress))));
                    if (j0.message) setServerStatus(j0.message);
                    if (j0.status === 'completed') {
                        if (j0.downloadUrl) setDownloadUrl(j0.downloadUrl);
                        stopPolling();
                        setServerStatus('Completado');
                        smoothSetProgress(100);
                        return;
                    }
                }
            } catch (e) {
                console.warn('Immediate polling error', e);
            }

            // Iniciar intervalo regular
            pollRef.current = setInterval(async () => {
                try {
                    console.debug('Polling fetch for', planillaId);
                    const res = await fetch(`${BACKEND}/api/v1/inventory/${planillaId}/progress`);
                    if (!res.ok) {
                        console.warn('Polling error status', res.status);
                        return;
                    }
                    const j = await res.json();
                    console.debug('Polling response', j);
                    if (j.progress !== undefined) {
                        // animar suavemente hacia el nuevo valor
                        smoothSetProgress(Number(j.progress));
                    }
                    if (j.message) setServerStatus(j.message);
                    setLastPollResponse(j);
                    if (j.status === 'completed') {
                        // detener polling y mostrar URL si existe
                        if (j.downloadUrl) setDownloadUrl(j.downloadUrl);
                        stopPolling();
                        setServerStatus('Completado');
                        smoothSetProgress(100);
                    }
                    if (j.status === 'error') {
                        stopPolling();
                        setServerStatus('Error en procesamiento');
                    }
                } catch (e) {
                    console.warn('Polling error', e);
                }
            }, 3000) as unknown as number;
        })();
    };

    const stopPolling = () => {
        if (pollRef.current) {
            clearInterval(pollRef.current as unknown as number);
            pollRef.current = null;
        }
        setPolling(false);
        if (fakeProgressRef.current) {
            clearInterval(fakeProgressRef.current as unknown as number);
            fakeProgressRef.current = null;
        }
    };

    // limpiar al desmontar
    useEffect(() => {
        return () => {
            stopPolling();
        };
    }, []);

    // Si cambia downloadUrl o polling, cancelar fake progress
    useEffect(() => {
        if (downloadUrl || polling) {
            if (fakeProgressRef.current) {
                clearInterval(fakeProgressRef.current as unknown as number);
                fakeProgressRef.current = null;
            }
        }
    }, [downloadUrl, polling]);

    const downloadResult = async () => {
        if (!downloadUrl) {
            Alert.alert('No disponible', 'Aún no hay URL de descarga.');
            return;
        }

        try {
            setServerStatus('Descargando resultado...');
            const fileName = downloadUrl.split('/').pop() ?? `resultado_${Date.now()}.xlsx`;
            const documentDir = (FileSystem as any).documentDirectory ?? (FileSystem as any).cacheDirectory ?? '/';
            const dest = `${documentDir}${fileName}`;
            const dl = await FileSystem.downloadAsync(downloadUrl, dest);
            setLocalFileUri(dl.uri);
            setServerStatus('Descargado');
            Alert.alert('Descargado', `Archivo guardado en: ${dl.uri}`);
        } catch (e) {
            console.error('Download error', e);
            Alert.alert('Error', 'No se pudo descargar el archivo.');
            setServerStatus('Error al descargar');
        }
    };

    const saveToGallery = async () => {
        if (!localFileUri) {
            Alert.alert('No disponible', 'Primero descarga el archivo.');
            return;
        }
        try {
            const { status } = await (await import('expo-media-library')).requestPermissionsAsync();
            if (status !== 'granted') {
                Alert.alert('Permiso denegado', 'No se pudo obtener permiso para guardar en la galería.');
                return;
            }
            const MediaLibrary = await import('expo-media-library');
            const asset = await MediaLibrary.createAssetAsync(localFileUri);
            await MediaLibrary.createAlbumAsync('DigiStock', asset, false);
            Alert.alert('Guardado', 'El archivo fue guardado en la galería.');
        } catch (e) {
            console.error('save to gallery error', e);
            Alert.alert('Error', 'No se pudo guardar en la galería.');
        }
    };

    const shareResult = async () => {
        if (!localFileUri && downloadUrl) {
            // si no hay local, intentamos descargar temporalmente
            try {
                const fileName = downloadUrl.split('/').pop() ?? `resultado_${Date.now()}.xlsx`;
                const documentDir = (FileSystem as any).documentDirectory ?? (FileSystem as any).cacheDirectory ?? '/';
                const dest = `${documentDir}${fileName}`;
                const dl = await FileSystem.downloadAsync(downloadUrl, dest);
                setLocalFileUri(dl.uri);
            } catch (e) {
                console.error('share download error', e);
                Alert.alert('Error', 'No se pudo preparar el archivo para compartir.');
                return;
            }
        }

        if (!localFileUri) {
            Alert.alert('No disponible', 'No hay archivo local para compartir.');
            return;
        }

        try {
            await import('expo-sharing').then(sh => sh.shareAsync(localFileUri!));
        } catch (e) {
            console.error('share error', e);
            Alert.alert('Error', 'No se pudo compartir el archivo.');
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
                    <ThemedText style={[styles.headerTitle, { color: headerTextColor }]}>Planilla en PDF</ThemedText>
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

            {/* Resultado (si existe archivo local o URL de descarga) */}
            {(downloadUrl || localFileUri) && (
                <View style={styles.resultCard}>
                    <ThemedText style={{ fontWeight: '700', marginBottom: 6 }}>Resultado disponible</ThemedText>
                    <ThemedText numberOfLines={1} style={{ marginBottom: 8 }}>{(localFileUri || downloadUrl)?.split('/').pop()}</ThemedText>
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                        <TouchableOpacity style={[styles.openButton]} onPress={async () => {
                            try {
                                const uri = localFileUri ?? downloadUrl!;
                                if (Platform.OS === 'android') {
                                    try { const contentUri = await FileSystem.getContentUriAsync(uri); await import('expo-sharing').then(sh => sh.shareAsync(contentUri)); return; } catch (e) { /* fallback */ }
                                }
                                await import('expo-sharing').then(sh => sh.shareAsync(uri));
                            } catch (e) { console.error(e); Alert.alert('Error', 'No se pudo abrir el archivo.'); }
                        }}>
                            <ThemedText style={styles.openText}>Abrir / Compartir</ThemedText>
                        </TouchableOpacity>
                        <TouchableOpacity style={[styles.openButton]} onPress={saveToGallery}>
                            <ThemedText style={styles.openText}>Guardar</ThemedText>
                        </TouchableOpacity>
                        <TouchableOpacity style={[styles.sendButton]} onPress={downloadResult}>
                            <ThemedText style={styles.sendText}>Descargar</ThemedText>
                        </TouchableOpacity>
                    </View>
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

                {/* Barra de progreso simple */}
                {(isUploading || polling || downloadUrl) && (
                    <View style={styles.progressWrap}>
                        <View style={styles.progressBarBackground}>
                            <View style={[styles.progressBarFill, { width: `${uploadProgress}%` }]} />
                        </View>
                        <ThemedText style={{ fontSize: 12 }}>{uploadProgress}%</ThemedText>
                        {serverStatus && <ThemedText style={{ fontSize: 12, marginLeft: 8 }}>{serverStatus}</ThemedText>}
                    </View>
                )}

                {/* Si ya hay URL de descarga, mostrar botones de acción */}
                {downloadUrl && (
                    <View style={{ marginLeft: 12, flexDirection: 'row', gap: 8 }}>
                        <TouchableOpacity style={[styles.sendButton]} onPress={downloadResult}>
                            <ThemedText style={styles.sendText}>Descargar Resultado</ThemedText>
                        </TouchableOpacity>
                        <TouchableOpacity style={[styles.openButton]} onPress={shareResult}>
                            <ThemedText style={styles.openText}>Compartir</ThemedText>
                        </TouchableOpacity>
                        <TouchableOpacity style={[styles.openButton]} onPress={saveToGallery}>
                            <ThemedText style={styles.openText}>Guardar</ThemedText>
                        </TouchableOpacity>
                    </View>
                )}

                {/* Si ya hay archivo local, mostrar opción de abrir */}
                {localFileUri && (
                    <View style={{ marginLeft: 12 }}>
                        <TouchableOpacity style={[styles.openButton]} onPress={async () => {
                            try { await import('expo-sharing').then(sh => sh.shareAsync(localFileUri)); }
                            catch (e) { console.error(e); }
                        }}>
                            <ThemedText style={styles.openText}>Abrir</ThemedText>
                        </TouchableOpacity>
                    </View>
                )}
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

    sendButton: { width: 150, flexDirection: 'row', padding: 12, borderRadius: 10, backgroundColor: '#2ecc71', justifyContent: 'center', alignItems: 'center', gap: 8 },
    openButton: { flex: 1, flexDirection: 'row', padding: 12, borderRadius: 10, backgroundColor: '#007AFF', justifyContent: 'center', alignItems: 'center', gap: 8 },

    buttonText: { color: 'white', fontWeight: '700' },
    sendText: { color: 'white', fontWeight: '700', fontSize: 14 },
    openText: { color: 'white', fontWeight: '700', fontSize: 14 },

    progressWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, marginLeft: 12 },
    progressBarBackground: { width: 140, height: 8, backgroundColor: '#e6e9ee', borderRadius: 6, overflow: 'hidden', marginRight: 8 },
    progressBarFill: { height: 8, backgroundColor: '#2ecc71' },

    resultCard: { padding: 12, backgroundColor: '#fff', margin: 12, borderRadius: 8, borderWidth: 1, borderColor: '#e6e9ee' }
});

export const screenOptions = {
    headerShown: false,
};