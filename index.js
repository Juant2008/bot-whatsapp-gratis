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
    
    // CAMBIO CLAVE: Usamos "gemini-pro" porque es compatible con la versión
    // de la librería que Render tiene instalada actualmente.
    // Esto soluciona el error 404 inmediatamente.
    model = genAI.getGenerativeModel({ model: "gemini-pro" });
    
} catch (e) {
    console.error("Error fatal IA:", e);
}

// --- PROMPT MAESTRO (Tus enlaces de ONE4CARS) ---
const SYSTEM_PROMPT = `
Eres el Asistente Virtual de ONE4CARS (Venezuela).
Tu única función es redirigir al cliente al enlace correcto de nuestra web.
NO inventes precios ni stock. Usa EXCLUSIVAMENTE estos enlaces:

1. 💰 DEUDA / SALDO / ESTADO DE CUENTA:
   👉 "Para ver su saldo y facturas: https://www.one4cars.com/estado_de_cuenta.php/"

2. 🏦 PAGOS / CUENTAS / ZELLE:
   👉 "Nuestros medios de pago: https://www.one4cars.com/medios_de_pago.php/"

3. 📦 PRECIOS / EXISTENCIA / STOCK:
   👉 "Consulte precios y stock aquí: https://www.one4cars.com/consulta_productos.php/"

4. 🛒 MONTAR PEDIDO:
   👉 "Cargue su pedido aquí: https://www.one4cars.com/tomar_pedido.php/"

5. 👥 NUEVO CLIENTE:
   👉 "Registro de clientes: https://www.one4cars.com/afiliar_cliente.php/"

6. 📊 MIS CLIENTES (Vendedores):
   👉 "Su cartera de clientes: https://www.one4cars.com/mis_clientes.php/"

7. ⚙️ FOTOS / FICHA TÉCNICA:
   👉 "Ver fotos y detalles: https://www.one4cars.com/ficha_producto.php/"

8. 🚚 ENVÍOS / GUÍAS:
   👉 "Rastreo de despacho: https://www.one4cars.com/despacho.php/"

9. 👤 ASESOR HUMANO:
   👉 "Para atención personalizada, contacte a su Asesor de Ventas."

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
            
            // Ignoramos el error 515 (Stream Error) y reconectamos
            if (statusCode === 515) {
                console.log("🔄 Reinicio automático por error de flujo (Normal)...");
                startBot();
                return;
            }

            if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
                console.log("⛔ SESIÓN CERRADA. Borrando credenciales...");
                try {
                    fs.rmSync(SESSION_DIR, { recursive: true, force: true });
                } catch (e) {}
                process.exit(0); // Forzamos reinicio limpio
            } else {
                console.log("🔄 Reconectando...");
                startBot();
            }
        } else if (connection === 'open') {
            qrCodeData = "✅ CONECTADO";
            console.log('🚀 ONE4CARS ONLINE - LISTO PARA RESPONDER');
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
                // Enviamos "Escribiendo..." para que se vea real
                await sock.sendPresenceUpdate('composing', from);

                const result = await model.generateContent(`${SYSTEM_PROMPT}\n\nCliente: ${userText}\nRespuesta:`);
                const response = await result.response;
                const text = response.text();

                await sock.sendMessage(from, { text: text });
            }
        } catch (error) {
            console.error("Error IA:", error.message);
            // Si falla la IA, al menos no tumba el bot
        }
    });
}

// Servidor Web
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<html><head><meta http-equiv="refresh" content="5"></head><body style="text-align:center;padding:50px;"><h1>ONE4CARS</h1><div>${qrCodeData.includes("data:image") ? `<img src="${qrCodeData}" width="300">` : `<h3>${qrCodeData}</h3>`}</div></body></html>`);
}).listen(process.env.PORT || 10000);

startBot();
