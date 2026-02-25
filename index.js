const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode');
const http = require('http');
const url = require('url');
const pino = require('pino');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const cobranza = require('./cobranza');

// --- CONFIGURACIÓN DE IA (MODELO 1.5 FLASH PARA EVITAR 404) ---
const genAI = new GoogleGenerativeAI("AIzaSyCagnD3xFykhx8khwXcTQcLF1VtTCIfQhI");
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

let qrCodeData = "";
let socketBot = null;
const port = process.env.PORT || 10000;

// BASE DE CONOCIMIENTOS COMPLETA (SEGÚN TUS INSTRUCCIONES)
const knowledgeBase = `Eres el asistente oficial de ONE4CARS. Empresa importadora de autopartes desde China a Venezuela.
Proporciona respuestas útiles y usa siempre estos enlaces:
1. Medios de pago: https://www.one4cars.com/medios_de_pago.php/
2. Estado de cuenta: https://www.one4cars.com/estado_de_cuenta.php/
3. Lista de precios: https://www.one4cars.com/lista_de_precios.php/
4. Tomar pedido: https://www.one4cars.com/tomar_pedido.php/
5. Mis clientes/Vendedores: https://www.one4cars.com/mis_clientes.php/
6. Afiliar cliente: https://www.one4cars.com/afiliar_clientes.php/
7. Consulta de productos: https://www.one4cars.com/consulta_productos.php/
8. Seguimiento Despacho: https://www.one4cars.com/despacho.php/
9. Asesor Humano: Indica que un operador revisará el caso pronto.
REGLA: Si el cliente pregunta por saldos o pagos, refiere a los links 1 y 2.`;

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const { version } = await fetchLatestBaileysVersion();
    
    // Se eliminó printQRInTerminal:true para evitar el error de depreciación en Render
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
            console.log("ONE4CARS: Conexión establecida con éxito.");
        }
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

        if (text.length < 1) return;

        try {
            const prompt = `${knowledgeBase}\n\nCliente pregunta: "${text}"\nRespuesta ONE4CARS:`;
            const result = await model.generateContent(prompt);
            const response = await result.response;
            await sock.sendMessage(from, { text: response.text() });
        } catch (e) {
            console.error("Error en IA Gemini:", e.message);
        }
    });
}

const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    
    // HEADER PHP SIMULADO (SEGÚN REQUERIMIENTO)
    const header = `
        <header class="p-3 mb-4 border-bottom bg-dark text-white shadow">
            <div class="container d-flex justify-content-between align-items-center">
                <h4 class="m-0">📦 ONE4CARS System v2.0</h4>
                <nav>
                    <a href="/" class="text-white me-3 text-decoration-none">Estado</a>
                    <a href="/cobranza" class="btn btn-primary btn-sm fw-bold">ZONA COBRANZA</a>
                </nav>
            </div>
        </header>`;

    if (parsedUrl.pathname === '/cobranza') {
        try {
            // PROCESOS DE DATOS COMPLETOS
            const v = await cobranza.obtenerVendedores();
            const z = await cobranza.obtenerZonas();
            const d = await cobranza.obtenerListaDeudores(parsedUrl.query);

            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.write(`
                <html>
                <head>
                    <title>Cobranza - ONE4CARS</title>
                    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
                    <style> .table-wrapper { max-height: 500px; overflow-y: auto; } </style>
                </head>
                <body class="bg-light">
                    ${header}
                    <div class="container bg-white shadow p-4 rounded-3">
                        <div class="d-flex justify-content-between align-items-center mb-4">
                            <h3 class="text-primary">Gestión de Deudores</h3>
                            <span class="badge bg-danger p-2">${d.length} Facturas Pendientes</span>
                        </div>
                        
                        <form class="row g-2 mb-4 bg-light p-3 rounded border">
                            <div class="col-md-3">
                                <select name="vendedor" class="form-select">
                                    <option value="">-- Vendedor --</option>
                                    ${v.map(i => `<option value="${i.nombre}">${i.nombre}</option>`)}
                                </select>
                            </div>
                            <div class="col-md-3">
                                <select name="zona" class="form-select">
                                    <option value="">-- Zona --</option>
                                    ${z.map(i => `<option value="${i.zona}">${i.zona}</option>`)}
                                </select>
                            </div>
                            <div class="col-md-2">
                                <input type="number" name="dias" class="form-control" placeholder="Días venc." value="${parsedUrl.query.dias || 0}">
                            </div>
                            <div class="col-md-4">
                                <button class="btn btn-dark w-100 fw-bold">FILTRAR LISTADO</button>
                            </div>
                        </form>

                        <div class="table-wrapper border rounded">
                            <table class="table table-hover table-sm m-0">
                                <thead class="table-dark text-center">
                                    <tr>
                                        <th><input type="checkbox" id="all" class="form-check-input"></th>
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
                                            <td class="text-start"><small>${i.nombres}</small></td>
                                            <td><span class="badge bg-light text-dark border">${i.nro_factura}</span></td>
                                            <td class="text-danger fw-bold">$${parseFloat(i.saldo_pendiente).toFixed(2)}</td>
                                            <td class="text-primary fw-bold">Bs. ${parseFloat(i.saldo_bolivares).toFixed(2)}</td>
                                            <td><span class="badge ${i.dias_transcurridos > 15 ? 'bg-warning text-dark' : 'bg-success'}">${i.dias_transcurridos} d</span></td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                        <button onclick="enviar()" id="btn" class="btn btn-success w-100 py-3 mt-3 fw-bold shadow">🚀 ENVIAR COBRANZA MASIVA POR WHATSAPP</button>
                    </div>
                    <script>
                        document.getElementById('all').onclick = function() {
                            document.querySelectorAll('.rowCheck').forEach(c => c.checked = this.checked);
                        }
                        async function enviar() {
                            const sel = Array.from(document.querySelectorAll('.rowCheck:checked')).map(cb => JSON.parse(cb.value));
                            if(sel.length === 0) return alert('Por favor, seleccione al menos un cliente.');
                            const btn = document.getElementById('btn');
                            btn.disabled = true; btn.innerText = 'ENVIANDO MENSAJES...';
                            await fetch('/enviar-cobranza', { method:'POST', body: JSON.stringify({facturas:sel}) });
                            alert('Proceso de envío iniciado con éxito.');
                            btn.disabled = false; btn.innerText = '🚀 ENVIAR COBRANZA MASIVA POR WHATSAPP';
                        }
                    </script>
                </body>
                </html>
            `);
            res.end();
        } catch (e) {
            res.end(`Error en base de datos: ${e.message}`);
        }
    } else if (parsedUrl.pathname === '/enviar-cobranza' && req.method === 'POST') {
        let b = ''; req.on('data', c => b += c);
        req.on('end', () => {
            const data = JSON.parse(b);
            cobranza.ejecutarEnvioMasivo(socketBot, data.facturas);
            res.end("OK");
        });
    } else {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`
            <html>
            <head><link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet"></head>
            <body class="bg-light text-center">
                ${header}
                <div class="container mt-5">
                    <div class="card shadow p-4 mx-auto" style="max-width: 450px;">
                        <h4 class="mb-4">Estatus del Bot</h4>
                        ${qrCodeData.startsWith('data') 
                            ? `<img src="${qrCodeData}" class="border shadow rounded mb-3" style="width: 250px;">
                               <p class="text-muted small">Escanea para conectar con el WhatsApp de la empresa</p>` 
                            : `<div class="alert alert-success fw-bold">${qrCodeData || "Iniciando..."}</div>`
                        }
                        <hr>
                        <a href="/cobranza" class="btn btn-primary w-100 py-2">IR A PANEL DE COBRANZA</a>
                    </div>
                </div>
            </body>
            </html>`);
    }
});

server.listen(port, '0.0.0.0', () => { 
    console.log("Servidor ONE4CARS activo en puerto " + port); 
    startBot(); 
});
