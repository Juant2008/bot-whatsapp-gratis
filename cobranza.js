const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode');
const http = require('http');
const url = require('url');
const pino = require('pino');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const cobranza = require('./cobranza');

// --- CONFIGURACIÓN IA ---
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-pro" });

let qrCodeData = "";
let socketBot = null;
const port = process.env.PORT || 10000;

const knowledgeBase = `Eres el asistente de ONE4CARS. Responde amable y corto. 
Links: Medios de pago: https://www.one4cars.com/medios_de_pago.php/, 
Estado de cuenta: https://www.one4cars.com/estado_de_cuenta.php/, 
Pedidos: https://www.one4cars.com/tomar_pedido.php/. 
Si no sabes algo, indica que un asesor humano contactará al cliente.`;

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
            const prompt = `${knowledgeBase}\n\nCliente: "${body}"\nRespuesta:`;
            const result = await model.generateContent(prompt);
            await sock.sendMessage(from, { text: result.response.text() });
        } catch (e) { console.error("Error IA"); }
    });
}

// --- SERVIDOR HTTP CON PANEL COMPLETO ---
http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const path = parsedUrl.pathname;

    if (path === '/cobranza') {
        const vendedores = await cobranza.obtenerVendedores();
        const zonas = await cobranza.obtenerZonas();
        const deudores = await cobranza.obtenerListaDeudores(parsedUrl.query);

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.write(`
            <html>
            <head>
                <title>ONE4CARS - Cobranza</title>
                <meta name="viewport" content="width=device-width, initial-scale=1">
                <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
                <style>body{background:#f8f9fa} .container{margin-top:10px; background:white; padding:15px; border-radius:10px; shadow: 0 0 10px rgba(0,0,0,0.1)}</style>
            </head>
            <body>
                <div class="container shadow-sm">
                    <div class="d-flex justify-content-between align-items-center mb-3">
                        <h4 class="mb-0">📊 Cobranza ONE4CARS</h4>
                        <a href="/" class="btn btn-sm btn-outline-secondary">Cerrar</a>
                    </div>
                    
                    <form method="GET" class="row g-2 mb-3">
                        <div class="col-6">
                            <select name="vendedor" class="form-select form-select-sm">
                                <option value="">Vendedor</option>
                                ${vendedores.map(v => `<option value="${v.nombre}">${v.nombre}</option>`).join('')}
                            </select>
                        </div>
                        <div class="col-6">
                            <select name="zona" class="form-select form-select-sm">
                                <option value="">Zona</option>
                                ${zonas.map(z => `<option value="${z.zona}">${z.zona}</option>`).join('')}
                            </select>
                        </div>
                        <div class="col-6">
                            <input type="number" name="dias" class="form-control form-control-sm" placeholder="Días mín." value="${parsedUrl.query.dias || 0}">
                        </div>
                        <div class="col-6">
                            <button type="submit" class="btn btn-primary btn-sm w-100">Filtrar</button>
                        </div>
                    </form>

                    <form id="formEnvio">
                        <div class="table-responsive" style="max-height: 400px;">
                            <table class="table table-sm table-hover border">
                                <thead class="table-light sticky-top">
                                    <tr>
                                        <th><input type="checkbox" id="selectAll" class="form-check-input"></th>
                                        <th>Cliente</th>
                                        <th>Saldo ($)</th>
                                        <th>Días</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${deudores.map(d => `
                                        <tr>
                                            <td><input type="checkbox" name="f" class="rowCheck form-check-input" value='${JSON.stringify(d)}'></td>
                                            <td><small>${d.nombres}</small></td>
                                            <td class="text-danger"><b>${parseFloat(d.saldo_pendiente).toFixed(2)}</b></td>
                                            <td><span class="badge bg-warning text-dark">${d.dias_transcurridos}</span></td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                        <button type="button" onclick="enviarMensajes()" id="btnEnviar" class="btn btn-success w-100 mt-3 py-2">🚀 ENVIAR WHATSAPP</button>
                    </form>
                </div>
                <script>
                    document.getElementById('selectAll').onclick = function() {
                        const checks = document.querySelectorAll('.rowCheck');
                        for (const c of checks) c.checked = this.checked;
                    }
                    async function enviarMensajes() {
                        const selected = Array.from(document.querySelectorAll('.rowCheck:checked')).map(cb => JSON.parse(cb.value));
                        if (selected.length === 0) return alert('Seleccione al menos un cliente');
                        const btn = document.getElementById('btnEnviar');
                        btn.disabled = true; btn.innerText = 'Enviando...';
                        try {
                            const res = await fetch('/enviar-cobranza', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ facturas: selected })
                            });
                            alert(await res.text());
                        } catch(e) { alert('Error de conexión'); }
                        btn.disabled = false; btn.innerText = '🚀 ENVIAR WHATSAPP';
                    }
                </script>
            </body>
            </html>
        `);
        res.end();
    } 
    else if (path === '/enviar-cobranza' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', async () => {
            const data = JSON.parse(body);
            if (socketBot && data.facturas) {
                cobranza.ejecutarEnvioMasivo(socketBot, data.facturas);
                res.end('Envío masivo iniciado...');
            } else {
                res.end('Error: Bot desconectado');
            }
        });
    }
    else {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        if (qrCodeData.includes("data:image")) {
            res.write(`<center style="margin-top:50px;"><h1>Escanea ONE4CARS</h1><img src="${qrCodeData}" width="300"></center>`);
        } else {
            res.write(`
                <html>
                <head><meta name="viewport" content="width=device-width, initial-scale=1">
                <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet"></head>
                <body class="d-flex align-items-center justify-content-center vh-100 bg-light">
                    <div class="text-center p-4 shadow-sm bg-white rounded w-75">
                        <h1 class="h4 mb-4">🚗 ONE4CARS Bot</h1>
                        <p class="badge bg-success fs-6">${qrCodeData}</p>
                        <br><br>
                        <a href="/cobranza" class="btn btn-primary btn-lg w-100">ENTRAR A COBRANZA</a>
                    </div>
                </body>
                </html>
            `);
        }
        res.end();
    }
}).listen(port, '0.0.0.0');

startBot();
