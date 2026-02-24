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
const pino = require('pino');
const cobranza = require('./cobranza');

// --- CONFIGURACIÓN DE GEMINI 2.0 ---
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Instrucción de Sistema para ONE4CARS
const systemInstruction = `Eres el Asistente Virtual de ONE4CARS, importadora de autopartes en Venezuela.
REGLAS:
1. Usa emojis y tono cordial venezolano.
2. ENLACES OBLIGATORIOS:
   🏦 Medios de Pago: https://www.one4cars.com/medios_de_pago.php/
   📄 Estado de Cuenta: https://www.one4cars.com/estado_de_cuenta.php/
   💰 Lista de Precios: https://www.one4cars.com/consulta_productos.php/
   🛒 Tomar Pedido: https://www.one4cars.com/tomar_pedido.php/
   👥 Afiliar Cliente: https://www.one4cars.com/afiliar_clientes.php/
   👥 Mis Clientes: https://www.one4cars.com/mis_clientes.php/
   ⚙️ Ficha Producto: https://www.one4cars.com/consulta_productos.php/
   🚚 Despacho: https://one4cars.com/sevencorpweb/productos_transito_web.php
   👤 Asesor: Un humano te contactará.

3. Importamos de China, almacén en Caracas. Mayoristas 40% desc en divisas (Tasa BCV).`;

// Inicializar modelo con configuración de seguridad
const modelIA = genAI.getGenerativeModel({ 
    model: "gemini-2.5-flash"
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
            console.log('🚀 ONE4CARS Conectado');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        const body = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").trim();
        const titulo = "🚗 *SOPORTE ONE4CARS*\n________________________\n\n";

        try {
            await sock.sendPresenceUpdate('composing', from);

            // Generar contenido enviando la instrucción de sistema en cada mensaje para evitar el 404 de v1beta
            const promptFinal = `${systemInstruction}\n\nUsuario dice: ${body}`;
            const result = await modelIA.generateContent(promptFinal);
            const responseText = result.response.text();

            await sock.sendMessage(from, { text: titulo + responseText });
} catch (error) {
            console.error("ERROR REAL EN GEMINI:", error.message);
            
            // Mensaje de respaldo con los 9 enlaces obligatorios formateados correctamente
            const menuManual = `¡Hola! Bienvenido a ONE4CARS 🚗💨

Soy tu asistente virtual. Para ayudarte rápidamente, escribe la palabra clave de lo que necesitas:

🏦 *Medios de Pago:* https://www.one4cars.com/medios_de_pago.php/
📄 *Estado de Cuenta:* https://www.one4cars.com/estado_de_cuenta.php/
💰 *Lista de Precios:* https://www.one4cars.com/consulta_productos.php/
🛒 *Tomar Pedido:* https://www.one4cars.com/tomar_pedido.php/
👥 *Afiliar Cliente:* https://www.one4cars.com/afiliar_clientes.php/
👥 *Mis Clientes:* https://www.one4cars.com/mis_clientes.php/
⚙️ *Ficha Producto:* https://www.one4cars.com/consulta_productos.php/
🚚 *Despacho:* https://one4cars.com/sevencorpweb/productos_transito_web.php
👤 *Asesor:* Un humano le contactará a la brevedad.`;

            await sock.sendMessage(from, { text: titulo + menuManual });
        }
    });
}

// --- SERVIDOR WEB MODERNO (Sin url.parse) ---
http.createServer(async (req, res) => {
    const protocol = req.headers['x-forwarded-proto'] || 'http';
    const baseUrl = protocol + '://' + req.headers.host;
    const myUrl = new URL(req.url, baseUrl);
    const path = myUrl.pathname;

    if (path === '/cobranza') {
        const deudores = await cobranza.obtenerListaDeudores();
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.write(`<h1>Panel ONE4CARS</h1><p>Clientes con deuda: ${deudores.length}</p><a href="/">Ver QR</a>`);
        res.end();
    } 
    else {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        if (qrCodeData.includes("data:image")) {
            res.write(`<center><h1>Escanea ONE4CARS AI</h1><img src="${qrCodeData}"></center>`);
        } else {
            res.write(`<center><h1>${qrCodeData || "Iniciando..."}</h1></center>`);
        }
        res.end();
    }
}).listen(port, '0.0.0.0');

startBot();
