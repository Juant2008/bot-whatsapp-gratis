const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const mongoose = require('mongoose');
const qrcode = require('qrcode');
const http = require('http');
const pino = require('pino');
const url = require('url');
const { obtenerListaDeudores, ejecutarEnvioMasivo, obtenerDetalleFacturas } = require('./cobranza');

const mongoURI = "mongodb+srv://one4cars:v6228688@one4cars.fpwdlwe.mongodb.net/?appName=one4cars";
let qrCodeData = "";
global.sockBot = null;

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
    // Lógica de menús automáticos (Se mantiene igual)
    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe || msg.key.remoteJid.includes('@g.us')) return;
        const from = msg.key.remoteJid;
        const body = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").toLowerCase().trim();
        if (body.includes('hola') || body.includes('buen')) {
            await sock.sendMessage(from, { text: 'Hola! Bienvenido a *ONE4CARS* 🚗. Escribe tu opción:\n\n🏦 *Medios de Pago*\n📄 *Estado de Cuenta*\n💰 *Lista de Precios*\n👤 *Asesor*' });
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
            <label class="debt-card">
                <input type="checkbox" name="facturas" value="${d.nro_factura}" checked class="user-check">
                <div class="card-content">
                    <div class="card-main">
                        <span class="client-name">${d.nombres}</span>
                        <span class="invoice-id">Fac: ${d.nro_factura}</span>
                    </div>
                    <div class="card-details">
                        <span class="days">${d.dias_mora} días</span>
                        <span class="amount">$${parseFloat(d.saldo_pendiente).toFixed(2)}</span>
                    </div>
                </div>
            </label>`).join('');

        res.write(`
        <!DOCTYPE html><html><head>
        <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
        <style>
            body { font-family: -apple-system, sans-serif; background: #f2f2f7; margin: 0; padding-bottom: 120px; color: #1c1c1e; }
            .header { background: #007aff; color: white; padding: 20px 15px; text-align: center; position: sticky; top: 0; z-index: 10; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
            .header h2 { margin: 0; font-size: 18px; }
            .selector-bar { background: white; padding: 12px 20px; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #d1d1d6; font-size: 14px; font-weight: 600; }
            .debt-card { background: white; border-radius: 12px; padding: 16px; margin: 10px; display: flex; align-items: center; box-shadow: 0 1px 3px rgba(0,0,0,0.1); transition: 0.2s; -webkit-tap-highlight-color: transparent; }
            .debt-card:active { background: #e5e5ea; }
            .user-check { width: 24px; height: 24px; margin-right: 15px; accent-color: #007aff; }
            .card-content { flex-grow: 1; display: flex; flex-direction: column; }
            .card-main { display: flex; justify-content: space-between; align-items: baseline; }
            .client-name { font-weight: 700; font-size: 15px; text-transform: uppercase; max-width: 70%; overflow: hidden; text-overflow: ellipsis; }
            .invoice-id { font-size: 12px; color: #8e8e93; }
            .card-details { display: flex; justify-content: space-between; margin-top: 5px; align-items: center; }
            .days { font-size: 12px; font-weight: bold; color: #ff9500; background: #fff2e0; padding: 2px 6px; border-radius: 4px; }
            .amount { font-weight: 800; color: #ff3b30; font-size: 17px; }
            .footer { position: fixed; bottom: 0; width: 100%; background: rgba(255,255,255,0.9); padding: 15px; border-top: 1px solid #d1d1d6; backdrop-filter: blur(10px); box-sizing: border-box; }
            .btn-send { background: #34c759; color: white; border: none; padding: 16px; border-radius: 14px; font-weight: bold; width: 100%; font-size: 17px; box-shadow: 0 4px 12px rgba(52,199,89,0.3); }
        </style>
        <script>
            function toggleAll(source) {
                const checkboxes = document.querySelectorAll('.user-check');
                checkboxes.forEach(c => c.checked = source.checked);
            }
        </script>
        </head><body>
        <div class="header"><h2>Cobranza ONE4CARS</h2></div>
        <div class="selector-bar">
            <span>${deudores.length} Pendientes</span>
            <label style="display:flex; align-items:center; color:#007aff;"><input type="checkbox" id="master" checked onclick="toggleAll(this)" style="margin-right:8px;"> Marcar Todos</label>
        </div>
        <form action="/confirmar-envio" method="GET">
            ${cards || '<div style="text-align:center; padding:50px; color:gray;">No hay deudas de >300 días</div>'}
            ${cards ? '<div class="footer"><button type="submit" class="btn-send">🚀 Enviar a Seleccionados</button></div>' : ''}
        </form>
        </body></html>`);
        res.end();
    } 
    else if (parsedUrl.pathname === '/confirmar-envio') {
        let fIds = parsedUrl.query.facturas;
        if (!fIds) return res.end("Error: No seleccionaste nada.");
        if (!Array.isArray(fIds)) fIds = [fIds];

        res.write(`<html><body style="font-family:sans-serif; text-align:center; padding:50px 20px; background:#f2f2f7;">
            <div style="background:white; padding:30px; border-radius:20px; box-shadow:0 4px 10px rgba(0,0,0,0.1);">
                <h1 style="color:#34c759;">🚀 ¡Envío en Marcha!</h1>
                <p>Consultando teléfonos para <b>${fIds.length}</b> facturas.</p>
                <p>El bot trabajará en segundo plano. Puedes volver ahora.</p>
                <br><a href="/cobrar-ahora" style="display:inline-block; background:#007aff; color:white; padding:12px 25px; border-radius:10px; text-decoration:none; font-weight:bold;">← Volver al Panel</a>
            </div>
        </body></html>`);
        res.end();

        if (global.sockBot) {
            obtenerDetalleFacturas(fIds).then(deudoresFinales => {
                ejecutarEnvioMasivo(global.sockBot, deudoresFinales);
            });
        }
    } 
    else {
        res.write(`<center style="margin-top:100px; font-family:sans-serif;">
            ${qrCodeData.includes("data:image") ? `<h1>Vincular Bot</h1><img src="${qrCodeData}" width="300">` : `<h1>✅ BOT ONLINE</h1><a href="/cobrar-ahora" style="color:#007aff; font-size:20px; text-decoration:none;">💰 Ir a Panel de Cobranza</a>`}
        </center>`);
        res.end();
    }
});

server.listen(port, '0.0.0.0', () => {
    mongoose.connect(mongoURI).then(() => {
        console.log("✅ MongoDB OK");
        startBot();
    });
});
