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
const url = require('url');
const { GoogleGenerativeAI } = require("@google/generative-ai");

// Importamos el módulo de cobranza
const cobranza = require('./cobranza.js');

// --- CONFIGURACIÓN IA GEMINI 3 FLASH (GRATUITO Y DEFINITIVO) ---
let model;
try {
    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    // Usamos el ID de modelo confirmado para 2026
model = genAI.getGenerativeModel({ 
        model: "gemini-1.5-flash",
        generationConfig: { 
            temperature: 1.0 
        }
    });
} catch (e) {
    console.error("Error inicializando Gemini 3:", e);
}

const SYSTEM_PROMPT = `Eres el Asistente Virtual experto de ONE4CARS (Venezuela).
Atiende con tono profesional y venezolano ("Estamos a la orden").
REGLA DE COBRANZA: Si preguntan por deuda, diles: "Si tiene facturas con más de 35 días vencidas, agradecemos gestionar su pago." y manda el link de estado de cuenta.
LINKS:
- Deuda: https://www.one4cars.com/estado_de_cuenta.php/
- Pagos: https://www.one4cars.com/medios_de_pago.php/
- Stock: https://www.one4cars.com/consulta_productos.php/`;

let qrCodeData = "Cargando...";
let socketGlobal = null;
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
        browser: ["ONE4CARS", "Chrome", "1.0.0"]
    });

    socketGlobal = sock;
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            qrcode.toDataURL(qr, (err, url) => { qrCodeData = url; });
        }
        if (connection === 'close') {
            const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
            if (reason === DisconnectReason.loggedOut) {
                fs.rmSync(SESSION_DIR, { recursive: true, force: true });
            }
            startBot();
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
            // Indicamos que el bot está procesando
            await sock.sendPresenceUpdate('composing', from);

            // --- CORRECCIÓN DE ESTRUCTURA PARA GEMINI 3 ---
            const result = await model.generateContent({
                contents: [{ 
                    role: "user", 
                    parts: [{ text: `${SYSTEM_PROMPT}\n\nCliente: ${userText}` }] 
                }],
                // Cambiamos "config" por la estructura correcta de Gemini 3
                generationConfig: {
                    thinkingConfig: {
                        include_thoughts: false // No queremos ver el proceso interno en el chat
                    }
                }
            });

            const text = result.response.text();
            await sock.sendMessage(from, { text: text });

        } catch (e) {
            console.error("Error IA:", e.message);
            // Si hay error, enviamos un mensaje y quitamos el "escribiendo"
            await sock.sendMessage(from, { text: "Lo siento, hubo un inconveniente técnico. Por favor, intente de nuevo en un momento." });
        } finally {
            // Siempre intentamos quitar el estado de escribiendo al terminar
            await sock.sendPresenceUpdate('paused', from);
        }
    });
}

// --- SERVIDOR WEB CON PANEL DE COBRANZA ---
http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);

    // Acción de enviar cobranza
    if (parsedUrl.pathname === '/enviar-cobranza') {
        const dias = parsedUrl.query.dias || 35;
        const facturas = await cobranza.obtenerListaDeudores({ dias });
        
        // Ejecutar en segundo plano para no bloquear el navegador
        cobranza.ejecutarEnvioMasivo(socketGlobal, facturas);
        
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(`<h2>Enviando mensajes a ${facturas.length} clientes...</h2><a href="/">Volver</a>`);
    }

    // Página Principal (QR + Botón Cobranza)
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    
    let html = `
    <html>
    <head><title>Panel ONE4CARS</title></head>
    <body style="text-align:center; font-family: sans-serif; padding:20px;">
        <h1>Control ONE4CARS</h1>
        <div style="margin: 20px; padding: 20px; border: 1px solid #ccc;">
            ${qrCodeData.includes("data:image") ? `<h3>Escanea el QR:</h3><img src="${qrCodeData}">` : `<h2>Estatus: ${qrCodeData}</h2>`}
        </div>`;

    if (qrCodeData === "✅ CONECTADO") {
        html += `
        <div style="background: #f0f0f0; padding: 20px; border-radius: 10px;">
            <h3>Módulo de Cobranza Masiva</h3>
            <p>Enviar recordatorio a clientes con facturas vencidas:</p>
            <form action="/enviar-cobranza" method="GET">
                Días de vencimiento: <input type="number" name="dias" value="35" style="width:50px;">
                <button type="submit" style="background:red; color:white; padding:10px;">🚀 INICIAR ENVÍO MASIVO</button>
            </form>
        </div>`;
    }

    html += `</body></html>`;
    res.end(html);

}).listen(process.env.PORT || 10000);

startBot();
