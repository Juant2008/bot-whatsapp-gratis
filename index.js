const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const mongoose = require('mongoose');
const qrcode = require('qrcode');
const http = require('http');
const pino = require('pino');
const url = require('url');
const { obtenerListaDeudores, ejecutarEnvioMasivo, obtenerDetalleFacturas, obtenerVendedores, obtenerZonas } = require('./cobranza');

const mongoURI = "mongodb+srv://one4cars:v6228688@one4cars.fpwdlwe.mongodb.net/?appName=one4cars";
let qrCodeData = "";
global.sockBot = null;

mongoose.connect(mongoURI).then(() => console.log("✅ Memoria MongoDB OK")).catch(err => console.log("❌ Error MongoDB"));

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
        if (body.includes('hola') || body.includes('buen')) {
            await sock.sendMessage(from, { text: 'Hola! Bienvenido a *ONE4CARS* 🚗. Tu asistente virtual está activo.' });
        }
    });
}

const port = process.env.PORT || 10000;
const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });

    if (parsedUrl.pathname === '/cobrar-ahora') {
        const deudores = await obtenerListaDeudores();
        let cards = deudores.map(d => `
            <label class="card" style="display:flex; background:white; margin:10px; padding:15px; border-radius:12px; align-items:center; box-shadow:0 2px 5px rgba(0,0,0,0.1);">
                <input type="checkbox" name="facturas" value="${d.nro_factura}" checked style="width:25px;height:25px;">
                <div style="flex-grow:1; margin-left:12px;">
                    <b style="font-size:14px; text-transform:uppercase;">${d.nombres}</b><br>
                    <small style="color:#666;">Fac: ${d.nro_factura} • ${d.dias_mora} días</small>
                </div>
                <div style="font-weight:bold; color:#ff3b30;">$${parseFloat(d.saldo_pendiente).toFixed(2)}</div>
            </label>`).join('');

        res.write(`<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>body{font-family:sans-serif; background:#f2f2f7; margin:0; padding-bottom:100px;}</style></head>
        <body>
            <div style="background:#007aff; color:white; padding:20px; text-align:center;"><h2>Panel Cobranza</h2></div>
            <form action="/confirmar-envio" method="GET">
                ${cards || '<p style="text-align:center; padding:30px;">Sin deudas pendientes.</p>'}
                <div style="position:fixed; bottom:0; width:100%; background:white; padding:15px; border-top:1px solid #ccc; box-sizing:border-box;">
                    <button type="submit" style="background:#34c759; color:white; border:none; width:100%; padding:18px; border-radius:12px; font-weight:bold; font-size:16px;">🚀 ENVIAR WHATSAPP</button>
                </div>
            </form>
        </body></html>`);
        res.end();
    } 
    else if (parsedUrl.pathname === '/confirmar-envio') {
        let fIds = parsedUrl.query.facturas;
        if (!fIds) return res.end("Nada seleccionado.");
        if (!Array.isArray(fIds)) fIds = [fIds];

        obtenerDetalleFacturas(fIds).then(deudoresFinales => {
            res.write(`<html><body style="font-family:sans-serif; text-align:center; padding-top:50px;">
                <h1>🚀 ¡Envío Iniciado!</h1>
                <p>Se están procesando <b>${deudoresFinales.length}</b> facturas.</p>
                <p>El bot limpiará los números y enviará los mensajes ahora.</p>
                <br><a href="/cobrar-ahora">Volver al Panel</a>
            </body></html>`);
            res.end();

            if (global.sockBot && deudoresFinales.length > 0) {
                ejecutarEnvioMasivo(global.sockBot, deudoresFinales);
            }
        });
    } 
    else {
        if (qrCodeData.includes("data:image")) {
            res.write(`<center style="margin-top:100px;"><h1>Vincular Bot</h1><img src="${qrCodeData}" width="300"></center>`);
        } else {
            res.write(`<center style="margin-top:100px;"><h1>✅ BOT ONLINE</h1><a href="/cobrar-ahora">💰 Ir a Cobranza</a></center>`);
        }
        res.end();
    }
});

server.listen(port, '0.0.0.0', () => {
    console.log(`✅ Servidor en puerto ${port}`);
    startBot();
});
