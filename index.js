// index.js
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode');
const http = require('http');
const https = require('https');
const url = require('url');
const pino = require('pino');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const cobranza = require('./cobranza');

// --- CONFIGURACIÓN IA ---
const apiKey = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(apiKey);
const model = genAI.getGenerativeModel({ 
    model: "gemini-2.5-flash", 
    generationConfig: { temperature: 0.7, maxOutputTokens: 1000 }
});

let qrCodeData = "";
let socketBot = null;
const port = process.env.PORT || 10000;

// --- CONTROL HUMANO ---
global.controlManual = {};
function activarControlManual(jid) { global.controlManual[jid] = true; }
function desactivarControlManual(jid) { delete global.controlManual[jid]; }

// --- FUNCIONES AUXILIARES ---
function obtenerTasa(apiUrl) {
    return new Promise((resolve) => {
        https.get(apiUrl, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve(JSON.parse(data).promedio || null); }
                catch { resolve(null); }
            });
        }).on('error', () => resolve(null));
    });
}

async function construirInstrucciones() {
    const tasaOficial = await obtenerTasa('https://ve.dolarapi.com/v1/dolares/oficial');
    const tasaParalelo = await obtenerTasa('https://ve.dolarapi.com/v1/dolares/paralelo');
    const txtOficial = tasaOficial ? `Bs. ${tasaOficial}` : "No disponible";
    const txtParalelo = tasaParalelo ? `Bs. ${tasaParalelo}` : "No disponible";
    const fecha = new Date().toLocaleString('es-VE', { timeZone: 'America/Caracas' });

    return `
ROL: Eres ONE4-Bot, asistente experto de ONE4CARS.
FECHA: ${fecha}

--- DÓLARES ---
Oficial: ${txtOficial}
Paralelo: ${txtParalelo}

--- IDENTIDAD ---
Tono profesional y venezolano, saludo cordial, lenguaje formal.

--- ENLACES OFICIALES ---
1. Pagos: https://www.one4cars.com/medios_de_pago.php/
2. Estado de cuenta: https://www.one4cars.com/estado_de_cuenta.php/
3. Lista de precios: https://www.one4cars.com/lista_de_precios.php/
4. Tomar pedido: https://www.one4cars.com/tomar_pedido.php/
5. Mis clientes/Vendedores: https://www.one4cars.com/mis_clientes.php/
6. Afiliar cliente: https://www.one4cars.com/afiliar_clientes.php/
7. Consulta de productos: https://www.one4cars.com/consulta_productos.php/
8. Seguimiento Despacho: https://www.one4cars.com/despacho.php/
9. Asesor humano: operador revisará el caso.

--- PAUTAS ---
Validación de identidad antes de dar info privada.
Consultas de stock: pedir Marca, Modelo, Año.
Almacenes: General = bultos China, Intermedio = despacho inmediato.
Cero invención: si no tienes datos, redirige a humano.
`;
}

// --- INICIALIZAR BOT ---
async function startBot() {
    try {
        const { state, saveCreds } = await useMultiFileAuthState('auth_info');
        const { version } = await fetchLatestBaileysVersion();

        const sock = makeWASocket({ 
            version, auth: state, logger: pino({ level: 'silent' }), browser: ["ONE4CARS", "Chrome", "1.0.0"]
        });

        socketBot = sock;
        sock.ev.on('creds.update', saveCreds);

        // --- CONEXIÓN ---
        sock.ev.on('connection.update', (update) => {
            const { connection, lastDisconnect, qr } = update;
            if (qr) qrcode.toDataURL(qr, (err, url) => qrCodeData = url);

            if (connection === 'open') qrCodeData = "ONLINE ✅";

            if (connection === 'close') {
                const reason = (lastDisconnect.error instanceof Boom) ? lastDisconnect.error.output.statusCode : null;
                console.log("Desconectado. Razón:", reason);

                if (reason !== DisconnectReason.loggedOut) {
                    console.log("Intentando reconectar en 5s...");
                    setTimeout(() => startBot(), 5000);
                } else {
                    console.log("Sesión cerrada, necesita reescaneo QR.");
                    qrCodeData = "";
                }
            }
        });

        // --- MENSAJES ---
        sock.ev.on('messages.upsert', async ({ messages, type }) => {
            if (type !== 'notify') return;
            const msg = messages[0];
            if (!msg.message || msg.key.fromMe) return;

            const from = msg.key.remoteJid;
            const isGroup = from.endsWith('@g.us');
            if (isGroup) return; // NO RESPONDER EN GRUPOS
            if (global.controlManual[from]) return; // NO RESPONDER SI HUMANO

            const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").trim();
            if (!text) return;

            try {
                if (!apiKey) throw new Error("Key no configurada");
                const systemInstructions = await construirInstrucciones();

                const chat = model.startChat({
                    history: [
                        { role: "user", parts: [{ text: systemInstructions }] },
                        { role: "model", parts: [{ text: "Entendido. Soy ONE4-Bot, listo para asistir." }] }
                    ],
                    generationConfig: { maxOutputTokens: 800 }
                });

                const result = await chat.sendMessage(text);
                const response = result.response.text();
                await sock.sendMessage(from, { text: response });

            } catch (e) {
                console.error("Error en IA:", e);
                const fallback = "🚗 *ONE4-Bot:* Estamos actualizando sistemas. Aquí accesos rápidos:\n\n" +
                    "1️⃣ Pagos: https://www.one4cars.com/medios_de_pago.php/\n" +
                    "2️⃣ Estado de cuenta: https://www.one4cars.com/estado_de_cuenta.php/\n" +
                    "3️⃣ Precios: https://www.one4cars.com/lista_de_precios.php/\n" +
                    "4️⃣ Pedidos: https://www.one4cars.com/tomar_pedido.php/\n" +
                    "6️⃣ Registro: https://www.one4cars.com/afiliar_clientes.php/\n" +
                    "8️⃣ Despacho: https://www.one4cars.com/despacho.php/\n\nUn operador humano revisará su mensaje.";
                await sock.sendMessage(from, { text: fallback });
            }
        });

        console.log("ONE4-Bot iniciado correctamente.");

    } catch (err) {
        console.error("Fallo al iniciar el bot:", err);
        setTimeout(startBot, 5000);
    }
}

// --- SERVIDOR WEB ---
const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const header = `
        <header class="p-3 mb-4 border-bottom bg-dark text-white shadow">
            <div class="container d-flex justify-content-between align-items-center">
                <div class="d-flex align-items-center">
                    <h4 class="m-0 text-primary fw-bold">🚗 ONE4CARS</h4>
                    <span class="ms-3 badge bg-secondary d-none d-md-inline">Panel Administrativo</span>
                </div>
                <nav>
                    <a href="/" class="text-white me-3 text-decoration-none small">Estado Bot</a>
                    <a href="/cobranza" class="btn btn-outline-primary btn-sm fw-bold">COBRANZA</a>
                </nav>
            </div>
        </header>`;

    if (parsedUrl.pathname === '/cobranza') {
        try {
            const v = await cobranza.obtenerVendedores();
            const z = await cobranza.obtenerZonas();
            const d = await cobranza.obtenerListaDeudores(parsedUrl.query);
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.write(`<!-- Aquí tu HTML de cobranza completo -->`);
            res.end();
        } catch (e) { res.end(`Error SQL: ${e.message}`); }

    } else if (parsedUrl.pathname === '/enviar-cobranza' && req.method === 'POST') {
        let b = ''; req.on('data', c => b += c);
        req.on('end', () => {
            cobranza.ejecutarEnvioMasivo(socketBot, JSON.parse(b).facturas);
            res.end("OK");
        });

    } else {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
            <html>
            <head><link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet"></head>
            <body class="bg-light text-center">
                ${header}
                <div class="container py-5">
                    <div class="card shadow p-4 mx-auto" style="max-width: 450px;">
                        <h4 class="mb-4">Status de Conexión</h4>
                        <div class="mb-4">
                            ${qrCodeData.startsWith('data') 
                                ? `<img src="${qrCodeData}" class="border shadow rounded p-2 bg-white" style="width: 250px;">` 
                                : `<div class="alert alert-success fw-bold p-4 h2">${qrCodeData || "Iniciando..."}</div>`
                            }
                        </div>
                        <p class="text-muted small">Escanee el código para activar ONE4CARS</p>
                        <p class="text-primary fw-bold small">Bot Dinámico con IA + API Dólar Activo</p>
                        <hr>
                        <a href="/cobranza" class="btn btn-primary w-100 fw-bold py-2">IR AL PANEL DE COBRANZA</a>
                    </div>
                </div>
            </body>
            </html>`);
    }
});

// --- INICIAR SERVIDOR Y BOT ---
server.listen(port, '0.0.0.0', () => { startBot(); });