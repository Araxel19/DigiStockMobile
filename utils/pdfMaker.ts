import * as Print from 'expo-print';

export const generatePDF = async (photos: string[]) => {
  try {
    // Creamos el contenido HTML. Cada imagen será una página del PDF.
    const htmlContent = `
      <html>
        <head>
          <style>
            body { margin: 0; padding: 0; background-color: white; }
            .page-break { page-break-after: always; }
            img { width: 100%; height: auto; display: block; }
          </style>
        </head>
        <body>
          ${photos.map((uri, index) => `
            <div class="${index === photos.length - 1 ? '' : 'page-break'}">
              <img src="${uri}" />
            </div>
          `).join('')}
        </body>
      </html>
    `;

    // Generamos el archivo PDF
    const { uri } = await Print.printToFileAsync({
      html: htmlContent,
      base64: false,
    });

    console.log('PDF generado en:', uri);
    return uri;
  } catch (error) {
    console.error("Error generando PDF:", error);
    throw error;
  }
};