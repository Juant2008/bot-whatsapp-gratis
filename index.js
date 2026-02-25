const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode');
const http = require('http');
const url = require('url');
const pino = require('pino');
const cobranza = require('./cobranza');

let qrCodeData = "";
let socketBot = null;
const port = process.env.PORT || 10000;

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const { version } = await fetchLatestBaileysVersion();
    const sock = makeWASocket({ version, auth: state, logger: pino({ level: 'error' }), browser: ["ONE4CARS", "Chrome", "1.0.0"] });
    socketBot = sock;
    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', (u) => {
        if (u.qr) qrcode.toDataURL(u.qr, (err, url) => qrCodeData = url);
        if (u.connection === 'open') qrCodeData = "BOT ONLINE ✅";
        if (u.connection === 'close') {
            const code = (u.lastDisconnect.error instanceof Boom)?.output?.statusCode;
            if (code !== DisconnectReason.loggedOut) setTimeout(startBot, 5000);
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;
        const from = msg.key.remoteJid;
        const body = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").toLowerCase().trim();

        const titulo = "🚗 *SOPORTE ONE4CARS*\n________________________\n\n";
        const respuestas = {
            'medio de pago': 'Estimado cliente, acceda aquí para ver nuestras cuentas bancarias y métodos de pago en divisas y bolívares:\n🔗 https://www.one4cars.com/medios_de_pago.php/',
            'estado de cuenta': 'Consulte sus facturas pendientes, abonos realizados y saldo actual en tiempo real aquí:\n🔗 https://www.one4cars.com/estado_de_cuenta.php/',
            'lista de precio': 'Acceda a nuestro catálogo completo y lista de precios actualizada para mayoristas y detal:\n🔗 https://www.one4cars.com/lista_de_precios.php/',
            'tomar pedido': 'Agilice su compra cargando sus productos directamente en nuestro sistema de pedidos:\n🔗 https://www.one4cars.com/tomar_pedido.php/',
            'mis cliente': 'Panel exclusivo para vendedores: Gestione su cartera, cobranza y estatus de sus clientes aquí:\n🔗 https://www.one4cars.com/mis_clientes.php/',
            'afiliar cliente': 'Si desea registrar un nuevo cliente en nuestra base de datos, complete el formulario aquí:\n🔗 https://www.one4cars.com/afiliar_clientes.php/',
            'ficha producto': 'Consulte fotos, medidas y compatibilidad técnica de nuestras autopartes en este enlace:\n🔗 https://www.one4cars.com/consulta_productos.php/',
            'despacho': 'Verifique el estatus de su envío, número de guía y empresa de transporte asignada:\n🔗 https://www.one4cars.com/despacho.php/',
            'asesor': 'He notificado a nuestro equipo. Un asesor humano revisará su chat para brindarle atención personalizada a la brevedad.'
        };

        for (const [key, val] of Object.entries(respuestas)) {
            if (body.includes(key)) return await sock.sendMessage(from, { text: titulo + val });
        }

        const saludos = ['hola', 'buen dia', 'saludos', 'buenas'];
        if (saludos.some(s => body.includes(s))) {
            const menu = '¡Hola! Bienvenido a *ONE4CARS* 🚗💨\n\nSoy tu asistente virtual. Escribe una *palabra clave* para ayudarte:\n\n' +
                         '🏦 *Medios de Pago*\n📄 *Estado de Cuenta*\n💰 *Lista de Precios*\n🛒 *Tomar Pedido*\n👥 *Afiliar Cliente*\n👥 *Mis Clientes*\n⚙️ *Ficha Producto*\n🚚 *Despacho*\n👤 *Asesor*';
            await sock.sendMessage(from, { text: menu });
        }
    });
}

const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    if (parsedUrl.pathname === '/cobranza') {
        const v = await cobranza.obtenerVendedores();
        const z = await cobranza.obtenerZonas();
        const d = await cobranza.obtenerListaDeudores(parsedUrl.query);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.write(`<html><head><title>ONE4CARS</title><link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet"></head><body class="bg-light">
            <div class="container bg-white shadow p-4 mt-3 rounded">
                <header class="d-flex justify-content-between align-items-center mb-4 border-bottom pb-2">
                    <h2 class="text-primary">🚗 ONE4CARS - Panel de Cobranza</h2>
                    <a href="/" class="btn btn-outline-secondary btn-sm">Estado QR</a>
                </header>
                <form class="row g-2 mb-4">
                    <div class="col-md-4"><select name="vendedor" class="form-select">${v.map(i=>`<option value="${i.nombre}" ${parsedUrl.query.vendedor===i.nombre?'selected':''}>${i.nombre}</option>`)}</select></div>
                    <div class="col-md-4"><select name="zona" class="form-select">${z.map(i=>`<option value="${i.zona}" ${parsedUrl.query.zona===i.zona?'selected':''}>${i.zona}</option>`)}</select></div>
                    <div class="col-md-2"><input type="number" name="dias" class="form-control" value="${parsedUrl.query.dias || 0}"></div>
                    <div class="col-md-2"><button class="btn btn-primary w-100">Filtrar</button></div>
                </form>
                <div class="table-responsive" style="max-height:450px;"><table class="table table-sm table-hover">
                    <thead class="table-dark"><tr><th><input type="checkbox" id="all"></th><th>Cliente</th><th>Factura</th><th>Saldo $</th><th>Días</th></tr></thead>
                    <tbody>${d.map(i=>`<tr><td><input type="checkbox" class="rowCheck" value='${JSON.stringify(i)}'></td><td><small>${i.nombres}</small></td><td><small>${i.nro_factura}</small></td><td class="text-danger"><b>$${parseFloat(i.saldo_pendiente).toFixed(2)}</b></td><td><span class="badge bg-warning text-dark">${i.dias_transcurridos}</span></td></tr>`).join('')}</tbody>
                </table></div>
                <button onclick="enviar()" id="btn" class="btn btn-success w-100 py-3 mt-3 fw-bold">🚀 ENVIAR RECORDATORIOS</button>
            </div>
            <script>
                document.getElementById('all').onclick = function() { document.querySelectorAll('.rowCheck').forEach(c => c.checked = this.checked); }
                async function enviar() {
                    const sel = Array.from(document.querySelectorAll('.rowCheck:checked')).map(cb => JSON.parse(cb.value));
                    if(sel.length === 0) return alert('Seleccione clientes');
                    const btn = document.getElementById('btn'); btn.disabled = true; btn.innerText = 'ENVIANDO...';
                    await fetch('/enviar-cobranza', { method:'POST', body: JSON.stringify({facturas:sel}) });
                    alert('Envío iniciado'); btn.disabled = false; btn.innerText = '🚀 ENVIAR RECORDATORIOS';
                }
            </script></body></html>`);
        res.end();
    } else if (parsedUrl.pathname === '/enviar-cobranza' && req.method === 'POST') {
        let b = ''; req.on('data', c => b += c);
        req.on('end', () => { cobranza.ejecutarEnvioMasivo(socketBot, JSON.parse(b).facturas); res.end("OK"); });
    } else {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<center style="margin-top:100px;"><h1>ONE4CARS BOT</h1>${qrCodeData.startsWith('data')?`<img src="${qrCodeData}">`:`<h3>${qrCodeData||"Iniciando..."}</h3>`}<br><br><a href="/cobranza" class="btn btn-primary">IR A COBRANZA</a></center>`);
    }
});

server.on('error', (e) => { if (e.code === 'EADDRINUSE') setTimeout(() => { server.close(); server.listen(port); }, 3000); });
server.listen(port, '0.0.0.0', () => { console.log("Puerto " + port); startBot(); });
