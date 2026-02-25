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
9. Asesor Humano: Indica que un operador revisará el caso pronto.`;

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const { version } = await fetchLatestBaileysVersion();
    
    const sock = makeWASocket({ 
        version, 
        auth: state, 
        logger: pino({ level: 'silent' }), // Bajamos el ruido de logs
        browser: ["ONE4CARS", "Chrome", "1.0.0"],
        markOnlineOnConnect: true
    });

    socketBot = sock;
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (u) => {
        const { connection, lastDisconnect, qr } = u;
        if (qr) qrcode.toDataURL(qr, (err, url) => qrCodeData = url);
        
        if (connection === 'open') {
            qrCodeData = "ONLINE ✅";
            console.log("Conexión exitosa con WhatsApp");
        }
        
        if (connection === 'close') {
            const shouldReconnect = (lastDisconnect.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;
            if (shouldReconnect) {
                console.log("Reconectando...");
                setTimeout(startBot, 5000);
            }
        }
    });

// --- CONFIGURACIÓN IA MEJORADA ---
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" }); // Usamos Flash que es más estable y rápido

// ... (resto del código de conexión)

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        
        // No responder a mensajes propios ni a grupos (opcional)
        if (!msg.message || msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        const text = (msg.message.conversation || 
                      msg.message.extendedTextMessage?.text || 
                      msg.message.imageMessage?.caption || "").trim();

        // 1. Ignorar si el texto es muy corto o nulo
        if (text.length < 2) return; 

        try {
            // 2. Limpiar el prompt para evitar caracteres extraños
            const prompt = `${knowledgeBase}\n\nPregunta del cliente: ${text}\nRespuesta profesional:`;
            
            const result = await model.generateContent(prompt);
            const response = await result.response;
            const textReply = response.text();

            if (textReply) {
                await sock.sendMessage(from, { text: textReply });
            }
        } catch (e) {
            // 3. Diagnóstico preciso del error
            console.error("--- ERROR CRÍTICO IA ---");
            if (e.message.includes("429")) {
                console.error("⚠️ Límite de cuota excedido (Too Many Requests).");
            } else if (e.message.includes("API key not valid")) {
                console.error("⚠️ La API KEY de Gemini es incorrecta o expiró.");
            } else {
                console.error("Detalle:", e.message);
            }
        }
    });
}

const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    
    // HEADER PHP SIMULADO (SEGÚN INSTRUCCIONES)
    const header = `
        <header class="p-3 mb-4 border-bottom bg-dark text-white">
            <div class="container d-flex justify-content-between align-items-center">
                <h4 class="m-0">📦 ONE4CARS System</h4>
                <nav>
                    <a href="/" class="text-white me-3 text-decoration-none">Estado Bot</a>
                    <a href="/cobranza" class="btn btn-primary btn-sm">Panel Cobranza</a>
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
                    <div class="container bg-white shadow p-4 rounded">
                        <form class="row g-2 mb-4">
                            <div class="col-md-4"><select name="vendedor" class="form-select"><option value="">Vendedor</option>${v.map(i=>`<option value="${i.nombre}">${i.nombre}</option>`)}</select></div>
                            <div class="col-md-4"><select name="zona" class="form-select"><option value="">Zona</option>${z.map(i=>`<option value="${i.zona}">${i.zona}</option>`)}</select></div>
                            <div class="col-md-2"><input type="number" name="dias" class="form-control" placeholder="Días" value="${parsedUrl.query.dias || 0}"></div>
                            <div class="col-md-2"><button class="btn btn-primary w-100">Filtrar</button></div>
                        </form>
                        <div class="table-responsive" style="max-height:500px;">
                            <table class="table table-sm table-hover">
                                <thead class="table-dark">
                                    <tr><th><input type="checkbox" id="all"></th><th>Cliente</th><th>Factura</th><th>Saldo $</th><th>Días</th></tr>
                                </thead>
                                <tbody>
                                    ${d.map(i=>`<tr><td><input type="checkbox" class="rowCheck" value='${JSON.stringify(i)}'></td><td><small>${i.nombres}</small></td><td><small>${i.nro_factura}</small></td><td class="text-danger"><b>$${parseFloat(i.saldo_pendiente).toFixed(2)}</b></td><td><span class="badge bg-warning text-dark">${i.dias_transcurridos}</span></td></tr>`).join('')}
                                </tbody>
                            </table>
                        </div>
                        <button onclick="enviar()" id="btn" class="btn btn-success w-100 py-3 mt-3 fw-bold">🚀 ENVIAR WHATSAPP SELECCIONADOS</button>
                    </div>
                    <script>
                        document.getElementById('all').onclick = function() { document.querySelectorAll('.rowCheck').forEach(c => c.checked = this.checked); }
                        async function enviar() {
                            const sel = Array.from(document.querySelectorAll('.rowCheck:checked')).map(cb => JSON.parse(cb.value));
                            if(sel.length === 0) return alert('Seleccione clientes');
                            const btn = document.getElementById('btn');
                            btn.disabled = true; btn.innerText = 'PROCESANDO ENVÍO...';
                            await fetch('/enviar-cobranza', { method:'POST', body: JSON.stringify({facturas:sel}) });
                            alert('Envío de mensajes iniciado.');
                            btn.disabled = false; btn.innerText = '🚀 ENVIAR WHATSAPP SELECCIONADOS';
                        }
                    </script>
                </body>
                </html>`);
            res.end();
        } catch (e) {
            res.end(`Error: ${e.message}`);
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
            <html><head><link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet"></head>
            <body class="bg-light">
                ${header}
                <center style="margin-top:50px;">
                    <h1>Estatus del Bot</h1>
                    <div class="mt-4">${qrCodeData.startsWith('data') ? `<img src="${qrCodeData}" class="border p-2 bg-white shadow">` : `<h3 class="text-success">${qrCodeData || "Iniciando..."}</h3>`}</div>
                </center>
            </body></html>`);
    }
});

server.on('error', (e) => { if (e.code === 'EADDRINUSE') setTimeout(() => { server.close(); server.listen(port); }, 3000); });
server.listen(port, () => { startBot(); });
