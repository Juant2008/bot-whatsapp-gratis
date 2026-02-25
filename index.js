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

// --- BASE DE CONOCIMIENTOS (LAS 9 OPCIONES COMPLETAS) ---
const knowledgeBase = `
Eres el asistente virtual de ONE4CARS. Responde de forma amable y profesional.
Si el cliente pregunta por estos temas, entrega el link exacto:

1. Medios de pago / Cómo pagar: https://www.one4cars.com/medios_de_pago.php/
2. Estado de cuenta / Deuda: https://www.one4cars.com/estado_de_cuenta.php/
3. Lista de precios: https://www.one4cars.com/lista_de_precios.php/
4. Tomar pedido / Hacer pedido: https://www.one4cars.com/tomar_pedido.php/
5. Mis clientes / Cartera: https://www.one4cars.com/mis_clientes.php/
6. Afiliar cliente: https://www.one4cars.com/afiliar_clientes.php/
7. Consulta de productos / Ficha: https://www.one4cars.com/consulta_productos.php/
8. Seguimiento de despacho / Envío: https://www.one4cars.com/despacho.php/
9. Asesor Humano: Indica que un operador revisará el chat pronto.

Regla: No inventes información. Si el tema no está aquí, di que un asesor le atenderá.
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
            const prompt = `${knowledgeBase}\n\nCliente: "${body}"\nRespuesta:`;
            const result = await model.generateContent(prompt);
            await sock.sendMessage(from, { text: result.response.text() });
        } catch (e) { console.error("Error IA"); }
    });
}

// --- SERVIDOR HTTP (ESTRUCTURA ONE4CARS COMPLETA) ---
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
                </head>
                <body class="bg-light">
                    <div class="container bg-white shadow p-4 mt-3 rounded">
                        <div class="d-flex justify-content-between align-items-center mb-4">
                            <h4 class="text-primary">📊 Gestión de Cobranza</h4>
                            <a href="/" class="btn btn-sm btn-outline-secondary">Estado QR</a>
                        </div>

                        <form method="GET" class="row g-2 mb-4">
                            <div class="col-md-4 col-6">
                                <select name="vendedor" class="form-select form-select-sm">
                                    <option value="">Todos los Vendedores</option>
                                    ${vendedores.map(v => `<option value="${v.nombre}" ${parsedUrl.query.vendedor === v.nombre ? 'selected' : ''}>${v.nombre}</option>`).join('')}
                                </select>
                            </div>
                            <div class="col-md-4 col-6">
                                <select name="zona" class="form-select form-select-sm">
                                    <option value="">Todas las Zonas</option>
                                    ${zonas.map(z => `<option value="${z.zona}" ${parsedUrl.query.zona === z.zona ? 'selected' : ''}>${z.zona}</option>`).join('')}
                                </select>
                            </div>
                            <div class="col-md-2 col-6">
                                <input type="number" name="dias" class="form-control form-control-sm" placeholder="Días mín." value="${parsedUrl.query.dias || 0}">
                            </div>
                            <div class="col-md-2 col-6">
                                <button type="submit" class="btn btn-primary btn-sm w-100">Filtrar</button>
                            </div>
                        </form>

                        <form id="formEnvio">
                            <div class="table-responsive" style="max-height: 500px;">
                                <table class="table table-sm table-hover border">
                                    <thead class="table-dark sticky-top">
                                        <tr>
                                            <th><input type="checkbox" id="checkMaster" class="form-check-input"></th>
                                            <th>Cliente</th>
                                            <th>Saldo ($)</th>
                                            <th>Días</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        ${deudores.map(d => `
                                            <tr>
                                                <td><input type="checkbox" name="f" class="rowCheck form-check-input" value='${JSON.stringify(d)}'></td>
                                                <td><small><b>${d.nombres}</b><br>Fact: ${d.nro_factura}</small></td>
                                                <td class="text-danger"><b>${parseFloat(d.saldo_pendiente).toFixed(2)}</b></td>
                                                <td><span class="badge bg-warning text-dark">${d.dias_transcurridos}</span></td>
                                            </tr>
                                        `).join('')}
                                    </tbody>
                                </table>
                            </div>
                            <button type="button" onclick="enviarMasivo()" id="btnSend" class="btn btn-success w-100 mt-3 py-2 fw-bold">🚀 ENVIAR RECORDATORIOS WHATSAPP</button>
                        </form>
                    </div>
                    <script>
                        document.getElementById('checkMaster').onclick = function() {
                            document.querySelectorAll('.rowCheck').forEach(c => c.checked = this.checked);
                        }
                        async function enviarMasivo() {
                            const list = Array.from(document.querySelectorAll('.rowCheck:checked')).map(cb => JSON.parse(cb.value));
                            if (list.length === 0) return alert('Selecciona al menos un cliente');
                            const btn = document.getElementById('btnSend');
                            btn.disabled = true; btn.innerText = 'Enviando...';
                            try {
                                const res = await fetch('/enviar-cobranza', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ facturas: list })
                                });
                                alert(await res.text());
                            } catch(e) { alert('Error de red'); }
                            btn.disabled = false; btn.innerText = '🚀 ENVIAR RECORDATORIOS WHATSAPP';
                        }
                    </script>
                </body>
                </html>
            `);
            res.end();
        } catch(e) { res.end("Error DB"); }

    } else if (path === '/enviar-cobranza' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', async () => {
            const data = JSON.parse(body);
            if (socketBot && data.facturas) {
                cobranza.ejecutarEnvioMasivo(socketBot, data.facturas);
                res.end('Envío en proceso...');
            } else { res.end('Error: Bot desconectado'); }
        });
    } else {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        if (qrCodeData.includes("data:image")) {
            res.write(`<center style="padding-top:50px;"><h2>Escanear ONE4CARS</h2><img src="${qrCodeData}" width="300"><br><br><a href="/cobranza">Panel de Cobranza</a></center>`);
        } else {
            res.write(`<center style="padding-top:100px;"><h1>🚗 ${qrCodeData || "Iniciando..."}</h1><br><a href="/cobranza" style="padding:15px; background:green; color:white; text-decoration:none; border-radius:8px;">ENTRAR A COBRANZA</a></center>`);
        }
        res.end();
    }
});

// --- EL ÚNICO LISTEN DEL PROGRAMA ---
server.listen(port, '0.0.0.0', () => {
    console.log(`Servidor ONE4CARS listo en puerto ${port}`);
});

startBot();
