const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode');
const http = require('http');
const url = require('url');
const pino = require('pino');
const axios = require('axios');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const cobranza = require('./cobranza');

// --- CONFIGURACIÓN DE IA (ONE4CARS 2026) ---
const apiKey = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(apiKey);
const model = genAI.getGenerativeModel({ 
    model: "gemini-2.5-flash", 
    generationConfig: { temperature: 0.5, maxOutputTokens: 1000 }
});

let qrCodeData = "";
let socketBot = null;
const port = process.env.PORT || 10000;

// --- LÓGICA DE OBTENCIÓN DE DÓLAR (TRANSCRIPCIÓN FIEL DE TU PHP A JS) ---
// Simulamos el $_SESSION en un objeto global para el entorno de Node.js
let _SESSION = {};

async function obtener_dolar_con_cache(type) {
    const cache_key = 'dolar_' + type;
    const cache_time_key = 'dolar_' + type + '_time';
    const cache_duration = 900; // 15 min

    if (_SESSION[cache_key] && _SESSION[cache_time_key] && (Math.floor(Date.now() / 1000) - _SESSION[cache_time_key] < cache_duration)) {
        return parseFloat(_SESSION[cache_key]);
    }

    const targetUrl = (type === 'oficial') 
        ? "https://api.dolarvzla.com/public/exchange-rate" 
        : "https://ve.dolarapi.com/v1/dolares/paralelo";

    const get_fallback = () => {
        return (_SESSION[cache_key] && !isNaN(_SESSION[cache_key])) ? parseFloat(_SESSION[cache_key]) : 0.0;
    };

    try {
        const res = await axios.get(targetUrl, { timeout: 7000 });
        const data = res.data;
        let valor = (type === 'oficial') ? (data.current?.usd ?? 0.0) : (data.promedio ?? 0.0);

        if (valor <= 0) return get_fallback();

        _SESSION[cache_key] = parseFloat(valor);
        _SESSION[cache_time_key] = Math.floor(Date.now() / 1000);
        return parseFloat(valor);
    } catch (e) {
        return get_fallback();
    }
}

async function obtenerDolarOficial() { return await obtener_dolar_con_cache('oficial'); }
async function obtenerDolarParalelo() { return await obtener_dolar_con_cache('paralelo'); }

// --- COMPONENTES DE MENSAJERÍA ---
const MENU_COMPLETO = `🛠️ *MENÚ DE OPCIONES ONE4CARS* 🚗

1. 💰 *Medios de pago:* https://www.one4cars.com/medios_de_pago.php/
2. 📄 *Estado de cuenta:* https://www.one4cars.com/estado_de_cuenta.php/
3. 🏷️ *Lista de precios:* https://www.one4cars.com/lista_de_precios.php/
4. 🛒 *Tomar pedido:* https://www.one4cars.com/tomar_pedido.php/
5. 👥 *Mis clientes/Vendedores:* https://www.one4cars.com/mis_clientes.php/
6. 📝 *Afiliar cliente:* https://www.one4cars.com/afiliar_clientes.php/
7. 🔍 *Consulta de productos:* https://www.one4cars.com/consulta_productos.php/
8. 🚚 *Seguimiento Despacho:* https://www.one4cars.com/despacho.php/
9. 👨‍💼 *Asesor Humano:* Un operador revisará su requerimiento pronto.`;

const knowledgeBase = (oficial, paralelo) => `Eres el Asistente Inteligente de ONE4CARS (2026).
Empresa importadora de autopartes desde China.
Dólar Oficial (BCV): Bs. ${oficial} | Dólar Paralelo: Bs. ${paralelo}.

REGLAS:
- No eres Juan. Eres el asistente.
- Si el usuario parece interesado en algo, indaga amablemente antes de soltar links.
- Si pide la tasa, dala de inmediato.
- Si es VENDEDOR, prioriza las opciones 4 y 5.
- Si pide el menú o no sabe qué hacer, envía las 9 opciones completas.
- No seas repetitivo.`;

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const { version } = await fetchLatestBaileysVersion();
    
    const sock = makeWASocket({ 
        version, 
        auth: state, 
        logger: pino({ level: 'silent' }), 
        browser: ["ONE4CARS BOT", "Chrome", "1.0.0"]
    });

    socketBot = sock;
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (u) => {
        const { connection, lastDisconnect, qr } = u;
        if (qr) qrcode.toDataURL(qr, (err, url) => qrCodeData = url);
        if (connection === 'open') { qrCodeData = "ONLINE ✅"; }
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) setTimeout(startBot, 5000);
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        const text = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").trim();
        const textLow = text.toLowerCase();

        try {
            const dolarOficial = await obtenerDolarOficial();
            const dolarParalelo = await obtenerDolarParalelo();

            if (textLow === "menu" || textLow === "menú" || textLow === "opciones") {
                return await sock.sendMessage(from, { text: MENU_COMPLETO });
            }

            if (textLow.includes("tasa") || textLow.includes("bcv") || textLow.includes("dolar")) {
                return await sock.sendMessage(from, { text: `📈 *TASAS DE HOY*\nOficial: Bs. ${dolarOficial}\nParalelo: Bs. ${dolarParalelo}\n\n¿Deseas consultar algún precio?` });
            }

            const result = await model.generateContent(`${knowledgeBase(dolarOficial, dolarParalelo)}\n\nCliente: ${text}\nAsistente (Indaga amablemente):`);
            const response = await result.response;
            await sock.sendMessage(from, { text: response.text() });

        } catch (e) {
            await sock.sendMessage(from, { text: "🚗 *ONE4CARS:* Hola, ¿en qué puedo ayudarte hoy? Si deseas ver nuestras opciones escribe *MENU*." });
        }
    });
}

// --- SERVIDOR HTTP CON HEADER PHP Y PANEL DE COBRANZA COMPLETO ---
const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    
    const header = `
        <header class="p-3 mb-4 border-bottom bg-dark text-white shadow">
            <div class="container d-flex justify-content-between align-items-center">
                <div class="d-flex align-items-center">
                    <h4 class="m-0 text-primary fw-bold">🚗 ONE4CARS</h4>
                    <span class="ms-3 badge bg-secondary d-none d-md-inline">Administración 2026</span>
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
            res.write(`
                <html>
                <head>
                    <title>Cobranza - ONE4CARS</title>
                    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
                    <style>
                        .table-container { max-height: 600px; overflow-y: auto; border: 1px solid #ddd; }
                        thead th { position: sticky; top: 0; background: #212529; color: white; z-index: 10; }
                    </style>
                </head>
                <body class="bg-light">
                    ${header}
                    <div class="container-fluid px-4">
                        <div class="card shadow-sm mb-4">
                            <div class="card-body">
                                <h3>Gestión de Cobranza</h3>
                                <form class="row g-2 mt-3">
                                    <div class="col-md-3">
                                        <label class="small fw-bold">Vendedor</label>
                                        <select name="vendedor" class="form-select">
                                            <option value="">-- Todos --</option>
                                            ${v.map(i => `<option value="${i.nombre}">${i.nombre}</option>`).join('')}
                                        </select>
                                    </div>
                                    <div class="col-md-3">
                                        <label class="small fw-bold">Zona</label>
                                        <select name="zona" class="form-select">
                                            <option value="">-- Todas --</option>
                                            ${z.map(i => `<option value="${i.zona}">${i.zona}</option>`).join('')}
                                        </select>
                                    </div>
                                    <div class="col-md-2">
                                        <label class="small fw-bold">Días</label>
                                        <input type="number" name="dias" class="form-control" value="${parsedUrl.query.dias || 0}">
                                    </div>
                                    <div class="col-md-4 d-flex align-items-end">
                                        <button class="btn btn-dark w-100 fw-bold">FILTRAR DEUDORES</button>
                                    </div>
                                </form>
                            </div>
                        </div>

                        <div class="card shadow-sm">
                            <div class="table-container rounded">
                                <table class="table table-hover table-sm text-center align-middle m-0">
                                    <thead>
                                        <tr>
                                            <th><input type="checkbox" id="selectAll" class="form-check-input"></th>
                                            <th class="text-start">Cliente</th>
                                            <th>Factura</th>
                                            <th>Saldo $</th>
                                            <th>Saldo Bs.</th>
                                            <th>Días</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${d.map(i => `
                                            <tr>
                                                <td><input type="checkbox" class="rowCheck form-check-input" value='${JSON.stringify(i)}'></td>
                                                <td class="text-start"><small><strong>${i.nombres}</strong></small></td>
                                                <td><span class="badge bg-light text-dark border">${i.nro_factura}</span></td>
                                                <td class="text-danger fw-bold">$${parseFloat(i.saldo_pendiente).toFixed(2)}</td>
                                                <td class="text-primary">Bs. ${parseFloat(i.saldo_bolivares).toFixed(2)}</td>
                                                <td><span class="badge ${i.dias_transcurridos > 15 ? 'bg-danger' : 'bg-success'}">${i.dias_transcurridos}</span></td>
                                            </tr>
                                        `).join('')}
                                    </tbody>
                                </table>
                            </div>
                            <div class="card-footer">
                                <button onclick="enviar()" id="btnSend" class="btn btn-success btn-lg w-100 fw-bold py-3 shadow">🚀 ENVIAR RECORDATORIOS MASIVOS</button>
                            </div>
                        </div>
                    </div>

                    <script>
                        document.getElementById('selectAll').onclick = function() {
                            document.querySelectorAll('.rowCheck').forEach(c => c.checked = this.checked);
                        }
                        async function enviar() {
                            const selected = Array.from(document.querySelectorAll('.rowCheck:checked')).map(cb => JSON.parse(cb.value));
                            if(selected.length === 0) return alert('Seleccione clientes');
                            const b = document.getElementById('btnSend');
                            b.disabled = true; b.innerText = 'ENVIANDO...';
                            await fetch('/enviar-cobranza', { 
                                method:'POST', 
                                headers: {'Content-Type': 'application/json'},
                                body: JSON.stringify({facturas:selected}) 
                            });
                            alert('Envío de mensajes iniciado.');
                            b.disabled = false; b.innerText = '🚀 ENVIAR RECORDATORIOS MASIVOS';
                        }
                    </script>
                </body>
                </html>
            `);
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
                        <h4 class="mb-4">Estatus Conexión WhatsApp</h4>
                        <div class="mb-4">
                            ${qrCodeData.startsWith('data') 
                                ? `<img src="${qrCodeData}" class="border shadow rounded p-2 bg-white" style="width: 250px;">` 
                                : `<div class="alert alert-success fw-bold p-4 h2">${qrCodeData || "Iniciando..."}</div>`
                            }
                        </div>
                        <p class="text-muted small">Escanee el código para activar ONE4CARS</p>
                        <hr>
                        <a href="/cobranza" class="btn btn-primary w-100 fw-bold py-2">IR AL PANEL DE COBRANZA</a>
                    </div>
                </div>
            </body>
            </html>`);
    }
});

server.listen(port, '0.0.0.0', () => { startBot(); });
