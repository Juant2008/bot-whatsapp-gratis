const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode');
const http = require('http');
const pino = require('pino');

let qrCodeData = "";

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info_baileys');
    const { version } = await fetchLatestBaileysVersion();

    console.log(`Usando versión de WA: ${version}`);

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'error' }), // Reducimos logs para ahorrar memoria
        browser: ["ONE4CARS", "Chrome", "1.0.0"],
        connectTimeoutMs: 60000, // Aumentamos tiempo de espera
        defaultQueryTimeoutMs: 0,
        keepAliveIntervalMs: 10000
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            qrcode.toDataURL(qr, (err, url) => { 
                qrCodeData = url; 
                console.log("✅ QR Generado. Refresca la página.");
            });
        }

        if (connection === 'close') {
            const statusCode = (lastDisconnect.error instanceof Boom)?.output?.statusCode;
            const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
            
            console.log(`Conexión cerrada por: ${statusCode}. Reconectando: ${shouldReconnect}`);
            
            if (shouldReconnect) {
                // Esperamos 5 segundos antes de reintentar para no saturar la red
                setTimeout(() => startBot(), 5000);
            }
        } else if (connection === 'open') {
            qrCodeData = "BOT ONLINE ✅";
            console.log('🚀 CONECTADO A WHATSAPP');
        }
    });

    // LÓGICA DE RESPUESTAS
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        const body = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").toLowerCase().trim();

        if (body.includes('hola') || body.includes('buen')) {
            await sock.sendMessage(from, { text: 'Hola! Bienvenido a *ONE4CARS* 🚗.\n\nEscribe una opción:\n🏦 *Medios de Pago*\n📄 *Estado de Cuenta*\n💰 *Lista de Precios*\n👤 *Asesor*' });
        }
        if (body.includes('pago')) {
            await sock.sendMessage(from, { text: '🏦 *PAGOS*\nZelle: pagos@one4cars.com\nPago Móvil: Banesco, J-12345678, 0412-1234567' });
        }
    });
}

// Servidor Web para ver el QR
const port = process.env.PORT || 10000;
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    if (qrCodeData.includes("data:image")) {
        res.write(`
            <center style="font-family:Arial; padding-top: 50px;">
                <h1>🚗 ONE4CARS - Escanea el código</h1>
                <img src="${qrCodeData}" style="width:300px; border: 5px solid #25D366; border-radius: 10px;">
                <p>Escanea este código con tu WhatsApp para activar el bot.</p>
                <button onclick="location.reload()" style="padding:10px 20px; cursor:pointer; background:#25D366; color:white; border:none; border-radius:5px;">ACTUALIZAR QR</button>
            </center>
        `);
    } else {
        res.write(`<center><h1 style="font-family:Arial; margin-top:100px;">${qrCodeData || "Conectando al servidor... refresca en 5 segundos."}</h1></center>`);
    }
    res.end();
}).listen(port, '0.0.0.0');

startBot().catch(err => console.error("Error inicial:", err));
