const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const qrcode = require('qrcode');
const http = require('http');
const url = require('url');
const pino = require('pino');
const mysql = require('mysql2/promise');
const cobranza = require('./cobranza');

// --- CONFIGURACIÓN ---
const genAI = new GoogleGenerativeAI("TU_API_KEY_AQUI"); 
const dbConfig = {
    host: 'one4cars.com',
    user: 'juant200_one4car',
    password: 'Notieneclave1*',
    database: 'juant200_venezon'
};

let socketBot = null;
let qrCodeData = "";
let botStatus = "INICIALIZANDO...";
const port = process.env.PORT || 10000;

// --- LÓGICA DEL BOT ---
async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    
    socketBot = makeWASocket({ 
        auth: state, 
        logger: pino({ level: 'error' }),
        browser: ["ONE4CARS", "Chrome", "1.0.0"] // Esto ayuda a que WhatsApp no bloquee la conexión
    });
    
    socketBot.ev.on('creds.update', saveCreds);

    socketBot.ev.on('connection.update', async (u) => {
        const { connection, lastDisconnect, qr } = u;
        
        if (qr) {
            botStatus = "QR_GENERADO";
            qrCodeData = await qrcode.toDataURL(qr);
            console.log(">>> NUEVO QR LISTO PARA ESCANEAR <<<");
        }

        if (connection === 'open') {
            botStatus = "CONECTADO";
            qrCodeData = "ONLINE";
            console.log('✅ BOT ONLINE');
        }

        if (connection === 'close') {
            botStatus = "RECONECTANDO...";
            const shouldReconnect = (lastDisconnect.error)?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) startBot();
        }
    });

    // Respuesta con IA (Manteniendo tu lógica anterior)
    socketBot.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;
        const from = msg.key.remoteJid;
        const body = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").toLowerCase();
        
        try {
            const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
            const result = await model.generateContent(`Eres el asistente de ONE4CARS. Usuario dice: ${body}`);
            await socketBot.sendMessage(from, { text: result.response.text() });
        } catch (e) { console.error("Error IA:", e); }
    });
}

// --- SERVIDOR WEB ---
const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const path = parsedUrl.pathname.replace(/\/+$/, "") || "/";

    if (path === '/cobranza') {
        try {
            const data = await cobranza.obtenerListaDeudores(parsedUrl.query);
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            let rows = data.map(r => `<tr><td>${r.nombres}</td><td>${r.nro_factura}</td></tr>`).join('');
            res.end(`<h2>Cobranza</h2><table border="1">${rows}</table>`);
        } catch (e) { res.end("Error DB"); }
    } else {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        
        let contenido = "";
        if (qrCodeData === "ONLINE") {
            contenido = "<h1 style='color:green'>✅ SISTEMA CONECTADO</h1><p>El bot está trabajando.</p>";
        } else if (qrCodeData) {
            contenido = `<h1>ONE4CARS AI</h1><p>Escanea rápido:</p><img src="${qrCodeData}" width="300"><p>Estado: ${botStatus}</p>`;
        } else {
            contenido = `<h1>ONE4CARS AI</h1><p>Generando código... Estado actual: <b>${botStatus}</b></p><p>Refresca la página en 10 segundos.</p>`;
        }
        
        res.end(`<html><head><meta http-equiv="refresh" content="10"></head><body><center>${contenido}</center></body></html>`);
    }
});

server.listen(port, '0.0.0.0', () => {
    console.log(`Servidor en puerto ${port}`);
    startBot();
});
