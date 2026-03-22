const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const qrcode = require('qrcode');
const http = require('http');

const PORT = process.env.PORT || 10000;

let qrCodeData = "Iniciando...";
let botStarted = false;

// ===== BOT =====
async function startBot() {

    if (botStarted) return; // 🔥 evita doble ejecución
    botStarted = true;

    const { state, saveCreds } = await useMultiFileAuthState('auth_info');

    const sock = makeWASocket({
        auth: state,
        printQRInTerminal: false
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            qrcode.toDataURL(qr, (_, url) => {
                qrCodeData = url;
            });
        }

        if (connection === 'open') {
            qrCodeData = "ONLINE ✅";
            console.log("BOT CONECTADO");
        }

        if (connection === 'close') {
            const shouldReconnect =
                (lastDisconnect.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut;

            if (shouldReconnect) {
                botStarted = false;
                startBot();
            }
        }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        const msg = messages[0];
        if (!msg.message) return;

        const from = msg.key.remoteJid;

        // ❌ NO GRUPOS
        if (from.includes('@g.us')) return;

        const text = msg.message.conversation || "";
        if (!text) return;

        await sock.sendMessage(from, {
            text: "🤖 Bot activo ONE4CARS"
        });
    });
}

// ===== SERVER =====
const server = http.createServer((req, res) => {

    res.writeHead(200, { 'Content-Type': 'text/html' });

    res.end(`
        <h2>ONE4CARS BOT</h2>
        ${
            qrCodeData.startsWith('data')
            ? `<img src="${qrCodeData}" width="250"/>`
            : `<h3>${qrCodeData}</h3>`
        }
    `);
});

// 🔥 SOLO UNA VEZ (BLINDADO)
server.listen(PORT, '0.0.0.0', () => {
    console.log("Servidor activo en puerto", PORT);
    startBot();
});