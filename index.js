const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode');
const http = require('http');
const url = require('url');
const pino = require('pino');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const cobranza = require('./cobranza');

// --- CONFIGURACIÓN RESTAURADA ---
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
// Usamos 1.5 Flash: es el que te funcionó sin dar error 404 y tiene más mensajes gratis
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

const SYSTEM_PROMPT = `Eres el Asistente de ONE4CARS. 
Vendes autopartes en Venezuela. 
Si preguntan por deudas, envíales este link: https://www.one4cars.com/estado_de_cuenta.php/
Usa un tono amable y profesional.`;

let qrCodeData = "";
let socketBot = null;

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'error' }),
        browser: ["ONE4CARS", "Chrome", "1.0.0"]
    });

    socketBot = sock;
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) qrcode.toDataURL(qr, (err, url) => { qrCodeData = url; });
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) startBot();
        } else if (connection === 'open') {
            qrCodeData = "BOT ONLINE ✅";
            console.log('🚀 ONE4CARS Conectado');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        const userText = msg.message.conversation || msg.message.extendedTextMessage?.text || "";

        try {
            await sock.sendPresenceUpdate('composing', from);
            
            // Lógica de la IA que te funcionó
            const result = await model.generateContent(`${SYSTEM_PROMPT}\n\nCliente: ${userText}`);
            const response = await result.response;
            const text = response.text();

            await sock.sendMessage(from, { text: text });
        } catch (e) {
            console.log("Error en IA, intentando respuesta rápida...");
            await sock.sendMessage(from, { text: "Hola, estamos procesando su solicitud. Si desea ver su estado de cuenta entre aquí: https://www.one4cars.com/estado_de_cuenta.php/" });
        }
    });
}

// --- SERVIDOR WEB (QR + COBRANZA) ---
http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const path = parsedUrl.pathname;

    if (path === '/cobranza') {
        const vendedores = await cobranza.obtenerVendedores();
        const zonas = await cobranza.obtenerZonas();
        const deudores = await cobranza.obtenerListaDeudores(parsedUrl.query);

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        // Aquí va tu código de la tabla de deudores que ya tienes...
        res.end("Cargando Panel de Cobranza..."); 
    } 
    // ... (Mantén el resto de tus rutas /enviar-cobranza igual)
    else {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<h1>Estatus: ${qrCodeData}</h1>${qrCodeData.includes("data:image") ? `<img src="${qrCodeData}">` : ""}`);
    }
}).listen(process.env.PORT || 10000);

startBot();
