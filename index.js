const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const mongoose = require('mongoose');
const qrcode = require('qrcode');
const http = require('http');
const pino = require('pino');
const url = require('url');
const { obtenerListaDeudores, ejecutarEnvioMasivo } = require('./cobranza');

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
        else if (body.includes('asesor')) await sock.sendMessage(from, { text: 'Saludos estimado, un asesor se comunicará con usted en breve.' });
        else {
            const saludos = ['hola', 'buendia', 'buen dia', 'buenos dias', 'buenas tardes'];
            if (saludos.some(s => body.includes(s))) {
                await sock.sendMessage(from, { text: 'Hola! Bienvenido a *ONE4CARS* 🚗. Tu asistente virtual está listo para apoyarte.\n\nEscribe la frase de la opción que necesitas:\n\n📲 *Menú de Gestión Comercial*\n🏦 *Medios de Pago*\n📄 *Estado de Cuenta*\n💰 *Lista de Precios*\n🛒 *Tomar Pedido*\n👥 *Mis Clientes*\n📝 *Afiliar Cliente*\n⚙️ *Ficha Producto*\n🚚 *Despacho*\n👤 *Asesor*' });
            }
        }
    });
}

const port = process.env.PORT || 10000;
const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });

    if (parsedUrl.pathname === '/cobrar-ahora') {
        deudoresEnMemoria = await obtenerListaDeudores();
        let cards = deudoresEnMemoria.map(d => `
            <label class="card">
                <input type="checkbox" name="facturas" value="${d.nro_factura}" checked class="user-check">
                <div class="card-info">
                    <div class="c-name">${d.nombres}</div>
                    <div class="c-sub">Fac: ${d.nro_factura}</div>
                </div>
                <div class="c-price">
                    <div class="val">$${parseFloat(d.saldo_pendiente).toFixed(2)}</div>
                </div>
            </label>`).join('');

        res.write(`<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
            body { font-family: sans-serif; background: #f2f2f7; margin: 0; padding-bottom: 100px; }
            .nav { background: #007aff; color: white; padding: 15px; text-align: center; font-weight: bold; position: sticky; top: 0; }
            .card { background: white; border-radius: 15px; padding: 15px; margin: 10px; display: flex; align-items: center; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
            .card-info { flex-grow: 1; padding-left: 10px; overflow: hidden; }
            .c-name { font-weight: bold; font-size: 14px; text-transform: uppercase; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            .c-sub { font-size: 11px; color: #8e8e93; }
            .c-price { text-align: right; min-width: 80px; }
            .val { font-weight: 800; color: #ff3b30; font-size: 16px; }
            .footer { position: fixed; bottom: 0; width: 100%; background: white; padding: 15px; border-top: 1px solid #ddd; box-sizing: border-box; }
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
        <form action="/confirmar-envio" method="GET">
            <div style="padding: 10px; display: flex; justify-content: space-between; font-size: 12px;">
                <span>Total: ${deudoresEnMemoria.length}</span>
                <label><input type="checkbox" checked onclick="toggleAll(this)"> Todos</label>
            </div>
            ${cards || '<p style="text-align:center; padding:20px;">No hay facturas.</p>'}
            ${cards ? '<div class="footer"><button type="submit" class="btn-s">🚀 ENVIAR WHATSAPP</button></div>' : ''}
        </form>
        </body></html>`);
        res.end();
    } 
    else if (parsedUrl.pathname === '/confirmar-envio') {
        let fIds = parsedUrl.query.facturas;
        if (!fIds) return res.end("Nada seleccionado.");
        if (!Array.isArray(fIds)) fIds = [fIds];
        const aEnviar = deudoresEnMemoria.filter(d => fIds.includes(d.nro_factura));
        res.write('<html><body style="font-family:sans-serif; text-align:center; padding-top:50px;"><h1>🚀 Iniciando Envío</h1><p>Enviando a '+aEnviar.length+' clientes...</p><a href="/cobrar-ahora">Volver</a></body></html>');
        res.end();
        if (global.sockBot) ejecutarEnvioMasivo(global.sockBot, aEnviar);
    } 
    else {
        if (qrCodeData.includes("data:image")) {
            res.write(`<center style="padding-top:100px;"><h1>Escanea el QR</h1><img src="${qrCodeData}" width="300"></center>`);
        } else {
            res.write(`<center style="padding-top:100px;"><h1>✅ BOT ONLINE</h1><p><a href="/cobrar-ahora">Ir al Panel de Cobranza</a></p></center>`);
        }
        res.end();
    }
});

server.listen(port, '0.0.0.0', () => {
    console.log(`✅ Servidor listo puerto ${port}`);
    startBot();
});
