const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode');
const http = require('http');
const url = require('url');
const pino = require('pino');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const cobranza = require('./cobranza');

// --- CONFIGURACIÓN DE IA SEGURA (LEE DESDE RENDER) ---
// Configura la variable GEMINI_API_KEY en el panel de Render para evitar bloqueos
const apiKey = process.env.GEMINI_API_KEY;
const genAI = new GoogleGenerativeAI(apiKey);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

let qrCodeData = "";
let socketBot = null;
const port = process.env.PORT || 10000;

// BASE DE CONOCIMIENTOS COMPLETA - ONE4CARS
const knowledgeBase = `Eres el asistente oficial de ONE4CARS. Empresa importadora de autopartes desde China a Venezuela.
Debes responder de forma profesional, amable y siempre proporcionando los enlaces correspondientes según la consulta:

1. Medios de pago: Información sobre transferencias, depósitos y pagos en divisas. Link: https://www.one4cars.com/medios_de_pago.php/
2. Estado de cuenta: Para que el cliente consulte sus facturas y saldos pendientes. Link: https://www.one4cars.com/estado_de_cuenta.php/
3. Lista de precios: Catálogo actualizado de productos y precios. Link: https://www.one4cars.com/lista_de_precios.php/
4. Tomar pedido: Sistema para que el cliente cargue sus pedidos directamente. Link: https://www.one4cars.com/tomar_pedido.php/
5. Mis clientes/Vendedores: Sección exclusiva para vendedores y gestión de cartera. Link: https://www.one4cars.com/mis_clientes.php/
6. Afiliar cliente: Registro para nuevos clientes que deseen comprar al mayor. Link: https://www.one4cars.com/afiliar_clientes.php/
7. Consulta de productos: Fichas técnicas, fotos y detalles de autopartes. Link: https://www.one4cars.com/consulta_productos.php/
8. Seguimiento Despacho: Estatus de la mercancía enviada y guías. Link: https://www.one4cars.com/despacho.php/
9. Asesor Humano: Si la duda es muy específica, indica que un operador revisará el caso a la brevedad posible.

Instrucción: Si el cliente pregunta algo general, resume los puntos principales. Si pregunta algo específico, dale el link directo.`;

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const { version } = await fetchLatestBaileysVersion();
    
    // Configuración del socket de WhatsApp
    const sock = makeWASocket({ 
        version, 
        auth: state, 
        logger: pino({ level: 'silent' }), 
        browser: ["ONE4CARS", "Chrome", "1.0.0"]
    });

    socketBot = sock;
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (u) => {
        const { connection, lastDisconnect, qr } = u;
        if (qr) qrcode.toDataURL(qr, (err, url) => qrCodeData = url);
        if (connection === 'open') {
            qrCodeData = "ONLINE ✅";
            console.log("ONE4CARS: Bot conectado y listo.");
        }
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) {
                console.log("Reconectando bot...");
                setTimeout(startBot, 5000);
            }
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        const text = (msg.message.conversation || 
                      msg.message.extendedTextMessage?.text || 
                      msg.message.imageMessage?.caption || "").trim();

        if (text.length < 1) return;

        try {
            // Verificamos si la API Key existe en Render
            if (!apiKey) {
                throw new Error("API_KEY_NOT_SET");
            }

            const prompt = `${knowledgeBase}\n\nPregunta del cliente: "${text}"\nRespuesta profesional ONE4CARS:`;
            const result = await model.generateContent(prompt);
            const response = await result.response;
            const replyText = response.text();
            
            if (replyText) {
                await sock.sendMessage(from, { text: replyText });
            }
        } catch (e) {
            console.error("Error en IA Gemini:", e.message);
            // Menú de emergencia si la IA falla (Bloqueo regional o falta de Key)
            const fallback = `🚗 *ONE4CARS - Asistente Virtual*\n\nHola, para ayudarte mejor por favor utiliza nuestros enlaces directos:\n\n1️⃣ *Pagos:* https://www.one4cars.com/medios_de_pago.php/\n2️⃣ *Estado de Cuenta:* https://www.one4cars.com/estado_de_cuenta.php/\n3️⃣ *Precios:* https://www.one4cars.com/lista_de_precios.php/\n4️⃣ *Pedidos:* https://www.one4cars.com/tomar_pedido.php/\n\nUn asesor humano también revisará tu mensaje pronto.`;
            await sock.sendMessage(from, { text: fallback });
        }
    });
}

const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    
    // HEADER OFICIAL ONE4CARS
    const header = `
        <header class="p-3 mb-4 border-bottom bg-dark text-white shadow">
            <div class="container d-flex justify-content-between align-items-center">
                <div class="d-flex align-items-center">
                    <h4 class="m-0 text-primary fw-bold">🚗 ONE4CARS</h4>
                    <span class="ms-3 badge bg-secondary">Importadora Autopartes</span>
                </div>
                <nav>
                    <a href="/" class="text-white me-3 text-decoration-none small">Estado QR</a>
                    <a href="/cobranza" class="btn btn-outline-primary btn-sm fw-bold">ZONA DE COBRANZA</a>
                </nav>
            </div>
        </header>`;

    if (parsedUrl.pathname === '/cobranza') {
        try {
            // OBTENER DATOS DESDE COBRANZA.JS (SQL)
            const vendedores = await cobranza.obtenerVendedores();
            const zonas = await cobranza.obtenerZonas();
            const deudores = await cobranza.obtenerListaDeudores(parsedUrl.query);

            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.write(`
                <!DOCTYPE html>
                <html lang="es">
                <head>
                    <meta charset="UTF-8">
                    <title>Panel de Cobranza - ONE4CARS</title>
                    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
                    <style>
                        .table-scroll { max-height: 550px; overflow-y: auto; border: 1px solid #dee2e6; }
                        thead th { position: sticky; top: 0; background-color: #212529; color: white; z-index: 10; }
                    </style>
                </head>
                <body class="bg-light">
                    ${header}
                    <div class="container bg-white shadow-sm p-4 rounded-3">
                        <h2 class="h4 mb-4 border-bottom pb-2">Gestión de Cuentas por Cobrar</h2>
                        
                        <form class="row g-2 mb-4 p-3 bg-light rounded shadow-sm border">
                            <div class="col-md-3">
                                <label class="form-label small fw-bold">Vendedor:</label>
                                <select name="vendedor" class="form-select form-select-sm">
                                    <option value="">-- Todos --</option>
                                    ${vendedores.map(v => `<option value="${v.nombre}" ${parsedUrl.query.vendedor === v.nombre ? 'selected' : ''}>${v.nombre}</option>`).join('')}
                                </select>
                            </div>
                            <div class="col-md-3">
                                <label class="form-label small fw-bold">Zona:</label>
                                <select name="zona" class="form-select form-select-sm">
                                    <option value="">-- Todas --</option>
                                    ${zonas.map(z => `<option value="${z.zona}" ${parsedUrl.query.zona === z.zona ? 'selected' : ''}>${z.zona}</option>`).join('')}
                                </select>
                            </div>
                            <div class="col-md-2">
                                <label class="form-label small fw-bold">Días Vencidos:</label>
                                <input type="number" name="dias" class="form-control form-control-sm" value="${parsedUrl.query.dias || 0}">
                            </div>
                            <div class="col-md-4 d-flex align-items-end">
                                <button type="submit" class="btn btn-dark btn-sm w-100 fw-bold">GENERAR LISTADO FILTRADO</button>
                            </div>
                        </form>

                        <div class="table-scroll rounded">
                            <table class="table table-hover table-sm text-center align-middle m-0">
                                <thead>
                                    <tr>
                                        <th><input type="checkbox" id="checkAll" class="form-check-input"></th>
                                        <th class="text-start">Nombre del Cliente</th>
                                        <th>Nro Factura</th>
                                        <th>Saldo ($)</th>
                                        <th>Saldo (Bs.)</th>
                                        <th>Días</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${deudores.map(i => `
                                        <tr>
                                            <td><input type="checkbox" class="rowCheck form-check-input" value='${JSON.stringify(i)}'></td>
                                            <td class="text-start"><small>${i.nombres}</small></td>
                                            <td><span class="badge bg-light text-dark border">${i.nro_factura}</span></td>
                                            <td class="text-danger fw-bold">$${parseFloat(i.saldo_pendiente).toFixed(2)}</td>
                                            <td class="text-primary fw-bold">Bs. ${parseFloat(i.saldo_bolivares).toFixed(2)}</td>
                                            <td><span class="badge ${i.dias_transcurridos > 15 ? 'bg-danger' : 'bg-success'}">${i.dias_transcurridos}</span></td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                        <div class="mt-4">
                            <button onclick="enviarNotificaciones()" id="btnSend" class="btn btn-success w-100 py-3 fw-bold shadow">
                                🚀 ENVIAR NOTIFICACIONES DE COBRO (WHATSAPP)
                            </button>
                        </div>
                    </div>

                    <script>
                        document.getElementById('checkAll').onclick = function() {
                            document.querySelectorAll('.rowCheck').forEach(c => c.checked = this.checked);
                        }

                        async function enviarNotificaciones() {
                            const seleccionados = Array.from(document.querySelectorAll('.rowCheck:checked'))
                                                       .map(cb => JSON.parse(cb.value));
                            
                            if (seleccionados.length === 0) return alert('Seleccione al menos una factura para enviar.');
                            
                            const btn = document.getElementById('btnSend');
                            btn.disabled = true;
                            btn.innerText = 'PROCESANDO ENVÍOS... ESPERE POR FAVOR';

                            try {
                                await fetch('/enviar-cobranza', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ facturas: seleccionados })
                                });
                                alert('El proceso de envío masivo ha iniciado en segundo plano.');
                            } catch (e) {
                                alert('Error al procesar el envío.');
                            } finally {
                                btn.disabled = false;
                                btn.innerText = '🚀 ENVIAR NOTIFICACIONES DE COBRO (WHATSAPP)';
                            }
                        }
                    </script>
                </body>
                </html>
            `);
            res.end();
        } catch (e) {
            res.writeHead(500, { 'Content-Type': 'text/html' });
            res.end(`<h3>Error al cargar datos: ${e.message}</h3>`);
        }
    } else if (parsedUrl.pathname === '/enviar-cobranza' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            const data = JSON.parse(body);
            // Ejecutamos el envío masivo usando el socket activo
            cobranza.ejecutarEnvioMasivo(socketBot, data.facturas);
            res.end("OK");
        });
    } else {
        // PÁGINA DE INICIO - ESTADO DEL QR
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
            <html>
            <head>
                <title>QR Status - ONE4CARS</title>
                <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
            </head>
            <body class="bg-light text-center">
                ${header}
                <div class="container py-5">
                    <div class="card shadow p-4 mx-auto" style="max-width: 450px;">
                        <h4 class="mb-4">Conexión de WhatsApp</h4>
                        <div class="mb-4">
                            ${qrCodeData.startsWith('data') 
                                ? `<img src="${qrCodeData}" class="img-fluid border p-2 bg-white shadow-sm" style="width: 250px;">
                                   <p class="mt-3 text-muted small">Escanee este código con el WhatsApp de la empresa</p>` 
                                : `<div class="alert alert-success h2 py-4">${qrCodeData || "Iniciando..."}</div>`
                            }
                        </div>
                        <a href="/cobranza" class="btn btn-primary w-100 fw-bold">ABRIR PANEL DE COBRANZA</a>
                    </div>
                </div>
            </body>
            </html>`);
    }
});

server.listen(port, '0.0.0.0', () => {
    console.log("Servidor ONE4CARS corriendo en puerto " + port);
    startBot();
});
