/**
 * BoothTogether - Lightweight Standalone PDF Generator Fallback
 * Generates valid PDF 1.4 documents from JPEG canvas data with zero dependencies.
 * Used if external jsPDF CDN is blocked or unavailable.
 */

window.createPhotostripPdfFallback = function(canvas, orientation = 'p') {
  return new Promise((resolve) => {
    // Standard photobooth strip or postcard page size in points (72 points = 1 inch)
    // 2x6 inch strip = 144 x 432 pt. Or 4x6 inch = 288 x 432 pt.
    const isStrip = canvas.height > canvas.width * 2;
    const pageWidthPt = isStrip ? 200 : 360;
    const pageHeightPt = isStrip ? 600 : (360 * (canvas.height / canvas.width));

    // Get JPEG image data as binary
    const jpegDataUrl = canvas.toDataURL('image/jpeg', 0.95);
    const base64Data = jpegDataUrl.split(',')[1];
    const binaryStr = atob(base64Data);
    const imgLen = binaryStr.length;

    // Convert to Uint8Array
    const imgBytes = new Uint8Array(imgLen);
    for (let i = 0; i < imgLen; i++) {
      imgBytes[i] = binaryStr.charCodeAt(i);
    }

    // PDF Object offsets
    const offsets = [];
    let pdfStr = '';

    function addObj(content) {
      offsets.push(pdfStr.length);
      pdfStr += content + '\n';
    }

    pdfStr += '%PDF-1.4\n%\xFF\xFF\xFF\xFF\n';

    // Obj 1: Catalog
    addObj('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj');

    // Obj 2: Pages
    addObj('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj');

    // Obj 3: Page
    addObj(`3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidthPt.toFixed(2)} ${pageHeightPt.toFixed(2)}] /Contents 4 0 R /Resources << /XObject << /Im1 5 0 R >> >> >>\nendobj`);

    // Obj 4: Content stream (Draw image scaled to page)
    const streamContent = `q\n${pageWidthPt.toFixed(2)} 0 0 ${pageHeightPt.toFixed(2)} 0 0 cm\n/Im1 Do\nQ`;
    addObj(`4 0 obj\n<< /Length ${streamContent.length} >>\nstream\n${streamContent}\nendstream\nendobj`);

    // Obj 5: Image XObject with JPEG DCTDecode
    const imgHeader = `5 0 obj\n<< /Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${imgLen} >>\nstream\n`;
    offsets.push(pdfStr.length);
    pdfStr += imgHeader;

    // Now assemble binary PDF
    const preHeaderBytes = new TextEncoder().encode(pdfStr);
    const postStream = '\nendstream\nendobj\n';
    
    // Calculate xref
    const xrefOffset = preHeaderBytes.length + imgLen + postStream.length;
    let xref = `xref\n0 6\n0000000000 65535 f \n`;
    for (let i = 0; i < offsets.length; i++) {
      xref += offsets[i].toString().padStart(10, '0') + ' 00000 n \n';
    }
    const trailer = `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

    const postBytes = new TextEncoder().encode(postStream + xref + trailer);

    // Combine all chunks into one Blob
    const totalBlob = new Blob([preHeaderBytes, imgBytes, postBytes], { type: 'application/pdf' });
    resolve(totalBlob);
  });
};
