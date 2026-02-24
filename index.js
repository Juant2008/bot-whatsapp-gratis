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

// --- CONFIGURACIÓN IA ---
let model;
try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
} catch (e) {
    console.error("Error fatal IA:", e);
}

// --- PROMPT ---
const SYSTEM_PROMPT = `
Eres el Asistente de ONE4CARS. Tu única función es dar el enlace correcto.
NO inventes respuestas.

1. 💰 DEUDA/SALDO: "Ver saldo: https://www.one4cars.com/estado_de_cuenta.php/"
2. 🏦 PAGOS: "Cuentas bancarias: https://www.one4cars.com/medios_de_pago.php/"
3. 📦 PRECIOS/STOCK: "Lista de precios: https://www.one4cars.com/consulta_productos.php/"
4. 🛒 PEDIDOS: "Cargar pedido: https://www.one4cars.com/tomar_pedido.php/"
5. 👥 REGISTRO: "Nuevo cliente: https://www.one4cars.com/afiliar_cliente.php/"
6. 📊 MIS CLIENTES: "Cartera: https://www.one4cars.com/mis_clientes.php/"
7. ⚙️ FOTOS: "Ficha técnica: https://www.one4cars.com/ficha_producto.php/"
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
        connectTimeoutMs: 60000,
        retryRequestDelayMs: 5000
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            console.log("QR NUEVO GENERADO");
            qrcode.toDataURL(qr, (err, url) => { qrCodeData = url; });
        }
        
        if (connection === 'close') {
            const error = lastDisconnect?.error;
            const statusCode = new Boom(error)?.output?.statusCode;
            
            console.log(`Conexión cerrada. Código: ${statusCode}`);

            // SOLUCIÓN AL BUCLE INFINITO Y ERROR 401
            if (statusCode === DisconnectReason.loggedOut || statusCode === 401 || JSON.stringify(error).includes("device_removed")) {
                console.log("⛔ SESIÓN INVÁLIDA O DISPOSITIVO REMOVIDO.");
                console.log("🗑️ Borrando sesión y reiniciando...");
                
                try {
                    fs.rmSync(SESSION_DIR, { recursive: true, force: true });
                } catch (e) { console.error("Error borrando carpeta:", e); }

                // IMPORTANTE: Matamos el proceso para que Render lo reinicie limpio
                process.exit(0); 
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

        try {
            if (model) {
                const result = await model.generateContent(`${SYSTEM_PROMPT}\n\nCliente: ${userText}\nRespuesta:`);
                const response = await result.response;
                await sock.sendMessage(from, { text: response.text() });
            }
        } catch (error) {
            console.error("Error IA (Ignorado para no tumbar el bot):", error.message);
        }
    });
}

// Servidor Web
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<html><head><meta http-equiv="refresh" content="5"></head><body style="text-align:center;padding:50px;"><h1>ONE4CARS</h1><div>${qrCodeData.includes("data:image") ? `<img src="${qrCodeData}" width="300">` : `<h3>${qrCodeData}</h3>`}</div></body></html>`);
}).listen(process.env.PORT || 10000);

startBot();
