const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode');
const http = require('http');
const url = require('url');
const pino = require('pino');
const cobranza = require('./cobranza');

let qrCodeData = "";
let socketBot = null;

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
        if (qr) qrcode.toDataURL(qr, (err, url) => { qrCodeData = url; });
        if (connection === 'close') {
            const statusCode = (lastDisconnect.error instanceof Boom)?.output?.statusCode;
            if (statusCode !== DisconnectReason.loggedOut) setTimeout(() => startBot(), 5000);
        } else if (connection === 'open') {
            qrCodeData = "BOT ONLINE ✅";
        }
    });

    // ... (Mantén tu lógica de messages.upsert que ya tenías)
}

// SERVIDOR WEB MEJORADO
http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const path = parsedUrl.pathname;

    // RUTA: PANEL DE COBRANZA
    if (path === '/cobranza') {
        const vendedores = await cobranza.obtenerVendedores();
        const zonas = await cobranza.obtenerZonas();
        const deudores = await cobranza.obtenerListaDeudores(parsedUrl.query);

        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.write(`
            <html>
            <head>
                <title>ONE4CARS - Gestión de Cobranza</title>
                <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
                <style>
                    body { background: #f4f7f6; font-family: sans-serif; }
                    .container { margin-top: 30px; background: white; padding: 20px; border-radius: 10px; box-shadow: 0 0 10px rgba(0,0,0,0.1); }
                    .header-flex { display: flex; justify-content: space-between; align-items: center; }
                </style>
            </head>
            <body>
                <div class="container">
                    <div class="header-flex">
                        <h2>📊 Cobranza ONE4CARS</h2>
                        <a href="/" class="btn btn-outline-secondary btn-sm">Ver QR / Estado</a>
                    </div>
                    <hr>
                    
                    <form method="GET" class="row g-3 mb-4">
                        <div class="col-md-3">
                            <label>Vendedor</label>
                            <select name="vendedor" class="form-select">
                                <option value="">Todos</option>
                                ${vendedores.map(v => `<option value="${v.nombre}" ${parsedUrl.query.vendedor === v.nombre ? 'selected' : ''}>${v.nombre}</option>`).join('')}
                            </select>
                        </div>
                        <div class="col-md-3">
                            <label>Zona</label>
                            <select name="zona" class="form-select">
                                <option value="">Todas</option>
                                ${zonas.map(z => `<option value="${z.zona}" ${parsedUrl.query.zona === z.zona ? 'selected' : ''}>${z.zona}</option>`).join('')}
                            </select>
                        </div>
                        <div class="col-md-2">
                            <label>Días Vencidos (+)</label>
                            <input type="number" name="dias" class="form-control" value="${parsedUrl.query.dias || 0}">
                        </div>
                        <div class="col-md-2 d-flex align-items-end">
                            <button type="submit" class="btn btn-primary w-100">Filtrar</button>
                        </div>
                    </form>

                    <form id="formEnvio">
                        <div class="table-responsive">
                            <table class="table table-hover table-striped">
                                <thead class="table-dark">
                                    <tr>
                                        <th><input type="checkbox" id="selectAll"></th>
                                        <th>Cliente</th>
                                        <th>Factura</th>
                                        <th>Saldo</th>
                                        <th>Días</th>
                                        <th>Vendedor</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${deudores.map((d, i) => `
                                        <tr>
                                            <td><input type="checkbox" name="factura" class="rowCheck" value='${JSON.stringify(d)}'></td>
                                            <td>${d.nombres}</td>
                                            <td>${d.nro_factura}</td>
                                            <td class="text-danger font-weight-bold">$${parseFloat(d.saldo_pendiente).toFixed(2)}</td>
                                            <td><span class="badge bg-warning text-dark">${d.dias_transcurridos} días</span></td>
                                            <td>${d.vendedor_nom}</td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                        <button type="button" onclick="enviarMensajes()" class="btn btn-success btn-lg mt-3">🚀 Enviar WhatsApp Seleccionados</button>
                    </form>
                </div>

                <script>
                    document.getElementById('selectAll').onclick = function() {
                        const checkboxes = document.querySelectorAll('.rowCheck');
                        for (const checkbox of checkboxes) checkbox.checked = this.checked;
                    }

                    async function enviarMensajes() {
                        const selected = Array.from(document.querySelectorAll('.rowCheck:checked')).map(cb => JSON.parse(cb.value));
                        if (selected.length === 0) return alert('Seleccione al menos una factura');
                        
                        if (!confirm('¿Enviar mensajes a ' + selected.length + ' clientes?')) return;

                        const btn = document.querySelector('button[onclick="enviarMensajes()"]');
                        btn.disabled = true;
                        btn.innerText = 'Enviando...';

                        const response = await fetch('/enviar-cobranza', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ facturas: selected })
                        });

                        const res = await response.text();
                        alert(res);
                        btn.disabled = false;
                        btn.innerText = '🚀 Enviar WhatsApp Seleccionados';
                    }
                </script>
            </body>
            </html>
        `);
        res.end();
    } 
    // RUTA: PROCESAR ENVÍO (POST)
    else if (path === '/enviar-cobranza' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', async () => {
            const data = JSON.parse(body);
            if (socketBot && data.facturas) {
                // No esperamos a que termine para no bloquear la web, pero enviamos respuesta
                cobranza.ejecutarEnvioMasivo(socketBot, data.facturas);
                res.writeHead(200);
                res.end('Proceso de envío iniciado en segundo plano. Revise la consola del bot.');
            } else {
                res.writeHead(400);
                res.end('Error: Bot no conectado o sin datos');
            }
        });
    }
    // RUTA: RAÍZ (QR y Estado)
    else {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        if (qrCodeData.includes("data:image")) {
            res.write(`<center style="font-family:Arial;padding-top:50px;">
                        <h1>Escanea ONE4CARS</h1>
                        <img src="${qrCodeData}" width="300">
                        <br><br>
                        <a href="/cobranza" style="padding:10px 20px; background:blue; color:white; text-decoration:none; border-radius:5px;">Ir a Cobranza</a>
                      </center>`);
        } else {
            res.write(`<center style="font-family:Arial;margin-top:100px;">
                        <h1>${qrCodeData || "Iniciando..."}</h1>
                        <br>
                        <a href="/cobranza" style="padding:10px 20px; background:green; color:white; text-decoration:none; border-radius:5px;">Entrar al Panel de Cobranza</a>
                       </center>`);
        }
        res.end();
    }
}).listen(port, '0.0.0.0');

startBot();
