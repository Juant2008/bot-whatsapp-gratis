const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    fetchLatestBaileysVersion 
} = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const qrcode = require('qrcode');
const http = require('http');
const url = require('url');
const pino = require('pino');
const cobranza = require('./cobranza');

// --- CONFIGURACIÓN GEMINI ---
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const modelIA = genAI.getGenerativeModel({ 
    model: "gemini-1.5-flash",
    systemInstruction: `Eres el Asistente Virtual de ONE4CARS, importadora de autopartes en Venezuela.
    Tu objetivo es vender y ayudar. 
    ENLACES OBLIGATORIOS (Ofrécelos cuando el cliente pregunte por servicios):
    - 🏦 Medios de Pago: https://www.one4cars.com/medios_de_pago.php/
    - 📄 Estado de Cuenta: https://www.one4cars.com/estado_de_cuenta.php/
    - 💰 Lista de Precios: https://www.one4cars.com/lista_de_precios.php/
    - 🛒 Tomar Pedido: https://www.one4cars.com/tomar_pedido.php/
    - 👥 Afiliar Cliente: https://www.one4cars.com/afiliar_clientes.php/
    - 👥 Mis Clientes: https://www.one4cars.com/mis_clientes.php/
    - ⚙️ Ficha Producto: https://www.one4cars.com/consulta_productos.php/
    - 🚚 Despacho: https://one4cars.com/sevencorpweb/productos_transito_web.php
    - 👤 Asesor: Indica que un asesor humano lo contactará pronto.

    REGLAS:
    - Importamos de China. Almacén en Caracas.
    - Mayoristas: 40% descuento en divisas (Tasa BCV).
    - Si el cliente promete pagar una fecha, dile que lo anotarás en agenda.
    - Tono: Cordial, profesional y venezolano.`
});

let qrCodeData = "";
let socketBot = null;
const port = process.env.PORT || 10000;

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'error' }),
        browser: ["ONE4CARS AI", "Chrome", "1.0.0"]
    });

    socketBot = sock;
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) qrcode.toDataURL(qr, (err, url) => { qrCodeData = url; });
        
        if (connection === 'close') {
            const statusCode = (lastDisconnect.error instanceof Boom)?.output?.statusCode;
            if (statusCode !== DisconnectReason.loggedOut) setTimeout(() => startBot(), 5000);
        } else if (connection === 'open') {
            qrCodeData = "BOT ONLINE ✅";
            console.log('🚀 ONE4CARS AI Conectado');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        const body = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").trim();

        // Título obligatorio para todas las respuestas
        const titulo = "🚗 *SOPORTE ONE4CARS*\n________________________\n\n";

        try {
            // Efecto "escribiendo"
            await sock.sendPresenceUpdate('composing', from);

            // Generar respuesta con Gemini
            const chat = modelIA.startChat({ history: [] });
            const result = await chat.sendMessage(body);
            const responseText = result.response.text();

            await sock.sendMessage(from, { text: titulo + responseText });
        } catch (error) {
            console.error("Error Gemini:", error);
            await sock.sendMessage(from, { text: titulo + "Hola, estoy recibiendo muchas consultas. Dame un momento o escribe *Asesor*." });
        }
    });
}

// --- SERVIDOR WEB PARA QR Y PANEL DE COBRANZA ---
http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const path = parsedUrl.pathname;

    if (path === '/cobranza') {
        const vendedores = await cobranza.obtenerVendedores();
        const zonas = await cobranza.obtenerZonas();
        const deudores = await cobranza.obtenerListaDeudores(parsedUrl.query);

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        // (Aquí va el mismo HTML de cobranza que ya tienes, se mantiene igual para funcionalidad)
        res.write(`<html>...</html>`); // Reutiliza tu HTML de cobranza aquí
        res.end();
    } 
    else if (path === '/enviar-cobranza' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', async () => {
            const data = JSON.parse(body);
            if (socketBot && data.facturas) {
                cobranza.ejecutarEnvioMasivo(socketBot, data.facturas);
                res.writeHead(200); res.end('Proceso iniciado');
            }
        });
    }
    else {
        // Página principal para el QR
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        if (qrCodeData.includes("data:image")) {
            res.write(`<center><h1>Escanea ONE4CARS AI</h1><img src="${qrCodeData}"><br><a href="/cobranza">Panel de Cobranza</a></center>`);
        } else {
            res.write(`<center><h1>${qrCodeData || "Iniciando..."}</h1><br><a href="/cobranza">ENTRAR A COBRANZA</a></center>`);
        }
        res.end();
    }
}).listen(port, '0.0.0.0');

startBot();
