const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode');
const http = require('http');
const url = require('url');
const pino = require('pino');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const cobranza = require('./cobranza');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const model = genAI.getGenerativeModel({ model: "gemini-pro" });

let qrCodeData = "";
let socketBot = null;
const port = process.env.PORT || 10000;

// IA CON LAS 9 OPCIONES DE TU NEGOCIO
const knowledgeBase = `Eres el asistente de ONE4CARS. Empresa importadora de China a Venezuela.
Almacén general (bultos) y Almacén intermedio (stock detal). 10 vendedores.
RESPONDE SIEMPRE CON ESTOS LINKS SEGÚN EL CASO:
1. Pagos: https://www.one4cars.com/medios_de_pago.php/
2. Estado Cuenta: https://www.one4cars.com/estado_de_cuenta.php/
3. Precios: https://www.one4cars.com/lista_de_precios.php/
4. Pedidos: https://www.one4cars.com/tomar_pedido.php/
5. Cartera: https://www.one4cars.com/mis_clientes.php/
6. Afiliar: https://www.one4cars.com/afiliar_clientes.php/
7. Ficha Técnica: https://www.one4cars.com/consulta_productos.php/
8. Despacho: https://www.one4cars.com/despacho.php/
9. Humano: Indica que un asesor lo contactará.`;

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const { version } = await fetchLatestBaileysVersion();
    const sock = makeWASocket({ version, auth: state, logger: pino({ level: 'error' }), browser: ["ONE4CARS", "Chrome", "1.0.0"] });
    socketBot = sock;
    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', (u) => {
        if (u.qr) qrcode.toDataURL(u.qr, (err, url) => qrCodeData = url);
        if (u.connection === 'open') qrCodeData = "ONLINE ✅";
        if (u.connection === 'close') {
            const code = (u.lastDisconnect.error instanceof Boom)?.output?.statusCode;
            if (code !== DisconnectReason.loggedOut) startBot();
        }
    });
    sock.ev.on('messages.upsert', async (m) => {
        if (m.type !== 'notify') return;
        const msg = m.messages[0];
        if (!msg.message || msg.key.fromMe) return;
        const body = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
        const r = await model.generateContent(`${knowledgeBase}\nCliente: ${body}`);
        await sock.sendMessage(msg.key.remoteJid, { text: r.response.text() });
    });
}

const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    if (parsedUrl.pathname === '/cobranza') {
        const v = await cobranza.obtenerVendedores();
        const z = await cobranza.obtenerZonas();
        const d = await cobranza.obtenerListaDeudores(parsedUrl.query);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.write(`<html><head><link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet"></head><body class="p-3">
            <div class="container bg-white shadow p-4">
                <header class="mb-4 border-bottom"><h3>🚀 ONE4CARS - Sistema de Cobranza</h3></header>
                <form class="row g-2 mb-4">
                    <div class="col-4"><select name="vendedor" class="form-select">${v.map(i=>`<option>${i.nombre}</option>`)}</select></div>
                    <div class="col-4"><select name="zona" class="form-select">${z.map(i=>`<option>${i.zona}</option>`)}</select></div>
                    <div class="col-2"><input type="number" name="dias" class="form-control" value="${parsedUrl.query.dias || 0}"></div>
                    <div class="col-2"><button class="btn btn-primary w-100">Filtrar</button></div>
                </form>
                <table class="table table-sm">
                    <thead class="table-dark"><tr><th><input type="checkbox" id="all"></th><th>Cliente</th><th>Factura</th><th>Saldo $</th><th>Días</th></tr></thead>
                    <tbody>${d.map(i=>`<tr><td><input type="checkbox" class="rowCheck" value='${JSON.stringify(i)}'></td><td>${i.nombres}</td><td>${i.nro_factura}</td><td class="text-danger">${i.saldo_pendiente}</td><td>${i.dias_transcurridos}</td></tr>`).join('')}</tbody>
                </table>
                <button onclick="enviar()" id="btn" class="btn btn-success w-100 py-3">🚀 ENVIAR WHATSAPP SELECCIONADOS</button>
            </div>
            <script>
                document.getElementById('all').onclick = function() { document.querySelectorAll('.rowCheck').forEach(c => c.checked = this.checked); }
                async function enviar() {
                    const sel = Array.from(document.querySelectorAll('.rowCheck:checked')).map(cb => JSON.parse(cb.value));
                    if(sel.length === 0) return alert('Seleccione clientes');
                    document.getElementById('btn').disabled = true;
                    await fetch('/enviar-cobranza', { method:'POST', body: JSON.stringify({facturas:sel}) });
                    alert('Proceso iniciado');
                }
            </script></body></html>`);
        res.end();
    } else if (parsedUrl.pathname === '/enviar-cobranza' && req.method === 'POST') {
        let b = ''; req.on('data', c => b += c);
        req.on('end', () => {
            const data = JSON.parse(b);
            cobranza.ejecutarEnvioMasivo(socketBot, data.facturas);
            res.end("OK");
        });
    } else {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<center style="margin-top:100px;"><h1>ONE4CARS BOT</h1><br>${qrCodeData.startsWith('data') ? `<img src="${qrCodeData}">` : `<h3>${qrCodeData || "Cargando..."}</h3>`}<br><br><a href="/cobranza" class="btn btn-primary">IR AL PANEL</a></center>`);
    }
});

// FIX PUERTO: Si el puerto está ocupado, espera 3 segundos y reintenta automáticamente
server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
        console.log('Puerto ocupado, reintentando...');
        setTimeout(() => { server.close(); server.listen(port); }, 3000);
    }
});

server.listen(port, () => {
    console.log("Servidor iniciado en puerto " + port);
    startBot();
});
