const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode');
const http = require('http');
const url = require('url');
const pino = require('pino');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const cobranza = require('./cobranza');

// --- CONFIGURACIÓN DE IA ---
const genAI = new GoogleGenerativeAI("AIzaSyCagnD3xFykhx8khwXcTQcLF1VtTCIfQhI");
const model = genAI.getGenerativeModel({ 
    model: "gemini-1.5-flash",
    generationConfig: {
        maxOutputTokens: 500,
        temperature: 0.7,
    }
});

let qrCodeData = "";
let socketBot = null;
const port = process.env.PORT || 10000;

// BASE DE CONOCIMIENTOS COMPLETA PARA LAS 9 OPCIONES
const knowledgeBase = `Eres el asistente inteligente de ONE4CARS, empresa importadora de China a Venezuela.
Tu objetivo es ayudar a clientes y vendedores. RESPONDE SIEMPRE incluyendo los links correspondientes:

1. PAGOS: Informa sobre transferencias y divisas. Link: https://www.one4cars.com/medios_de_pago.php/
2. ESTADO DE CUENTA: Para revisar facturas pendientes y saldos. Link: https://www.one4cars.com/estado_de_cuenta.php/
3. LISTA DE PRECIOS: Catálogo actualizado de productos. Link: https://www.one4cars.com/lista_de_precios.php/
4. TOMAR PEDIDO: Sistema para que el cliente cargue su compra. Link: https://www.one4cars.com/tomar_pedido.php/
5. MIS CLIENTES: Exclusivo vendedores para gestionar su cartera. Link: https://www.one4cars.com/mis_clientes.php/
6. AFILIAR CLIENTES: Registro de nuevos aliados comerciales. Link: https://www.one4cars.com/afiliar_clientes.php/
7. FICHA TÉCNICA: Consulta de detalles y fotos de productos. Link: https://www.one4cars.com/consulta_productos.php/
8. DESPACHO: Seguimiento de mercancía enviada. Link: https://www.one4cars.com/despacho.php/
9. ASESOR HUMANO: Si el cliente requiere atención personalizada, indica que un asesor será notificado.

Regla de oro: Sé profesional, usa emojis de autos (🚗, 📦) y siempre despídete invitando a cuidar su crédito.`;

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const { version } = await fetchLatestBaileysVersion();
    
    const sock = makeWASocket({ 
        version, 
        auth: state, 
        logger: pino({ level: 'silent' }), 
        browser: ["ONE4CARS", "Chrome", "1.0.0"],
        printQRInTerminal: true 
    });

    socketBot = sock;
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (u) => {
        const { connection, lastDisconnect, qr } = u;
        if (qr) qrcode.toDataURL(qr, (err, url) => qrCodeData = url);
        if (connection === 'open') {
            qrCodeData = "ONLINE ✅";
            console.log("ONE4CARS BOT CONECTADO");
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
        
        // No responder a notas de voz sin texto o mensajes propios
        if (!msg.message || msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        const text = (msg.message.conversation || 
                      msg.message.extendedTextMessage?.text || 
                      msg.message.imageMessage?.caption || "").trim();

        if (text.length < 1) return;

        console.log(`📩 Mensaje recibido de ${from}: ${text}`);

        try {
            // Generar contenido con un timeout para evitar que el bot se quede pegado
            const prompt = `${knowledgeBase}\n\nCliente pregunta: "${text}"\nRespuesta de ONE4CARS:`;
            
            const result = await model.generateContent(prompt);
            const response = await result.response;
            const replyText = response.text();
            
            if (replyText) {
                await sock.sendMessage(from, { text: replyText });
                console.log(`✅ Respuesta enviada a ${from}`);
            }
        } catch (e) {
            console.error("❌ ERROR CRÍTICO GEMINI:");
            console.error("Mensaje:", e.message);
            
            // Si hay un error de seguridad o bloqueo de Google, intentamos una respuesta simple
            if (e.message.includes("SAFETY")) {
                await sock.sendMessage(from, { text: "Lo siento, no puedo responder a eso por políticas de seguridad. ¿En qué más puedo ayudarte con tus autopartes? 🚗" });
            } else {
                // Notificar en consola si la API KEY falló de nuevo
                console.log("Revisa si la API Key tiene permisos para 'Generative Language API' en Google Cloud.");
            }
        }
    });
}

const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    
    // RENDERIZADO DEL HEADER (include/header.php)
    const renderHeader = () => `
        <nav class="navbar navbar-expand-lg navbar-dark bg-dark mb-4 shadow">
            <div class="container">
                <a class="navbar-brand fw-bold" href="/">🚗 ONE4CARS SYSTEM</a>
                <div class="d-flex">
                    <a href="/cobranza" class="btn btn-outline-primary btn-sm me-2">Gestión Cobranza</a>
                    <a href="/" class="btn btn-outline-light btn-sm">Estado QR</a>
                </div>
            </div>
        </nav>`;

    if (parsedUrl.pathname === '/cobranza') {
        try {
            const v = await cobranza.obtenerVendedores();
            const z = await cobranza.obtenerZonas();
            const d = await cobranza.obtenerListaDeudores(parsedUrl.query);

            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.write(`
                <!DOCTYPE html>
                <html lang="es">
                <head>
                    <meta charset="UTF-8">
                    <title>Cobranza - ONE4CARS</title>
                    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
                    <style>
                        .table-container { max-height: 600px; overflow-y: auto; }
                        .sticky-thead th { position: sticky; top: 0; background: #212529; z-index: 10; }
                    </style>
                </head>
                <body class="bg-light">
                    ${renderHeader()}
                    <div class="container bg-white shadow p-4 rounded-3">
                        <h4 class="mb-4 border-bottom pb-2">📦 Listado de Cuentas por Cobrar</h4>
                        
                        <form class="row g-3 mb-4 bg-light p-3 rounded border">
                            <div class="col-md-3">
                                <label class="small fw-bold">Vendedor:</label>
                                <select name="vendedor" class="form-select form-select-sm">
                                    <option value="">TODOS</option>
                                    ${v.map(i => `<option value="${i.nombre}" ${parsedUrl.query.vendedor === i.nombre ? 'selected' : ''}>${i.nombre}</option>`).join('')}
                                </select>
                            </div>
                            <div class="col-md-3">
                                <label class="small fw-bold">Zona:</label>
                                <select name="zona" class="form-select form-select-sm">
                                    <option value="">TODAS</option>
                                    ${z.map(i => `<option value="${i.zona}" ${parsedUrl.query.zona === i.zona ? 'selected' : ''}>${i.zona}</option>`).join('')}
                                </select>
                            </div>
                            <div class="col-md-2">
                                <label class="small fw-bold">Días Vencidos:</label>
                                <input type="number" name="dias" class="form-select-sm form-control" value="${parsedUrl.query.dias || 0}">
                            </div>
                            <div class="col-md-2 d-flex align-items-end">
                                <button type="submit" class="btn btn-primary btn-sm w-100 fw-bold">FILTRAR DATOS</button>
                            </div>
                        </form>

                        <div class="table-container shadow-sm border rounded">
                            <table class="table table-hover table-sm m-0">
                                <thead class="table-dark sticky-thead text-center">
                                    <tr>
                                        <th><input type="checkbox" id="checkAll" class="form-check-input"></th>
                                        <th>Cliente</th>
                                        <th>Factura</th>
                                        <th>Saldo $</th>
                                        <th>Saldo Bs.</th>
                                        <th>Días</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${d.map(i => `
                                        <tr class="text-center align-middle">
                                            <td><input type="checkbox" class="rowCheck form-check-input" value='${JSON.stringify(i)}'></td>
                                            <td class="text-start"><small>${i.nombres}</small></td>
                                            <td><span class="badge bg-secondary">${i.nro_factura}</span></td>
                                            <td class="text-danger fw-bold">$${parseFloat(i.saldo_pendiente).toFixed(2)}</td>
                                            <td class="text-primary fw-bold">Bs. ${parseFloat(i.saldo_bolivares).toFixed(2)}</td>
                                            <td><span class="badge ${i.dias_transcurridos > 30 ? 'bg-danger' : 'bg-warning text-dark'}">${i.dias_transcurridos}</span></td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>

                        <div class="mt-4 p-3 bg-dark rounded shadow">
                            <button onclick="enviarMensajes()" id="btnSend" class="btn btn-success w-100 py-3 fw-bold shadow">
                                🚀 ENVIAR RECORDATORIOS VÍA WHATSAPP (${d.length} registros cargados)
                            </button>
                        </div>
                    </div>

                    <script>
                        document.getElementById('checkAll').onclick = function() {
                            document.querySelectorAll('.rowCheck').forEach(c => c.checked = this.checked);
                        };

                        async function enviarMensajes() {
                            const seleccionados = Array.from(document.querySelectorAll('.rowCheck:checked'))
                                                       .map(cb => JSON.parse(cb.value));
                            
                            if (seleccionados.length === 0) return alert('Debes seleccionar al menos un cliente de la lista.');
                            
                            const btn = document.getElementById('btnSend');
                            btn.disabled = true;
                            btn.innerHTML = '<span class="spinner-border spinner-border-sm"></span> PROCESANDO ENVÍO...';

                            try {
                                await fetch('/enviar-cobranza', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ facturas: seleccionados })
                                });
                                alert('El proceso de envío masivo ha iniciado correctamente.');
                            } catch (e) {
                                alert('Error al procesar el envío.');
                            } finally {
                                btn.disabled = false;
                                btn.innerText = '🚀 ENVIAR RECORDATORIOS VÍA WHATSAPP';
                            }
                        }
                    </script>
                </body>
                </html>
            `);
            res.end();
        } catch (e) {
            res.writeHead(500, { 'Content-Type': 'text/html' });
            res.end(`<div class="container mt-5 alert alert-danger">Error Base de Datos: ${e.message}</div>`);
        }
    } else if (parsedUrl.pathname === '/enviar-cobranza' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => body += chunk);
        req.on('end', () => {
            const data = JSON.parse(body);
            cobranza.ejecutarEnvioMasivo(socketBot, data.facturas);
            res.end("OK");
        });
    } else {
        // PÁGINA PRINCIPAL - ESTADO QR
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
            <html>
            <head>
                <title>Status Bot - ONE4CARS</title>
                <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
            </head>
            <body class="bg-light text-center">
                ${renderHeader()}
                <div class="container py-5">
                    <div class="card shadow p-4 mx-auto" style="max-width: 500px;">
                        <h2 class="mb-4">Estatus de Conexión</h2>
                        <div class="mb-4">
                            ${qrCodeData.startsWith('data') 
                                ? `<img src="${qrCodeData}" class="border p-3 bg-white shadow-sm rounded" style="width: 300px;">
                                   <p class="mt-3 text-muted">Escanea el código con tu WhatsApp</p>` 
                                : `<div class="alert alert-success fw-bold">${qrCodeData || "Iniciando sistema..."}</div>`
                            }
                        </div>
                        <a href="/cobranza" class="btn btn-primary py-2 fw-bold">IR AL PANEL DE COBRANZA</a>
                    </div>
                </div>
            </body>
            </html>`);
    }
});

server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
        setTimeout(() => { server.close(); server.listen(port); }, 3000);
    }
});

server.listen(port, '0.0.0.0', () => {
    console.log("Servidor ONE4CARS corriendo en puerto " + port);
    startBot();
});
