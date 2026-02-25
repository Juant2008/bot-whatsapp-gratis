const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode');
const http = require('http');
const url = require('url');
const pino = require('pino');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const cobranza = require('./cobranza');

// --- CONFIGURACIÓN IA GEMINI ---
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-pro" });

let qrCodeData = "";
let socketBot = null;
const port = process.env.PORT || 10000;

// --- BASE DE CONOCIMIENTOS (9 OPCIONES COMPLETAS) ---
const knowledgeBase = `
Eres el asistente virtual de ONE4CARS. Atiende de forma amable y precisa. 
Si el cliente pregunta por estos temas, DEBES enviar el link exacto:

1. Medios de pago / Cómo pagar: https://www.one4cars.com/medios_de_pago.php/
2. Estado de cuenta / Cuánto debo: https://www.one4cars.com/estado_de_cuenta.php/
3. Lista de precios: https://www.one4cars.com/lista_de_precios.php/
4. Tomar pedido / Hacer pedido: https://www.one4cars.com/tomar_pedido.php/
5. Mis clientes / Cartera (Vendedores): https://www.one4cars.com/mis_clientes.php/
6. Afiliar cliente: https://www.one4cars.com/afiliar_clientes.php/
7. Ficha técnica / Consulta productos: https://www.one4cars.com/consulta_productos.php/
8. Despacho / Seguimiento de envío: https://www.one4cars.com/despacho.php/
9. Asesor Humano: Indica que un agente se comunicará a la brevedad.

Si no entiendes la consulta, pide amablemente que esperen a un asesor humano.
`;

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        auth: state,
        printQRInTerminal: false,
        logger: pino({ level: 'error' }),
        browser: ["ONE4CARS", "Chrome", "1.0.0"]
    });

    socketBot = sock;
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            qrcode.toDataURL(qr, (err, url) => { qrCodeData = url; });
        }
        if (connection === 'close') {
            const statusCode = (lastDisconnect.error instanceof Boom)?.output?.statusCode;
            if (statusCode !== DisconnectReason.loggedOut) setTimeout(() => startBot(), 5000);
        } else if (connection === 'open') {
            qrCodeData = "BOT ONLINE ✅";
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        const body = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").trim();
        if (!body) return;

        try {
            const prompt = `${knowledgeBase}\n\nCliente: "${body}"\nRespuesta corta:`;
            const result = await model.generateContent(prompt);
            await sock.sendMessage(from, { text: result.response.text() });
        } catch (e) { console.error("Error en IA Gemini"); }
    });
}

// --- SERVIDOR HTTP (UN SOLO LISTEN) ---
const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const path = parsedUrl.pathname;

    if (path === '/cobranza') {
        try {
            const vendedores = await cobranza.obtenerVendedores();
            const zonas = await cobranza.obtenerZonas();
            const deudores = await cobranza.obtenerListaDeudores(parsedUrl.query);

            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.write(`
                <html>
                <head>
                    <title>ONE4CARS - Panel de Cobranza</title>
                    <meta name="viewport" content="width=device-width, initial-scale=1">
                    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
                    <style>
                        .sticky-header { position: sticky; top: 0; background: white; z-index: 1000; padding: 10px 0; }
                    </style>
                </head>
                <body class="bg-light">
                    <div class="container bg-white shadow-sm min-vh-100 p-4">
                        <div class="sticky-header border-bottom mb-3">
                            <div class="d-flex justify-content-between align-items-center">
                                <h4 class="text-primary m-0">📊 Gestión de Cobranza ONE4CARS</h4>
                                <a href="/" class="btn btn-outline-secondary btn-sm">Estado Bot</a>
                            </div>
                        </div>

                        <form method="GET" class="row g-2 mb-4">
                            <div class="col-md-4 col-6">
                                <label class="small fw-bold">Vendedor</label>
                                <select name="vendedor" class="form-select form-select-sm">
                                    <option value="">Todos</option>
                                    ${vendedores.map(v => `<option value="${v.nombre}" ${parsedUrl.query.vendedor === v.nombre ? 'selected' : ''}>${v.nombre}</option>`).join('')}
                                </select>
                            </div>
                            <div class="col-md-4 col-6">
                                <label class="small fw-bold">Zona</label>
                                <select name="zona" class="form-select form-select-sm">
                                    <option value="">Todas</option>
                                    ${zonas.map(z => `<option value="${z.zona}" ${parsedUrl.query.zona === z.zona ? 'selected' : ''}>${z.zona}</option>`).join('')}
                                </select>
                            </div>
                            <div class="col-md-2 col-6">
                                <label class="small fw-bold">Días Venc.</label>
                                <input type="number" name="dias" class="form-control form-control-sm" value="${parsedUrl.query.dias || 0}">
                            </div>
                            <div class="col-md-2 col-6 d-flex align-items-end">
                                <button type="submit" class="btn btn-primary btn-sm w-100">Filtrar</button>
                            </div>
                        </form>

                        <div class="table-responsive" style="max-height: 60vh;">
                            <table class="table table-hover table-sm border">
                                <thead class="table-dark sticky-top">
                                    <tr>
                                        <th><input type="checkbox" id="checkAll" class="form-check-input"></th>
                                        <th>Cliente / Factura</th>
                                        <th>Saldo ($)</th>
                                        <th>Días</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${deudores.map(d => `
                                        <tr>
                                            <td><input type="checkbox" name="factura" class="rowCheck form-check-input" value='${JSON.stringify(d)}'></td>
                                            <td>
                                                <div class="fw-bold" style="font-size: 0.85rem;">${d.nombres}</div>
                                                <small class="text-muted">Nro: ${d.nro_factura}</small>
                                            </td>
                                            <td class="text-danger fw-bold">${parseFloat(d.saldo_pendiente).toFixed(2)}</td>
                                            <td><span class="badge ${d.dias_transcurridos > 30 ? 'bg-danger' : 'bg-warning text-dark'}">${d.dias_transcurridos}</span></td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>

                        <button id="btnEnviar" onclick="procesarEnvio()" class="btn btn-success w-100 mt-4 py-3 fw-bold shadow">
                            🚀 ENVIAR MENSAJES POR WHATSAPP
                        </button>
                    </div>

                    <script>
                        document.getElementById('checkAll').onclick = function() {
                            const checks = document.querySelectorAll('.rowCheck');
                            checks.forEach(c => c.checked = this.checked);
                        };

                        async function procesarEnvio() {
                            const seleccionados = Array.from(document.querySelectorAll('.rowCheck:checked')).map(cb => JSON.parse(cb.value));
                            if (seleccionados.length === 0) return alert('Selecciona al menos una factura.');
                            
                            if(!confirm('¿Enviar recordatorio a ' + seleccionados.length + ' clientes?')) return;

                            const btn = document.getElementById('btnEnviar');
                            btn.disabled = true;
                            btn.innerText = 'ENVIANDO... POR FAVOR ESPERE';

                            try {
                                const response = await fetch('/enviar-cobranza', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ facturas: seleccionados })
                                });
                                const resText = await response.text();
                                alert(resText);
                            } catch (e) {
                                alert('Error al procesar el envío masivo.');
                            } finally {
                                btn.disabled = false;
                                btn.innerText = '🚀 ENVIAR MENSAJES POR WHATSAPP';
                            }
                        }
                    </script>
                </body>
                </html>
            `);
            res.end();
        } catch (error) {
            res.end("Error en la conexión con la base de datos.");
        }
    } 
    else if (path === '/enviar-cobranza' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', async () => {
            try {
                const data = JSON.parse(body);
                if (socketBot && data.facturas) {
                    cobranza.ejecutarEnvioMasivo(socketBot, data.facturas);
                    res.end('Envío masivo iniciado en segundo plano.');
                } else {
                    res.writeHead(400); res.end('Error: Bot no conectado.');
                }
            } catch (e) { res.writeHead(500); res.end('Error de servidor.'); }
        });
    } 
    else {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        if (qrCodeData.includes("data:image")) {
            res.write(`<div style="text-align:center; padding-top:50px;">
                <h2>Vincular ONE4CARS</h2>
                <img src="${qrCodeData}" width="300" style="border:5px solid #ccc; border-radius:10px;">
                <p>Escanea el código para activar el sistema.</p>
                <a href="/cobranza" style="font-weight:bold; color:blue;">Ir al Panel de Cobranza</a>
            </div>`);
        } else {
            res.write(`
                <div style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100vh; font-family:sans-serif;">
                    <h1 style="color:#0d6efd;">🚗 ONE4CARS</h1>
                    <div style="padding:20px; border-radius:10px; background:#e9ecef; margin-bottom:20px;">
                        <strong>Estado:</strong> ${qrCodeData || "Iniciando sistema..."}
                    </div>
                    <a href="/cobranza" style="padding:15px 30px; background:#198754; color:white; text-decoration:none; border-radius:5px; font-weight:bold;">ENTRAR AL PANEL DE COBRANZA</a>
                </div>
            `);
        }
        res.end();
    }
});

// --- EL LISTEN SOLO OCURRE UNA VEZ AQUÍ ---
server.listen(port, '0.0.0.0', () => {
    console.log(`>>> Servidor ONE4CARS corriendo en puerto ${port}`);
});

startBot();
