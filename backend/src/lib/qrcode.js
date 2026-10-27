const QRCode = require('qrcode');

async function generateQrPngBuffer(text) {
  return QRCode.toBuffer(text, {
    type: 'png',
    width: 320,
    margin: 2,
    errorCorrectionLevel: 'M',
  });
}

module.exports = { generateQrPngBuffer };
