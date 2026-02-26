const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode');
const http = require('http');
const url = require('url');
const pino = require('pino');
const axios = require('axios'); // API para el dólar
const { GoogleGenerativeAI } = require("@google/generative-ai");
const cobranza = require('./cobranza');

// --- CONFIGURACIÓN DE IA (ONE4CARS 2026) ---
const apiKey = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(apiKey);
const model = genAI.getGenerativeModel({ 
    model: "gemini-2.5-flash", 
    generationConfig: { temperature: 0.6, maxOutputTokens: 1000 }
});

let qrCodeData = "";
let socketBot = null;
const port = process.env.PORT || 10000;

/**
 * RUTINA PARA OBTENER EL DÓLAR (API)
 * Como solicitaste, esta función busca la cotización real.
 */
async function getDolar() {
    try {
        const response = await axios.get('https://pydolarve.org/api/v1/dollar?page=bcv', { timeout: 5000 }); 
        const bcv = response.data.monitors.bcv.price;
        const paralelo = response.data.monitors.enparalelovzla.price;
        return `📈 *COTIZACIÓN ACTUAL:* \n- BCV: Bs. ${bcv}\n- Paralelo: Bs. ${paralelo}`;
    } catch (e) {
        return "📈 *Tasa del Día:* Por favor, consulte con administración para la tasa exacta de facturación.";
    }
}

// DEFINICIÓN DE LAS 9 OPCIONES (COMPLETA)
const MENU_COMPLETO = `🛠️ *MENÚ DE OPCIONES ONE4CARS* 🚗

1. 💰 *Medios de pago:* https://www.one4cars.com/medios_de_pago.php/
2. 📄 *Estado de cuenta:* https://www.one4cars.com/estado_de_cuenta.php/
3. 🏷️ *Lista de precios:* https://www.one4cars.com/lista_de_precios.php/
4. 🛒 *Tomar pedido:* https://www.one4cars.com/tomar_pedido.php/
5. 👥 *Mis clientes/Vendedores:* https://www.one4cars.com/mis_clientes.php/
6. 📝 *Afiliar cliente:* https://www.one4cars.com/afiliar_clientes.php/
7. 🔍 *Consulta de productos:* https://www.one4cars.com/consulta_productos.php/
8. 🚚 *Seguimiento Despacho:* https://www.one4cars.com/despacho.php/
9. 👨‍💼 *Asesor Humano:* Un operador le atenderá en breve.`;

// PROMPT DE CONOCIMIENTOS PARA LA IA
const knowledgeBase = (tasa) => `Eres el Asistente Inteligente de ONE4CARS. 
Empresa importadora de autopartes desde China (Venezuela 2026).
Tasa: ${tasa}.

INSTRUCCIONES DE COMPORTAMIENTO:
- NO digas que eres Juan. Tú eres el Asistente de ONE4CARS.
- Sé amable e indaga: "¿En qué puedo apoyarte hoy con tus repuestos?"
- Si el cliente es VENDEDOR, enfócate en ayudarlo con Tomar Pedidos y Gestión de Clientes.
- Si pide PRECIOS, envíale: https://www.one4cars.com/lista_de_precios.php/
- Si pide el MENÚ, envía las 9 opciones completas.
- Si el cliente es curioso, sospecha su necesidad y guíalo al link correcto.
- NO seas repetitivo.`;

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
            const tasaHoy = await getDolar();

            // RESPUESTAS DIRECTAS (No pasan por IA para evitar fallos)
            if (textLow === "menú" || textLow === "menu" || textLow === "opciones") {
                return await sock.sendMessage(from, { text: MENU_COMPLETO });
            }

            if (textLow.includes("tasa") || textLow.includes("bcv") || textLow.includes("dolar")) {
                return await sock.sendMessage(from, { text: `${tasaHoy}\n\n¿Deseas consultar la disponibilidad de algún producto con esta tasa?` });
            }

            // PROCESO DE INDAGACIÓN CON IA
            const result = await model.generateContent(`${knowledgeBase(tasaHoy)}\n\nCliente: ${text}\nAsistente:`);
            const response = await result.response;
            let finalMsg = response.text();

            await sock.sendMessage(from, { text: finalMsg });

        } catch (e) {
            console.error("Error en flujo principal:", e);
            // Fallback: Mensaje amable + menú en caso de que todo falle
            await sock.sendMessage(from, { text: `¡Hola! 👋 Bienvenido a ONE4CARS. Para ayudarte mejor, aquí tienes nuestras opciones principales:\n\n${MENU_COMPLETO}` });
        }
    });
}

// --- SERVIDOR HTTP CON TODO EL SISTEMA DE COBRANZA Y HEADER PHP ---
const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    
    const header = `
        <header class="p-3 mb-4 border-bottom bg-dark text-white shadow">
            <div class="container d-flex justify-content-between align-items-center">
                <div class="d-flex align-items-center">
                    <h4 class="m-0 text-primary fw-bold">🚗 ONE4CARS</h4>
                    <span class="ms-3 badge bg-secondary d-none d-md-inline">Administración v2026</span>
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
                </head>
                <body class="bg-light">
                    ${header}
                    <div class="container-fluid px-4">
                        <div class="card shadow-sm mb-4">
                            <div class="card-body">
                                <h5 class="mb-3 text-muted">Filtrar Cuentas por Cobrar</h5>
                                <form class="row g-2">
                                    <div class="col-md-3">
                                        <select name="vendedor" class="form-select">
                                            <option value="">-- Vendedor --</option>
                                            ${v.map(i => `<option value="${i.nombre}">${i.nombre}</option>`).join('')}
                                        </select>
                                    </div>
                                    <div class="col-md-3">
                                        <select name="zona" class="form-select">
                                            <option value="">-- Zona --</option>
                                            ${z.map(i => `<option value="${i.zona}">${i.zona}</option>`).join('')}
                                        </select>
                                    </div>
                                    <div class="col-md-2">
                                        <input type="number" name="dias" class="form-control" placeholder="Días" value="${parsedUrl.query.dias || 0}">
                                    </div>
                                    <div class="col-md-4">
                                        <button class="btn btn-primary w-100 fw-bold">ACTUALIZAR LISTADO</button>
                                    </div>
                                </form>
                            </div>
                        </div>

                        <div class="card shadow-sm">
                            <div class="table-responsive" style="max-height: 550px;">
                                <table class="table table-hover align-middle m-0">
                                    <thead class="table-dark">
                                        <tr class="text-center">
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
                                            <tr class="text-center">
                                                <td><input type="checkbox" class="rowCheck form-check-input" value='${JSON.stringify(i)}'></td>
                                                <td class="text-start"><strong>${i.nombres}</strong></td>
                                                <td><span class="badge bg-light text-dark">${i.nro_factura}</span></td>
                                                <td class="text-danger fw-bold">$${parseFloat(i.saldo_pendiente).toFixed(2)}</td>
                                                <td class="text-primary">Bs. ${parseFloat(i.saldo_bolivares).toFixed(2)}</td>
                                                <td><span class="badge ${i.dias_transcurridos > 15 ? 'bg-danger' : 'bg-success'}">${i.dias_transcurridos}</span></td>
                                            </tr>
                                        `).join('')}
                                    </tbody>
                                </table>
                            </div>
                            <div class="card-footer bg-white p-3">
                                <button onclick="enviar()" id="btnSend" class="btn btn-success btn-lg w-100 fw-bold shadow">🚀 ENVIAR RECORDATORIOS MASIVOS</button>
                            </div>
                        </div>
                    </div>
                    <script>
                        document.getElementById('selectAll').onclick = function() {
                            document.querySelectorAll('.rowCheck').forEach(c => c.checked = this.checked);
                        };
                        async function enviar() {
                            const selected = Array.from(document.querySelectorAll('.rowCheck:checked')).map(cb => JSON.parse(cb.value));
                            if(selected.length === 0) return alert('Seleccione clientes');
                            const btn = document.getElementById('btnSend');
                            btn.disabled = true; btn.innerText = 'ENVIANDO...';
                            await fetch('/enviar-cobranza', { 
                                method:'POST', 
                                headers: {'Content-Type': 'application/json'},
                                body: JSON.stringify({facturas:selected}) 
                            });
                            alert('Envío programado correctamente.');
                            btn.disabled = false; btn.innerText = '🚀 ENVIAR RECORDATORIOS MASIVOS';
                        }
                    </script>
                </body>
                </html>
            `);
            res.end();
        } catch (e) { res.end(`Error: ${e.message}`); }
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
                        <h4 class="mb-4">Conexión de IA ONE4CARS</h4>
                        ${qrCodeData.startsWith('data') 
                            ? `<img src="${qrCodeData}" class="border rounded p-2 shadow-sm mb-3">` 
                            : `<div class="alert alert-success fw-bold p-4 h2">${qrCodeData || "INICIANDO..."}</div>`
                        }
                        <p class="text-muted small">Escanee para activar la gestión de autopartes</p>
                        <hr>
                        <a href="/cobranza" class="btn btn-primary w-100 fw-bold">PANEL DE COBRANZA</a>
                    </div>
                </div>
            </body>
            </html>`);
    }
});

server.listen(port, '0.0.0.0', () => { startBot(); });
