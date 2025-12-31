const qrcode = require('qrcode');
const http = require('http');
const pino = require('pino');
const { ejecutarCobranza } = require('./cobranza');
const { obtenerListaDeudores, ejecutarEnvioMasivo } = require('./cobranza');

const mongoURI = "mongodb+srv://one4cars:v6228688@one4cars.fpwdlwe.mongodb.net/?retryWrites=true&w=majority";
let qrCodeData = "";
global.sockBot = null;
let deudoresPendientes = []; // Memoria temporal para la confirmación

mongoose.connect(mongoURI).then(() => console.log("✅ MongoDB Conectado")).catch(err => console.log("❌ Error MongoDB"));

@@ -37,7 +38,6 @@ async function startBot() {
            if (statusCode !== DisconnectReason.loggedOut) setTimeout(() => startBot(), 5000);
        } else if (connection === 'open') {
            qrCodeData = "BOT ONLINE ✅";
            console.log('🚀 ONE4CARS EN LÍNEA');
        }
    });

@@ -50,9 +50,7 @@ async function startBot() {
        const body = (msg.message.conversation || msg.message.extendedTextMessage?.text || "").toLowerCase().trim();
        const saludoFormal = 'Saludos estimado, ingrese al siguiente link para ';

        // --- LÓGICA DE RESPUESTAS (RESTABLECIDA SEGÚN TU ÚLTIMA VERSIÓN) ---
        
        if (body.includes('medios de pago') || body.includes('numero de cuenta') || body.includes('numeros de cuenta')) {
        if (body.includes('medios de pago')) {
            await sock.sendMessage(from, { text: saludoFormal + 'obtener nuestras formas de pago:\n\nhttps://www.one4cars.com/medios_de_pago.php/' });
        }
        else if (body.includes('estado de cuenta')) {
@@ -82,36 +80,64 @@ async function startBot() {
        else if (body.includes('asesor')) {
            await sock.sendMessage(from, { text: 'Saludos estimado, en un momento un asesor se comunicará con usted de forma manual.' });
        }
        // --- MENÚ PRINCIPAL ---
        else {
            const saludos = ['hola', 'buendia', 'buen dia', 'buenos dias', 'buenas tardes', 'saludos'];
            if (saludos.some(s => body === s || body.includes(s)) && !body.includes('http')) {
            if (saludos.some(s => body.includes(s))) {
                const menu = 'Hola! Bienvenido a *ONE4CARS* 🚗. Tu asistente virtual está listo para apoyarte.\n\nEscribe la frase de la opción que necesitas:\n\n📲 *Menú de Gestión Comercial*\n🏦 *Medios de Pago*\n📄 *Estado de Cuenta*\n💰 *Lista de Precios*\n🛒 *Tomar Pedido*\n👥 *Mis Clientes*\n👥 *Afiliar Clientes*\n⚙️ *Ficha Producto*\n🚚 *Despacho*\n👤 *Asesor*';
                await sock.sendMessage(from, { text: menu });
            }
        }
    });
}

// --- SERVIDOR WEB PROFESIONAL ---
const port = process.env.PORT || 10000;
const server = http.createServer(async (req, res) => {
http.createServer(async (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    
    // RUTA 1: Vista Previa de Deudores
    if (req.url === '/cobrar-ahora') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.write('<h1>🚀 Ejecutando cobranza masiva...</h1>');
        deudoresPendientes = await obtenerListaDeudores();
        let tabla = deudoresPendientes.map(d => `<tr><td>${d.nombres}</td><td>${d.nro_factura}</td><td>${d.total}</td><td>${d.celular}</td></tr>`).join('');
        
        res.write(`
            <html><head><style>
                body { font-family: Arial; background: #f4f4f4; text-align: center; }
                table { width: 90%; margin: 20px auto; border-collapse: collapse; background: white; }
                th, td { border: 1px solid #ddd; padding: 12px; }
                th { background: #2c3e50; color: white; }
                .btn { background: #27ae60; color: white; padding: 15px 30px; text-decoration: none; border-radius: 5px; font-weight: bold; }
            </style></head><body>
                <h1>📋 Lista de Cobranza (>30 días)</h1>
                <p>Se encontraron <b>${deudoresPendientes.length}</b> facturas pendientes.</p>
                <table>
                    <tr><th>Cliente</th><th>Factura</th><th>Monto</th><th>WhatsApp</th></tr>
                    ${tabla}
                </table>
                <br>
                ${deudoresPendientes.length > 0 ? `<a href="/confirmar-envio" class="btn">🚀 CONFIRMAR Y ENVIAR MENSAJES</a>` : '<b>No hay deudas vencidas.</b>'}
            </body></html>
        `);
        res.end();
    } 
    // RUTA 2: Ejecución tras confirmación
    else if (req.url === '/confirmar-envio') {
        res.write('<h1>🚀 Envío en progreso...</h1><p>El bot está enviando los mensajes cada 30 segundos para evitar bloqueos. Puedes cerrar esta ventana.</p>');
        res.end();
        if (global.sockBot) ejecutarCobranza(global.sockBot).catch(e => console.log(e));
    } else {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        if (global.sockBot && deudoresPendientes.length > 0) {
            ejecutarEnvioMasivo(global.sockBot, deudoresPendientes).then(() => deudoresPendientes = []);
        }
    } 
    // RUTA 3: Home (QR)
    else {
        if (qrCodeData.includes("data:image")) {
            res.write(`<center><h1>🚗 ESCANEA EL QR</h1><img src="${qrCodeData}" width="300"></center>`);
        } else {
            res.write(`<center><h1>✅ BOT ONLINE</h1><p>ONE4CARS Activo.</p></center>`);
            res.write(`<center><h1>✅ BOT ONLINE</h1><p>Visita <a href="/cobrar-ahora">/cobrar-ahora</a> para ver deudores.</p></center>`);
        }
        res.end();
    }
});

server.listen(port, '0.0.0.0', () => {
    console.log(`Servidor activo puerto ${port}`);
}).listen(port, '0.0.0.0', () => {
    console.log("Servidor listo");
    startBot();
});
