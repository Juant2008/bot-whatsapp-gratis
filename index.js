const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const mongoose = require('mongoose');
const qrcode = require('qrcode');
const http = require('http');
const pino = require('pino');
const url = require('url');
const { obtenerListaDeudores, ejecutarEnvioMasivo, obtenerVendedores, obtenerZonas } = require('./cobranza');

// CONFIGURACIÓN MONGODB
const mongoURI = "mongodb+srv://one4cars:v6228688@one4cars.fpwdlwe.mongodb.net/?retryWrites=true&w=majority";
let qrCodeData = "";
global.sockBot = null;
let deudoresEnMemoria = []; 

mongoose.connect(mongoURI).then(() => console.log("✅ MongoDB OK")).catch(err => console.log("❌ Error MongoDB"));

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_info');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version, auth: state, printQRInTerminal: false, logger: pino({ level: 'error' }),
        browser: ["ONE4CARS Bot", "Chrome", "1.0.0"], syncFullHistory: false,
        shouldIgnoreJid: jid => jid.includes('broadcast') || jid.includes('@g.us'), 
        connectTimeoutMs: 60000
    });

    global.sockBot = sock;
    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) qrcode.toDataURL(qr, (err, url) => { qrCodeData = url; });
        if (connection === 'close') {
            const statusCode = (lastDisconnect.error instanceof Boom)?.output?.statusCode;
            if (statusCode !== DisconnectReason.loggedOut) setTimeout(() => startBot(), 5000);
        } else if (connection === 'open') { qrCodeData = "BOT ONLINE ✅"; }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe || msg.key.remoteJid.includes('@g.us')) return;

        const from = msg.key.remoteJid;
        const body = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").toLowerCase().trim();
        const saludoEnlace = 'Saludos estimado, toque el siguiente enlace para ';

        // LÓGICA DE BOTONES Y AUTO-RESPUESTAS
        if (body.includes('medios de pago')) await sock.sendMessage(from, { text: `${saludoEnlace} consultar:\n\n👉 *MEDIOS DE PAGO*\nhttps://www.one4cars.com/medios_de_pago.php` });
        else if (body.includes('estado de cuenta')) await sock.sendMessage(from, { text: `${saludoEnlace} obtener su:\n\n👉 *ESTADO DE CUENTA*\nhttps://www.one4cars.com/estado_de_cuenta_cliente.php` });
        else if (body.includes('lista de precios')) await sock.sendMessage(from, { text: `${saludoEnlace} ver nuestra:\n\n👉 *LISTA DE PRECIOS*\nhttps://www.one4cars.com/lista_de_precios.php` });
        else if (body.includes('afiliar cliente')) await sock.sendMessage(from, { text: `${saludoEnlace} realizar la:\n\n👉 *AFILIAR CLIENTE*\nhttps://www.one4cars.com/afiliacion_cliente.php` });
        else if (body.includes('aprobar cliente')) await sock.sendMessage(from, { text: `${saludoEnlace} gestionar la:\n\n👉 *APROBACIÓN DE CLIENTE*\nhttps://www.one4cars.com/aprobadora_clientes.php` });
        else if (body.includes('asesor')) await sock.sendMessage(from, { text: 'Saludos estimado, en un momento un asesor se comunicará con usted.' });
        else {
            const saludos = ['hola', 'buendia', 'buen dia', 'buenos dias', 'buenas tardes', 'saludos'];
            if (saludos.some(s => body.includes(s))) {
                await sock.sendMessage(from, { text: 'Hola! Bienvenido a *ONE4CARS* 🚗. Tu asistente virtual está listo para apoyarte.\n\nEscribe la frase de la opción que necesitas:\n\n📲 *Menú de Gestión Comercial*\n\n🏦 *Medios de Pago*\n📄 *Estado de Cuenta*\n💰 *Lista de Precios*\n🛒 *Tomar Pedido*\n👥 *Mis Clientes*\n📝 *Afiliar Cliente*\n⚙️ *Ficha Producto*\n🚚 *Despacho*\n👤 *Asesor*' });
            }
        }
    });
}

// SERVIDOR DASHBOARD (RESPONSIVO iPHONE)
const port = process.env.PORT || 10000;
const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });

    if (parsedUrl.pathname === '/cobrar-ahora') {
        const vends = await obtenerVendedores();
        const zons = await obtenerZonas();
        deudoresEnMemoria = await obtenerListaDeudores(parsedUrl.query);
        
        let cards = deudoresEnMemoria.map((d, i) => `
            <label class="card">
                <input type="checkbox" name="facturas" value="${d.nro_factura}" checked class="user-check">
                <div class="card-body">
                    <div class="c-name">${d.nombres}</div>
                    <div class="c-sub">Fac: ${d.nro_factura} • ${d.vendedor_nom || ''}</div>
                    <div class="c-tag">📍 ${d.zona_nom || ''}</div>
                </div>
                <div class="c-price">
                    <div class="val">$${parseFloat(d.saldo_pendiente).toFixed(2)}</div>
                    <div class="days">${d.dias_transcurridos} d&iacute;as</div>
                </div>
            </label>`).join('');

        res.write(`<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
        <style>
            body { font-family: -apple-system, sans-serif; background: #f2f2f7; margin: 0; padding-bottom: 120px; }
            .nav { background: #007aff; color: white; padding: 15px; text-align: center; position: sticky; top: 0; z-index: 10; font-weight: bold; }
            .filters { background: white; padding: 15px; border-bottom: 1px solid #ddd; }
            select, input { width: 100%; padding: 12px; margin-bottom: 8px; border: 1px solid #ccc; border-radius: 10px; font-size: 14px; box-sizing: border-box; }
            .btn-f { background: #007aff; color: white; border: none; padding: 12px; border-radius: 10px; width: 100%; font-weight: bold; }
            .card { background: white; border-radius: 15px; padding: 15px; margin: 10px; display: flex; align-items: center; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
            .card-body { flex-grow: 1; padding-left: 12px; overflow: hidden; }
            .c-name { font-weight: bold; font-size: 14px; text-transform: uppercase; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            .c-sub { font-size: 11px; color: #8e8e93; }
            .c-tag { font-size: 10px; color: #007aff; font-weight: bold; }
            .c-price { text-align: right; min-width: 80px; }
            .val { font-weight: 800; color: #ff3b30; font-size: 16px; }
            .days { font-size: 11px; color: #ff9500; font-weight: bold; }
            .footer { position: fixed; bottom: 0; width: 100%; background: rgba(255,255,255,0.9); padding: 15px; border-top: 1px solid #ddd; backdrop-filter: blur(10px); box-sizing: border-box; }
            .btn-s { background: #34c759; color: white; border: none; padding: 16px; border-radius: 12px; font-weight: bold; width: 100%; font-size: 16px; }
            input[type="checkbox"] { width: 22px; height: 22px; }
        </style></head><body>
        <div class="nav">Cobranza ONE4CARS</div>
        <form action="/cobrar-ahora" class="filters">
            <select name="id_vendedor"><option value="">Vendedores</option>${vends.map(v=>`<option value="${v.id_vendedor}">${v.nombre}</option>`)}</select>
            <select name="id_zona"><option value="">Zonas</option>${zons.map(z=>`<option value="${z.id_zona}">${z.zona}</option>`)}</select>
            <input type="number" name="dias" placeholder="Min. d&iacute;as de mora" value="${parsedUrl.query.dias || 30}">
            <button type="submit" class="btn-f">🔍 Generar Reporte</button>
        </form>
        <form action="/confirmar-envio" method="GET">
            ${cards || '<p style="text-align:center; padding:20px;">Sin facturas.</p>'}
            ${cards ? '<div class="footer"><button type="submit" class="btn-s">🚀 ENVIAR WHATSAPP</button></div>' : ''}
        </form>
        </body></html>`);
        res.end();
    } 
    else if (parsedUrl.pathname === '/confirmar-envio') {
        let facturas = parsedUrl.query.facturas;
        if (!Array.isArray(facturas)) facturas = [facturas];
        const seleccionados = deudoresEnMemoria.filter(d => facturas.includes(d.nro_factura));
        res.write('<html><body style="font-family:sans-serif; text-align:center; padding-top:50px;"><h1>🚀 Envío Iniciado</h1><p>Enviando a '+seleccionados.length+' clientes.</p><a href="/cobrar-ahora">Volver</a></body></html>');
        res.end();
        if (global.sockBot && seleccionados.length > 0) ejecutarEnvioMasivo(global.sockBot, seleccionados);
    } 
    else {
        res.write(`<center style="padding-top:100px;">${qrCodeData.includes("data:image") ? `<h1>Escanea el QR</h1><img src="${qrCodeData}" width="300">` : `<h1>✅ BOT ONLINE</h1><a href="/cobrar-ahora">Ir al Panel de Cobranza</a>`}</center>`);
        res.end();
    }
});

server.listen(port, '0.0.0.0', () => {
    console.log(`✅ Servidor listo puerto ${port}`);
    startBot();
});
