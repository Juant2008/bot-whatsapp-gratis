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
        version, auth: state, printQRInTerminal: false,
        logger: pino({ level: 'error' }),
        browser: ["ONE4CARS Bot", "Chrome", "1.0.0"],
        syncFullHistory: false,
        shouldIgnoreJid: jid => jid.includes('broadcast') || jid.includes('@g.us')
    });
    global.sockBot = sock;
    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) qrcode.toDataURL(qr, (err, url) => { qrCodeData = url; });
        if (connection === 'close') {
            if ((lastDisconnect.error instanceof Boom)?.output?.statusCode !== DisconnectReason.loggedOut) setTimeout(() => startBot(), 5000);
        } else if (connection === 'open') { qrCodeData = "BOT ONLINE ✅"; }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe || msg.key.remoteJid.includes('@g.us')) return;
        const from = msg.key.remoteJid;
        const body = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").toLowerCase().trim();
        const saludoEnlace = 'Saludos estimado, toque el siguiente enlace para ';

        if (body.includes('medios de pago')) await sock.sendMessage(from, { text: `${saludoEnlace} consultar:\n\n👉 *MEDIOS DE PAGO*\nhttps://www.one4cars.com/medios_de_pago.php` });
        else if (body.includes('estado de cuenta')) await sock.sendMessage(from, { text: `${saludoEnlace} obtener su:\n\n👉 *ESTADO DE CUENTA*\nhttps://www.one4cars.com/estado_de_cuenta_cliente.php` });
        else if (body.includes('lista de precios')) await sock.sendMessage(from, { text: `${saludoEnlace} ver nuestra:\n\n👉 *LISTA DE PRECIOS*\nhttps://www.one4cars.com/lista_de_precios.php` });
        else if (body.includes('tomar pedido')) await sock.sendMessage(from, { text: `${saludoEnlace} realizar su:\n\n👉 *TOMAR PEDIDO*\nhttps://www.one4cars.com/tomar_pedido.php` });
        else if (body.includes('afiliar cliente')) await sock.sendMessage(from, { text: `${saludoEnlace} realizar la:\n\n👉 *AFILIAR CLIENTE*\nhttps://www.one4cars.com/afiliacion_cliente.php` });
        else if (body.includes('aprobar cliente')) await sock.sendMessage(from, { text: `${saludoEnlace} gestionar la:\n\n👉 *APROBACIÓN DE CLIENTE*\nhttps://www.one4cars.com/aprobadora_clientes.php` });
        else if (body.includes('mis clientes')) await sock.sendMessage(from, { text: `${saludoEnlace} gestionar su:\n\n👉 *CARTERA DE CLIENTES*\nhttps://www.one4cars.com/acceso_vendedores.php` });
        else if (body.includes('ficha producto')) await sock.sendMessage(from, { text: `${saludoEnlace} consultar la:\n\n👉 *FICHA DE PRODUCTO*\nhttps://www.one4cars.com/consulta_productos.php` });
        else if (body.includes('despacho')) await sock.sendMessage(from, { text: `${saludoEnlace} ver su:\n\n👉 *SEGUIMIENTO DE DESPACHO*\nhttps://www.one4cars.com/despacho_cliente_web.php` });
        else if (body.includes('asesor')) await sock.sendMessage(from, { text: 'Saludos estimado, en un momento un asesor se comunicará con usted de forma manual.' });
        else {
            const saludos = ['hola', 'buendia', 'buen dia', 'buenos dias', 'buenas tardes', 'saludos'];
            if (saludos.some(s => body.includes(s))) {
                await sock.sendMessage(from, { text: 'Hola! Bienvenido a *ONE4CARS* 🚗. Tu asistente virtual está listo para apoyarte.\n\nEscribe la frase de la opción que necesitas:\n\n📲 *Menú de Gestión Comercial*\n\n🏦 *Medios de Pago*\n📄 *Estado de Cuenta*\n💰 *Lista de Precios*\n🛒 *Tomar Pedido*\n👥 *Mis Clientes*\n📝 *Afiliar Cliente*\n⚙️ *Ficha Producto*\n🚚 *Despacho*\n👤 *Asesor*' });
            }
        }
    });
}

// --- SERVIDOR DASHBOARD PROFESIONAL ---
const port = process.env.PORT || 10000;
http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });

    if (parsedUrl.pathname === '/cobrar-ahora') {
        deudoresEnMemoria = await obtenerListaDeudores();
        let rows = deudoresEnMemoria.map((d, i) => `
            <tr>
                <td><input type="checkbox" name="cliente_${i}" value="${d.celular}" checked class="user-check"></td>
                <td>${d.nombres}</td>
                <td><b>${d.nro_factura}</b></td>
                <td style="color:red; font-weight:bold;">$${d.total}</td>
                <td>${d.fecha_reg}</td>
            </tr>`).join('');

        res.write(`
        <!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
        <style>
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background: #f0f2f5; margin: 0; padding: 20px; color: #333; }
            .container { max-width: 900px; margin: auto; background: white; padding: 30px; border-radius: 12px; box-shadow: 0 10px 25px rgba(0,0,0,0.1); }
            h2 { color: #1a73e8; margin-bottom: 5px; }
            .header { border-bottom: 2px solid #eee; margin-bottom: 20px; padding-bottom: 10px; display: flex; justify-content: space-between; align-items: center; }
            table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 14px; }
            th { background: #f8f9fa; text-align: left; padding: 12px; border-bottom: 2px solid #dee2e6; }
            td { padding: 12px; border-bottom: 1px solid #eee; }
            .btn-send { background: #28a745; color: white; border: none; padding: 12px 25px; border-radius: 6px; font-weight: bold; cursor: pointer; font-size: 16px; transition: 0.3s; width: 100%; margin-top: 20px; }
            .btn-send:hover { background: #218838; }
            .select-all { margin-bottom: 15px; font-size: 14px; color: #666; }
            input[type="checkbox"] { transform: scale(1.3); cursor: pointer; }
        </style>
        <script>
            function toggleAll(source) {
                const checkboxes = document.getElementsByClassName('user-check');
                for(let i=0; i<checkboxes.length; i++) checkboxes[i].checked = source.checked;
            }
        </script>
        </head><body>
        <div class="container">
            <div class="header">
                <div><h2>Panel de Cobranza</h2><p>ONE4CARS 🚗 - Facturas >300 días</p></div>
                <div style="text-align:right"><b>Total:</b> ${deudoresEnMemoria.length}</div>
            </div>
            <form action="/confirmar-envio" method="GET">
                <div class="select-all">
                    <input type="checkbox" id="master" checked onclick="toggleAll(this)"> <label for="master">Seleccionar/Deseleccionar Todos</label>
                </div>
                <table>
                    <thead><tr><th>Env?</th><th>Cliente</th><th>Factura</th><th>Monto</th><th>Fecha</th></tr></thead>
                    <tbody>${rows || '<tr><td colspan="5">No hay facturas vencidas</td></tr>'}</tbody>
                </table>
                ${deudoresEnMemoria.length > 0 ? '<button type="submit" class="btn-send">🚀 ENVIAR RECORDATORIOS POR WHATSAPP</button>' : ''}
            </form>
        </div>
        </body></html>`);
        res.end();
    } 
    else if (parsedUrl.pathname === '/confirmar-envio') {
        const query = parsedUrl.query;
        const celularesAEnviar = Object.values(query); // Obtenemos los números marcados
        
        // Filtramos de nuestra memoria solo los seleccionados
        const deudoresFinales = deudoresEnMemoria.filter(d => celularesAEnviar.includes(d.celular));

        res.write(`
        <body style="font-family:sans-serif; text-align:center; padding-top:50px;">
            <div style="max-width:400px; margin:auto; border:1px solid #ccc; padding:20px; border-radius:10px;">
                <h1 style="color:#28a745;">🚀 Procesando...</h1>
                <p>Enviando a <b>${deudoresFinales.length}</b> clientes.</p>
                <p>El bot enviará un mensaje cada 20-30 segundos para proteger tu número.</p>
                <a href="/cobrar-ahora" style="color:#1a73e8;">Volver al panel</a>
            </div>
        </body>`);
        res.end();

        if (global.sockBot && deudoresFinales.length > 0) {
            ejecutarEnvioMasivo(global.sockBot, deudoresFinales);
        }
    } 
    else {
        res.write(`<center style="font-family:Arial; padding-top:100px;">
            ${qrCodeData.includes("data:image") ? `<h1>Escanea para conectar</h1><img src="${qrCodeData}" width="300">` : `<h1>✅ BOT ONLINE</h1><p><a href="/cobrar-ahora">Ir al Panel de Cobranza</a></p>`}
        </center>`);
        res.end();
    }
}).listen(port, '0.0.0.0', () => {
    console.log("Servidor Dashboard OK");
    startBot();
});
