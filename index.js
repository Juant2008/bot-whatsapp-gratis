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
    generationConfig: { temperature: 0.4, maxOutputTokens: 1000 }
});

let qrCodeData = "";
let socketBot = null;
const port = process.env.PORT || 10000;

// FUNCIÓN PARA OBTENER PRECIO DEL DÓLAR (BCV Y PARALELO)
async function getDolar() {
    try {
        const response = await axios.get('https://pydolarve.org/api/v1/dollar?page=bcv'); 
        const bcv = response.data.monitors.bcv.price;
        const paralelo = response.data.monitors.enparalelovzla.price;
        return `📈 *TASAS OFICIALES:* BCV: Bs. ${bcv} | Paralelo: Bs. ${paralelo}`;
    } catch (e) {
        console.error("Error obteniendo dólar:", e.message);
        return "📈 *Tasa del Día:* Consultar con administración para el valor exacto de hoy.";
    }
}

// DEFINICIÓN ÚNICA DEL MENÚ COMPLETO
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

// BASE DE CONOCIMIENTOS PARA LA IA
const knowledgeBase = (tasa) => `Eres el Asistente Inteligente de ONE4CARS. 
IMPORTANTE: Tu nombre NO es Juan. Juan es probablemente el cliente o el dueño. Tú eres la IA de la empresa.

INFORMACIÓN DE LA EMPRESA:
Importamos autopartes desde China. Almacén General (bultos) e Intermedio (stock detallado).
Tasa actual: ${tasa}

REGLAS DE RESPUESTA:
1. Sé muy amable y pregunta siempre en qué puedes ayudar.
2. Si el cliente pregunta por la TASA, dásela directamente usando el dato de arriba.
3. Si el cliente pide el "menú", "opciones" o pregunta "qué puedes hacer", DEBES enviar las 9 opciones completas.
4. Si detectas que busca precios, envía el link de lista de precios: https://www.one4cars.com/lista_de_precios.php/
5. Indaga con astucia: Si el cliente está indeciso, ofrece enviarle el menú completo.
6. NO inventes tasas si no las tienes.`;

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
            const tasaActual = await getDolar();

            // RESPUESTAS PRIORITARIAS (Hardcoded para evitar fallos de la IA)
            if (textLow.includes("menu") || textLow.includes("opciones") || textLow === "lista") {
                return await sock.sendMessage(from, { text: `¡Claro que sí! Aquí tienes todas nuestras herramientas disponibles:\n\n${MENU_COMPLETO}\n\n${tasaActual}` });
            }

            if (textLow.includes("tasa") || textLow.includes("bcv") || textLow.includes("dolar")) {
                return await sock.sendMessage(from, { text: `Con gusto le informo la tasa del día:\n\n${tasaActual}\n\n¿Desea que le ayude a calcular algún presupuesto o prefiere ver la lista de precios?` });
            }

            // CONSULTA A LA IA PARA INDAGACIÓN AMABLE
            const result = await model.generateContent(`${knowledgeBase(tasaActual)}\n\nCliente: ${text}\nAsistente:`);
            const response = await result.response;
            await sock.sendMessage(from, { text: response.text() });

        } catch (e) {
            console.error("Error en flujo:", e);
            // Fallback SEGURO con las 9 opciones, nunca chucuto
            await sock.sendMessage(from, { text: `Lo siento, tuve un problema técnico. Aquí tienes nuestro menú completo para ayudarte:\n\n${MENU_COMPLETO}` });
        }
    });
}

// --- SERVIDOR WEB COMPLETO CON HEADER PHP Y PANEL DE COBRANZA ---
const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    
    const header = `
        <header class="p-3 mb-4 border-bottom bg-dark text-white shadow">
            <div class="container d-flex justify-content-between align-items-center">
                <div class="d-flex align-items-center">
                    <h4 class="m-0 text-primary fw-bold">🚗 ONE4CARS</h4>
                    <span class="ms-3 badge bg-secondary d-none d-md-inline">Almacén General e Intermedio</span>
                </div>
                <nav>
                    <a href="/" class="text-white me-3 text-decoration-none small">Estado Bot</a>
                    <a href="/cobranza" class="btn btn-outline-primary btn-sm fw-bold">GESTIÓN DE COBRANZA</a>
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
                        .table-container { max-height: 650px; overflow-y: auto; }
                        thead th { position: sticky; top: 0; background: #212529; color: white; z-index: 10; }
                    </style>
                </head>
                <body class="bg-light">
                    ${header}
                    <div class="container-fluid px-4">
                        <div class="card shadow-sm mb-4">
                            <div class="card-body">
                                <h3 class="card-title">Listado de Cuentas por Cobrar</h3>
                                <form class="row g-3 mt-2">
                                    <div class="col-md-3">
                                        <label class="form-label small fw-bold">Filtrar por Vendedor</label>
                                        <select name="vendedor" class="form-select">
                                            <option value="">Todos los Vendedores</option>
                                            ${v.map(i => `<option value="${i.nombre}" ${parsedUrl.query.vendedor === i.nombre ? 'selected' : ''}>${i.nombre}</option>`).join('')}
                                        </select>
                                    </div>
                                    <div class="col-md-3">
                                        <label class="form-label small fw-bold">Filtrar por Zona</label>
                                        <select name="zona" class="form-select">
                                            <option value="">Todas las Zonas</option>
                                            ${z.map(i => `<option value="${i.zona}" ${parsedUrl.query.zona === i.zona ? 'selected' : ''}>${i.zona}</option>`).join('')}
                                        </select>
                                    </div>
                                    <div class="col-md-2">
                                        <label class="form-label small fw-bold">Días Vencimiento</label>
                                        <input type="number" name="dias" class="form-control" value="${parsedUrl.query.dias || 0}">
                                    </div>
                                    <div class="col-md-4 d-flex align-items-end">
                                        <button type="submit" class="btn btn-primary w-100 fw-bold">APLICAR FILTROS</button>
                                    </div>
                                </form>
                            </div>
                        </div>

                        <div class="card shadow-sm">
                            <div class="table-container">
                                <table class="table table-striped table-hover align-middle mb-0">
                                    <thead>
                                        <tr class="text-center">
                                            <th><input type="checkbox" id="selectAll" class="form-check-input"></th>
                                            <th class="text-start">Cliente</th>
                                            <th>Factura</th>
                                            <th>Fecha</th>
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
                                                <td><span class="badge bg-secondary">${i.nro_factura}</span></td>
                                                <td>${i.fecha_factura || '-'}</td>
                                                <td class="text-danger fw-bold">$${parseFloat(i.saldo_pendiente).toFixed(2)}</td>
                                                <td class="text-primary">Bs. ${parseFloat(i.saldo_bolivares).toFixed(2)}</td>
                                                <td><span class="badge ${i.dias_transcurridos > 7 ? 'bg-danger' : 'bg-warning'}">${i.dias_transcurridos} días</span></td>
                                            </tr>
                                        `).join('')}
                                    </tbody>
                                </table>
                            </div>
                            <div class="card-footer p-3">
                                <button onclick="enviarRecordatorios()" id="btnSend" class="btn btn-success btn-lg w-100 fw-bold shadow">
                                    🚀 ENVIAR RECORDATORIO DE PAGO A SELECCIONADOS
                                </button>
                            </div>
                        </div>
                    </div>

                    <script>
                        document.getElementById('selectAll').onclick = function() {
                            document.querySelectorAll('.rowCheck').forEach(c => c.checked = this.checked);
                        };

                        async function enviarRecordatorios() {
                            const selected = Array.from(document.querySelectorAll('.rowCheck:checked')).map(cb => JSON.parse(cb.value));
                            if(selected.length === 0) return alert('Por favor, seleccione al menos una factura.');
                            
                            const btn = document.getElementById('btnSend');
                            btn.disabled = true;
                            btn.innerText = 'PROCESANDO ENVÍOS...';

                            try {
                                await fetch('/enviar-cobranza', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ facturas: selected })
                                });
                                alert('Los recordatorios se están enviando en segundo plano.');
                            } catch (e) {
                                alert('Error al procesar el envío.');
                            } finally {
                                btn.disabled = false;
                                btn.innerText = '🚀 ENVIAR RECORDATORIO DE PAGO A SELECCIONADOS';
                            }
                        }
                    </script>
                </body>
                </html>
            `);
            res.end();
        } catch (e) {
            res.end(`Error en el sistema de cobranza: ${e.message}`);
        }
    } else if (parsedUrl.pathname === '/enviar-cobranza' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            const data = JSON.parse(body);
            cobranza.ejecutarEnvioMasivo(socketBot, data.facturas);
            res.end("Proceso iniciado");
        });
    } else {
        // PÁGINA DE ESTADO DEL BOT
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
            <html>
            <head>
                <title>ONE4CARS - Bot Status</title>
                <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
            </head>
            <body class="bg-light">
                ${header}
                <div class="container py-5">
                    <div class="card shadow mx-auto" style="max-width: 500px;">
                        <div class="card-header bg-primary text-white text-center fw-bold">ESTADO DEL SERVIDOR</div>
                        <div class="card-body text-center">
                            <div class="mb-4">
                                ${qrCodeData.startsWith('data') 
                                    ? `<img src="${qrCodeData}" class="img-fluid border p-2 shadow-sm">` 
                                    : `<div class="display-6 text-success fw-bold">${qrCodeData || "CONECTANDO..."}</div>`
                                }
                            </div>
                            <p class="text-muted small">${qrCodeData.startsWith('data') ? "Escanea el código QR para vincular WhatsApp" : "El sistema está operando correctamente"}</p>
                            <hr>
                            <div class="d-grid">
                                <a href="/cobranza" class="btn btn-dark fw-bold">ACCEDER AL PANEL DE COBRANZA</a>
                            </div>
                        </div>
                    </div>
                </div>
            </body>
            </html>`);
    }
});

server.listen(port, '0.0.0.0', () => { 
    console.log(`Servidor ONE4CARS corriendo en puerto ${port}`);
    startBot(); 
});
