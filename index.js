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

// --- CEREBRO DE LA IA (9 OPCIONES RESTAURADAS AL 100%) ---
const knowledgeBase = `
Eres el asistente virtual de ONE4CARS. Tu objetivo es atender al cliente de forma amable, corta y precisa.
IMPORTANTE: Si el cliente pregunta por estos temas, DEBES responder con el enlace exacto:

1. 'medios de pago' o 'como pagar':
   "Estimado cliente, acceda al siguiente enlace para ver nuestras formas de pago actualizadas:\n\n🔗 https://www.one4cars.com/medios_de_pago.php/"

2. 'estado de cuenta' o 'cuanto debo':
   "Estimado cliente, puede consultar su estado de cuenta detallado en el siguiente link:\n\n🔗 https://www.one4cars.com/estado_de_cuenta.php/"

3. 'lista de precios' o 'precios':
   "Estimado cliente, descargue nuestra lista de precios más reciente aquí:\n\n🔗 https://www.one4cars.com/lista_de_precios.php/"

4. 'tomar pedido' o 'hacer pedido':
   "Estimado cliente, inicie la carga de su pedido de forma rápida aquí:\n\n🔗 https://www.one4cars.com/tomar_pedido.php/"

5. 'mis clientes' o 'cartera':
   "Estimado, gestione su cartera de clientes en el siguiente apartado:\n\n🔗 https://www.one4cars.com/mis_clientes.php/"

6. 'afiliar cliente':
   "Estimado, para afiliar nuevos clientes por favor ingrese al siguiente link:\n\n🔗 https://www.one4cars.com/afiliar_clientes.php/"

7. 'ficha producto' o 'tecnica':
   "Estimado cliente, consulte las especificaciones y fichas técnicas aquí:\n\n🔗 https://www.one4cars.com/consulta_productos.php/"

8. 'despacho', 'envio' o 'seguimiento':
   "Estimado cliente, realice el seguimiento en tiempo real de su despacho aquí:\n\n🔗 https://www.one4cars.com/despacho.php/"

9. 'asesor' o 'humano':
   "Entendido. En un momento uno de nuestros asesores humanos revisará su caso y le contactará de forma manual. Gracias por su paciencia."

Si el usuario saluda, responde cortésmente. Si pregunta algo fuera de estos 9 puntos, indica que un asesor humano lo contactará pronto. No inventes links.
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
            const response = await result.response;
            await sock.sendMessage(from, { text: response.text() });
        } catch (error) { console.error("Error Gemini"); }
    });
}

// --- SERVIDOR HTTP ÚNICO Y COMPLETO ---
const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const path = parsedUrl.pathname;

    // RUTA 1: PANEL DE COBRANZA (TODO EL HTML Y LÓGICA)
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
            </head>
            <body class="bg-light p-2">
                <div class="container bg-white shadow-sm p-3 rounded mt-2" style="max-width: 900px;">
                    <div class="d-flex justify-content-between align-items-center mb-3">
                        <h5 class="mb-0 text-primary">📊 Panel Cobranza ONE4CARS</h5>
                        <a href="/" class="btn btn-sm btn-outline-secondary">Volver</a>
                    </div>
                    
                    <form method="GET" class="row g-2 mb-3">
                        <div class="col-6">
                            <select name="vendedor" class="form-select form-select-sm">
                                <option value="">Todos los Vendedores</option>
                                ${vendedores.map(v => `<option value="${v.nombre}" ${parsedUrl.query.vendedor === v.nombre ? 'selected' : ''}>${v.nombre}</option>`).join('')}
                            </select>
                        </div>
                        <div class="col-6">
                            <select name="zona" class="form-select form-select-sm">
                                <option value="">Todas las Zonas</option>
                                ${zonas.map(z => `<option value="${z.zona}" ${parsedUrl.query.zona === z.zona ? 'selected' : ''}>${z.zona}</option>`).join('')}
                            </select>
                        </div>
                        <div class="col-6">
                            <input type="number" name="dias" class="form-control form-control-sm" placeholder="Mínimo días" value="${parsedUrl.query.dias || 0}">
                        </div>
                        <div class="col-6">
                            <button type="submit" class="btn btn-primary btn-sm w-100">Filtrar Lista</button>
                        </div>
                    </form>

                    <form id="formMasivo">
                        <div class="table-responsive" style="max-height: 500px;">
                            <table class="table table-sm table-hover border">
                                <thead class="table-dark sticky-top">
                                    <tr>
                                        <th><input type="checkbox" id="masterCheck" class="form-check-input"></th>
                                        <th>Cliente / Factura</th>
                                        <th>Saldo ($)</th>
                                        <th>Días</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${deudores.map(d => `
                                        <tr>
                                            <td><input type="checkbox" name="f" class="rowCheck form-check-input" value='${JSON.stringify(d)}'></td>
                                            <td><small><b>${d.nombres}</b><br><span class="text-muted">#${d.nro_factura}</span></small></td>
                                            <td class="text-danger"><b>${parseFloat(d.saldo_pendiente).toFixed(2)}</b></td>
                                            <td><span class="badge ${d.dias_transcurridos > 30 ? 'bg-danger' : 'bg-warning text-dark'}">${d.dias_transcurridos}d</span></td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                        <button type="button" onclick="enviar()" id="btnEnviar" class="btn btn-success w-100 mt-3 py-2 fw-bold">🚀 ENVIAR WHATSAPP SELECCIONADOS</button>
                    </form>
                </div>
                <script>
                    document.getElementById('masterCheck').onclick = function() {
                        const checks = document.querySelectorAll('.rowCheck');
                        for (const c of checks) c.checked = this.checked;
                    }
                    async function enviar() {
                        const seleccionados = Array.from(document.querySelectorAll('.rowCheck:checked')).map(cb => JSON.parse(cb.value));
                        if (seleccionados.length === 0) return alert('Seleccione al menos un cliente de la lista.');
                        if (!confirm('¿Desea enviar recordatorio a ' + seleccionados.length + ' clientes?')) return;
                        
                        const btn = document.getElementById('btnEnviar');
                        btn.disabled = true; btn.innerText = 'PROCESANDO ENVÍOS...';
                        
                        try {
                            const res = await fetch('/enviar-cobranza', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ facturas: seleccionados })
                            });
                            const txt = await res.text();
                            alert(txt);
                        } catch(e) { alert('Error de conexión con el servidor.'); }
                        
                        btn.disabled = false; btn.innerText = '🚀 ENVIAR WHATSAPP SELECCIONADOS';
                    }
                </script>
            </body>
            </html>
        `);
        res.end();
    } 
    // RUTA 2: PROCESAMIENTO DE ENVÍO
    else if (path === '/enviar-cobranza' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
        req.on('end', async () => {
            try {
                const data = JSON.parse(body);
                if (socketBot && data.facturas) {
                    cobranza.ejecutarEnvioMasivo(socketBot, data.facturas);
                    res.writeHead(200); res.end('Cola de envío iniciada con éxito.');
                } else {
                    res.writeHead(400); res.end('Error: WhatsApp no vinculado.');
                }
            } catch(e) { res.writeHead(500); res.end('Error en el proceso.'); }
        });
    }
    // RUTA 3: HOME (QR O STATUS)
    else {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        if (qrCodeData.includes("data:image")) {
            res.write(`
                <html>
                <body style="display:flex; flex-direction:column; align-items:center; justify-content:center; height:100vh; font-family:sans-serif;">
                    <h2>Vincular ONE4CARS</h2>
                    <img src="${qrCodeData}" style="border: 10px solid #eee; border-radius:15px; width:300px;">
                    <p style="color:red;">Escanea con WhatsApp</p>
                    <a href="/cobranza" style="margin-top:20px; text-decoration:none; color:blue; font-weight:bold;">IR AL PANEL DE COBRANZA</a>
                </body>
                </html>
            `);
        } else {
            res.write(`
                <html>
                <head><meta name="viewport" content="width=device-width, initial-scale=1">
                <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet"></head>
                <body class="d-flex align-items-center justify-content-center vh-100 bg-light text-center">
                    <div class="p-4 shadow bg-white rounded w-75">
                        <h4 class="mb-4">🚀 ONE4CARS Bot</h4>
                        <span class="badge bg-success mb-4 p-2 fs-6">${qrCodeData}</span>
                        <a href="/cobranza" class="btn btn-primary btn-lg w-100 shadow-sm">ENTRAR A COBRANZA</a>
                    </div>
                </body>
                </html>
            `);
        }
        res.end();
    }
});

// SOLO UN LISTEN EN TODO EL PROGRAMA
server.listen(port, '0.0.0.0', () => {
    console.log(`[ONE4CARS] Escuchando en puerto ${port}`);
});

startBot();
