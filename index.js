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
        if (qr) {
            qrcode.toDataURL(qr, (err, url) => { qrCodeData = url; });
        }
        if (connection === 'close') {
            const statusCode = (lastDisconnect.error instanceof Boom)?.output?.statusCode;
            if (statusCode !== DisconnectReason.loggedOut) setTimeout(() => startBot(), 5000);
        } else if (connection === 'open') {
            qrCodeData = "BOT ONLINE ✅";
            console.log('🚀 ONE4CARS Conectado con éxito');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        const from = msg.key.remoteJid;
        const body = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").toLowerCase().trim();

        // --- CONFIGURACIÓN DE RESPUESTAS ---
        // --- CONFIGURACIÓN DE RESPUESTAS (MENÚ ORIGINAL) ---
        const titulo = "🚗 *SOPORTE ONE4CARS*\n________________________\n\n";

        const respuestas = {
@@ -91,6 +91,7 @@
    });
}

// --- SERVIDOR HTTP (COBRANZA + QR + NOTIFICACIONES DE PAGO) ---
http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const path = parsedUrl.pathname;
@@ -214,7 +215,7 @@
            } catch(e) { res.writeHead(500); res.end('Error interno'); }
        });
    }
    // --- NUEVA RUTA AGREGADA PARA PAGOS ---
    // --- RUTA PARA LOS PAGOS AUTOMÁTICOS DESDE HOSTGATOR ---
    else if (path === '/enviar-pago' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk.toString(); });
@@ -233,16 +234,15 @@
            } catch(e) { res.writeHead(500); res.end('Error'); }
        });
    }
    // --- FIN NUEVA RUTA ---
    else {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        if (qrCodeData.includes("data:image")) {
            res.write(`<center style="margin-top:50px;"><h1>Escanea ONE4CARS</h1><img src="${qrCodeData}" width="300"><br><br><a href="/cobranza" style="color:blue">Ir a Cobranza</a></center>`);
        } else {
            res.write(`<center style="margin-top:100px;"><h1>${qrCodeData || "Iniciando..."}</h1><br><a href="/cobranza" style="padding:10px 20px; background:green; color:white; border-radius:5px; text-decoration:none;">ENTRAR A COBRANZA</a></center>`);
        }
        res.end();
    }
}).listen(port, '0.0.0.0');

startBot();
