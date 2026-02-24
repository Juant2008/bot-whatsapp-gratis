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

// --- CONFIGURACIÓN DE IA ---
let model;
try {
    // Esta versión maneja correctamente el modelo flash
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
} catch (e) {
    console.error("Error fatal inicializando Gemini (Revisar API KEY):", e);
}

// --- PROMPT MAESTRO CON TUS ENLACES ---
const SYSTEM_PROMPT = `
Eres el Asistente Virtual de ONE4CARS (Venezuela). Tu trabajo es redirigir al cliente a la web según su necesidad.
NO inventes datos. Usa EXCLUSIVAMENTE estos enlaces:

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

Si saludan, sé amable y venezolano ("Estamos a la orden"). Si preguntan algo de la lista, da el link directo.
`;

let qrCodeData = "Iniciando...";
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
        connectTimeoutMs: 60000, // Aumentado para Venezuela
        retryRequestDelayMs: 5000
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        
        if (qr) {
            console.log("NUEVO QR GENERADO - ESCANEAR EN LA WEB");
            qrcode.toDataURL(qr, (err, url) => { qrCodeData = url; });
        }
        
        if (connection === 'close') {
            const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
            console.log(`Conexión cerrada: ${reason}`);

            // Si la sesión se rompe (401) o se cierra sesión (403), borramos y reiniciamos
            if (reason === DisconnectReason.loggedOut || reason === 401) {
                console.log("Sesión corrupta. Borrando y reiniciando...");
                fs.rmSync(SESSION_DIR, { recursive: true, force: true });
                startBot();
            } else {
                // Cualquier otro error (internet, 515, etc), solo reconectamos
                console.log("Reconectando automáticamente...");
                startBot();
            }
        } else if (connection === 'open') {
            qrCodeData = "✅ CONECTADO EXITOSAMENTE";
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
            if (!model) {
                // Si falla la IA, respondemos algo básico para no dejar en visto
                return; 
            }

            const result = await model.generateContent(`${SYSTEM_PROMPT}\n\nCliente dice: ${userText}\nRespuesta:`);
            const response = await result.response;
            const text = response.text();

            await sock.sendMessage(from, { text: text });

        } catch (error) {
            console.error("Error IA:", error.message);
        }
    });
}

// Servidor Web para Render
http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`
        <html>
            <head><meta http-equiv="refresh" content="5"></head>
            <body style="text-align:center; font-family:sans-serif; padding:50px;">
                <h1>ONE4CARS BOT</h1>
                <div>${qrCodeData.includes("data:image") ? `<img src="${qrCodeData}" width="300">` : `<h3>${qrCodeData}</h3>`}</div>
            </body>
        </html>
    `);
}).listen(process.env.PORT || 10000);

startBot();
