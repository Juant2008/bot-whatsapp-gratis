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

// --- BASE DE CONOCIMIENTOS (9 OPCIONES COMPLETAS) ---
const knowledgeBase = `
Eres el asistente virtual de ONE4CARS. Atiende de forma amable.
Enlaces obligatorios:
1. Medios de pago: https://www.one4cars.com/medios_de_pago.php/
2. Estado de cuenta: https://www.one4cars.com/estado_de_cuenta.php/
3. Lista de precios: https://www.one4cars.com/lista_de_precios.php/
4. Tomar pedido: https://www.one4cars.com/tomar_pedido.php/
5. Mis clientes/Cartera: https://www.one4cars.com/mis_clientes.php/
6. Afiliar cliente: https://www.one4cars.com/afiliar_clientes.php/
7. Consulta productos: https://www.one4cars.com/consulta_productos.php/
8. Despacho/Seguimiento: https://www.one4cars.com/despacho.php/
9. Asesor Humano: Indica que un humano atenderá pronto.
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
        if (qr) qrcode.toDataURL(qr, (err, url) => { qrCodeData = url; });
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
            const result = await model.generateContent(`${knowledgeBase}\nCliente: "${body}"\nRespuesta:`);
            await sock.sendMessage(from, { text: result.response.text() });
        } catch (e) { console.error("Error IA"); }
    });
}

// --- CREACIÓN DEL SERVIDOR CON MANEJO DE ERRORES ---
const server = http.createServer(async (req, res) => {
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
                <meta name="viewport" content="width=device-width, initial-scale=1">
                <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
                <title>Cobranza ONE4CARS</title>
            </head>
            <body class="bg-light p-2">
                <div class="container bg-white shadow-sm p-3 rounded mt-2">
                    <h5>📊 Panel Cobranza ONE4CARS</h5>
                    <form method="GET" class="row g-2 mb-3">
                        <div class="col-6"><select name="vendedor" class="form-select form-select-sm">
                            <option value="">Vendedor</option>
                            ${vendedores.map(v => `<option value="${v.nombre}">${v.nombre}</option>`).join('')}
                        </select></div>
                        <div class="col-6"><select name="zona" class="form-select form-select-sm">
                            <option value="">Zona</option>
                            ${zonas.map(z => `<option value="${z.zona}">${z.zona}</option>`).join('')}
                        </select></div>
                        <div class="col-12"><button type="submit" class="btn btn-primary btn-sm w-100">Filtrar</button></div>
                    </form>
                    <div class="table-responsive" style="max-height: 400px;">
                        <table class="table table-sm">
                            <thead><tr><th><input type="checkbox" id="all"></th><th>Cliente</th><th>Saldo</th></tr></thead>
                            <tbody>
                                ${deudores.map(d => `<tr>
                                    <td><input type="checkbox" class="rowCheck" value='${JSON.stringify(d)}'></td>
                                    <td><small>${d.nombres}</small></td>
                                    <td class="text-danger">$${parseFloat(d.saldo_pendiente).toFixed(2)}</td>
                                </tr>`).join('')}
                            </tbody>
                        </table>
                    </div>
                    <button onclick="enviar()" id="btnEnv" class="btn btn-success w-100 mt-3">🚀 ENVIAR WHATSAPP</button>
                </div>
                <script>
                    document.getElementById('all').onclick = function() {
                        document.querySelectorAll('.rowCheck').forEach(c => c.checked = this.checked);
                    }
                    async function enviar() {
                        const sel = Array.from(document.querySelectorAll('.rowCheck:checked')).map(cb => JSON.parse(cb.value));
                        if(sel.length === 0) return alert('Seleccione clientes');
                        const btn = document.getElementById('btnEnv');
                        btn.disabled = true; btn.innerText = 'Enviando...';
                        const r = await fetch('/enviar-cobranza', { method:'POST', body: JSON.stringify({facturas:sel}) });
                        alert(await r.text());
                        btn.disabled = false; btn.innerText = '🚀 ENVIAR WHATSAPP';
                    }
                </script>
            </body>
            </html>
        `);
        res.end();
    } else if (path === '/enviar-cobranza' && req.method === 'POST') {
        let body = '';
        req.on('data', c => body += c);
        req.on('end', () => {
            const data = JSON.parse(body);
            if(socketBot) { cobranza.ejecutarEnvioMasivo(socketBot, data.facturas); res.end('Iniciado'); }
            else { res.end('Bot desconectado'); }
        });
    } else {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.write(qrCodeData.includes("data:image") ? `<center><img src="${qrCodeData}" width="300"><br><a href="/cobranza">Panel</a></center>` : `<center><h1>${qrCodeData || "Iniciando..."}</h1><br><a href="/cobranza">IR A COBRANZA</a></center>`);
        res.end();
    }
});

// --- EL TRUCO PARA ELIMINAR EL ERROR EADDRINUSE ---
server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
        console.log('Puerto ocupado, reintentando en 2 segundos...');
        setTimeout(() => {
            server.close();
            server.listen(port, '0.0.0.0');
        }, 2000);
    }
});

server.listen(port, '0.0.0.0', () => {
    console.log(`Puerto ${port} abierto`);
    startBot();
});
