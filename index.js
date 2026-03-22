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

// --- CONFIGURACIÓN DE IA (ONE4CARS 2026) ---
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
global.controlManual = {}; // Chats donde un humano tomó control

function activarControlManual(jid) { global.controlManual[jid] = true; }
function desactivarControlManual(jid) { delete global.controlManual[jid]; }

// --- FUNCIONES AUXILIARES ---
function obtenerTasa(apiUrl) {
    return new Promise((resolve) => {
        https.get(apiUrl, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { const json = JSON.parse(data); resolve(json.promedio || null); }
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
ROL: Eres ONE4-Bot, asistente experto de ONE4CARS, importadora de autopartes de China a Venezuela.
FECHA Y HORA ACTUAL: ${fecha}

--- DATOS ECONÓMICOS EN TIEMPO REAL ---
Dólar Oficial (BCV): ${txtOficial}
Dólar Paralelo: ${txtParalelo}

--- 1. IDENTIDAD Y TONO ---
- Tono profesional, servicial y venezolano.
- Bienvenida cordial aleatoria.
- Lenguaje formal: "Estimado cliente", "A su orden", "Un gusto".

--- 2. ENLACES OFICIALES ---
Medios de pago -> https://www.one4cars.com/medios_de_pago.php/
Estado de cuenta -> https://www.one4cars.com/estado_de_cuenta.php/
Lista de precios -> https://www.one4cars.com/lista_de_precios.php/
Tomar pedido -> https://www.one4cars.com/tomar_pedido.php/
Mis clientes/Vendedores -> https://www.one4cars.com/mis_clientes.php/
Afiliar cliente -> https://www.one4cars.com/afiliar_clientes.php/
Consulta de productos -> https://www.one4cars.com/consulta_productos.php/
Seguimiento Despacho -> https://www.one4cars.com/despacho.php/
Asesor Humano -> Un operador revisará el caso.

--- 3. PAUTAS EXPERTO ---
- Validación de identidad antes de dar información privada.
- Consultas de stock: pedir Marca, Modelo y Año.
- Explica importancia de repuestos usando ONE4CARS.
- Almacenes: General = Bultos de China, Intermedio = Despacho inmediato.

--- 4. REGLAS ---
- No inventar precios.
- Explicar venta al mayor si el cliente es detal.
- Asignación de vendedores: validar identidad en la base interna.

Responde solo basándote en lo anterior, usa emojis 🚗 📦 🔧, tono venezolano, profesional y de empresa.
`;
}

// --- INICIALIZAR BOT ---
async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({ 
        version, auth: state, logger: pino({ level: 'silent' }), browser: ["ONE4CARS", "Chrome", "1.0.0"]
    });

    socketBot = sock;
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (u) => {
        const { connection, lastDisconnect, qr } = u;
        if (qr) qrcode.toDataURL(qr, (err, url) => qrCodeData = url);
        if (connection === 'open') qrCodeData = "ONLINE ✅";
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) setTimeout(startBot, 5000);
        }
    });

    // --- EVENTO DE MENSAJES ---
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        const isGroup = from.endsWith('@g.us');

        if (isGroup) return; // NO RESPONDER EN GRUPOS
        if (global.controlManual[from]) return; // NO RESPONDER SI HUMANO CONTROL

        const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").trim();
        if (!text) return;

        try {
            if (!apiKey) throw new Error("Key no configurada");
            const systemInstructions = await construirInstrucciones();

            const chat = model.startChat({
                history: [
                    { role: "user", parts: [{ text: systemInstructions }] },
                    { role: "model", parts: [{ text: "Entendido. Soy ONE4-Bot, listo para asistir con tono venezolano y experto en autopartes." }] }
                ],
                generationConfig: { maxOutputTokens: 800 }
            });

            const result = await chat.sendMessage(text);
            const response = result.response.text();
            await sock.sendMessage(from, { text: response });

        } catch (e) {
            console.error("Error en Gemini o API:", e);
            const saludoError = "🚗 *ONE4-Bot:* Estimado cliente, disculpe, estoy actualizando mis sistemas. 🔧\n\nPero aquí le dejo nuestros accesos directos:\n\n";
            const menuFallback = `
1️⃣ *Pagos:* https://www.one4cars.com/medios_de_pago.php/
2️⃣ *Edo. Cuenta:* https://www.one4cars.com/estado_de_cuenta.php/
3️⃣ *Precios:* https://www.one4cars.com/lista_de_precios.php/
4️⃣ *Pedidos:* https://www.one4cars.com/tomar_pedido.php/
6️⃣ *Registro:* https://www.one4cars.com/afiliar_clientes.php/
8️⃣ *Despacho:* https://www.one4cars.com/despacho.php/

Estamos a su orden. Un asesor humano revisará su mensaje en breve.`;

            await sock.sendMessage(from, { text: saludoError + menuFallback });
        }
    });
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
            res.write(`...`); // Mantener tu HTML completo de cobranza como ya lo tenías
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
            <head>
                <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
            </head>
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
                        <p class="text-muted small">Escanee el código para activar el servicio de ONE4CARS</p>
                        <p class="text-primary fw-bold small">Bot Dinámico con IA + API Dólar Activo</p>
                        <hr>
                        <a href="/cobranza" class="btn btn-primary w-100 fw-bold py-2">IR AL PANEL DE COBRANZA</a>
                    </div>
                </div>
            </body>
            </html>`);
    }
});

server.listen(port, '0.0.0.0', () => { startBot(); });