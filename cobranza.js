const mysql = require('mysql2/promise');

const dbConfig = {
    host: 'one4cars.com',
    user: 'juant200_one4car',
    password: 'Notieneclave1*',
    database: 'juant200_venezon',
    connectTimeout: 30000 
};

async function obtenerListaDeudores() {
    let connection;
    try {
        connection = await mysql.createConnection(dbConfig);
        // Consulta directa a la tabla de facturas (sin JOINs para evitar errores)
        const [rows] = await connection.execute(
            `SELECT celular, nombres, nro_factura, total, abono_factura, 
            (total - abono_factura) as saldo_pendiente, fecha_reg,
            DATEDIFF(CURDATE(), fecha_reg) as dias 
            FROM tab_facturas 
            WHERE pagada = 'NO' AND id_cliente <> 334 AND anulado <> 'si'
            AND (total - abono_factura) > 0
            AND DATEDIFF(CURDATE(), fecha_reg) > 30
            ORDER BY fecha_reg ASC`
        );
        return rows;
    } catch (error) {
        console.error("❌ Error DB:", error.message);
        return [];
    } finally {
        if (connection) await connection.end();
    }
}

async function ejecutarEnvioMasivo(sock, deudores) {
    console.log(`🚀 Iniciando tanda de mensajes para ${deudores.length} clientes...`);
    for (constmedios_de_pago.php` });
        else if (body.includes('estado de cuenta')) await sock.sendMessage(from, { text: `${saludoEnlace} obtener su:\n\n👉 *ESTADO DE CUENTA*\nhttps://www.one4cars.com/estado_de_cuenta_cliente.php` });
        else if (body.includes('lista de precios')) await sock.sendMessage(from, { text: `${saludoEnlace} ver nuestra:\n\n👉 *LISTA DE PRECIOS*\nhttps://www.one4cars.com/lista_de_precios.php` });
        else if (body.includes('tomar pedido')) await sock.sendMessage(from, { text: `${saludoEnlace} realizar su:\n\n👉 *TOMAR PEDIDO*\nhttps://www.one4cars.com/tomar_pedido.php` });
        else if (body.includes('afiliar cliente')) await sock.sendMessage(from, { text: `${saludoEnlace} realizar la:\n\n👉 *AFILIAR CLIENTE*\nhttps://www.one4cars.com/afiliacion_cliente.php` });
        else if (body.includes('aprobar cliente')) await sock.sendMessage(from, { text: `${saludoEnlace} gestionar la:\n\n👉 *APROBACIÓN DE CLIENTE*\nhttps://www.one4cars.com/aprobadora_clientes.php` });
        else if (body.includes('asesor')) await sock.sendMessage(from, { text: 'Saludos estimado, en un momento un asesor se comunicará con usted de forma manual.' });
        else {
            const saludos = ['hola', 'buendia', 'buen dia', 'buenos dias', 'buenas tardes', 'saludos'];
            if (saludos.some(s => body.includes(s))) {
                const menu = 'Hola! Bienvenido a *ONE4CARS* 🚗. Tu asistente virtual está listo para apoyarte.\n\nEscribe la frase de la opción que necesitas, saveCreds } = await useMultiFileAuthState('auth_info');
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
        const body = (msg. || jid.includes('@g.us'), connectTimeoutMs: 60000
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
        const saludo = 'Saludos estimado, toque el siguiente enlace para ';

        if (body.includes('medios de pago')) await sock.sendMessage(from, { text: `${saludo} consultar:\n\n👉 *MEDIOS DE PAGO*\nhttps://www.one4cars.com/medios_de_pago.php` });
        else if (body.includes('estado de cuenta')) await sock.sendMessage(from, { text: `${saludo} obtener su:\n\n👉 *ESTADO DE CUENTA*\nhttps://www.one4cars.com/estado_de_cuenta_cliente.php` });
        else if (body.includes('lista de precios') || body.includes('listas de precios')) await sock.sendMessage(from, { text: `${saludo} ver nuestra:\n\n👉 *LISTA DE row of deudores) {
        try {
            // El celular ya trae el 58, solo quitamos cualquier caracter no numérico
            let num = row.celular.toString().replace(/\D/g, '');
            const jid = `${num}@s.whatsapp.net`;
            
            const saldo = parseFloat(row.saldo_pendiente).toFixed(2);
            const texto = `Hola *${row.nombres}* 🚗, te saludamos de *ONE4CARS*.\n\nLe recordamos que su factura *${row.nro_factura}* presenta un *SALDO PENDIENTE de $${saldo}*.\n\nEsta factura tiene ${row.dias} días de vencimiento. Por favor, gestione su pago a la brevedad.`;

            await sock.sendMessage(jid, { text: texto });
            console.log(`✅ Enviado a: ${row.nombres}`);
            
            // Pausa de 20 segundos para seguridad
            await new Promise(r => setTimeout(r, 20000));
        } catch (e) {
            console.error(`❌ Error enviando a ${row.nombres}:`, e.message);
        }
    }
    console.log("🏁 Proceso terminado.");
}

module.exports = { obtenerListaDeudores, ejecutarEnvioMasivo };
