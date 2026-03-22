// index.js - ONE4CARS BOT COMPLETO 2026
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode');
const http = require('http');
const https = require('https');
const url = require('url');
const pino = require('pino');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const cobranza = require('./cobranza');
const fs = require('fs');

const PORT = process.env.PORT || 10000;
const apiKey = process.env.GEMINI_API_KEY;

const genAI = new GoogleGenerativeAI(apiKey);
const model = genAI.getGenerativeModel({ 
    model: "gemini-2.5-flash", 
    generationConfig: { temperature: 0.7, maxOutputTokens: 1000 } 
});

let qrCodeData = "Iniciando...";
let socketBot = null;
let retryCount = 0;

// --- FUNCIONES AUXILIARES ---
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
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
    const fecha = new Date().toLocaleString('es-VE', { timeZone: 'America/Caracas' });
    return `
ROL: Eres ONE4-Bot, asistente experto de ONE4CARS.
FECHA: ${fecha}
Dólar Oficial: ${tasaOficial ? "Bs. "+tasaOficial : "No disponible"}
Dólar Paralelo: ${tasaParalelo ? "Bs. "+tasaParalelo : "No disponible"}

--- PAUTAS ---
- Profesional, cordial y venezolano.
- Saludo dinámico y personalizado.
- Antes de dar saldo o precios: solicitar RIF o cédula.
- Cero invención de precios: usar links oficiales.
- Filtro mayorista: mínimo $100.
- Asignación de vendedores: validar identidad.
- Usa emojis 🚗📦🔧 y tono amable.
`;
}

// --- BOT PRINCIPAL ---
async function startBot() {
    try {
        const { state, saveCreds } = await useMultiFileAuthState('auth_info');
        const { version } = await fetchLatestBaileysVersion();
        const sock = makeWASocket({
            version,
            auth: state,
            logger: pino({ level: 'silent' }),
            browser: ["ONE4CARS", "Chrome", "1.0.0"]
        });

        socketBot = sock;
        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', async (u) => {
            const { connection, lastDisconnect, qr } = u;

            if (qr) qrcode.toDataURL(qr, (_, url) => qrCodeData = url);
            if (connection === 'open') { 
                console.log("✅ CONECTADO - ONE4-Bot activo");
                qrCodeData = "ONLINE ✅";
                retryCount = 0;
            }

            if (connection === 'close') {
                const code = (lastDisconnect?.error instanceof Boom) ? lastDisconnect.error.output.statusCode : 0;
                console.log("❌ Conexión cerrada:", code);

                retryCount++;
                if (retryCount > 5) { console.log("⛔ Demasiados intentos, espera 60s"); await sleep(60000); }
                if (code === DisconnectReason.loggedOut) fs.rmSync('auth_info', { recursive: true, force: true });

                setTimeout(startBot, 10000);
            }
        });

        sock.ev.on('messages.upsert', async ({ messages, type }) => {
            if (type !== 'notify') return;
            const msg = messages[0];
            if (!msg.message) return;

            const from = msg.key.remoteJid;
            if (from.includes('@g.us')) return; // ignorar grupos
            const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").trim();
            if (!text) return;

            // 👤 Intervención humana pausa el bot
            if (msg.key.fromMe) {
                if (socketBot) console.log(`⚠️ Humano intervino: modo pausa`);
                return;
            }

            // --- IA ---
            try {
                const instrucciones = await construirInstrucciones();
                const chat = model.startChat({
                    history: [
                        { role:"user", parts:[{text: instrucciones}] },
                        { role:"model", parts:[{text:"Entendido. Soy ONE4-Bot listo para asistir."}] }
                    ],
                    generationConfig: { maxOutputTokens: 800 }
                });

                const r = await chat.sendMessage(text);
                await sock.sendMessage(from, { text: r.response.text() });

            } catch (e) {
                console.error("⚠️ Error IA:", e);
                const fallback = `
🚗 ONE4-Bot en mantenimiento
Accesos rápidos:
1️⃣ Pagos: https://www.one4cars.com/medios_de_pago.php/
2️⃣ Edo. Cuenta: https://www.one4cars.com/estado_de_cuenta.php/
3️⃣ Precios: https://www.one4cars.com/lista_de_precios.php/
4️⃣ Pedidos: https://www.one4cars.com/tomar_pedido.php/
6️⃣ Registro: https://www.one4cars.com/afiliar_clientes.php/
8️⃣ Despacho: https://www.one4cars.com/despacho.php/
`;
                await sock.sendMessage(from, { text: fallback });
            }
        });

    } catch (err) { console.error("Error al iniciar bot:", err); }
}

// --- SERVER WEB ---
const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const header = `<header class="p-3 mb-4 border-bottom bg-dark text-white shadow">
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

    // PANEL COBRANZA
    if (parsedUrl.pathname === '/cobranza') {
        try {
            const v = await cobranza.obtenerVendedores();
            const z = await cobranza.obtenerZonas();
            const d = await cobranza.obtenerListaDeudores(parsedUrl.query);
            res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'});
            res.end(await cobranza.generarHTML(v, z, d, header, parsedUrl.query));
        } catch (e) { res.end(`Error: ${e.message}`); }

    } else if (parsedUrl.pathname === '/enviar-cobranza' && req.method==='POST') {
        let b=''; req.on('data', c=>b+=c); req.on('end', ()=>{ cobranza.ejecutarEnvioMasivo(socketBot, JSON.parse(b).facturas); res.end("OK"); });
    } else {
        // ESTADO BOT
        res.writeHead(200, {'Content-Type':'text/html; charset=utf-8'});
        res.end(`
<html>
<head><link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet"></head>
<body class="bg-light text-center">
${header}
<div class="container py-5">
<div class="card shadow p-4 mx-auto" style="max-width:450px;">
<h4 class="mb-4">Status de Conexión</h4>
<div class="mb-4">
${qrCodeData.startsWith('data') ? `<img src="${qrCodeData}" class="border shadow rounded p-2 bg-white" style="width:250px;">`
: `<div class="alert alert-success fw-bold p-4 h2">${qrCodeData || "Iniciando..."}</div>`}
</div>
<p class="text-muted small">Escanee el QR para activar ONE4CARS</p>
<p class="text-primary fw-bold small">Bot + IA + API Dólar Activo</p>
<hr>
<a href="/cobranza" class="btn btn-primary w-100 fw-bold py-2">IR AL PANEL DE COBRANZA</a>
</div>
</div>
</body>
</html>
        `);
    }
});

// START SERVER
server.listen(PORT, '0.0.0.0', () => { startBot(); console.log("Servidor corriendo en puerto", PORT); });