const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const mongoose = require('mongoose');
const qrcode = require('qrcode');
const http = require('http');
const pino = require('pino');
const url = require('url');
const { obtenerListaDeudores, ejecutarEnvioMasivo, obtenerVendedores, obtenerZonas, obtenerDetalleFacturas } = require('./cobranza');

const mongoURI = "mongodb+srv://one4cars:v6228688@one4cars.fpwdlwe.mongodb.net/?retryWrites=true&w=majority";
let qrCodeData = "";
global.sockBot = null;

mongoose.connect(mongoURI).then(() => console.log("✅ MongoDB OK")).catch(err => console.log("❌ Error MongoDB"));

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const { version } = await fetchLatestBaileysVersion();
    const sock = makeWASocket({
        version, auth: state, printQRInTerminal: false, logger: pino({ level: 'error' }),
        browser: ["ONE4CARS Bot", "Chrome", "1.0.0"], syncFullHistory: false,
        shouldIgnoreJid: jid => jid.includes('broadcast') || jid.includes('@g.us'), connectTimeoutMs: 60000
    });
    global.sockBot = sock;
    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', (u) => {
        if (u.qr) qrcode.toDataURL(u.qr, (err, url) => { qrCodeData = url; });
        if (u.connection === 'open') qrCodeData = "BOT ONLINE ✅";
        if (u.connection === 'close') {
            if ((u.lastDisconnect.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut) setTimeout(startBot, 5000);
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe || msg.key.remoteJid.includes('@g.us')) return;
        const from = msg.key.remoteJid;
        const body = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").toLowerCase().trim();
        const saludo = 'Saludos estimado, toque el enlace para ';

        if (body.includes('medios de pago')) await sock.sendMessage(from, { text: `${saludo} consultar:\n\n👉 *MEDIOS DE PAGO*\nhttps://www.one4cars.com/medios_de_pago.php` });
        else if (body.includes('estado de cuenta')) await sock.sendMessage(from, { text: `${saludo} obtener su:\n\n👉 *ESTADO DE CUENTA*\nhttps://www.one4cars.com/estado_de_cuenta_cliente.php` });
        else if (body.includes('lista de precios')) await sock.sendMessage(from, { text: `${saludo} ver nuestra:\n\n👉 *LISTA DE PRECIOS*\nhttps://www.one4cars.com/lista_de_precios.php` });
        else if (body.includes('afiliar cliente')) await sock.sendMessage(from, { text: `${saludo} realizar la:\n\n👉 *AFILIAR CLIENTE*\nhttps://www.one4cars.com/afiliacion_cliente.php` });
        else if (body.includes('aprobar cliente')) await sock.sendMessage(from, { text: `${saludo} gestionar la:\n\n👉 *APROBACIÓN DE CLIENTE*\nhttps://www.one4cars.com/aprobadora_clientes.php` });
        else if (body.includes('mis clientes')) await sock.sendMessage(from, { text: `${saludo} gestionar su:\n\n👉 *CARTERA DE CLIENTES*\nhttps://www.one4cars.com/acceso_vendedores.php` });
        else if (body.includes('ficha producto')) await sock.sendMessage(from, { text: `${saludo} consultar la:\n\n👉 *FICHA DE PRODUCTO*\nhttps://www.one4cars.com/consulta_productos.php` });
        else if (body.includes('despacho')) await sock.sendMessage(from, { text: `${saludo} ver su:\n\n👉 *SEGUIMIENTO DE DESPACHO*\nhttps://www.one4cars.com/despacho_cliente_web.php` });
        else if (body.includes('asesor')) await sock.sendMessage(from, { text: 'Saludos estimado, en un momento un asesor se comunicará con usted de forma manual.' });
        else {
            const saludos = ['hola', 'buendia', 'buen dia', 'buenos dias', 'buenas tardes', 'saludos'];
            if (saludos.some(s => body.includes(s))) {
                await sock.sendMessage(from, { text: 'Hola! Bienvenido a *ONE4CARS* 🚗.\n\nEscribe la opción:\n\n🏦 *Medios de Pago*\n📄 *Estado de Cuenta*\n💰 *Lista de Precios*\n🛒 *Tomar Pedido*\n👥 *Mis Clientes*\n📝 *Afiliar Cliente*\n⚙️ *Ficha Producto*\n🚚 *Despacho*\n👤 *Asesor*' });
            }
        }
    });
}

const port = process.env.PORT || 10000;
const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });

    if (parsedUrl.pathname === '/cobrar-ahora') {
        const vends = await obtenerVendedores();
        const zons = await obtenerZonas();
        const deudores = await obtenerListaDeudores(parsedUrl.query);
        
        let cards = deudores.map(d => `
            <label class="card">
                <input type="checkbox" name="facturas" value="${d.nro_factura}" checked class="user-check">
                <div class="card-info">
                    <div class="c-name">${d.nombres}</div>
                    <div class="c-sub">Fac: ${d.nro_factura} • ${d.vendedor_nom || 'S/V'}</div>
                </div>
                <div class="c-price">
                    <div class="val">$${parseFloat(d.saldo_pendiente).toFixed(2)}</div>
                    <div class="days">${d.dias_transcurridos} días</div>
                </div>
            </label>`).join('');

        res.write(`<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
            body { font-family: -apple-system, sans-serif; background: #f2f2f7; margin: 0; padding-bottom: 100px; }
            .nav { background: #007aff; color: white; padding: 15px; text-align: center; position: sticky; top: 0; z-index: 10; font-weight: bold; }
            .filters { background: white; padding: 15px; border-bottom: 1px solid #ddd; }
            select, input { width: 100%; padding: 12px; margin-bottom: 8px; border: 1px solid #ccc; border-radius: 10px; font-size: 14px; -webkit-appearance: none; }
            .btn-f { background: #007aff; color: white; border: none; padding: 12px; width: 100%; border-radius: 10px; font-weight: bold; }
            .card { background: white; border-radius: 15px; padding: 15px; margin: 10px; display: flex; align-items: center; box-shadow: 0 1px 2px rgba(0,0,0,0.1); }
            .card-info { flex-grow: 1; padding-left: 12px; overflow: hidden; }
            .c-name { font-weight: bold; font-size: 14px; text-transform: uppercase; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            .c-sub { font-size: 11px; color: #8e8e93; }
            .c-price { text-align: right; min-width: 85px; }
            .val { font-weight: 800; color: #ff3b30; font-size: 16px; }
            .days { font-size: 11px; color: #ff9500; font-weight: bold; }
            .footer { position: fixed; bottom: 0; width: 100%; background: rgba(255,255,255,0.9); padding: 15px; border-top: 1px solid #ddd; backdrop-filter: blur(10px); box-sizing: border-box; }
            .btn-s { background: #34c759; color: white; border: none; padding: 16px; border-radius: 12px; font-weight: bold; width: 100%; font-size: 16px; }
            input[type="checkbox"] { width: 22px; height: 22px; }
        </style>
        <script>
            function toggleAll(source) {
                const checkboxes = document.querySelectorAll('.user-check');
                checkboxes.forEach(c => c.checked = source.checked);
            }
        </script></head><body>
        <div class="nav">Cobranza ONE4CARS</div>
        <form action="/cobrar-ahora" class="filters">
            <select name="vendedor"><option value="">Todos los Vendedores</option>${vends.map(v=>`<option value="${v.nombre}">${v.nombre}</option>`)}</select>
            <select name="zona"><option value="">Todas las Zonas</option>${zons.map(z=>`<option value="${z.zona}">${z.zona}</option>`)}</select>
            <input type="number" name="dias" placeholder="Mínimo días" value="${parsedUrl.query.dias || 30}">
            <button type="submit" class="btn-f">Generar Reporte</button>
        </form>
        <form action="/confirmar-envio" method="GET">
            <div style="padding: 10px; display: flex; justify-content: space-between; font-size: 12px;">
                <span>Total: ${deudores.length}</span>
                <label><input type="checkbox" checked onclick="toggleAll(this)"> Seleccionar Todos</label>
            </div>
            ${cards || '<p style="text-align:center; padding:20px;">Sin resultados.</p>'}
            ${cards ? '<div class="footer"><button type="submit" class="btn-s">ENVIAR WHATSAPP</button></div>' : ''}
        </form>
        </body></html>`);
        res.end();
    } 
    else if (parsedUrl.pathname === '/confirmar-envio') {
        let fIds = parsedUrl.query.facturas;
        if (!fIds) return res.end("No seleccionaste nada.");
        if (!Array.isArray(fIds)) fIds = [fIds];
        
        res.write('<html><body style="font-family:sans-serif; text-align:center; padding-top:50px;"><h1>🚀 Envío Iniciado</h1><p>Consultando teléfonos...</p></body></html>');
        res.end();

        if (global.sockBot) {
            obtenerDetalleFacturas(fIds).then(rows => {
                ejecutarEnvioMasivo(global.sockBot, rows);
            });
        }
    } 
    else {
        if (qrCodeData.includes("data:image")) {
            res.write(`<center style="padding-top:100px;"><h1>Escanea el QR</h1><img src="${qrCodeData}" width="300"></center>`);
        } else {
            res.write(`<center style="padding-top:100px;"><h1>✅ BOT ONLINE</h1><p><a href="/cobrar-ahora">Entrar al Panel</a></p></center>`);
        }
        res.end();
    }
});

server.listen(port, '0.0.0.0', () => {
    console.log(`✅ Servidor Dashboard OK puerto ${port}`);
    startBot();
});
