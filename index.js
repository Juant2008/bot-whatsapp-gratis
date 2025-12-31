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

// Función para conectar a WhatsApp
async function startBot() {
    try {
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
                const code = (u.lastDisconnect.error instanceof Boom)?.output?.statusCode;
                if (code !== DisconnectReason.loggedOut) {
                    console.log("🔄 Reconectando...");
                    setTimeout(startBot, 5000);
                }
            }
        });

        sock.ev.on('messages.upsert', async ({ messages, type }) => {
            if (type !== 'notify') return;
            const msg = messages[0];
            if (!msg.message || msg.key.fromMe || msg.key.remoteJid.includes('@g.us')) return;
            const from = msg.key.remoteJid;
            const body = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").toLowerCase().trim();
            const saludoE = 'Saludos estimado, toque el enlace para ';

            if (body.includes('medios de pago')) await sock.sendMessage(from, { text: `${saludoE} consultar:\n\n👉 *MEDIOS DE PAGO*\nhttps://www.one4cars.com/medios_de_pago.php` });
            else if (body.includes('estado de cuenta')) await sock.sendMessage(from, { text: `${saludoE} obtener su:\n\n👉 *ESTADO DE CUENTA*\nhttps://www.one4cars.com/estado_de_cuenta_cliente.php` });
            else if (body.includes('lista de precios')) await sock.sendMessage(from, { text: `${saludoE} ver nuestra:\n\n👉 *LISTA DE PRECIOS*\nhttps://www.one4cars.com/lista_de_precios.php` });
            else if (body.includes('afiliar cliente')) await sock.sendMessage(from, { text: `${saludoE} realizar la:\n\n👉 *AFILIAR CLIENTE*\nhttps://www.one4cars.com/afiliacion_cliente.php` });
            else if (body.includes('asesor')) await sock.sendMessage(from, { text: 'Saludos estimado, un asesor se comunicará con usted en breve.' });
            else if (['hola', 'buendia', 'buen dia', 'buenos dias', 'buenas tardes', 'saludos'].some(s => body.includes(s))) {
                await sock.sendMessage(from, { text: 'Hola! Bienvenido a *ONE4CARS* 🚗. Escribe la opción:\n\n🏦 *Medios de Pago*\n📄 *Estado de Cuenta*\n💰 *Lista de Precios*\n🛒 *Tomar Pedido*\n👥 *Mis Clientes*\n📝 *Afiliar Cliente*\n⚙️ *Ficha Producto*\n🚚 *Despacho*\n👤 *Asesor*' });
            }
        });
    } catch (e) { console.log("Error en startBot:", e); }
}

// Servidor Web: Se inicia ANTES que cualquier base de datos para evitar el Bad Gateway
const port = process.env.PORT || 10000;
const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });

    if (parsedUrl.pathname === '/cobrar-ahora') {
        deudoresEnMemoria = await obtenerListaDeudores();
        let cards = deudoresEnMemoria.map(d => `
            <label style="display:flex; background:white; margin:10px; padding:15px; border-radius:10px; align-items:center; border-bottom:2px solid #ddd;">
                <input type="checkbox" name="facturas" value="${d.nro_factura}" checked style="width:20px;height:20px;">
                <div style="flex-grow:1; margin-left:10px;">
                    <b>${d.nombres}</b><br><small>Fac: ${d.nro_factura} • ${d.dias_mora} días</small>
                </div>
                <div style="color:red; font-weight:bold;">$${parseFloat(d.saldo_pendiente).toFixed(2)}</div>
            </label>`).join('');

        res.write(`<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
        <body style="font-family:sans-serif; background:#f2f2f7; margin:0;">
            <div style="background:#007aff; color:white; padding:15px; text-align:center;"><h2>ONE4CARS Cobranza</h2></div>
            <form action="/confirmar-envio" method="GET">
                ${cards || '<p style="text-align:center;">No hay facturas.</p>'}
                <div style="position:fixed; bottom:0; width:100%; background:white; padding:15px; box-sizing:border-box;">
                    <button type="submit" style="background:#34c759; color:white; border:none; width:100%; padding:15px; border-radius:10px; font-weight:bold;">🚀 ENVIAR WHATSAPP</button>
                </div>
            </form>
        </body></html>`);
        res.end();
    } 
    else if (parsedUrl.pathname === '/confirmar-envio') {
        let fIds = parsedUrl.query.facturas;
        if (!fIds) return res.end("Error: Nada seleccionado.");
        if (!Array.isArray(fIds)) fIds = [fIds];
        const seleccionados = deudoresEnMemoria.filter(d => fIds.includes(d.nro_factura));
        res.write('<h1>🚀 Envío Iniciado</h1><p>Consultando '+seleccionados.length+' clientes.</p><a href="/cobrar-ahora">Volver</a>');
        res.end();
        if (global.sockBot) ejecutarEnvioMasivo(global.sockBot, seleccionados);
    } 
    else {
        if (qrCodeData.includes("data:image")) {
            res.write(`<center><h1>Escanea el QR</h1><img src="${qrCodeData}" width="300"></center>`);
        } else {
            res.write(`<center style="margin-top:50px;"><h1>✅ BOT ONLINE</h1><a href="/cobrar-ahora" style="font-size:20px;">💰 Entrar a Cobranza</a></center>`);
        }
        res.end();
    }
});

server.listen(port, '0.0.0.0', () => {
    console.log(`✅ Servidor en puerto ${port}`);
    // Conectamos a MongoDB y WhatsApp DESPUÉS de que el servidor web ya respondió a Render
    mongoose.connect(mongoURI)
        .then(() => {
            console.log("✅ MongoDB OK");
            startBot();
        })
        .catch(err => console.log("❌ Error inicial:", err));
});
