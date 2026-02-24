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
    // Usamos gemini-pro para máxima compatibilidad
    model = genAI.getGenerativeModel({ model: "gemini-pro" });
} catch (e) {
    console.error("Error fatal IA:", e);
}

// --- PROMPT COMPLETO (CON COBRANZA Y LINKS) ---
const SYSTEM_PROMPT = `
Eres el Asistente Virtual experto de ONE4CARS (Importadora de Autopartes en Venezuela).
Tu misión es atender a clientes y vendedores.

REGLAS DE ORO (OBLIGATORIAS):

1. 🚨 COBRANZA (MUY IMPORTANTE):
   - Si un cliente pregunta cuánto debe o pide saldo, RECUÉRDALE AMABLEMENTE:
   "Si tiene facturas con más de 35 días vencidas, agradecemos gestionar su pago a la brevedad."
   - Luego dale el link de estado de cuenta.

2. 🔗 TABLA DE ENLACES (Usa estos links para responder):

   - 💰 DEUDA / SALDO: https://www.one4cars.com/estado_de_cuenta.php/
   - 🏦 PAGOS / CUENTAS: https://www.one4cars.com/medios_de_pago.php/
   - 📦 PRECIOS / STOCK: https://www.one4cars.com/consulta_productos.php/
   - 🛒 MONTAR PEDIDO: https://www.one4cars.com/tomar_pedido.php/
   - 👥 NUEVO CLIENTE: https://www.one4cars.com/afiliar_cliente.php/
   - 📊 MIS CLIENTES (Vendedores): https://www.one4cars.com/mis_clientes.php/
   - ⚙️ FOTOS / FICHA TÉCNICA: https://www.one4cars.com/ficha_producto.php/
   - 🚚 ENVÍOS / RASTREO: https://www.one4cars.com/despacho.php/
   - 👤 ASESOR HUMANO: "Contacte a su vendedor asignado."

3. TONO:
   - Profesional, venezolano y servicial ("Estamos a la orden", "Estimado cliente").
   - NO inventes precios ni stock. Si no sabes, manda el link de consulta.

Si el usuario saluda: "Hola, bienvenido a ONE4CARS. ¿En qué puedo ayudarle hoy?"
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
        keepAliveIntervalMs: 10000, 
        retryRequestDelayMs: 2000,
        syncFullHistory: false
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
            if (!model) throw new Error("Modelo IA no inicializado");

            // --- AUMENTO DE TIEMPO DE ESPERA A 60 SEGUNDOS ---
            const timeoutPromise = new Promise((_, reject) => 
                setTimeout(() => reject(new Error("Tiempo de espera agotado (Internet lento)")), 60000)
            );

            const aiPromise = model.generateContent(`${SYSTEM_PROMPT}\n\nCliente dice: ${userText}\nRespuesta ONE4CARS:`);
            
            const result = await Promise.race([aiPromise, timeoutPromise]);
            const response = await result.response;
            const text = response.text();

            await sock.sendMessage(from, { text: text });

        } catch (error) {
            console.error("Error procesando mensaje:", error.message);
            
            // MENSAJE DE ERROR MÁS ESPECÍFICO PARA QUE SEPAS QUÉ PASA
            let errorMsg = "Disculpe, estamos presentando lentitud en la conexión. Intente de nuevo.";
            
            if (error.message.includes("404")) errorMsg = "Error técnico (Modelo no encontrado). Contacte soporte.";
            if (error.message.includes("API key")) errorMsg = "Error de configuración (API Key inválida).";
            
            await sock.sendMessage(from, { text: errorMsg });
        }
    });
}

http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<html><head><meta http-equiv="refresh" content="5"></head><body style="text-align:center;padding:50px;"><h1>ONE4CARS</h1><div>${qrCodeData.includes("data:image") ? `<img src="${qrCodeData}" width="300">` : `<h3>${qrCodeData}</h3>`}</div></body></html>`);
}).listen(process.env.PORT || 10000);

startBot();
