
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

export type UploadOptions = {
  timeoutMs?: number; // tiempo máximo para la petición (por defecto 5 minutos)
  onUploadProgress?: (percent: number) => void; // solo aplicable en multipart fallback
  sendAsMultipart?: boolean; // por defecto false -> intentamos subir como BINARY (como antes)
};

export const uploadPdfToN8n = async (
  pdfUri: string,
  document?: Record<string, any>,
  options: UploadOptions = {}
): Promise<any> => {
  const { timeoutMs = 5 * 60 * 1000, onUploadProgress, sendAsMultipart = false } = options;
  const fileName = document?.fileName ?? pdfUri.split('/').pop() ?? 'document.pdf';

  // 1) Intentar subir como BINARY (comportamiento original con FileSystem.uploadAsync)
  if (!sendAsMultipart) {
    try {
      const uploadPromise = FileSystem.uploadAsync(N8N_WEBHOOK_URL, pdfUri, {
        httpMethod: 'POST',
        uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
        headers: {
          'x-planilla-id': document?.planillaId ? String(document.planillaId) : 'sin_id',
          'Content-Type': 'application/pdf',
        },
      });

      const timeoutPromise = new Promise((_res, rej) => setTimeout(() => rej(new Error('Timeout en la petición al servidor de n8n')), timeoutMs));

      const response: any = await Promise.race([uploadPromise, timeoutPromise]);

      if (response.status >= 200 && response.status < 300) {
        try {
          return response.body ? JSON.parse(response.body) : { success: true };
        } catch (parseErr) {
          // Si la respuesta no es JSON, devolvemos la respuesta en crudo
          return { success: true, raw: response.body };
        }
      }

      const err: any = new Error(`Error HTTP: ${response.status}`);
      err.serverResponse = response.body;
      err.status = response.status;
      throw err;
    } catch (err) {
      // Si falla el envío binario, hacemos fallback a multipart para mantener la robustez
      console.warn('Envio binario falló, intentando multipart fallback:', err);
      // continue hacia multipart
    }
  }

  // 2) Fallback: enviar como multipart con XHR (soporta progreso)
  return new Promise((resolve, reject) => {
    try {
      const xhr = new XMLHttpRequest();

      xhr.open('POST', N8N_WEBHOOK_URL);

      // Header identificador
      xhr.setRequestHeader('x-planilla-id', document?.planillaId ? String(document.planillaId) : 'sin_id');

      xhr.timeout = timeoutMs;

      xhr.upload.onprogress = (e: any) => {
        if (!e || !e.lengthComputable) return;
        const percent = Math.round((e.loaded / e.total) * 100);
        try { onUploadProgress && onUploadProgress(percent); } catch (e) { /* ignore callback errors */ }
      };

      xhr.onreadystatechange = () => {
        if (xhr.readyState !== 4) return;

        const text = xhr.responseText ?? '';

        if (xhr.status >= 200 && xhr.status < 300) {
          try {
            const json = text ? JSON.parse(text) : { success: true };
            resolve(json);
          } catch (parseErr) {
            resolve({ success: true, raw: text });
          }
          return;
        }

        const err: any = new Error(`Error HTTP: ${xhr.status}`);
        err.serverResponse = text;
        err.status = xhr.status;
        reject(err);
      };

      xhr.ontimeout = () => reject(new Error('Timeout en la petición al servidor de n8n'));
      xhr.onerror = () => reject(new Error('Error de red durante la subida'));

      const form = new FormData();
      // @ts-ignore - RN FormData file object { uri, name, type }
      form.append('file', { uri: pdfUri, name: fileName, type: 'application/pdf' });

      xhr.send(form);
    } catch (err) {
      reject(err);
    }
  });
};
