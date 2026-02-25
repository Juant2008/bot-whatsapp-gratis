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

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;
        const text = msg.message.conversation || msg.message.extendedTextMessage?.text || "";
        try {
            const r = await model.generateContent(`${knowledgeBase}\nCliente dice: ${text}`);
            await sock.sendMessage(msg.key.remoteJid, { text: r.response.text() });
        } catch (e) { console.log("Error IA"); }
    });
}

const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    if (parsedUrl.pathname === '/cobranza') {
        try {
            const v = await cobranza.obtenerVendedores();
            const z = await cobranza.obtenerZonas();
            const d = await cobranza.obtenerListaDeudores(parsedUrl.query);

            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.write(`<html><head><title>ONE4CARS</title><link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet"></head><body class="bg-light">
                <div class="container bg-white shadow p-4 mt-3 rounded">
                    <header class="mb-4 border-bottom pb-2"><h3>🚗 ONE4CARS - Panel de Cobranza</h3></header>
                    <form class="row g-2 mb-4">
                        <div class="col-md-4"><select name="vendedor" class="form-select"><option value="">Vendedor</option>${v.map(i=>`<option value="${i.nombre}">${i.nombre}</option>`)}</select></div>
                        <div class="col-md-4"><select name="zona" class="form-select"><option value="">Zona</option>${z.map(i=>`<option value="${i.zona}">${i.zona}</option>`)}</select></div>
                        <div class="col-md-2"><input type="number" name="dias" class="form-control" placeholder="Días" value="${parsedUrl.query.dias || 0}"></div>
                        <div class="col-md-2"><button class="btn btn-primary w-100">Filtrar</button></div>
                    </form>
                    <div class="table-responsive" style="max-height:450px;"><table class="table table-sm table-hover">
                        <thead class="table-dark"><tr><th><input type="checkbox" id="all"></th><th>Cliente</th><th>Factura</th><th>Saldo $</th><th>Días</th></tr></thead>
                        <tbody>${d.map(i=>`<tr><td><input type="checkbox" class="rowCheck" value='${JSON.stringify(i)}'></td><td><small>${i.nombres}</small></td><td><small>${i.nro_factura}</small></td><td class="text-danger"><b>$${parseFloat(i.saldo_pendiente).toFixed(2)}</b></td><td>${i.dias_transcurridos}</td></tr>`).join('')}</tbody>
                    </table></div>
                    <button onclick="enviar()" id="btn" class="btn btn-success w-100 py-3 mt-3 fw-bold">🚀 ENVIAR WHATSAPP</button>
                </div>
                <script>
                    document.getElementById('all').onclick = function() { document.querySelectorAll('.rowCheck').forEach(c => c.checked = this.checked); }
                    async function enviar() {
                        const sel = Array.from(document.querySelectorAll('.rowCheck:checked')).map(cb => JSON.parse(cb.value));
                        if(sel.length === 0) return alert('Seleccione clientes');
                        document.getElementById('btn').disabled = true;
                        await fetch('/enviar-cobranza', { method:'POST', body: JSON.stringify({facturas:sel}) });
                        alert('Envío en proceso...');
                    }
                </script></body></html>`);
            res.end();
        } catch (e) { res.end("Error al cargar datos. Verifique columnas."); }
    } else if (parsedUrl.pathname === '/enviar-cobranza' && req.method === 'POST') {
        let b = ''; req.on('data', c => b += c);
        req.on('end', () => {
            const data = JSON.parse(b);
            cobranza.ejecutarEnvioMasivo(socketBot, data.facturas);
            res.end("OK");
        });
    } else {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<center style="margin-top:50px;"><h1>ONE4CARS BOT</h1>${qrCodeData.startsWith('data')?`<img src="${qrCodeData}">`:`<h3>${qrCodeData||"Cargando..."}</h3>`}<br><br><a href="/cobranza" class="btn btn-primary">Panel de Cobranza</a></center>`);
    }
});

server.on('error', (e) => { if (e.code === 'EADDRINUSE') setTimeout(() => { server.close(); server.listen(port); }, 3000); });
server.listen(port, () => { startBot(); });
