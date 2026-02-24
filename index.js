const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason, 
    fetchLatestBaileysVersion, 
    makeCacheableSignalKeyStore 
} = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode');
const http = require('http');
const pino = require('pino');
const fs = require('fs');
const { GoogleGenerativeAI } = require("@google/generative-ai");

// --- CONFIGURACIÓN IA (Versión Estable) ---
let model;
try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    // Usamos gemini-pro que es más estable en versiones antiguas de la librería
    model = genAI.getGenerativeModel({ model: "gemini-pro" });
} catch (e) {
    console.error("Error fatal IA:", e);
}

const SYSTEM_PROMPT = `
Eres el Asistente de ONE4CARS. Responde SOLO con el enlace correcto.
NO inventes nada.

1. 💰 DEUDA/SALDO: "Ver saldo: https://www.one4cars.com/estado_de_cuenta.php/"
2. 🏦 PAGOS: "Cuentas: https://www.one4cars.com/medios_de_pago.php/"
3. 📦 PRECIOS: "Precios: https://www.one4cars.com/consulta_productos.php/"
4. 🛒 PEDIDOS: "Pedido: https://www.one4cars.com/tomar_pedido.php/"
5. 👥 REGISTRO: "Registro: https://www.one4cars.com/afiliar_cliente.php/"
6. 📊 CLIENTES: "Cartera: https://www.one4cars.com/mis_clientes.php/"
7. ⚙️ FOTOS: "Ficha: https://www.one4cars.com/ficha_producto.php/"
8. 🚚 ENVÍOS: "Rastreo: https://www.one4cars.com/despacho.php/"
9. 👤 ASESOR: "Contacte a su vendedor."

Si saludan: "Hola, bienvenido a ONE4CARS. ¿En qué puedo ayudarle?"
`;

let qrCodeData = "Cargando...";
const SESSION_DIR = 'sesion_activa_one4cars';

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, pino({ level: 'silent' })),
        },
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: ["ONE4CARS", "Chrome", "1.0.0"],
        // Configuración agresiva para mantener conexión en Venezuela
        connectTimeoutMs: 60000,
        keepAliveIntervalMs: 10000, 
        retryRequestDelayMs: 2000,
        syncFullHistory: false // Acelera la carga inicial
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            console.log("QR NUEVO");
            qrcode.toDataURL(qr, (err, url) => { qrCodeData = url; });
        }
        
        if (connection === 'close') {
            const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
            console.log(`Conexión cerrada: ${reason}`);

            if (reason === DisconnectReason.loggedOut || reason === 401) {
                console.log("⚠️ Sesión cerrada. Borrando datos...");
                try { fs.rmSync(SESSION_DIR, { recursive: true, force: true }); } catch (e) {}
                // No matamos el proceso, solo reiniciamos la función
                startBot();
            } else {
                console.log("🔄 Reconectando...");
                startBot();
            }
        } else if (connection === 'open') {
            qrCodeData = "✅ CONECTADO";
            console.log('🚀 ONE4CARS ONLINE');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        const userText = msg.message.conversation || msg.message.extendedTextMessage?.text || "";

        if (!userText) return;

        // Enviamos estado "escribiendo"
        await sock.sendPresenceUpdate('composing', from);

        try {
            if (!model) throw new Error("IA no lista");

            // --- PROTECCIÓN ANTI-CUELGUE ---
            // Si la IA tarda más de 10 segundos, cortamos para no tumbar el bot
            const timeoutPromise = new Promise((_, reject) => 
                setTimeout(() => reject(new Error("Timeout IA")), 10000)
            );

            const aiPromise = model.generateContent(`${SYSTEM_PROMPT}\n\nCliente: ${userText}\nRespuesta:`);
            
            // Carrera entre la IA y el reloj
            const result = await Promise.race([aiPromise, timeoutPromise]);
            const response = await result.response;
            const text = response.text();

            await sock.sendMessage(from, { text: text });

        } catch (error) {
            console.error("Error procesando mensaje:", error.message);
            // Fallback: Si la IA falla, enviamos el menú básico para no dejar en visto
            await sock.sendMessage(from, { text: "Disculpe, en este momento no puedo procesar su consulta. Por favor intente de nuevo o contacte a un asesor." });
        }
    });
}

http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<html><head><meta http-equiv="refresh" content="5"></head><body style="text-align:center;padding:50px;"><h1>ONE4CARS</h1><div>${qrCodeData.includes("data:image") ? `<img src="${qrCodeData}" width="300">` : `<h3>${qrCodeData}</h3>`}</div></body></html>`);
}).listen(process.env.PORT || 10000);

startBot();
