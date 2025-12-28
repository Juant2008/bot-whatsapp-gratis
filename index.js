const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');

const client = new Client({
    authStrategy: new LocalAuth(),
    puppeteer: {
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    }
});

client.on('qr', (qr) => {
    // Esto imprimirá el QR en los logs de Render
    qrcode.generate(qr, {small: true});
    console.log("ESCANEA ESTE QR EN LOS LOGS");
});

client.on('ready', () => {
    console.log('¡Bot funcionando!');
});

client.on('message', msg => {
    if (msg.body.toLowerCase() === 'hola') {
        msg.reply('Hola, este es un mensaje automático desde mi iPhone.');
    }
});

client.initialize();
