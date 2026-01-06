import * as FileSystem from 'expo-file-system/legacy';

const {
  EXPO_PUBLIC_LOCAL_IP,
  EXPO_PUBLIC_N8N_PORT,
  EXPO_PUBLIC_N8N_PATH_TEST,
  EXPO_PUBLIC_N8N_PATH_PROD,
} = process.env;

const N8N_WEBHOOK_URL = __DEV__
  ? `http://${EXPO_PUBLIC_LOCAL_IP}:${EXPO_PUBLIC_N8N_PORT}/${EXPO_PUBLIC_N8N_PATH_TEST}`
  : `http://${EXPO_PUBLIC_LOCAL_IP}:${EXPO_PUBLIC_N8N_PORT}/${EXPO_PUBLIC_N8N_PATH_PROD}`;

export const uploadPdfToN8n = async (
  pdfUri: string,
  document?: Record<string, any>
): Promise<any> => {
  try {
    const response = await FileSystem.uploadAsync(
      N8N_WEBHOOK_URL,
      pdfUri,
      {
        httpMethod: 'POST',
        uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
        headers: {
          'x-planilla-id': document?.planillaId
            ? String(document.planillaId)
            : 'sin_id',
          'Content-Type': 'application/pdf',
        },
      }
    );

    if (response.status >= 200 && response.status < 300) {
      return response.body
        ? JSON.parse(response.body)
        : { success: true };
    }

    console.error('Error en servidor:', response.body);
    throw new Error(`Error HTTP: ${response.status}`);
  } catch (error) {
    console.error('Error en upload:', error);
    throw error;
  }
};
