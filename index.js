const { default: makeWASocket, useMultiFileAuthState, disconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode');
const http = require('http');

let qrCodeData = "";

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    
    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: true,
        browser: ["ONE4CARS", "Chrome", "1.0.0"]
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            qrcode.toDataURL(qr, (err, url) => { qrCodeData = url; });
        }
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error instanceof Boom)?.output?.statusCode !== disconnectReason.loggedOut;
            if (shouldReconnect) startBot();
        } else if (connection === 'open') {
            qrCodeData = "BOT ONLINE ✅";
            console.log('Conectado a WhatsApp');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        const body = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").toLowerCase().trim();

        const saludos = ['hola', 'buen dia', 'buenos dias', 'buenas tardes', 'buen día'];

        if (saludos.some(s => body.includes(s)) && !body.includes('pago')) {
            await sock.sendMessage(from, { text: 'Hola! Bienvenido a *ONE4CARS* 🚗.\n\nEscribe la opción:\n🏦 *Medios de Pago*\n📄 *Estado de Cuenta*\n💰 *Lista de Precios*\n👤 *Asesor*' });
        }
        if (body.includes('pago')) {
            await sock.sendMessage(from, { text: '🏦 *PAGOS*\nZelle: pagos@one4cars.com\nPago Móvil: Banesco, J-12345678, 0412-0000000' });
        }
    });
}

// Servidor Web para el QR
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.write(`<center><h1>${qrCodeData.includes("data:image") ? `<img src="${qrCodeData}" width="300">` : qrCodeData || "Iniciando..."}</h1></center>`);
    res.end();
}).listen(process.env.PORT || 10000);

startBot();
